import assert from "node:assert/strict";
import test from "node:test";
import { createV1GroupsApi } from "../server/v1-groups.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
import { createV1NotificationSubscriptionsApi } from "../server/v1-notification-subscriptions.ts";
import { createV1TasksApi } from "../server/v1-tasks.ts";

const GOOGLE_IDENTITY = {
  authenticatedAt: Date.parse("2026-07-23T12:00:00.000Z"),
  provider: "google",
  uid: "firebase_unknown_google",
};

function untouchedStore(label) {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`${label} must not be touched for an unrecognized Sign-in Method.`);
      },
    },
  );
}

test("an unrecognized Sign-in Method cannot create a User through any authenticated API", async () => {
  const resolved = [];
  const users = {
    async resolve(identity) {
      resolved.push(identity);
      return null;
    },
  };
  const verifyIdToken = async () => GOOGLE_IDENTITY;
  const apis = [
    [
      createV1IdentityApi({
        groups: untouchedStore("Group store"),
        users,
        verifyIdToken,
      }),
      new Request("https://openjob.test/api/v1/me"),
    ],
    [
      createV1GroupsApi({
        groups: untouchedStore("Group store"),
        users,
        verifyIdToken,
      }),
      new Request("https://openjob.test/api/v1/groups"),
    ],
    [
      createV1TasksApi({
        tasks: untouchedStore("Task store"),
        users,
        verifyIdToken,
      }),
      new Request("https://openjob.test/api/v1/groups/grp_unknown/tasks"),
    ],
    [
      createV1NotificationSubscriptionsApi({
        subscriptions: untouchedStore("Notification Subscription store"),
        users,
        verifyIdToken,
      }),
      new Request(
        "https://openjob.test/api/v1/me/notification-subscriptions/installation_unknown_01",
      ),
    ],
  ];

  for (const [api, request] of apis) {
    const response = await api.fetch(request);
    assert.equal(response.status, 409);
    const error = (await response.json()).error;
    assert.deepEqual(Object.keys(error).sort(), ["code", "message", "requestId"]);
    assert.equal(error.code, "sign_in_method_unrecognized");
    assert.equal(
      error.message,
      "Choose whether to create a new User or link an existing User.",
    );
    assert.match(error.requestId, /^req_/);
  }
  assert.deepEqual(resolved, Array(apis.length).fill(GOOGLE_IDENTITY));
});

test("POST /me is the only explicit and idempotent User creation transition", async () => {
  let user = null;
  let createCalls = 0;
  const users = {
    async create() {
      createCalls += 1;
      if (user) return { kind: "existing", user };
      user = { userId: "user_explicit", username: null };
      return { kind: "created", user };
    },
    async resolve() {
      return user;
    },
  };
  const api = createV1IdentityApi({
    groups: {
      async list() {
        return { groups: [], nextCursor: null };
      },
    },
    requestId: () => "req_explicit_create",
    users,
    verifyIdToken: async () => GOOGLE_IDENTITY,
  });

  const before = await api.fetch(new Request("https://openjob.test/api/v1/me"));
  assert.equal(before.status, 409);

  for (const body of [undefined, {}, { confirmation: false }, { confirmation: "link" }]) {
    const response = await api.fetch(
      new Request("https://openjob.test/api/v1/me", {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        method: "POST",
      }),
    );
    assert.equal(response.status, 400, String(JSON.stringify(body)));
    assert.equal((await response.json()).error.code, "invalid_request");
  }
  assert.equal(createCalls, 0);

  const created = await api.fetch(
    new Request("https://openjob.test/api/v1/me", {
      body: JSON.stringify({ confirmation: "create" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.deepEqual(createdBody, {
    data: {
      groups: [],
      userId: "user_explicit",
      username: null,
      usernameRequired: true,
    },
  });

  const repeated = await api.fetch(
    new Request("https://openjob.test/api/v1/me", {
      body: JSON.stringify({ confirmation: "create" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), createdBody);
  assert.equal(createCalls, 2);
});

test("Sign-in Method listing and linking expose only safe providers and require fresh confirmation", async () => {
  const now = Date.parse("2026-07-23T12:00:00.000Z");
  const currentUser = { userId: "user_existing", username: "shane" };
  const linkCalls = [];
  let linkResult = { kind: "linked", user: currentUser };
  const users = {
    async link(current, candidate, expectedTargetUserId) {
      linkCalls.push({ current, candidate, expectedTargetUserId });
      return linkResult;
    },
    async listSignInMethods() {
      return ["google", "qa-password"];
    },
    async resolve() {
      return currentUser;
    },
  };
  let candidate = {
    authenticatedAt: now - 60_000,
    provider: "apple",
    uid: "firebase_apple_candidate",
  };
  let currentIdentity = {
    authenticatedAt: now - 3_600_000,
    provider: "google",
    uid: "firebase_google_current",
  };
  const api = createV1IdentityApi({
    groups: {
      async list() {
        return { groups: [], nextCursor: null };
      },
    },
    now: () => now,
    requestId: () => "req_sign_in_methods",
    users,
    verifyCredentialToken: async (token) =>
      token === "fresh-private-token" ? candidate : null,
    verifyIdToken: async () => currentIdentity,
  });

  const listed = await api.fetch(
    new Request("https://openjob.test/api/v1/me/sign-in-methods"),
  );
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { data: ["google"] });

  for (const [body, expectedStatus, expectedCode] of [
    [{ confirmation: "link" }, 400, "invalid_request"],
    [
      {
        confirmation: "link",
        credentialToken: "invalid-private-token",
        expectedTargetUserId: currentUser.userId,
      },
      401,
      "fresh_authentication_required",
    ],
    [
      {
        confirmation: "create",
        credentialToken: "fresh-private-token",
        expectedTargetUserId: currentUser.userId,
      },
      400,
      "invalid_request",
    ],
  ]) {
    const response = await api.fetch(
      new Request("https://openjob.test/api/v1/me/sign-in-methods", {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    assert.equal(response.status, expectedStatus);
    assert.equal((await response.json()).error.code, expectedCode);
  }
  assert.equal(linkCalls.length, 0);

  currentIdentity = {
    authenticatedAt: now - 60_000,
    provider: "qa-password",
    uid: "firebase_qa_password_current",
  };
  candidate = {
    authenticatedAt: now - 60_000,
    provider: "apple",
    uid: "firebase_apple_candidate",
  };
  const internalCurrent = await api.fetch(
    new Request("https://openjob.test/api/v1/me/sign-in-methods", {
      body: JSON.stringify({
        confirmation: "link",
        credentialToken: "fresh-private-token",
        expectedTargetUserId: currentUser.userId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(internalCurrent.status, 409);
  assert.equal(
    (await internalCurrent.json()).error.code,
    "sign_in_method_conflict",
  );
  assert.equal(linkCalls.length, 0);
  currentIdentity = {
    authenticatedAt: now - 3_600_000,
    provider: "google",
    uid: "firebase_google_current",
  };

  candidate = { ...candidate, authenticatedAt: now - 5 * 60_000 - 1 };
  const stale = await api.fetch(
    new Request("https://openjob.test/api/v1/me/sign-in-methods", {
      body: JSON.stringify({
        confirmation: "link",
        credentialToken: "fresh-private-token",
        expectedTargetUserId: currentUser.userId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(stale.status, 401);
  assert.equal(
    (await stale.json()).error.code,
    "fresh_authentication_required",
  );

  candidate = {
    authenticatedAt: now - 60_000,
    provider: "google",
    uid: "firebase_other_google",
  };
  const sameProvider = await api.fetch(
    new Request("https://openjob.test/api/v1/me/sign-in-methods", {
      body: JSON.stringify({
        confirmation: "link",
        credentialToken: "fresh-private-token",
        expectedTargetUserId: currentUser.userId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(sameProvider.status, 409);
  assert.equal((await sameProvider.json()).error.code, "sign_in_method_conflict");

  candidate = {
    authenticatedAt: now - 60_000,
    provider: "qa-password",
    uid: "firebase_qa_password_candidate",
  };
  const internalCandidate = await api.fetch(
    new Request("https://openjob.test/api/v1/me/sign-in-methods", {
      body: JSON.stringify({
        confirmation: "link",
        credentialToken: "fresh-private-token",
        expectedTargetUserId: currentUser.userId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(internalCandidate.status, 409);
  assert.equal(
    (await internalCandidate.json()).error.code,
    "sign_in_method_conflict",
  );
  assert.equal(linkCalls.length, 0);

  candidate = {
    authenticatedAt: now - 60_000,
    provider: "apple",
    uid: "firebase_apple_candidate",
  };
  const linked = await api.fetch(
    new Request("https://openjob.test/api/v1/me/sign-in-methods", {
      body: JSON.stringify({
        confirmation: "link",
        credentialToken: "fresh-private-token",
        expectedTargetUserId: currentUser.userId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(linked.status, 200);
  assert.deepEqual(await linked.json(), {
    data: {
      groups: [],
      userId: "user_existing",
      username: "shane",
      usernameRequired: false,
    },
  });
  assert.equal(linkCalls.length, 1);
  assert.equal(linkCalls[0].expectedTargetUserId, currentUser.userId);
  assert.equal(JSON.stringify(linkCalls).includes("fresh-private-token"), false);

  linkResult = { kind: "target_changed" };
  const changed = await api.fetch(
    new Request("https://openjob.test/api/v1/me/sign-in-methods", {
      body: JSON.stringify({
        confirmation: "link",
        credentialToken: "fresh-private-token",
        expectedTargetUserId: currentUser.userId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, "link_target_changed");
});

test("an unknown current credential links only through a fresh recognized target proof", async () => {
  const now = Date.parse("2026-07-23T12:00:00.000Z");
  const current = {
    authenticatedAt: now - 3_600_000,
    provider: "google",
    uid: "firebase_unknown_google",
  };
  const links = [];
  let credentialVerifications = 0;
  const api = createV1IdentityApi({
    groups: {
      async list() {
        return { groups: [], nextCursor: null };
      },
    },
    now: () => now,
    users: {
      async link(first, second, expectedTargetUserId) {
        links.push({ first, second, expectedTargetUserId });
        return {
          kind: "linked",
          user: { userId: "user_existing", username: "shane" },
        };
      },
      async listSignInMethods() {
        return [];
      },
      async resolve() {
        return null;
      },
    },
    verifyCredentialToken: async () => {
      credentialVerifications += 1;
      return {
        authenticatedAt: now - 30_000,
        provider: "apple",
        uid: "firebase_linked_apple",
      };
    },
    verifyIdToken: async () => current,
  });

  const response = await api.fetch(
    new Request("https://openjob.test/api/v1/me/sign-in-methods", {
      body: JSON.stringify({
        confirmation: "link",
        credentialToken: "fresh-private-token",
        expectedTargetUserId: "user_existing",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.userId, "user_existing");
  assert.equal(credentialVerifications, 1);
  assert.equal(links.length, 1);
  assert.equal(links[0].first.uid, "firebase_unknown_google");
  assert.equal(links[0].second.uid, "firebase_linked_apple");
  assert.equal(links[0].expectedTargetUserId, "user_existing");
});
