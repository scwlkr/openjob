import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreUserStore } from "../db/users.ts";
import { createFirebaseIdTokenVerifier } from "../server/firebase-id-token.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
import { createTestFirebaseAuthority } from "./support/firebase-id-tokens.mjs";
import {
  createV1TestHarness,
  emptyGroupStore,
} from "./support/v1-harness.mjs";

async function createPrivateKey() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const base64 = Buffer.from(pkcs8).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

function createFakeFirestore() {
  const database = "projects/openjob-dev/databases/(default)";
  const documents = new Map();
  const commits = [];
  let revision = 0;

  function error(status, message) {
    return Response.json(
      { error: { code: 409, message, status } },
      { status: 409 },
    );
  }

  function applyCommit(body) {
    const snapshot = new Map(documents);
    for (const write of body.writes) {
      const current = snapshot.get(write.update.name);
      if (write.currentDocument?.exists === false && current) {
        return error("ALREADY_EXISTS", "Document already exists.");
      }
      if (
        write.currentDocument?.updateTime &&
        current?.updateTime !== write.currentDocument.updateTime
      ) {
        return error("FAILED_PRECONDITION", "Document changed.");
      }
    }

    for (const write of body.writes) {
      const current = snapshot.get(write.update.name);
      const masked = write.updateMask?.fieldPaths;
      const fields = masked
        ? {
            ...(current?.fields ?? {}),
            ...Object.fromEntries(
              masked.map((field) => [field, write.update.fields[field]]),
            ),
          }
        : write.update.fields;
      revision += 1;
      documents.set(write.update.name, {
        name: write.update.name,
        fields,
        updateTime: `2026-07-15T12:00:00.${String(revision).padStart(6, "0")}Z`,
      });
    }
    return Response.json({ commitTime: "2026-07-15T12:00:00.999999Z" });
  }

  return {
    commits,
    documents,
    async fetch(input, init = {}) {
      const url = new URL(input);
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ access_token: "test-service-access", expires_in: 3600 });
      }

      assert.equal(
        new Headers(init.headers).get("authorization"),
        "Bearer test-service-access",
      );
      if (url.pathname.endsWith("/documents:commit")) {
        const body = JSON.parse(init.body);
        commits.push(body);
        return applyCommit(body);
      }

      const marker = "/documents/";
      const path = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
      const document = documents.get(`${database}/documents/${path}`);
      return document
        ? Response.json(document)
        : Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
    },
  };
}

test("Firestore persists Users and atomically reserves immutable Usernames", async () => {
  const firestore = createFakeFirestore();
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const users = createFirestoreUserStore(
    {
      projectId: "openjob-dev",
      clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
      privateKey: await createPrivateKey(),
    },
    firestore.fetch,
    {
      now: () => Date.parse("2026-07-15T12:00:00.000Z"),
      randomUUID: () => ids.shift(),
    },
  );

  const shane = await users.getOrCreate("firebase_shane");
  assert.deepEqual(shane, {
    userId: "user_11111111111141118111111111111111",
    username: null,
  });
  assert.deepEqual(await users.getById(shane.userId), shane);
  assert.deepEqual(await users.getOrCreate("firebase_shane"), shane);

  const claimed = await users.claimUsername("firebase_shane", "shane");
  assert.deepEqual(claimed, {
    kind: "claimed",
    user: { ...shane, username: "shane" },
  });
  assert.deepEqual(await users.getById(shane.userId), claimed.user);
  assert.deepEqual(await users.claimUsername("firebase_shane", "shane"), claimed);
  assert.deepEqual(await users.claimUsername("firebase_shane", "other"), {
    kind: "immutable",
  });

  await users.getOrCreate("firebase_eli");
  assert.deepEqual(await users.claimUsername("firebase_eli", "shane"), {
    kind: "taken",
  });

  const claimCommit = firestore.commits.find(({ writes }) =>
    writes[0].update.name.endsWith("/v1Usernames/shane"),
  );
  assert.equal(claimCommit.writes[0].currentDocument.exists, false);
  assert.match(claimCommit.writes[0].update.name, /\/v1Usernames\/shane$/);
  assert.deepEqual(claimCommit.writes[1].updateMask.fieldPaths, ["username"]);
  assert.equal(typeof claimCommit.writes[1].currentDocument.updateTime, "string");
  assert.match(claimCommit.writes[2].update.name, /\/v1UserDirectory\/user_/);
  assert.deepEqual(claimCommit.writes[2].updateMask.fieldPaths, ["username"]);

  const storedData = JSON.stringify([...firestore.documents.values()]);
  assert.doesNotMatch(storedData, /firebase_shane|firebase_eli|example\.test|Google Name/);
  assert.doesNotMatch(storedData, /authorization|Bearer|privateKey|tasks/);
});

test("the black-box identity journey persists through the Firestore adapter", async (t) => {
  const now = "2026-07-15T12:00:00.000Z";
  const authority = await createTestFirebaseAuthority({ now });
  const firestore = createFakeFirestore();
  const privateKey = await createPrivateKey();
  const ids = [
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ];
  const harness = createV1TestHarness({
    initialNow: now,
    createWorker(controls) {
      return createV1IdentityApi({
        groups: emptyGroupStore,
        users: createFirestoreUserStore(
          {
            projectId: "openjob-dev",
            clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
            privateKey,
          },
          firestore.fetch,
          {
            now: () => Date.parse(controls.clock.now()),
            randomUUID: () => ids.shift(),
          },
        ),
        verifyIdToken: createFirebaseIdTokenVerifier({
          fetchImplementation: authority.fetch,
          now: () => Date.parse(controls.clock.now()),
          projectId: "openjob-dev",
        }),
      });
    },
  });
  t.after(() => harness.close());
  const shaneHeaders = {
    authorization: `Bearer ${await authority.issue({ uid: "firebase_shane" })}`,
  };
  const eliHeaders = {
    authorization: `Bearer ${await authority.issue({ uid: "firebase_eli" })}`,
  };

  const beforeClaim = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: "/api/v1/me",
  });
  assert.equal((await beforeClaim.json()).data.usernameRequired, true);

  const claim = await harness.request({
    body: { username: "shane" },
    headers: shaneHeaders,
    method: "PUT",
    path: "/api/v1/me/username",
  });
  assert.equal(claim.status, 200);
  const shane = (await claim.json()).data;

  await harness.restart();
  const persisted = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: "/api/v1/me",
  });
  assert.deepEqual((await persisted.json()).data, shane);

  const taken = await harness.request({
    body: { username: "shane" },
    headers: eliHeaders,
    method: "PUT",
    path: "/api/v1/me/username",
  });
  assert.equal(taken.status, 409);
  assert.equal((await taken.json()).error.code, "username_taken");
});
