import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreGroupStore } from "../db/groups.ts";
import { createFirestoreUserStore } from "../db/users.ts";
import { createFirebaseIdTokenVerifier } from "../server/firebase-id-token.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
import { createTestFirebaseAuthority } from "./support/firebase-id-tokens.mjs";
import {
  createV1TestHarness,
  emptyGroupStore,
} from "./support/v1-harness.mjs";
import {
  createFakeFirestore as createSharedFakeFirestore,
  createPrivateKey as createSharedPrivateKey,
} from "./support/fake-firestore.mjs";

async function sha256Key(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("base64url");
}

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

  const shaneIdentity = {
    authenticatedAt: Date.parse("2026-07-15T11:59:00.000Z"),
    provider: "google",
    uid: "firebase_shane",
  };
  const eliIdentity = {
    ...shaneIdentity,
    uid: "firebase_eli",
  };
  const shaneCreation = await users.create(shaneIdentity);
  const shane = shaneCreation.user;
  assert.deepEqual(shaneCreation, {
    kind: "created",
    user: {
      userId: "user_11111111111141118111111111111111",
      username: null,
    },
  });
  assert.deepEqual(shane, {
    userId: "user_11111111111141118111111111111111",
    username: null,
  });
  assert.deepEqual(await users.getById(shane.userId), shane);
  assert.deepEqual(await users.resolve(shaneIdentity), shane);

  const claimed = await users.claimUsername(shaneIdentity, "shane");
  assert.deepEqual(claimed, {
    kind: "claimed",
    user: { ...shane, username: "shane" },
  });
  assert.deepEqual(await users.getById(shane.userId), claimed.user);
  assert.deepEqual(await users.claimUsername(shaneIdentity, "shane"), claimed);
  assert.deepEqual(await users.claimUsername(shaneIdentity, "other"), {
    kind: "immutable",
  });

  await users.create(eliIdentity);
  assert.deepEqual(await users.claimUsername(eliIdentity, "shane"), {
    kind: "taken",
  });

  const claimCommit = firestore.commits.find(({ writes }) =>
    writes[0].update.name.endsWith("/v1Usernames/shane"),
  );
  assert.equal(claimCommit.writes[0].currentDocument.exists, false);
  assert.match(claimCommit.writes[0].update.name, /\/v1Usernames\/shane$/);
  assert.equal(typeof claimCommit.writes[1].currentDocument.updateTime, "string");
  assert.match(claimCommit.writes[1].update.name, /\/v1UserDirectory\/user_/);
  assert.deepEqual(claimCommit.writes[1].updateMask.fieldPaths, [
    "username",
    "emptyShellEligible",
  ]);

  const storedData = JSON.stringify([...firestore.documents.values()]);
  assert.doesNotMatch(storedData, /firebase_shane|firebase_eli|example\.test|Google Name/);
  assert.doesNotMatch(storedData, /authorization|Bearer|privateKey|tasks/);
});

test("Firestore creates only explicitly confirmed provider-scoped Sign-in Methods", async () => {
  const firestore = createSharedFakeFirestore();
  const users = createFirestoreUserStore(
    {
      projectId: "openjob-dev",
      clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
      privateKey: await createSharedPrivateKey(),
    },
    firestore.fetch,
    {
      now: () => Date.parse("2026-07-23T12:00:00.000Z"),
      randomUUID: () => "55555555-5555-4555-8555-555555555555",
    },
  );
  const google = {
    authenticatedAt: Date.parse("2026-07-23T11:59:00.000Z"),
    provider: "google",
    uid: "firebase_shared_uid",
  };
  const apple = { ...google, provider: "apple" };

  assert.equal(await users.resolve(google), null);
  assert.equal(await users.resolve(apple), null);
  assert.deepEqual(await users.link(google, apple), {
    kind: "unrecognized",
  });
  assert.equal(firestore.commitAttempts(), 0);

  const created = await users.create(google);
  assert.deepEqual(created, {
    kind: "created",
    user: {
      userId: "user_55555555555545558555555555555555",
      username: null,
    },
  });
  assert.deepEqual(await users.resolve(google), created.user);
  assert.equal(await users.resolve(apple), null);
  assert.deepEqual(await users.create(google), {
    kind: "existing",
    user: created.user,
  });
  assert.deepEqual(await users.link(apple, google), {
    kind: "linked",
    user: created.user,
  });
  assert.deepEqual(await users.resolve(apple), created.user);
  assert.deepEqual(await users.link(apple, google), {
    kind: "linked",
    user: created.user,
  });
  assert.deepEqual(await users.listSignInMethods(created.user.userId), [
    "apple",
    "google",
  ]);

  const persisted = JSON.stringify([...firestore.documents.values()]);
  assert.doesNotMatch(persisted, /firebase_shared_uid|example\.test|Bearer/);
  assert.match(persisted, /google/);
  assert.equal(
    [...firestore.documents.keys()].filter((name) =>
      name.includes("/v1UserDirectory/"),
    ).length,
    1,
  );
});

test("Firestore persists the internal QA password principal but never links it", async () => {
  const firestore = createSharedFakeFirestore({ projectId: "openjob-nonprod" });
  const users = createFirestoreUserStore(
    {
      projectId: "openjob-nonprod",
      clientEmail: "worker@openjob-nonprod.iam.gserviceaccount.com",
      privateKey: await createSharedPrivateKey(),
    },
    firestore.fetch,
    {
      now: () => Date.parse("2026-07-24T12:00:00.000Z"),
      randomUUID: () => "77777777-7777-4777-8777-777777777777",
    },
  );
  const qaPassword = {
    authenticatedAt: Date.parse("2026-07-24T11:59:00.000Z"),
    provider: "qa-password",
    uid: "firebase_qa_two",
  };
  const google = {
    ...qaPassword,
    provider: "google",
    uid: "firebase_google",
  };

  const created = await users.create(qaPassword);
  assert.equal(created.kind, "created");
  assert.deepEqual(await users.resolve(qaPassword), created.user);
  assert.deepEqual(
    await users.claimUsername(qaPassword, "qa-two"),
    {
      kind: "claimed",
      user: { ...created.user, username: "qa-two" },
    },
  );
  assert.deepEqual(await users.listSignInMethods(created.user.userId), [
    "qa-password",
  ]);
  const commitCount = firestore.commitAttempts();
  assert.deepEqual(await users.link(qaPassword, google), {
    kind: "conflict",
  });
  assert.equal(firestore.commitAttempts(), commitCount);
});

test("legacy Google Users migrate without email matching and are never cleanup-eligible", async () => {
  const firestore = createSharedFakeFirestore();
  const config = {
    projectId: "openjob-dev",
    clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
    privateKey: await createSharedPrivateKey(),
  };
  const database = "projects/openjob-dev/databases/(default)/documents";
  const legacyUid = "firebase_legacy_google";
  const legacyUser = {
    userId: "user_legacy",
    username: "legacy",
  };
  const legacyName = `${database}/v1Users/${await sha256Key(legacyUid)}`;
  firestore.documents.set(legacyName, {
    name: legacyName,
    fields: {
      userId: { stringValue: legacyUser.userId },
      username: { stringValue: legacyUser.username },
    },
    updateTime: "2026-07-22T12:00:00.000001Z",
  });
  const users = createFirestoreUserStore(config, firestore.fetch, {
    now: () => Date.parse("2026-07-23T12:00:00.000Z"),
    randomUUID: () => "56565656-5656-4565-8565-565656565656",
  });
  const google = {
    authenticatedAt: Date.parse("2026-07-23T11:59:00.000Z"),
    provider: "google",
    uid: legacyUid,
  };
  const sameSubjectApple = { ...google, provider: "apple" };
  const emptyApple = {
    ...sameSubjectApple,
    uid: "firebase_empty_apple",
  };

  assert.deepEqual(await users.resolve(google), legacyUser);
  assert.equal(await users.resolve(sameSubjectApple), null);
  const directory = firestore.documents.get(
    `${database}/v1UserDirectory/${legacyUser.userId}`,
  );
  assert.equal(directory.fields.emptyShellEligible.booleanValue, false);

  const shell = (await users.create(emptyApple)).user;
  assert.deepEqual(await users.link(emptyApple, google), {
    kind: "linked",
    user: legacyUser,
  });
  assert.equal(await users.getById(shell.userId), null);
  assert.deepEqual(await users.resolve(emptyApple), legacyUser);
});

test("Firestore links an unknown method and removes only a proven empty shell atomically", async () => {
  const firestore = createSharedFakeFirestore();
  const ids = [
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
  ];
  const users = createFirestoreUserStore(
    {
      projectId: "openjob-dev",
      clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
      privateKey: await createSharedPrivateKey(),
    },
    firestore.fetch,
    {
      now: () => Date.parse("2026-07-23T12:00:00.000Z"),
      randomUUID: () => ids.shift(),
    },
  );
  const google = {
    authenticatedAt: Date.parse("2026-07-23T11:59:00.000Z"),
    provider: "google",
    uid: "firebase_main_google",
  };
  const apple = {
    authenticatedAt: Date.parse("2026-07-23T11:59:30.000Z"),
    provider: "apple",
    uid: "firebase_shell_apple",
  };
  const main = (await users.create(google)).user;
  const shell = (await users.create(apple)).user;
  await users.claimUsername(google, "shane");

  const linked = await users.link(google, apple);
  assert.deepEqual(linked, {
    kind: "linked",
    user: { ...main, username: "shane" },
  });
  assert.deepEqual(await users.resolve(apple), linked.user);
  assert.equal(await users.getById(shell.userId), null);
  assert.deepEqual(await users.listSignInMethods(main.userId), [
    "apple",
    "google",
  ]);

  const persisted = JSON.stringify([...firestore.documents.values()]);
  assert.doesNotMatch(
    persisted,
    /firebase_main_google|firebase_shell_apple|credentialToken|Bearer/,
  );
});

test("Firestore preserves the explicitly proved target when both Users are empty shells", async () => {
  const firestore = createSharedFakeFirestore();
  const ids = [
    "67676767-6767-4767-8767-676767676767",
    "78787878-7878-4787-8787-787878787878",
  ];
  const users = createFirestoreUserStore(
    {
      projectId: "openjob-dev",
      clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
      privateKey: await createSharedPrivateKey(),
    },
    firestore.fetch,
    {
      now: () => Date.parse("2026-07-23T12:00:00.000Z"),
      randomUUID: () => ids.shift(),
    },
  );
  const current = {
    authenticatedAt: Date.parse("2026-07-23T11:59:00.000Z"),
    provider: "google",
    uid: "firebase_current_shell",
  };
  const target = {
    authenticatedAt: Date.parse("2026-07-23T11:59:30.000Z"),
    provider: "apple",
    uid: "firebase_target_shell",
  };
  const currentUser = (await users.create(current)).user;
  const targetUser = (await users.create(target)).user;

  assert.deepEqual(
    await users.link(current, target, currentUser.userId),
    { kind: "target_changed" },
  );
  assert.deepEqual(await users.resolve(current), currentUser);
  assert.deepEqual(await users.resolve(target), targetUser);

  assert.deepEqual(await users.link(current, target, targetUser.userId), {
    kind: "linked",
    user: targetUser,
  });
  assert.equal(await users.getById(currentUser.userId), null);
  assert.deepEqual(await users.resolve(current), targetUser);
  assert.deepEqual(await users.resolve(target), targetUser);
  assert.deepEqual(await users.listSignInMethods(targetUser.userId), [
    "apple",
    "google",
  ]);
});

test("Firestore refuses provider-slot and historical User collisions without changing ownership", async () => {
  const firestore = createSharedFakeFirestore();
  const ids = [
    "88888888-8888-4888-8888-888888888888",
    "99999999-9999-4999-8999-999999999999",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ];
  const users = createFirestoreUserStore(
    {
      projectId: "openjob-dev",
      clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
      privateKey: await createSharedPrivateKey(),
    },
    firestore.fetch,
    {
      now: () => Date.parse("2026-07-23T12:00:00.000Z"),
      randomUUID: () => ids.shift(),
    },
  );
  const current = {
    authenticatedAt: Date.parse("2026-07-23T11:59:00.000Z"),
    provider: "google",
    uid: "firebase_current_google",
  };
  const linkedApple = {
    ...current,
    provider: "apple",
    uid: "firebase_linked_apple",
  };
  const otherApple = {
    ...current,
    provider: "apple",
    uid: "firebase_historical_apple",
  };
  const currentUser = (await users.create(current)).user;
  assert.equal((await users.link(current, linkedApple)).kind, "linked");
  const historicalUser = (await users.create(otherApple)).user;
  await users.claimUsername(otherApple, "historical");

  assert.deepEqual(await users.link(current, otherApple), {
    kind: "conflict",
  });
  assert.deepEqual(await users.resolve(otherApple), {
    ...historicalUser,
    username: "historical",
  });
  assert.deepEqual(await users.resolve(linkedApple), currentUser);
  assert.deepEqual(await users.listSignInMethods(currentUser.userId), [
    "apple",
    "google",
  ]);
});

test("Group membership preserves the historical User and only removes the other empty shell", async () => {
  const firestore = createSharedFakeFirestore();
  const userIds = [
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ];
  const config = {
    projectId: "openjob-dev",
    clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
    privateKey: await createSharedPrivateKey(),
  };
  const users = createFirestoreUserStore(config, firestore.fetch, {
    now: () => Date.parse("2026-07-23T12:00:00.000Z"),
    randomUUID: () => userIds.shift(),
  });
  const groups = createFirestoreGroupStore(config, firestore.fetch, {
    now: () => Date.parse("2026-07-23T12:00:00.000Z"),
    randomUUID: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  });
  const google = {
    authenticatedAt: Date.parse("2026-07-23T11:59:00.000Z"),
    provider: "google",
    uid: "firebase_group_target",
  };
  const apple = {
    ...google,
    provider: "apple",
    uid: "firebase_group_history",
  };
  const shell = (await users.create(google)).user;
  const historical = (await users.create(apple)).user;
  await groups.create(historical, "Historical Group");

  assert.deepEqual(await users.link(google, apple), {
    kind: "linked",
    user: historical,
  });
  assert.deepEqual(await users.resolve(google), historical);
  assert.deepEqual(await users.resolve(apple), historical);
  assert.equal(await users.getById(shell.userId), null);
});

test("Firestore never merges two Users with historical identity data", async () => {
  const firestore = createSharedFakeFirestore();
  const ids = [
    "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
    "dededede-dede-4ede-8ede-dededededede",
  ];
  const users = createFirestoreUserStore(
    {
      projectId: "openjob-dev",
      clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
      privateKey: await createSharedPrivateKey(),
    },
    firestore.fetch,
    {
      now: () => Date.parse("2026-07-23T12:00:00.000Z"),
      randomUUID: () => ids.shift(),
    },
  );
  const google = {
    authenticatedAt: Date.parse("2026-07-23T11:59:00.000Z"),
    provider: "google",
    uid: "firebase_historical_google",
  };
  const apple = {
    ...google,
    provider: "apple",
    uid: "firebase_historical_apple",
  };
  const googleUser = (await users.create(google)).user;
  const appleUser = (await users.create(apple)).user;
  await users.claimUsername(google, "googlehistory");
  await users.claimUsername(apple, "applehistory");

  assert.deepEqual(await users.link(google, apple), { kind: "conflict" });
  assert.deepEqual(await users.resolve(google), {
    ...googleUser,
    username: "googlehistory",
  });
  assert.deepEqual(await users.resolve(apple), {
    ...appleUser,
    username: "applehistory",
  });
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

  const unrecognized = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: "/api/v1/me",
  });
  assert.equal(unrecognized.status, 409);
  assert.equal(
    (await unrecognized.json()).error.code,
    "sign_in_method_unrecognized",
  );

  const created = await harness.request({
    body: { confirmation: "create" },
    headers: shaneHeaders,
    method: "POST",
    path: "/api/v1/me",
  });
  assert.equal(created.status, 201);

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

  const eliCreated = await harness.request({
    body: { confirmation: "create" },
    headers: eliHeaders,
    method: "POST",
    path: "/api/v1/me",
  });
  assert.equal(eliCreated.status, 201);

  const taken = await harness.request({
    body: { username: "shane" },
    headers: eliHeaders,
    method: "PUT",
    path: "/api/v1/me/username",
  });
  assert.equal(taken.status, 409);
  assert.equal((await taken.json()).error.code, "username_taken");
});
