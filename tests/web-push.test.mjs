import assert from "node:assert/strict";
import test from "node:test";
import { createWebPushSender } from "../server/web-push.ts";

test("Web Push encrypts a JSON Task payload with VAPID and a 24-hour lifetime", async () => {
  const builds = [];
  const requests = [];
  const base64Url = (bytes) => Buffer.from(bytes).toString("base64url");
  const publicKey = base64Url(Uint8Array.from([
    4,
    ...new Uint8Array(32).fill(1),
    ...new Uint8Array(32).fill(2),
  ]));
  const privateKey = base64Url(new Uint8Array(32).fill(3));
  const vapid = {
    subject: "https://openjob.dev",
    publicKey,
    privateKey,
  };
  const sender = createWebPushSender({
    vapid,
    async buildRequest(options) {
      builds.push(options);
      return {
        endpoint: options.subscription.endpoint,
        headers: { "content-encoding": "aes128gcm" },
        body: Uint8Array.from([1, 2, 3]).buffer,
      };
    },
    async fetchImplementation(endpoint, init) {
      requests.push({ endpoint, init });
      return new Response(null, { status: 201 });
    },
  });
  const subscription = {
    installationId: "installation_0123456789",
    userId: "user_eli",
    endpoint: "https://push.example.test/capability",
    p256dh: "p256dh-key",
    auth: "auth-secret",
    state: "active",
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    stateChangedAt: "2026-07-18T12:00:00.000Z",
  };
  const data = {
    recipientUserId: "user_eli",
    eventKind: "assignment",
    groupId: "grp_notifications",
    groupName: "Release Team",
    taskId: "task_release",
    taskPreview: "Prepare release notes",
    launchTarget: "/?notification-group=grp_notifications",
  };

  const result = await sender.send(subscription, { data, ttl: 86_400 });

  assert.deepEqual(result, { status: 201 });
  assert.deepEqual(builds, [{
    privateJWK: {
      kty: "EC",
      crv: "P-256",
      x: base64Url(new Uint8Array(32).fill(1)),
      y: base64Url(new Uint8Array(32).fill(2)),
      d: privateKey,
    },
    message: {
      payload: data,
      adminContact: "https://openjob.dev",
      options: { ttl: 86_400 },
    },
    subscription: {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
  }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, subscription.endpoint);
  assert.equal(requests[0].init.method, "POST");
});
