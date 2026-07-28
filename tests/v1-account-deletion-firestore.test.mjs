import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreAccountDeletionJobStore } from "../db/account-deletions.ts";
import { createFirestoreUserStore } from "../db/users.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
import {
  createFakeFirestore,
  createPrivateKey,
} from "./support/fake-firestore.mjs";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const IDENTITY = {
  authenticatedAt: NOW - 30_000,
  provider: "google",
  uid: "firebase_disposable_delete",
};
const CREDENTIALS = [{
  firebaseUid: IDENTITY.uid,
  provider: "google",
  revocation: { kind: "access_token", value: "raw-provider-proof" },
}];

async function createStores() {
  const firestore = createFakeFirestore();
  const config = {
    clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
    privateKey: await createPrivateKey(),
    projectId: "openjob-dev",
  };
  const users = createFirestoreUserStore(config, firestore.fetch, {
    now: () => NOW,
    randomUUID: () => "00000000-0000-4000-8000-000000000042",
  });
  const jobs = createFirestoreAccountDeletionJobStore(
    config,
    Buffer.alloc(32, 7).toString("base64url"),
    firestore.fetch,
    {
      now: () => NOW,
      randomUUID: () => "00000000-0000-4000-8000-000000000043",
    },
  );
  const created = await users.create(IDENTITY);
  assert.equal(created.kind, "created");
  await users.claimUsername(IDENTITY, "delete-me");
  return { firestore, jobs, user: created.user, users };
}

test("deletion start atomically blocks access and encrypts provider proof", async () => {
  const { firestore, jobs, user, users } = await createStores();
  const first = await jobs.start(user.userId, CREDENTIALS);
  const repeated = await jobs.start(user.userId, CREDENTIALS);
  assert.equal(first.requestId, repeated.requestId);
  assert.deepEqual(first.completedSteps, []);
  assert.equal(first.deadline, "2026-08-04T12:00:00.000Z");
  assert.deepEqual((await users.resolve(IDENTITY)), {
    deletionPending: true,
    userId: user.userId,
    username: "delete-me",
  });
  const persisted = JSON.stringify([...firestore.documents.values()]);
  assert.equal(persisted.includes("raw-provider-proof"), false);
  assert.equal(persisted.includes(IDENTITY.uid), false);

  const api = createV1IdentityApi({
    groups: {
      async list() {
        throw new Error("deleted User must not reach Groups");
      },
    },
    requestId: () => "req_pending",
    users,
    verifyIdToken: async () => IDENTITY,
  });
  for (const request of [
    new Request("https://openjob.test/api/v1/me"),
    new Request("https://openjob.test/api/v1/me", {
      body: JSON.stringify({ confirmation: "create" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  ]) {
    const response = await api.fetch(request);
    assert.equal(response.status, 410);
    assert.equal((await response.json()).error.code, "account_deletion_pending");
  }
});

test("deletion jobs durably lease work and checkpoint provider cleanup", async () => {
  const { jobs, user } = await createStores();
  const job = await jobs.start(user.userId, CREDENTIALS);
  assert.equal(
    await jobs.claim(user.userId, "2026-07-28T12:15:00.000Z"),
    true,
  );
  assert.equal(
    await jobs.claim(user.userId, "2026-07-28T12:15:00.000Z"),
    false,
  );
  await jobs.markCompletedStep(
    user.userId,
    `provider:google:${IDENTITY.uid}`,
  );
  await jobs.release(user.userId, "2026-07-28T12:00:00.000Z");
  const pending = await jobs.listPending();
  assert.deepEqual(pending[0].completedSteps, [
    `provider:google:${IDENTITY.uid}`,
  ]);
  assert.equal(
    await jobs.claim(user.userId, "2026-07-28T12:15:00.000Z"),
    true,
  );
  assert.equal(job.requestId, pending[0].requestId);
});

test("identity finalization atomically removes the job, User, Username, and provider indexes", async () => {
  const { firestore, jobs, user, users } = await createStores();
  await jobs.start(user.userId, CREDENTIALS);
  assert.equal(await users.deleteForAccount(user.userId, [IDENTITY.uid]), true);
  assert.equal(await users.resolve(IDENTITY), null);
  assert.equal(await users.getByUsername("delete-me"), null);
  const persisted = JSON.stringify([...firestore.documents.values()]);
  assert.equal(persisted.includes(user.userId), false);
  assert.equal(persisted.includes("delete-me"), false);
  assert.equal(persisted.includes("v1AccountDeletions"), false);
  assert.equal(await users.deleteForAccount(user.userId, [IDENTITY.uid]), false);
});

test("a failed atomic start leaves the User active and stores no retry job", async () => {
  const { firestore, jobs, user, users } = await createStores();
  firestore.setMaxCommitWrites(1);
  await assert.rejects(() => jobs.start(user.userId, CREDENTIALS));
  assert.deepEqual(await users.resolve(IDENTITY), {
    userId: user.userId,
    username: "delete-me",
  });
  assert.equal(
    [...firestore.documents.keys()].some((name) =>
      name.includes("/v1AccountDeletions/"),
    ),
    false,
  );
});
