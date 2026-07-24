import assert from "node:assert/strict";
import test from "node:test";
import { createFirebaseIdTokenVerifier } from "../server/firebase-id-token.ts";
import {
  createV1IdentityApi,
  createV1IdentityHandler,
} from "../server/v1-identity.ts";
import { createTestFirebaseAuthority } from "./support/firebase-id-tokens.mjs";
import {
  createV1TestHarness,
  emptyGroupStore,
} from "./support/v1-harness.mjs";

const NOW = "2026-07-15T12:00:00.000Z";

function createHarnessUserStore(controls) {
  function newUser() {
    return {
      userId: `user_${crypto.randomUUID().replaceAll("-", "")}`,
      username: null,
    };
  }

  return {
    async create(identity) {
      return controls.state.transaction(async (state) => {
        const path = ["v1", "sign-in-methods", identity.provider, identity.uid];
        const existing = await state.get(path);
        if (existing) return { kind: "existing", user: existing };
        const user = newUser();
        await state.put(path, user);
        return { kind: "created", user };
      });
    },
    async resolve(identity) {
      return controls.state.get([
        "v1",
        "sign-in-methods",
        identity.provider,
        identity.uid,
      ]);
    },
    async claimUsername(identity, username) {
      return controls.state.transaction(async (state) => {
        const userPath = [
          "v1",
          "sign-in-methods",
          identity.provider,
          identity.uid,
        ];
        const user = await state.get(userPath);
        if (!user) return { kind: "unrecognized" };
        if (user.username === username) return { kind: "claimed", user };
        if (user.username !== null) return { kind: "immutable" };

        const usernamePath = ["v1", "usernames", username];
        if (await state.get(usernamePath)) return { kind: "taken" };
        const claimed = { ...user, username };
        await state.put(usernamePath, { userId: user.userId });
        await state.put(userPath, claimed);
        return { kind: "claimed", user: claimed };
      });
    },
  };
}

async function createIdentityHarness({ failKeyFetch = false, failUsers = false } = {}) {
  const authority = await createTestFirebaseAuthority({ now: NOW });
  const harness = createV1TestHarness({
    initialNow: NOW,
    createWorker(controls) {
      return createV1IdentityApi({
        groups: emptyGroupStore,
        users: failUsers
            ? {
              async create() {
                throw new Error("Test storage outage.");
              },
              async resolve() {
                throw new Error("Test storage outage.");
              },
              async claimUsername() {
                throw new Error("Test storage outage.");
              },
            }
          : createHarnessUserStore(controls),
        verifyIdToken: createFirebaseIdTokenVerifier({
          fetchImplementation: failKeyFetch
            ? async () => {
                throw new Error("Test signing-key outage.");
              }
            : authority.fetch,
          now: () => Date.parse(controls.clock.now()),
          projectId: "openjob-dev",
        }),
      });
    },
  });
  return { authority, harness };
}

function authorization(token) {
  return { authorization: `Bearer ${token}` };
}

test("Firebase verification returns only safe Google and Apple Sign-in Method identity", async () => {
  const authority = await createTestFirebaseAuthority({ now: NOW });
  const verifyIdToken = createFirebaseIdTokenVerifier({
    fetchImplementation: authority.fetch,
    now: () => Date.parse(NOW),
    projectId: "openjob-dev",
  });

  for (const [providerClaim, provider] of [
    ["google.com", "google"],
    ["apple.com", "apple"],
  ]) {
    const token = await authority.issue({
      uid: `firebase_${provider}`,
      claims: {
        email: "shared@example.test",
        firebase: { sign_in_provider: providerClaim },
        name: "Ignored provider profile",
      },
    });
    assert.deepEqual(
      await verifyIdToken(
        new Request("https://openjob.test/api/v1/me", {
          headers: authorization(token),
        }),
      ),
      {
        authenticatedAt: Date.parse(NOW) - 60_000,
        provider,
        uid: `firebase_${provider}`,
      },
    );
  }

  const passwordToken = await authority.issue({
    uid: "firebase_password",
    claims: { firebase: { sign_in_provider: "password" } },
  });
  assert.equal(
    await verifyIdToken(
      new Request("https://openjob.test/api/v1/me", {
        headers: authorization(passwordToken),
      }),
    ),
    null,
  );

  for (const providerClaim of ["google.com", "apple.com"]) {
    const tenantToken = await authority.issue({
      uid: "firebase_tenant_provider",
      claims: {
        firebase: {
          sign_in_provider: providerClaim,
          tenant: "unexpected-tenant",
        },
      },
    });
    assert.equal(await verifyIdToken.verifyToken(tenantToken), null);
  }
});

test("Firebase verification accepts only the exact allowlisted Preview QA password principal", async () => {
  const authority = await createTestFirebaseAuthority({
    now: NOW,
    projectId: "openjob-nonprod",
  });
  const exact = {
    tenantId: "OpenJob-QA-Two-mvz9m",
    uid: "firebase_qa_two",
  };
  const verifyIdToken = createFirebaseIdTokenVerifier({
    fetchImplementation: authority.fetch,
    now: () => Date.parse(NOW),
    projectId: "openjob-nonprod",
    qaPassword: exact,
  });
  const unconfigured = createFirebaseIdTokenVerifier({
    fetchImplementation: authority.fetch,
    now: () => Date.parse(NOW),
    projectId: "openjob-nonprod",
  });
  const issuePassword = (uid, tenant = exact.tenantId) =>
    authority.issue({
      uid,
      claims: {
        email: "ignored@example.test",
        firebase: { sign_in_provider: "password", tenant },
      },
    });
  const token = await issuePassword(exact.uid);

  assert.deepEqual(await verifyIdToken.verifyToken(token), {
    authenticatedAt: Date.parse(NOW) - 60_000,
    provider: "qa-password",
    uid: exact.uid,
  });
  assert.equal(await unconfigured.verifyToken(token), null);
  assert.equal(
    await verifyIdToken.verifyToken(
      await issuePassword("firebase_not_qa_two"),
    ),
    null,
  );
  assert.equal(
    await verifyIdToken.verifyToken(
      await issuePassword(exact.uid, "another-tenant"),
    ),
    null,
  );
  assert.equal(
    await verifyIdToken.verifyToken(
      await authority.issue({
        uid: exact.uid,
        claims: { firebase: { sign_in_provider: "password" } },
      }),
    ),
    null,
  );
});

test("GET /me resolves only an explicitly created OpenJob User", async (t) => {
  const { authority, harness } = await createIdentityHarness();
  t.after(() => harness.close());

  const missing = await harness.request({ method: "GET", path: "/api/v1/me" });
  assert.equal(missing.status, 401);
  assert.deepEqual(Object.keys((await missing.json()).error).sort(), [
    "code",
    "message",
    "requestId",
  ]);

  const shaneToken = await authority.issue({ uid: "firebase_shane" });
  const unrecognized = await harness.request({
    headers: authorization(shaneToken),
    method: "GET",
    path: "/api/v1/me",
  });
  assert.equal(unrecognized.status, 409);
  assert.equal(
    (await unrecognized.json()).error.code,
    "sign_in_method_unrecognized",
  );
  const creation = await harness.request({
    body: { confirmation: "create" },
    headers: authorization(shaneToken),
    method: "POST",
    path: "/api/v1/me",
  });
  assert.equal(creation.status, 201);
  const first = await harness.request({
    headers: authorization(shaneToken),
    method: "GET",
    path: "/api/v1/me",
  });
  assert.equal(first.status, 200);
  const firstUser = (await first.json()).data;
  assert.match(firstUser.userId, /^user_[a-f0-9]{32}$/);
  assert.deepEqual(firstUser, {
    userId: firstUser.userId,
    username: null,
    usernameRequired: true,
    groups: [],
  });

  await harness.restart();
  const changedProfileToken = await authority.issue({
    uid: "firebase_shane",
    claims: { email: "changed@example.test", name: "Changed Google Name" },
  });
  const persisted = await harness.request({
    headers: authorization(changedProfileToken),
    method: "GET",
    path: "/api/v1/me",
  });
  assert.deepEqual((await persisted.json()).data, firstUser);

  const eliToken = await authority.issue({ uid: "firebase_eli" });
  const eliCreation = await harness.request({
    body: { confirmation: "create" },
    headers: authorization(eliToken),
    method: "POST",
    path: "/api/v1/me",
  });
  assert.equal(eliCreation.status, 201);
  const second = await harness.request({
    headers: authorization(eliToken),
    method: "GET",
    path: "/api/v1/me",
  });
  assert.notEqual((await second.json()).data.userId, firstUser.userId);
});

test("the Worker rejects every invalid or unsupported Firebase identity", async (t) => {
  const { authority, harness } = await createIdentityHarness();
  t.after(() => harness.close());
  const now = Math.floor(Date.parse(NOW) / 1000);
  const invalidTokens = [
    "not-a-jwt",
    await authority.issue({ uid: "bad_signature", signer: "rogue" }),
    await authority.issue({
      uid: "unknown_key",
      header: { kid: "unknown-test-key" },
    }),
    await authority.issue({ uid: "wrong_issuer", claims: { iss: "https://example.test" } }),
    await authority.issue({ uid: "wrong_audience", claims: { aud: "another-project" } }),
    await authority.issue({ uid: "expired", claims: { exp: now } }),
    await authority.issue({ uid: "future_issued", claims: { iat: now + 1 } }),
    await authority.issue({ uid: "future_auth", claims: { auth_time: now + 1 } }),
    await authority.issue({ uid: "" }),
    await authority.issue({
      uid: "password_user",
      claims: { firebase: { sign_in_provider: "password" } },
    }),
  ];

  for (const token of invalidTokens) {
    const response = await harness.request({
      headers: authorization(token),
      method: "GET",
      path: "/api/v1/me",
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "authentication_required");
  }
  assert.equal(authority.keyRequests.length, 1);
});

test("infrastructure failures return the settled internal error envelope", async (t) => {
  for (const options of [{ failKeyFetch: true }, { failUsers: true }]) {
    const { authority, harness } = await createIdentityHarness(options);
    t.after(() => harness.close());
    const token = await authority.issue({ uid: "firebase_shane" });
    const response = await harness.request({
      headers: authorization(token),
      method: "GET",
      path: "/api/v1/me",
    });
    assert.equal(response.status, 500);
    const error = (await response.json()).error;
    assert.equal(error.code, "internal_error");
    assert.deepEqual(Object.keys(error).sort(), ["code", "message", "requestId"]);
  }
});

test("runtime initialization failures return the settled internal error envelope", async () => {
  const handle = createV1IdentityHandler(
    () => {
      throw new Error("Test missing binding.");
    },
    () => "req_runtime_failure",
  );

  const response = await handle(new Request("https://openjob.test/api/v1/me"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: "internal_error",
      message: "An unexpected error occurred.",
      requestId: "req_runtime_failure",
    },
  });
});

test("PUT /me/username persists one idempotent Username claim", async (t) => {
  const { authority, harness } = await createIdentityHarness();
  t.after(() => harness.close());
  const token = await authority.issue({ uid: "firebase_shane" });
  const headers = authorization(token);
  const creation = await harness.request({
    body: { confirmation: "create" },
    headers,
    method: "POST",
    path: "/api/v1/me",
  });
  assert.equal(creation.status, 201);

  const claimed = await harness.request({
    body: { username: "shane" },
    headers,
    method: "PUT",
    path: "/api/v1/me/username",
  });
  assert.equal(claimed.status, 200);
  const user = (await claimed.json()).data;
  assert.deepEqual(user, {
    userId: user.userId,
    username: "shane",
    usernameRequired: false,
    groups: [],
  });

  const repeated = await harness.request({
    body: { username: "shane" },
    headers,
    method: "PUT",
    path: "/api/v1/me/username",
  });
  assert.deepEqual((await repeated.json()).data, user);

  await harness.restart();
  const persisted = await harness.request({
    headers,
    method: "GET",
    path: "/api/v1/me",
  });
  assert.deepEqual((await persisted.json()).data, user);
});

test("Username claims are immutable and globally first-come", async (t) => {
  const { authority, harness } = await createIdentityHarness();
  t.after(() => harness.close());
  const shaneHeaders = authorization(
    await authority.issue({ uid: "firebase_shane" }),
  );
  const eliHeaders = authorization(
    await authority.issue({ uid: "firebase_eli" }),
  );
  for (const headers of [shaneHeaders, eliHeaders]) {
    const creation = await harness.request({
      body: { confirmation: "create" },
      headers,
      method: "POST",
      path: "/api/v1/me",
    });
    assert.equal(creation.status, 201);
  }

  const first = await harness.request({
    body: { username: "shane" },
    headers: shaneHeaders,
    method: "PUT",
    path: "/api/v1/me/username",
  });
  assert.equal(first.status, 200);

  const immutable = await harness.request({
    body: { username: "someone_else" },
    headers: shaneHeaders,
    method: "PUT",
    path: "/api/v1/me/username",
  });
  assert.equal(immutable.status, 409);
  assert.equal((await immutable.json()).error.code, "username_immutable");

  const taken = await harness.request({
    body: { username: "shane" },
    headers: eliHeaders,
    method: "PUT",
    path: "/api/v1/me/username",
  });
  assert.equal(taken.status, 409);
  assert.equal((await taken.json()).error.code, "username_taken");

  const eliClaim = await harness.request({
    body: { username: "eli" },
    headers: eliHeaders,
    method: "PUT",
    path: "/api/v1/me/username",
  });
  assert.equal(eliClaim.status, 200);
});

test("Username claims enforce the settled syntax and reserved names", async () => {
  const invalidBodies = [
    undefined,
    {},
    { username: null },
    { username: "a" },
    { username: "a".repeat(33) },
    { username: "Shane" },
    { username: ".shane" },
    { username: "shane_" },
    { username: " shane" },
    { username: "sha ne" },
    { username: "shané" },
    { username: "shane", ignored: true },
  ];

  for (const [index, body] of invalidBodies.entries()) {
    const { authority, harness } = await createIdentityHarness();
    const headers = authorization(
      await authority.issue({ uid: `firebase_invalid_${index}` }),
    );
    const response = await harness.request({
      body,
      headers,
      method: "PUT",
      path: "/api/v1/me/username",
    });
    await harness.close();
    assert.equal(response.status, 400, JSON.stringify(body));
    const error = (await response.json()).error;
    assert.equal(error.code, "invalid_request");
    assert.deepEqual(Object.keys(error.fields), ["username"]);
  }

  for (const username of ["admin", "support", "openjob", "unassigned", "me"]) {
    const { authority, harness } = await createIdentityHarness();
    const headers = authorization(
      await authority.issue({ uid: `firebase_reserved_${username}` }),
    );
    const response = await harness.request({
      body: { username },
      headers,
      method: "PUT",
      path: "/api/v1/me/username",
    });
    await harness.close();
    assert.equal(response.status, 409, username);
    assert.equal((await response.json()).error.code, "username_taken");
  }
});
