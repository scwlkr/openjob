import assert from "node:assert/strict";
import test from "node:test";
import { createAccountDeletionProviderGateway } from "../server/account-deletion-providers.ts";
import { createPrivateKey } from "./support/fake-firestore.mjs";

async function createApplePrivateKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const base64 = Buffer.from(exported).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

async function createGateway(fetchImplementation) {
  return createAccountDeletionProviderGateway({
    apple: {
      allowedClientIds: ["dev.openjob.app", "dev.openjob.auth"],
      keyId: "APPLEKEY1",
      privateKey: await createApplePrivateKey(),
      teamId: "TEAMOPENJOB",
    },
    fetchImplementation,
    firebase: {
      clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
      privateKey: await createPrivateKey(),
      projectId: "openjob-dev",
    },
    now: () => Date.parse("2026-07-28T12:00:00.000Z"),
  });
}

test("provider gateway revokes Firebase sessions and deletes Firebase Users", async () => {
  const requests = [];
  const gateway = await createGateway(async (input, init = {}) => {
    requests.push({ body: init.body, headers: new Headers(init.headers), url: String(input) });
    if (String(input) === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "firebase-admin-access" });
    }
    return Response.json({ localId: "firebase_delete" });
  });
  gateway.assertReady();
  await gateway.revokeFirebaseSessions("firebase_delete");
  await gateway.deleteFirebaseUser("firebase_delete");
  const identityRequests = requests.filter(({ url }) =>
    url.includes("identitytoolkit.googleapis.com"),
  );
  assert.equal(identityRequests.length, 2);
  assert.ok(identityRequests[0].url.endsWith("/accounts:update"));
  assert.deepEqual(JSON.parse(identityRequests[0].body), {
    localId: "firebase_delete",
    validSince: "1785240000",
  });
  assert.ok(identityRequests[1].url.endsWith("/accounts:delete"));
  assert.equal(
    identityRequests.every(
      ({ headers }) => headers.get("authorization") === "Bearer firebase-admin-access",
    ),
    true,
  );
});

test("provider gateway treats repeated Google revocation as idempotent", async () => {
  const requests = [];
  const gateway = await createGateway(async (input) => {
    requests.push(String(input));
    return new Response(null, { status: 400 });
  });
  await gateway.revokeAuthorization({
    firebaseUid: "firebase_google",
    provider: "google",
    revocation: { kind: "access_token", value: "google-proof" },
  });
  assert.deepEqual(requests, [
    "https://oauth2.googleapis.com/revoke?token=google-proof",
  ]);
});

test("provider gateway exchanges a fresh Apple code and revokes the returned token", async () => {
  const requests = [];
  const gateway = await createGateway(async (input, init = {}) => {
    requests.push({ body: String(init.body ?? ""), url: String(input) });
    if (String(input).endsWith("/auth/token")) {
      return Response.json({ refresh_token: "apple-refresh" });
    }
    return new Response(null, { status: 200 });
  });
  await gateway.revokeAuthorization({
    firebaseUid: "firebase_apple",
    provider: "apple",
    revocation: {
      clientId: "dev.openjob.app",
      kind: "authorization_code",
      value: "fresh-apple-code",
    },
  });
  assert.equal(requests.length, 2);
  assert.ok(requests[0].body.includes("code=fresh-apple-code"));
  assert.ok(requests[0].body.includes("client_id=dev.openjob.app"));
  assert.ok(requests[1].body.includes("token=apple-refresh"));
  assert.ok(requests[1].body.includes("token_type_hint=refresh_token"));
});

test("provider gateway rejects an unapproved Apple client before exchange", async () => {
  let requests = 0;
  const gateway = await createGateway(async () => {
    requests += 1;
    return new Response(null, { status: 200 });
  });
  await assert.rejects(() =>
    gateway.revokeAuthorization({
      firebaseUid: "firebase_apple",
      provider: "apple",
      revocation: {
        clientId: "example.attacker",
        kind: "authorization_code",
        value: "fresh-apple-code",
      },
    }),
  );
  assert.equal(requests, 0);
});
