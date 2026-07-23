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
  const database = "projects/openjob-dev/databases/(default)/documents";
  for (const userId of ["user_eli", "user_shane"]) {
    const name = `${database}/v1UserDirectory/${userId}`;
    firestore.documents.set(name, {
      name,
      fields: {
        emptyShellEligible: { booleanValue: true },
        userId: { stringValue: userId },
      },
      updateTime: "2026-07-18T11:00:00.000001Z",
    });
  }
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

test("registration atomically records durable User history", async () => {
  const { firestore, store } = await createStore();
  const database = "projects/openjob-dev/databases/(default)/documents";
  const userPath = `${database}/v1UserDirectory/user_shane`;

  await store.register({
    installationId: INSTALLATION_ID,
    userId: "user_shane",
    ...CAPABILITY,
  });

  assert.equal(
    firestore.documents.get(userPath).fields.emptyShellEligible.booleanValue,
    false,
  );

  const { firestore: failingFirestore, store: failingStore } =
    await createStore();
  failingFirestore.setMaxCommitWrites(2);
  await assert.rejects(
    failingStore.register({
      installationId: INSTALLATION_ID,
      userId: "user_shane",
      ...CAPABILITY,
    }),
  );
  assert.equal(
    failingFirestore.documents.get(userPath).fields.emptyShellEligible.booleanValue,
    true,
  );
  assert.equal(await failingStore.get(INSTALLATION_ID), null);
});

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
  assert.deepEqual(await store.listActive("user_shane"), []);
  assert.deepEqual(
    (await store.listActive("user_eli")).map(({ installationId }) => installationId),
    [INSTALLATION_ID],
  );
  assert.equal(
    [...firestore.documents.keys()].filter((name) =>
      name.includes("/v1NotificationSubscriptions/"),
    ).length,
    1,
  );
});

test("delivery lists every active installation for one User and removes only its rejected endpoint", async () => {
  const { store } = await createStore();
  const activeId = "installation_active_0123456789";
  const pausedId = "installation_paused_0123456789";
  const foreignId = "installation_foreign_0123456789";
  await store.register({ installationId: activeId, userId: "user_shane", ...CAPABILITY });
  await store.register({ installationId: pausedId, userId: "user_shane", ...CAPABILITY });
  await store.setState(pausedId, "user_shane", "paused");
  await store.register({ installationId: foreignId, userId: "user_eli", ...CAPABILITY });

  assert.deepEqual(
    (await store.listActive("user_shane")).map(({ installationId }) => installationId),
    [activeId],
  );
  assert.equal(await store.remove(activeId, "user_eli"), false);
  assert.equal(await store.remove(activeId, "user_shane"), true);
  assert.deepEqual(await store.listActive("user_shane"), []);
  assert.equal((await store.get(foreignId)).userId, "user_eli");
});
