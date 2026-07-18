import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreNotificationSubscriptionStore } from "../db/notification-subscriptions.ts";
import { createFakeFirestore, createPrivateKey } from "./support/fake-firestore.mjs";

const INSTALLATION_ID = "installation_0123456789abcdef";
const CAPABILITY = {
  endpoint: "https://push.example.test/subscriptions/secret-endpoint",
  p256dh: "p256dh_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
  auth: "auth_0123456789abcdef",
};

async function createStore(now = Date.parse("2026-07-18T12:00:00.000Z")) {
  const firestore = createFakeFirestore();
  const store = createFirestoreNotificationSubscriptionStore(
    {
      projectId: "openjob-dev",
      clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
      privateKey: await createPrivateKey(),
    },
    firestore.fetch,
    { now: () => now },
  );
  return { firestore, store };
}

test("Firestore retains a browser capability while Notification Subscription delivery is paused", async () => {
  const { store } = await createStore();
  assert.equal(await store.get(INSTALLATION_ID), null);

  const registered = await store.register({
    installationId: INSTALLATION_ID,
    userId: "user_shane",
    ...CAPABILITY,
  });
  assert.equal(registered.state, "active");
  assert.equal(registered.endpoint, CAPABILITY.endpoint);

  const paused = await store.setState(INSTALLATION_ID, "user_shane", "paused");
  assert.equal(paused.state, "paused");
  assert.equal(paused.endpoint, CAPABILITY.endpoint);
  assert.equal(paused.p256dh, CAPABILITY.p256dh);
  assert.equal(paused.auth, CAPABILITY.auth);

  assert.equal(await store.setState(INSTALLATION_ID, "user_eli", "active"), null);
  assert.deepEqual(await store.get(INSTALLATION_ID), paused);
});

test("explicit registration refreshes or reassigns one installation record", async () => {
  const { firestore, store } = await createStore();
  const first = await store.register({
    installationId: INSTALLATION_ID,
    userId: "user_shane",
    ...CAPABILITY,
  });
  const refreshed = await store.register({
    installationId: INSTALLATION_ID,
    userId: "user_eli",
    endpoint: "https://push.example.test/subscriptions/replacement-endpoint",
    p256dh: `replacement_${CAPABILITY.p256dh}`,
    auth: `replacement_${CAPABILITY.auth}`,
  });

  assert.equal(refreshed.userId, "user_eli");
  assert.equal(refreshed.state, "active");
  assert.equal(refreshed.createdAt, first.createdAt);
  assert.notEqual(refreshed.endpoint, first.endpoint);
  assert.equal(
    [...firestore.documents.keys()].filter((name) =>
      name.includes("/v1NotificationSubscriptions/"),
    ).length,
    1,
  );
});
