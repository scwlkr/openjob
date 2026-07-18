import assert from "node:assert/strict";
import test from "node:test";
import { createV1NotificationSubscriptionsApi } from "../server/v1-notification-subscriptions.ts";

const INSTALLATION_ID = "installation_0123456789abcdef";
const CAPABILITY = {
  endpoint: "https://push.example.test/subscriptions/secret-endpoint",
  keys: {
    p256dh: "p256dh_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
    auth: "auth_0123456789abcdef",
  },
};

function createApi() {
  const records = new Map();
  const users = {
    async getOrCreate(firebaseUid) {
      return { userId: `user_${firebaseUid}`, username: firebaseUid };
    },
  };
  const subscriptions = {
    async get(installationId) {
      return records.get(installationId) ?? null;
    },
    async register(input) {
      const record = { ...input, state: "active" };
      records.set(input.installationId, record);
      return record;
    },
    async setState(installationId, userId, state) {
      const record = records.get(installationId);
      if (!record || record.userId !== userId) return null;
      const changed = { ...record, state };
      records.set(installationId, changed);
      return changed;
    },
  };
  return createV1NotificationSubscriptionsApi({
    subscriptions,
    users,
    verifyIdToken: async (request) => {
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
      return token ? { uid: token } : null;
    },
  });
}

function request(api, { as, method = "GET", body, installationId = INSTALLATION_ID } = {}) {
  return api.fetch(new Request(
    `https://openjob.test/api/v1/me/notification-subscriptions/${installationId}`,
    {
      method,
      headers: {
        ...(as ? { authorization: `Bearer ${as}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  ));
}

test("GET Notification Subscription requires authentication and conceals a missing installation", async () => {
  const api = createApi();

  const unauthenticated = await request(api);
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).error.code, "authentication_required");

  const missing = await request(api, { as: "shane" });
  assert.equal(missing.status, 404);
  const error = (await missing.json()).error;
  assert.equal(error.code, "notification_subscription_not_found");
  assert.equal(error.message, "Notification Subscription was not found.");
  assert.equal(typeof error.requestId, "string");
});

test("PUT registers a bounded browser subscription and responses redact capability data", async () => {
  const api = createApi();
  const registered = await request(api, {
    as: "shane",
    body: CAPABILITY,
    method: "PUT",
  });

  assert.equal(registered.status, 200);
  const registeredText = await registered.text();
  assert.deepEqual(JSON.parse(registeredText), {
    data: { installationId: INSTALLATION_ID, state: "active" },
  });

  const status = await request(api, { as: "shane" });
  assert.equal(status.status, 200);
  const statusText = await status.text();
  assert.deepEqual(JSON.parse(statusText), {
    data: { installationId: INSTALLATION_ID, state: "active" },
  });
  assert.equal(statusText.includes(CAPABILITY.endpoint), false);
  assert.equal(registeredText.includes(CAPABILITY.keys.p256dh), false);
});

test("PATCH pauses and activates only the owning User while explicit PUT can reassign an installation", async () => {
  const api = createApi();
  await request(api, { as: "shane", body: CAPABILITY, method: "PUT" });

  const concealed = await request(api, { as: "eli" });
  assert.equal(concealed.status, 404);

  const foreignPause = await request(api, {
    as: "eli",
    body: { state: "paused" },
    method: "PATCH",
  });
  assert.equal(foreignPause.status, 404);

  const paused = await request(api, {
    as: "shane",
    body: { state: "paused" },
    method: "PATCH",
  });
  assert.deepEqual(await paused.json(), {
    data: { installationId: INSTALLATION_ID, state: "paused" },
  });

  const reassigned = await request(api, {
    as: "eli",
    body: CAPABILITY,
    method: "PUT",
  });
  assert.deepEqual(await reassigned.json(), {
    data: { installationId: INSTALLATION_ID, state: "active" },
  });
  assert.equal((await request(api, { as: "shane" })).status, 404);
  assert.equal((await request(api, { as: "eli" })).status, 200);
});

test("registration, state, and installation identifiers are strictly bounded", async () => {
  const invalidRegistrations = [
    undefined,
    {},
    { ...CAPABILITY, extra: true },
    { ...CAPABILITY, endpoint: "http://push.example.test/capability" },
    { ...CAPABILITY, endpoint: `https://push.example.test/${"x".repeat(2_100)}` },
    { ...CAPABILITY, keys: { ...CAPABILITY.keys, auth: "too-short" } },
    { ...CAPABILITY, keys: { ...CAPABILITY.keys, p256dh: "!".repeat(43) } },
  ];
  for (const body of invalidRegistrations) {
    const response = await request(createApi(), {
      as: "shane",
      body,
      method: "PUT",
    });
    assert.equal(response.status, 400, JSON.stringify(body));
    const text = await response.text();
    assert.equal(JSON.parse(text).error.code, "invalid_request");
    assert.equal(text.includes(String(body?.endpoint ?? "secret-endpoint")), false);
  }

  const api = createApi();
  await request(api, { as: "shane", body: CAPABILITY, method: "PUT" });
  for (const body of [{}, { state: "disabled" }, { state: "paused", extra: true }]) {
    const response = await request(api, { as: "shane", body, method: "PATCH" });
    assert.equal(response.status, 400, JSON.stringify(body));
  }

  for (const installationId of ["short", "contains%20spaces", "x".repeat(129)]) {
    const response = await request(createApi(), { as: "shane", installationId });
    assert.equal(response.status, 400, installationId);
    assert.deepEqual(Object.keys((await response.json()).error.fields), ["installationId"]);
  }
});
