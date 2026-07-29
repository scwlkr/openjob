import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreAccountDeletionJobStore } from "../db/account-deletions.ts";
import { createFirestoreGroupStore } from "../db/groups.ts";
import { createFirestoreNotificationSubscriptionStore } from "../db/notification-subscriptions.ts";
import { InactiveUserError } from "../db/user-history.ts";
import { createFirestoreUserStore } from "../db/users.ts";
import { createFirestoreTaskStore } from "../db/v1-tasks.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
import {
  createFakeFirestore,
  createPrivateKey,
} from "./support/fake-firestore.mjs";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const IDENTITY = {
  authenticatedAt: NOW - 30_000,
  expiresAt: NOW + 30 * 60_000,
  provider: "google",
  providerSubject: "google-provider-subject",
  uid: "firebase_disposable_delete",
};
const CREDENTIALS = [{
  firebaseUid: IDENTITY.uid,
  provider: "google",
  providerSubject: IDENTITY.providerSubject,
  revocation: {
    idToken: "raw-google-id-token",
    kind: "access_token",
    value: "raw-provider-proof",
  },
}];
const APPLE_IDENTITY = {
  authenticatedAt: NOW - 20_000,
  expiresAt: NOW + 30 * 60_000,
  provider: "apple",
  providerSubject: "apple-provider-subject",
  uid: "firebase_disposable_delete_apple",
};
const APPLE_CREDENTIAL = {
  firebaseUid: APPLE_IDENTITY.uid,
  provider: "apple",
  providerSubject: APPLE_IDENTITY.providerSubject,
  revocation: {
    clientId: "dev.openjob.app",
    idToken: "raw-apple-id-token",
    kind: "authorization_code",
    value: "raw-apple-provider-proof",
  },
};
const HOST_IDENTITY = {
  authenticatedAt: NOW - 25_000,
  provider: "google",
  uid: "firebase_group_host",
};

async function createStores({ now = () => NOW } = {}) {
  const firestore = createFakeFirestore();
  const config = {
    clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
    privateKey: await createPrivateKey(),
    projectId: "openjob-dev",
  };
  let userId = 42;
  const users = createFirestoreUserStore(config, firestore.fetch, {
    now,
    randomUUID: () =>
      `00000000-0000-4000-8000-${String(userId++).padStart(12, "0")}`,
  });
  let deletionId = 43;
  const jobs = createFirestoreAccountDeletionJobStore(
    config,
    Buffer.alloc(32, 7).toString("base64url"),
    firestore.fetch,
    {
      now,
      randomUUID: () =>
        `00000000-0000-4000-8000-${String(deletionId++).padStart(12, "0")}`,
    },
  );
  const created = await users.create(IDENTITY);
  assert.equal(created.kind, "created");
  const claimed = await users.claimUsername(IDENTITY, "delete-me");
  assert.equal(claimed.kind, "claimed");
  let groupId = 100;
  const groups = createFirestoreGroupStore(config, firestore.fetch, {
    now,
    randomUUID: () =>
      `00000000-0000-4000-8000-${String(groupId++).padStart(12, "0")}`,
  });
  let taskId = 200;
  const tasks = createFirestoreTaskStore(config, firestore.fetch, {
    now,
    randomUUID: () =>
      `00000000-0000-4000-8000-${String(taskId++).padStart(12, "0")}`,
  });
  const subscriptions = createFirestoreNotificationSubscriptionStore(
    config,
    firestore.fetch,
    { now },
  );
  return {
    firestore,
    groups,
    jobs,
    subscriptions,
    tasks,
    user: claimed.user,
    users,
  };
}

async function prepare(jobs, userId) {
  const result = await jobs.prepareStatusToken(userId);
  assert.equal(result.kind, "prepared");
  return result;
}

async function startPrepared(jobs, userId, statusToken) {
  const result = await jobs.start(userId, CREDENTIALS, statusToken);
  assert.equal(result.kind, "started");
  return result.job;
}

async function createStarted(jobs, userId) {
  const prepared = await prepare(jobs, userId);
  return startPrepared(jobs, userId, prepared.statusToken);
}

async function makeFinalizable(
  jobs,
  job,
  leaseUntil = "2026-07-28T12:15:00.000Z",
) {
  assert.equal(await jobs.claim(job.userId, leaseUntil), true);
  job.processingLeaseUntil = leaseUntil;
  await jobs.markCompletedStep(
    job.userId,
    "firebase-sessions:google",
    leaseUntil,
  );
  job.completedSteps.push("firebase-sessions:google");
  await jobs.markCompletedStep(
    job.userId,
    "provider-attempted:google",
    leaseUntil,
  );
  job.completedSteps.push("provider-attempted:google");
  assert.equal(
    await jobs.completeProvider(job.userId, CREDENTIALS[0], leaseUntil),
    true,
  );
  job.credentials = [{
    firebaseUid: IDENTITY.uid,
    provider: "google",
    providerSubject: IDENTITY.providerSubject,
  }];
  job.completedSteps.push("provider:google");
  return job;
}

test("PUT persists only one reusable minimal intent and its receipt spans pending through completion", async () => {
  const { firestore, jobs, user, users } = await createStores();
  const first = await prepare(jobs, user.userId);
  const afterFirst = JSON.stringify([...firestore.documents.entries()]);
  const second = await prepare(jobs, user.userId);
  assert.equal(JSON.stringify([...firestore.documents.entries()]), afterFirst);
  assert.notEqual(first.statusToken, second.statusToken);
  assert.equal(afterFirst.includes(first.statusToken), false);
  const intent = [...firestore.documents.values()].find(({ name }) =>
    name.endsWith(`/v1AccountDeletionIntents/${user.userId}`)
  );
  assert.ok(intent);
  assert.deepEqual(Object.keys(intent.fields).sort(), [
    "intentId",
    "submissionExpiresAt",
    "userId",
  ]);
  assert.deepEqual(first, {
    kind: "prepared",
    statusToken: first.statusToken,
    submissionExpiresAt: "2026-07-28T12:05:00.000Z",
  });
  const job = await startPrepared(jobs, user.userId, second.statusToken);
  assert.equal(
    [...firestore.documents.keys()].some((name) =>
      name.endsWith(`/v1AccountDeletionIntents/${user.userId}`)
    ),
    false,
  );
  for (const { statusToken } of [first, second]) {
    assert.deepEqual(await jobs.readStatus(statusToken), {
      deadline: "2026-08-04T12:00:00.000Z",
      kind: "pending",
      reauthenticationProviders: [],
      requestedAt: "2026-07-28T12:00:00.000Z",
    });
  }

  await makeFinalizable(jobs, job);
  assert.equal(await users.deleteForAccount(job, [IDENTITY.uid]), true);
  assert.deepEqual(await jobs.readStatus(first.statusToken), {
    kind: "completed",
  });
  assert.equal(job.statusToken, second.statusToken);
});

test("preparation winning a race blocks a concurrent Sign-in Method link", async () => {
  const { firestore, jobs, user, users } = await createStores();
  firestore.synchronizeNextCommits(2);
  const preparation = jobs.prepareStatusToken(user.userId);
  await firestore.waitForPendingCommits();
  const linking = users.link(IDENTITY, APPLE_IDENTITY, user.userId);
  assert.equal((await preparation).kind, "prepared");
  assert.deepEqual(await linking, { kind: "deletion_pending" });
  assert.deepEqual(await users.listSignInMethods(user.userId), ["google"]);
});

test("an expired prepared deletion intent no longer blocks Sign-in Method linking", async () => {
  let currentNow = NOW;
  const { firestore, jobs, user, users } = await createStores({
    now: () => currentNow,
  });
  const prepared = await prepare(jobs, user.userId);

  currentNow = Date.parse(prepared.submissionExpiresAt);
  assert.deepEqual(
    await users.link(IDENTITY, APPLE_IDENTITY, user.userId),
    { kind: "linked", user },
  );
  assert.equal(
    [...firestore.documents.keys()].some((name) =>
      name.endsWith(`/v1AccountDeletionIntents/${user.userId}`)
    ),
    false,
  );
  assert.deepEqual(await users.listSignInMethods(user.userId), [
    "apple",
    "google",
  ]);
});

test("a prepared deletion intent blocks lazy legacy-provider migration", async () => {
  const { firestore, jobs, users } = await createStores();
  const database = "projects/openjob-dev/databases/(default)/documents";
  const legacyUserId = "user_legacy_delete";
  const legacyUid = "firebase_legacy_delete";
  const legacyKey = Buffer.from(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(legacyUid),
  )).toString("base64url");
  firestore.documents.set(`${database}/v1Users/${legacyKey}`, {
    fields: {
      userId: { stringValue: legacyUserId },
      username: { stringValue: "legacy-delete" },
    },
    name: `${database}/v1Users/${legacyKey}`,
    updateTime: "2026-07-28T11:59:00.000001Z",
  });
  firestore.documents.set(`${database}/v1UserDirectory/${legacyUserId}`, {
    fields: {
      emptyShellEligible: { booleanValue: false },
      userId: { stringValue: legacyUserId },
      username: { stringValue: "legacy-delete" },
    },
    name: `${database}/v1UserDirectory/${legacyUserId}`,
    updateTime: "2026-07-28T11:59:00.000002Z",
  });

  assert.equal((await jobs.prepareStatusToken(legacyUserId)).kind, "prepared");
  await assert.rejects(() =>
    users.resolve({
      authenticatedAt: NOW - 30_000,
      provider: "google",
      uid: legacyUid,
    })
  );
  assert.deepEqual(await users.listSignInMethods(legacyUserId), []);
});

test("linking winning a race is included in preparation and exact deletion proof", async () => {
  const { firestore, jobs, user, users } = await createStores();
  firestore.synchronizeNextCommits(2);
  const linking = users.link(IDENTITY, APPLE_IDENTITY, user.userId);
  await firestore.waitForPendingCommits();
  const preparation = jobs.prepareStatusToken(user.userId);
  assert.equal((await linking).kind, "linked");
  const prepared = await preparation;
  assert.equal(prepared.kind, "prepared");
  assert.deepEqual(await users.listSignInMethods(user.userId), [
    "apple",
    "google",
  ]);
  assert.deepEqual(
    await jobs.start(user.userId, CREDENTIALS, prepared.statusToken),
    { kind: "provider_mismatch" },
  );
  const started = await jobs.start(
    user.userId,
    [APPLE_CREDENTIAL, ...CREDENTIALS],
    prepared.statusToken,
  );
  assert.equal(started.kind, "started");
  assert.deepEqual(
    started.job.credentials.map(({ provider }) => provider).sort(),
    ["apple", "google"],
  );
});

test("Group creation and deletion start serialize in both commit orders", async () => {
  {
    const { firestore, groups, jobs, user } = await createStores();
    const prepared = await prepare(jobs, user.userId);
    firestore.synchronizeNextCommits(2);
    const deletion = jobs.start(user.userId, CREDENTIALS, prepared.statusToken);
    await firestore.waitForPendingCommits();
    const creation = groups.create(user, "Too Late");

    assert.equal((await deletion).kind, "started");
    await assert.rejects(creation, InactiveUserError);
    await assert.rejects(
      groups.list(user.userId, { cursor: null, limit: 100 }),
      InactiveUserError,
    );
  }

  {
    const { firestore, groups, jobs, user } = await createStores();
    const prepared = await prepare(jobs, user.userId);
    firestore.synchronizeNextCommits(2);
    const creation = groups.create(user, "Included Before Deletion");
    await firestore.waitForPendingCommits();
    const deletion = jobs.start(user.userId, CREDENTIALS, prepared.statusToken);

    const group = await creation;
    assert.equal((await deletion).kind, "started");
    assert.deepEqual(
      await groups.listForDeletion(user.userId, { cursor: null, limit: 100 }),
      { groups: [group], nextCursor: null },
    );
    assert.deepEqual(
      await groups.removeUserForDeletion(user.userId, group.groupId),
      { kind: "ended" },
    );
    assert.deepEqual(
      await groups.listForDeletion(user.userId, { cursor: null, limit: 100 }),
      { groups: [], nextCursor: null },
    );
  }
});

test("Invite joining and deletion start serialize in both commit orders", async () => {
  for (const first of ["deletion", "join"]) {
    const { firestore, groups, jobs, user, users } = await createStores();
    const hostResult = await users.create(HOST_IDENTITY);
    assert.equal(hostResult.kind, "created");
    const hostClaim = await users.claimUsername(HOST_IDENTITY, "group-host");
    assert.equal(hostClaim.kind, "claimed");
    const group = await groups.create(hostClaim.user, "Join Race");
    const invite = await groups.getInvite(hostClaim.user.userId, group.groupId);
    assert.equal(invite.kind, "found");
    const prepared = await prepare(jobs, user.userId);

    firestore.synchronizeNextCommits(2);
    const firstOperation = first === "deletion"
      ? jobs.start(user.userId, CREDENTIALS, prepared.statusToken)
      : groups.joinInvite(user, invite.invite.token);
    await firestore.waitForPendingCommits();
    const secondOperation = first === "deletion"
      ? groups.joinInvite(user, invite.invite.token)
      : jobs.start(user.userId, CREDENTIALS, prepared.statusToken);

    if (first === "deletion") {
      assert.equal((await firstOperation).kind, "started");
      await assert.rejects(secondOperation, InactiveUserError);
      assert.deepEqual(
        await groups.listForDeletion(user.userId, {
          cursor: null,
          limit: 100,
        }),
        { groups: [], nextCursor: null },
      );
    } else {
      assert.equal((await firstOperation).kind, "joined");
      assert.equal((await secondOperation).kind, "started");
      assert.equal(
        (await groups.listForDeletion(user.userId, {
          cursor: null,
          limit: 100,
        })).groups.length,
        1,
      );
      assert.deepEqual(
        await groups.removeUserForDeletion(user.userId, group.groupId),
        { kind: "removed", promotedUserId: null },
      );
      assert.deepEqual(
        await groups.listForDeletion(user.userId, {
          cursor: null,
          limit: 100,
        }),
        { groups: [], nextCursor: null },
      );
    }
  }
});

test("pending Users cannot write Tasks, subscriptions, Usernames, or new assignee references", async () => {
  const {
    groups,
    jobs,
    subscriptions,
    tasks,
    user,
    users,
  } = await createStores();
  const hostResult = await users.create(HOST_IDENTITY);
  assert.equal(hostResult.kind, "created");
  const hostClaim = await users.claimUsername(HOST_IDENTITY, "active-host");
  assert.equal(hostClaim.kind, "claimed");
  const group = await groups.create(hostClaim.user, "Pending Fences");
  const invite = await groups.getInvite(hostClaim.user.userId, group.groupId);
  assert.equal(invite.kind, "found");
  assert.equal((await groups.joinInvite(user, invite.invite.token)).kind, "joined");
  const job = await createStarted(jobs, user.userId);

  await assert.rejects(
    tasks.create(
      user.userId,
      group.groupId,
      { userId: user.userId, username: "delete-me" },
      {
        dueDate: null,
        priority: "normal",
        text: "Must not be created",
      },
    ),
    InactiveUserError,
  );
  assert.deepEqual(
    await tasks.create(
      hostClaim.user.userId,
      group.groupId,
      { userId: user.userId, username: "delete-me" },
      {
        dueDate: null,
        priority: "normal",
        text: "Must not reference a deleting assignee",
      },
    ),
    { kind: "assignee_not_member" },
  );
  await assert.rejects(
    subscriptions.register({
      auth: "auth_0123456789abcdef",
      endpoint: "https://push.example.test/deleting-user",
      installationId: "installation_deleting_user_01",
      p256dh: "p256dh_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
      userId: user.userId,
    }),
    InactiveUserError,
  );
  assert.deepEqual(await users.claimUsername(IDENTITY, "other-name"), {
    kind: "deletion_pending",
  });
  assert.equal(await jobs.validatePending(job), true);
});

test("deletion cleanup stages more than 500 sole-Group Tasks within Firestore limits", async () => {
  const { firestore, groups, jobs, user } = await createStores();
  const group = await groups.create(user, "Large Sole Group");
  const database = "projects/openjob-dev/databases/(default)/documents";
  for (let index = 0; index < 501; index += 1) {
    const taskId = `task_cleanup_${String(index).padStart(4, "0")}`;
    const name = `${database}/v1Groups/${group.groupId}/tasks/${taskId}`;
    firestore.documents.set(name, {
      fields: {
        assigneeState: { stringValue: "unassigned" },
        createdAt: { timestampValue: "2026-07-28T11:00:00.000Z" },
        creatorUserId: { stringValue: user.userId },
        groupId: { stringValue: group.groupId },
        priority: { stringValue: "normal" },
        state: { stringValue: "open" },
        taskId: { stringValue: taskId },
        text: { stringValue: `Cleanup task ${index}` },
      },
      name,
      updateTime: `2026-07-28T11:00:00.${String(index).padStart(6, "0")}Z`,
    });
  }
  await createStarted(jobs, user.userId);
  const commitsBeforeCleanup = firestore.commitAttempts();

  assert.deepEqual(
    await groups.removeUserForDeletion(user.userId, group.groupId),
    { kind: "ended" },
  );
  assert.equal(firestore.commitAttempts() - commitsBeforeCleanup >= 3, true);
  assert.equal(
    [...firestore.documents.keys()].some((name) =>
      name.includes(`/v1Groups/${group.groupId}`)
    ),
    false,
  );
});

test("deletion cleanup stages more than 500 shared-Group Task attributions", async () => {
  const { firestore, groups, jobs, tasks, user, users } = await createStores();
  const hostResult = await users.create(HOST_IDENTITY);
  assert.equal(hostResult.kind, "created");
  const hostClaim = await users.claimUsername(HOST_IDENTITY, "large-host");
  assert.equal(hostClaim.kind, "claimed");
  const group = await groups.create(hostClaim.user, "Large Shared Group");
  const invite = await groups.getInvite(hostClaim.user.userId, group.groupId);
  assert.equal(invite.kind, "found");
  assert.equal((await groups.joinInvite(user, invite.invite.token)).kind, "joined");
  const database = "projects/openjob-dev/databases/(default)/documents";
  for (let index = 0; index < 501; index += 1) {
    const taskId = `task_attribution_${String(index).padStart(4, "0")}`;
    const name = `${database}/v1Groups/${group.groupId}/tasks/${taskId}`;
    firestore.documents.set(name, {
      fields: {
        assigneeState: { stringValue: "unassigned" },
        createdAt: { timestampValue: "2026-07-28T11:00:00.000Z" },
        creatorUserId: { stringValue: user.userId },
        groupId: { stringValue: group.groupId },
        priority: { stringValue: "normal" },
        state: { stringValue: "open" },
        taskId: { stringValue: taskId },
        text: { stringValue: `Attribution task ${index}` },
      },
      name,
      updateTime: `2026-07-28T11:01:00.${String(index).padStart(6, "0")}Z`,
    });
  }
  await createStarted(jobs, user.userId);
  const groupPath = `v1Groups/${group.groupId}`;
  const paused = firestore.pauseNextDocumentRead(groupPath, 2);
  const cleanup = groups.removeUserForDeletion(user.userId, group.groupId);
  await paused.waitUntilPaused();

  const persistedGroup = firestore.documents.get(`${database}/${groupPath}`);
  assert.equal(
    persistedGroup.fields.deletionCleanupUserId.stringValue,
    user.userId,
  );
  assert.equal(
    [...firestore.documents.keys()].filter((name) =>
      name.includes(`/v1Groups/${group.groupId}/tasks/task_attribution_`)
    ).length,
    2,
  );
  assert.equal(await groups.get(hostClaim.user.userId, group.groupId), null);
  assert.deepEqual(
    await groups.list(hostClaim.user.userId, { cursor: null, limit: 10 }),
    { groups: [], nextCursor: null },
  );
  assert.deepEqual(
    await groups.listForDeletion(user.userId, { cursor: null, limit: 10 }),
    { groups: [{ ...group, role: "member" }], nextCursor: null },
  );
  await assert.rejects(
    groups.list(user.userId, { cursor: null, limit: 10 }),
    InactiveUserError,
  );
  const pendingApi = createV1IdentityApi({
    groups,
    requestId: () => "req_fenced_cleanup",
    users,
    verifyIdToken: async () => IDENTITY,
  });
  const pendingResponse = await pendingApi.fetch(
    new Request("https://openjob.test/api/v1/me"),
  );
  assert.equal(pendingResponse.status, 410);
  assert.equal(
    (await pendingResponse.json()).error.code,
    "account_deletion_pending",
  );
  assert.deepEqual(await tasks.list(hostClaim.user.userId, group.groupId), {
    kind: "not_found",
  });
  assert.deepEqual(
    await groups.rename(hostClaim.user.userId, group.groupId, "Blocked Rename"),
    { kind: "not_found" },
  );

  paused.release();

  assert.deepEqual(
    await cleanup,
    { kind: "removed", promotedUserId: null },
  );
  assert.deepEqual(
    await groups.listForDeletion(user.userId, { cursor: null, limit: 10 }),
    { groups: [], nextCursor: null },
  );
  assert.ok(await groups.get(hostClaim.user.userId, group.groupId));
  assert.equal(
    [...firestore.documents.keys()].some((name) =>
      name.includes(`/v1Groups/${group.groupId}/tasks/task_attribution_`)
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(
      firestore.documents.get(`${database}/${groupPath}`).fields,
      "deletionCleanupUserId",
    ),
    false,
  );
  assert.deepEqual(await tasks.list(hostClaim.user.userId, group.groupId), {
    kind: "found",
    tasks: [],
  });
});

test("GET retains a fresh prepared intent and only expiration cancels it", async () => {
  {
    let currentNow = NOW;
    const { firestore, jobs, user } = await createStores({
      now: () => currentNow,
    });
    const prepared = await prepare(jobs, user.userId);

    currentNow = Date.parse("2026-07-28T12:04:59.999Z");
    assert.deepEqual(await jobs.readStatus(prepared.statusToken), {
      kind: "not_started",
      submissionExpired: false,
      submissionExpiresAt: "2026-07-28T12:05:00.000Z",
    });
    assert.equal(
      [...firestore.documents.keys()].some((name) =>
        name.endsWith(`/v1AccountDeletionIntents/${user.userId}`)
      ),
      true,
    );
    assert.equal(
      (await jobs.start(user.userId, CREDENTIALS, prepared.statusToken)).kind,
      "started",
    );
  }

  {
    let currentNow = NOW;
    const { jobs, user } = await createStores({ now: () => currentNow });
    const prepared = await prepare(jobs, user.userId);

    currentNow = Date.parse("2026-07-28T12:05:00.000Z");
    assert.deepEqual(await jobs.readStatus(prepared.statusToken), {
      kind: "not_started",
      submissionExpired: true,
      submissionExpiresAt: "2026-07-28T12:05:00.000Z",
    });
    assert.deepEqual(
      await jobs.start(user.userId, CREDENTIALS, prepared.statusToken),
      { kind: "invalid" },
    );
    assert.deepEqual(await jobs.readStatus(prepared.statusToken), {
      kind: "not_started",
      submissionExpired: true,
      submissionExpiresAt: "2026-07-28T12:05:00.000Z",
    });
    const replacement = await prepare(jobs, user.userId);
    assert.notEqual(replacement.statusToken, prepared.statusToken);
    assert.deepEqual(await jobs.readStatus(prepared.statusToken), {
      kind: "unavailable",
    });
    assert.deepEqual(
      await jobs.start(user.userId, CREDENTIALS, prepared.statusToken),
      { kind: "unavailable" },
    );
  }
});

test("POST at the exact submission expiry cancels the intent and requires a new PUT", async () => {
  let currentNow = NOW;
  const { firestore, jobs, user } = await createStores({
    now: () => currentNow,
  });
  const prepared = await prepare(jobs, user.userId);
  currentNow = Date.parse(prepared.submissionExpiresAt);
  assert.deepEqual(
    await jobs.start(user.userId, CREDENTIALS, prepared.statusToken),
    { kind: "invalid" },
  );
  assert.equal(
    [...firestore.documents.keys()].some((name) =>
      name.endsWith(`/v1AccountDeletionIntents/${user.userId}`)
    ),
    false,
  );
  const replacement = await prepare(jobs, user.userId);
  assert.equal(replacement.submissionExpiresAt, "2026-07-28T12:10:00.000Z");
});

test("prepared-intent mismatches and one-sided state fail closed", async () => {
  {
    const { firestore, jobs, user } = await createStores();
    const prepared = await prepare(jobs, user.userId);
    const intent = [...firestore.documents.values()].find(({ name }) =>
      name.endsWith(`/v1AccountDeletionIntents/${user.userId}`)
    );
    assert.ok(intent);
    intent.fields.intentId.stringValue = "intent_mismatched";
    assert.deepEqual(await jobs.readStatus(prepared.statusToken), {
      kind: "unavailable",
    });
    assert.deepEqual(
      await jobs.start(user.userId, CREDENTIALS, prepared.statusToken),
      { kind: "unavailable" },
    );
  }

  {
    const { firestore, jobs, user } = await createStores();
    const prepared = await prepare(jobs, user.userId);
    const userName = [...firestore.documents.keys()].find((name) =>
      name.endsWith(`/v1UserDirectory/${user.userId}`)
    );
    assert.ok(userName);
    firestore.documents.delete(userName);
    assert.deepEqual(await jobs.readStatus(prepared.statusToken), {
      kind: "unavailable",
    });
    assert.equal(await jobs.isFinalized(user.userId), false);
  }
});

test("deletion start atomically blocks access and encrypts provider proof", async () => {
  const { firestore, jobs, user, users } = await createStores();
  const prepared = await prepare(jobs, user.userId);
  const first = await startPrepared(jobs, user.userId, prepared.statusToken);
  const repeated = await startPrepared(jobs, user.userId, prepared.statusToken);
  assert.equal(first.requestId, repeated.requestId);
  assert.equal(first.statusToken, repeated.statusToken);
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
  assert.equal(persisted.includes(first.statusToken), false);
  assert.deepEqual(await jobs.readStatus(first.statusToken), {
    deadline: "2026-08-04T12:00:00.000Z",
    kind: "pending",
    reauthenticationProviders: [],
    requestedAt: "2026-07-28T12:00:00.000Z",
  });

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

  assert.deepEqual(
    await users.link(IDENTITY, APPLE_IDENTITY, user.userId),
    { kind: "deletion_pending" },
  );
  await assert.rejects(
    users.listSignInMethods(user.userId),
    InactiveUserError,
  );

  const pendingLink = await api.fetch(
    new Request("https://openjob.test/api/v1/me/sign-in-methods", {
      body: JSON.stringify({
        confirmation: "link",
        credentialToken: "must-not-be-verified",
        expectedTargetUserId: user.userId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(pendingLink.status, 410);
  assert.equal(
    (await pendingLink.json()).error.code,
    "account_deletion_pending",
  );
});

test("pending status capabilities remain valid after their submission deadline", async () => {
  let currentNow = NOW;
  const { jobs, user } = await createStores({ now: () => currentNow });
  const job = await createStarted(jobs, user.userId);
  currentNow = Date.parse("2026-08-05T12:00:00.000Z");
  assert.deepEqual(await jobs.readStatus(job.statusToken), {
    deadline: "2026-08-04T12:00:00.000Z",
    kind: "pending",
    reauthenticationProviders: [],
    requestedAt: "2026-07-28T12:00:00.000Z",
  });
  const recovered = await jobs.prepareStatusToken(user.userId);
  assert.equal(recovered.kind, "pending");
  assert.deepEqual(await jobs.readStatus(recovered.statusToken), {
    deadline: "2026-08-04T12:00:00.000Z",
    kind: "pending",
    reauthenticationProviders: [],
    requestedAt: "2026-07-28T12:00:00.000Z",
  });
});

test("deletion jobs durably lease work and checkpoint provider cleanup", async () => {
  const { jobs, user } = await createStores();
  const job = await createStarted(jobs, user.userId);
  assert.equal(
    await jobs.claim(user.userId, "2026-07-28T12:15:00.000Z"),
    true,
  );
  assert.equal(
    await jobs.claim(user.userId, "2026-07-28T12:15:00.000Z"),
    false,
  );
  const leaseUntil = "2026-07-28T12:15:00.000Z";
  await jobs.markCompletedStep(
    user.userId,
    "firebase-sessions:google",
    leaseUntil,
  );
  await jobs.markCompletedStep(
    user.userId,
    "provider-attempted:google",
    leaseUntil,
  );
  assert.equal(
    await jobs.completeProvider(user.userId, CREDENTIALS[0], leaseUntil),
    true,
  );
  await jobs.release(
    user.userId,
    "2026-07-28T12:15:00.000Z",
    "2026-07-28T12:00:00.000Z",
  );
  const pending = await jobs.listPending();
  assert.deepEqual(pending[0].completedSteps, [
    "firebase-sessions:google",
    "provider-attempted:google",
    "provider:google",
  ]);
  assert.deepEqual(pending[0].credentials, [{
    firebaseUid: IDENTITY.uid,
    provider: "google",
    providerSubject: IDENTITY.providerSubject,
  }]);
  assert.equal(
    await jobs.claim(user.userId, "2026-07-28T12:15:00.000Z"),
    true,
  );
  assert.equal(job.requestId, pending[0].requestId);
});

test("a stale worker cannot release a successor's deletion lease", async () => {
  let currentNow = NOW;
  const { jobs, user } = await createStores({ now: () => currentNow });
  await createStarted(jobs, user.userId);
  const firstLease = "2026-07-28T12:15:00.000Z";
  const secondLease = "2026-07-28T12:30:00.000Z";
  assert.equal(await jobs.claim(user.userId, firstLease), true);

  currentNow = Date.parse(firstLease);
  assert.equal(await jobs.claim(user.userId, secondLease), true);
  await jobs.release(
    user.userId,
    firstLease,
    new Date(currentNow).toISOString(),
  );
  assert.equal(
    await jobs.claim(user.userId, "2026-07-28T12:45:00.000Z"),
    false,
  );

  await jobs.release(
    user.userId,
    secondLease,
    new Date(currentNow).toISOString(),
  );
  assert.equal(
    await jobs.claim(user.userId, "2026-07-28T12:45:00.000Z"),
    true,
  );
});

test("recovery atomically reopens fresh proof under a successor lease and fences a stale finalizer", async () => {
  const { jobs, user, users } = await createStores();
  const job = await createStarted(jobs, user.userId);
  await makeFinalizable(jobs, job);
  const staleWorker = structuredClone(job);
  const successorLease = "2026-07-28T12:30:00.000Z";
  const replacement = {
    ...CREDENTIALS[0],
    revocation: {
      ...CREDENTIALS[0].revocation,
      value: "fresh-recovery-provider-proof",
    },
  };

  assert.equal(
    await jobs.reopenCredential(
      user.userId,
      { ...replacement, providerSubject: "different-provider-subject" },
      successorLease,
    ),
    null,
  );

  const reopened = await jobs.reopenCredential(
    user.userId,
    replacement,
    successorLease,
  );
  assert.ok(reopened);
  assert.equal(reopened.processingLeaseUntil, successorLease);
  assert.deepEqual(reopened.completedSteps, []);
  assert.deepEqual(reopened.reauthenticationProviders, ["google"]);
  assert.deepEqual(reopened.credentials, [replacement]);
  await assert.rejects(() =>
    jobs.markCompletedStep(
      user.userId,
      "firebase-sessions:google",
      staleWorker.processingLeaseUntil,
    )
  );
  const competingProof = {
    ...replacement,
    revocation: {
      ...replacement.revocation,
      value: "competing-provider-proof",
    },
  };
  assert.equal(
    await jobs.reopenCredential(
      user.userId,
      competingProof,
      "2026-07-28T12:45:00.000Z",
    ),
    null,
  );
  assert.deepEqual((await jobs.listPending())[0].credentials, [replacement]);
  assert.equal(
    await users.deleteForAccount(staleWorker, [IDENTITY.uid]),
    false,
  );

  await jobs.markCompletedStep(
    user.userId,
    "firebase-sessions:google",
    successorLease,
  );
  reopened.completedSteps.push("firebase-sessions:google");
  await jobs.markCompletedStep(
    user.userId,
    "provider-attempted:google",
    successorLease,
  );
  reopened.completedSteps.push("provider-attempted:google");
  assert.equal(
    await jobs.completeProvider(user.userId, replacement, successorLease),
    true,
  );
  reopened.credentials = [{
    firebaseUid: IDENTITY.uid,
    provider: "google",
    providerSubject: IDENTITY.providerSubject,
  }];
  reopened.completedSteps.push("provider:google");
  reopened.reauthenticationProviders = [];
  assert.equal(await users.deleteForAccount(reopened, [IDENTITY.uid]), true);
});

test("fresh provider proof replaces only its exact encrypted slot and completion scrubs revocation material", async () => {
  const { firestore, jobs, user } = await createStores();
  const job = await createStarted(jobs, user.userId);
  const leaseUntil = "2026-07-28T12:15:00.000Z";
  assert.equal(await jobs.claim(user.userId, leaseUntil), true);
  assert.equal(
    await jobs.markReauthenticationRequired(
      user.userId,
      CREDENTIALS[0],
      leaseUntil,
    ),
    true,
  );
  const target = await jobs.readRefreshTarget(job.statusToken, "google");
  assert.equal(target.kind, "target");
  assert.deepEqual(target.credential, CREDENTIALS[0]);

  const replacement = {
    firebaseUid: IDENTITY.uid,
    provider: "google",
    providerSubject: IDENTITY.providerSubject,
    revocation: {
      clientId: "google-web-client.apps.googleusercontent.com",
      expiresAt: "2026-07-28T12:30:00.000Z",
      kind: "validated_access_token",
      value: "fresh-replacement-access-token",
    },
  };
  assert.equal(
    await jobs.replaceCredential(
      user.userId,
      CREDENTIALS[0],
      replacement,
      leaseUntil,
      true,
    ),
    true,
  );
  assert.deepEqual(
    await jobs.readRefreshTarget(job.statusToken, "google"),
    { kind: "not_required" },
  );
  assert.equal(
    await jobs.completeProvider(user.userId, replacement, leaseUntil),
    true,
  );
  const [pending] = await jobs.listPending();
  assert.deepEqual(pending.credentials, [{
    firebaseUid: IDENTITY.uid,
    provider: "google",
    providerSubject: IDENTITY.providerSubject,
  }]);
  assert.deepEqual(pending.reauthenticationProviders, []);
  assert.ok(pending.completedSteps.includes("provider:google"));
  const storedJson = JSON.stringify([...firestore.documents.values()].find(
    ({ name }) => name.endsWith(`/v1AccountDeletions/${user.userId}`),
  ));
  assert.equal(storedJson.includes("fresh-replacement-access-token"), false);
  assert.equal(storedJson.includes(IDENTITY.uid), false);
});

test("deletion job parsing rejects identity-bearing or duplicate checkpoints", async () => {
  for (const completedSteps of [
    ["provider:firebase_sensitive_uid"],
    ["provider-attempted:google", "provider-attempted:google"],
  ]) {
    const { firestore, jobs, user } = await createStores();
    await createStarted(jobs, user.userId);
    const document = [...firestore.documents.values()].find(({ name }) =>
      name.endsWith(`/v1AccountDeletions/${user.userId}`)
    );
    document.fields.completedSteps.stringValue = JSON.stringify(completedSteps);
    await assert.rejects(() => jobs.listPending());
  }
});

test("identity finalization atomically removes the job, User, Username, and provider indexes", async () => {
  const { firestore, jobs, user, users } = await createStores();
  const job = await createStarted(jobs, user.userId);
  const jobDocument = [...firestore.documents.values()].find(({ name }) =>
    name.endsWith(`/v1AccountDeletions/${user.userId}`)
  );
  assert.ok(jobDocument);
  const intentName = jobDocument.name.replace(
    "/v1AccountDeletions/",
    "/v1AccountDeletionIntents/",
  );
  firestore.documents.set(intentName, {
    fields: {
      intentId: { stringValue: job.intentId },
      submissionExpiresAt: { timestampValue: job.submissionExpiresAt },
      userId: { stringValue: user.userId },
    },
    name: intentName,
    updateTime: "2026-07-28T12:00:00.999999Z",
  });
  await makeFinalizable(jobs, job);
  assert.equal(await users.deleteForAccount(job, [IDENTITY.uid]), true);
  assert.equal(await users.resolve(IDENTITY), null);
  assert.equal(await users.getByUsername("delete-me"), null);
  const persisted = JSON.stringify([...firestore.documents.values()]);
  assert.equal(persisted.includes(user.userId), false);
  assert.equal(persisted.includes("delete-me"), false);
  assert.equal(persisted.includes("v1AccountDeletions"), false);
  assert.equal(persisted.includes("v1AccountDeletionIntents"), false);
  assert.equal(persisted.includes(job.statusToken), false);
  assert.deepEqual(await jobs.readStatus(job.statusToken), {
    kind: "completed",
  });
  assert.equal(await users.deleteForAccount(job, [IDENTITY.uid]), false);
  assert.equal(await jobs.isFinalized(user.userId), true);
});

test("two providers sharing one Firebase UID finalize with one legacy and Firebase identity target", async () => {
  const { firestore, jobs, user, users } = await createStores();
  const appleIdentity = { ...APPLE_IDENTITY, uid: IDENTITY.uid };
  assert.equal(
    (await users.link(IDENTITY, appleIdentity, user.userId)).kind,
    "linked",
  );
  const credentials = [
    CREDENTIALS[0],
    {
      ...APPLE_CREDENTIAL,
      firebaseUid: IDENTITY.uid,
      providerSubject: appleIdentity.providerSubject,
    },
  ];
  const prepared = await prepare(jobs, user.userId);
  const started = await jobs.start(
    user.userId,
    credentials,
    prepared.statusToken,
  );
  assert.equal(started.kind, "started");
  const job = started.job;
  const leaseUntil = "2026-07-28T12:15:00.000Z";
  assert.equal(await jobs.claim(user.userId, leaseUntil), true);
  job.processingLeaseUntil = leaseUntil;
  for (const credential of credentials) {
    await jobs.markCompletedStep(
      user.userId,
      `firebase-sessions:${credential.provider}`,
      leaseUntil,
    );
    job.completedSteps.push(`firebase-sessions:${credential.provider}`);
    await jobs.markCompletedStep(
      user.userId,
      `provider-attempted:${credential.provider}`,
      leaseUntil,
    );
    job.completedSteps.push(`provider-attempted:${credential.provider}`);
    assert.equal(
      await jobs.completeProvider(user.userId, credential, leaseUntil),
      true,
    );
    job.completedSteps.push(`provider:${credential.provider}`);
  }
  job.credentials = credentials.map((credential) => ({
    firebaseUid: credential.firebaseUid,
    provider: credential.provider,
    providerSubject: credential.providerSubject,
  }));

  const legacyKey = Buffer.from(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(IDENTITY.uid),
  )).toString("base64url");
  const database = "projects/openjob-dev/databases/(default)/documents";
  const legacyName = `${database}/v1Users/${legacyKey}`;
  firestore.documents.set(legacyName, {
    fields: {
      userId: { stringValue: user.userId },
      username: { stringValue: "delete-me" },
    },
    name: legacyName,
    updateTime: "2026-07-28T12:00:00.999999Z",
  });

  assert.equal(
    await users.deleteForAccount(job, [IDENTITY.uid, IDENTITY.uid]),
    true,
  );
  assert.equal(firestore.documents.has(legacyName), false);
  assert.equal(await jobs.isFinalized(user.userId), true);
});

test("identity finalization fails closed when the live provider set differs from the deletion proof", async () => {
  const { firestore, jobs, user, users } = await createStores();
  const job = await createStarted(jobs, user.userId);
  await makeFinalizable(jobs, job);
  const providerSlotName = [...firestore.documents.keys()].find((name) =>
    name.endsWith(
      `/v1UserSignInMethods/${user.userId}/providers/${IDENTITY.provider}`,
    )
  );
  assert.ok(providerSlotName);
  firestore.documents.delete(providerSlotName);

  assert.equal(await jobs.validatePending(job), false);
  assert.equal(await users.deleteForAccount(job, [IDENTITY.uid]), false);
  assert.deepEqual(await users.resolve(IDENTITY), {
    deletionPending: true,
    userId: user.userId,
    username: "delete-me",
  });
});

test("status receipts fail closed for tampering, one-sided state, and mismatches", async () => {
  {
    const { jobs, user } = await createStores();
    const job = await createStarted(jobs, user.userId);
    const finalCharacter = job.statusToken.at(-1) === "A" ? "B" : "A";
    const tampered = `${job.statusToken.slice(0, -1)}${finalCharacter}`;
    assert.deepEqual(await jobs.readStatus(tampered), { kind: "invalid" });
    const [version, iv, ciphertext] = job.statusToken.split(".");
    for (const noncanonical of [
      `v2.${iv}.${ciphertext}`,
      `${version}.${iv}=.${ciphertext}`,
      `${job.statusToken}.extra`,
      `${version}.A.${ciphertext}`,
    ]) {
      assert.deepEqual(await jobs.readStatus(noncanonical), {
        kind: "invalid",
      });
    }
  }

  for (const missing of ["job", "user"]) {
    const { firestore, jobs, user } = await createStores();
    const job = await createStarted(jobs, user.userId);
    const suffix = missing === "job"
      ? `/v1AccountDeletions/${user.userId}`
      : `/v1UserDirectory/${user.userId}`;
    const name = [...firestore.documents.keys()].find((path) =>
      path.endsWith(suffix)
    );
    assert.ok(name);
    firestore.documents.delete(name);
    assert.deepEqual(await jobs.readStatus(job.statusToken), {
      kind: "unavailable",
    });
  }

  {
    const { firestore, jobs, user, users } = await createStores();
    const job = await createStarted(jobs, user.userId);
    await makeFinalizable(jobs, job);
    const userDocument = [...firestore.documents.values()].find(({ name }) =>
      name.endsWith(`/v1UserDirectory/${user.userId}`)
    );
    assert.ok(userDocument);
    userDocument.fields.deletionRequestId.stringValue = "del_mismatched";
    assert.deepEqual(await jobs.readStatus(job.statusToken), {
      kind: "unavailable",
    });
    assert.equal(await jobs.validatePending(job), false);
    assert.equal(await users.deleteForAccount(job, [IDENTITY.uid]), false);
  }

  {
    const { firestore, jobs, user } = await createStores();
    const job = await createStarted(jobs, user.userId);
    const jobDocument = [...firestore.documents.values()].find(({ name }) =>
      name.endsWith(`/v1AccountDeletions/${user.userId}`)
    );
    assert.ok(jobDocument);
    jobDocument.fields.credentialCiphertext.stringValue = "tampered";
    assert.deepEqual(await jobs.readStatus(job.statusToken), {
      kind: "unavailable",
    });
  }

  {
    const { firestore, jobs, user } = await createStores();
    await createStarted(jobs, user.userId);
    const jobDocument = [...firestore.documents.values()].find(({ name }) =>
      name.endsWith(`/v1AccountDeletions/${user.userId}`)
    );
    const userDocument = [...firestore.documents.values()].find(({ name }) =>
      name.endsWith(`/v1UserDirectory/${user.userId}`)
    );
    assert.ok(jobDocument);
    assert.ok(userDocument);
    jobDocument.fields.userId.stringValue = "user_other";
    userDocument.fields.userId.stringValue = "user_other";
    assert.deepEqual(await jobs.prepareStatusToken(user.userId), {
      kind: "unavailable",
    });
    await assert.rejects(() => jobs.listPending());
  }
});

test("status storage failure rejects instead of inferring completion", async () => {
  const { firestore, jobs, user } = await createStores();
  const job = await createStarted(jobs, user.userId);
  firestore.throttleNextRequest();
  await assert.rejects(() => jobs.readStatus(job.statusToken));
});

test("status reads use one snapshot across atomic pending-to-completed cleanup", async () => {
  const { firestore, jobs, user, users } = await createStores();
  const job = await createStarted(jobs, user.userId);
  await makeFinalizable(jobs, job);
  const paused = firestore.pauseNextDocumentRead(
    `v1AccountDeletions/${user.userId}`,
  );
  const statusDuringCleanup = jobs.readStatus(job.statusToken);
  await paused.waitUntilPaused();
  assert.equal(await users.deleteForAccount(job, [IDENTITY.uid]), true);
  paused.release();
  assert.deepEqual(await statusDuringCleanup, {
    deadline: "2026-08-04T12:00:00.000Z",
    kind: "pending",
    reauthenticationProviders: [],
    requestedAt: "2026-07-28T12:00:00.000Z",
  });
  assert.deepEqual(await jobs.readStatus(job.statusToken), {
    kind: "completed",
  });
});

test("a fresh status read racing POST cannot cancel the exact intent", async () => {
  const { firestore, jobs, user } = await createStores();
  const { statusToken } = await prepare(jobs, user.userId);
  const paused = firestore.pauseNextDocumentRead(
    `v1AccountDeletionIntents/${user.userId}`,
  );
  const status = jobs.readStatus(statusToken);
  await paused.waitUntilPaused();
  const start = jobs.start(user.userId, CREDENTIALS, statusToken);
  paused.release();
  assert.deepEqual(await status, {
    kind: "not_started",
    submissionExpired: false,
    submissionExpiresAt: "2026-07-28T12:05:00.000Z",
  });
  assert.equal((await start).kind, "started");
});

test("POST consumes the intent before a later GET reports the committed job", async () => {
  const { jobs, user } = await createStores();
  const { statusToken } = await prepare(jobs, user.userId);
  assert.equal(
    (await jobs.start(user.userId, CREDENTIALS, statusToken)).kind,
    "started",
  );
  assert.deepEqual(await jobs.readStatus(statusToken), {
    deadline: "2026-08-04T12:00:00.000Z",
    kind: "pending",
    reauthenticationProviders: [],
    requestedAt: "2026-07-28T12:00:00.000Z",
  });
});

test("simultaneous POSTs consume one intent and return the same exact job", async () => {
  const { firestore, jobs, user } = await createStores();
  const { statusToken } = await prepare(jobs, user.userId);
  firestore.synchronizeNextCommits(2);
  const first = jobs.start(user.userId, CREDENTIALS, statusToken);
  await firestore.waitForPendingCommits();
  const second = jobs.start(user.userId, CREDENTIALS, statusToken);
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(({ kind }) => kind), ["started", "started"]);
  assert.equal(results[0].job.requestId, results[1].job.requestId);
  assert.equal(results[0].job.statusToken, statusToken);
  assert.equal(results[1].job.statusToken, statusToken);
  assert.equal((await jobs.listPending()).length, 1);
});

test("status matching accepts equivalent precision and returns the job timestamps", async () => {
  const { firestore, jobs, user } = await createStores();
  const job = await createStarted(jobs, user.userId);
  const jobDocument = [...firestore.documents.values()].find(({ name }) =>
    name.endsWith(`/v1AccountDeletions/${user.userId}`)
  );
  const userDocument = [...firestore.documents.values()].find(({ name }) =>
    name.endsWith(`/v1UserDirectory/${user.userId}`)
  );
  assert.ok(jobDocument);
  assert.ok(userDocument);

  jobDocument.fields.startedAt.timestampValue = "2026-07-28T12:00:00Z";
  jobDocument.fields.deadline.timestampValue =
    "2026-08-04T12:00:00.000000000Z";
  userDocument.fields.deletionStartedAt.timestampValue =
    "2026-07-28T12:00:00.000000Z";
  userDocument.fields.deletionDeadline.timestampValue =
    "2026-08-04T12:00:00Z";
  assert.deepEqual(await jobs.readStatus(job.statusToken), {
    deadline: "2026-08-04T12:00:00.000000000Z",
    kind: "pending",
    reauthenticationProviders: [],
    requestedAt: "2026-07-28T12:00:00Z",
  });

  jobDocument.fields.startedAt.timestampValue =
    "2026-07-28T12:00:00.000000001Z";
  userDocument.fields.deletionStartedAt.timestampValue =
    "2026-07-28T12:00:00.000000001Z";
  assert.deepEqual(await jobs.readStatus(job.statusToken), {
    deadline: "2026-08-04T12:00:00.000000000Z",
    kind: "pending",
    reauthenticationProviders: [],
    requestedAt: "2026-07-28T12:00:00.000000001Z",
  });

  userDocument.fields.deletionStartedAt.timestampValue =
    "2026-07-28T12:00:00.000000002Z";
  assert.deepEqual(await jobs.readStatus(job.statusToken), {
    kind: "unavailable",
  });
});

test("identity finalization accepts equivalent Firestore timestamp precision", async () => {
  const { firestore, jobs, user, users } = await createStores();
  const job = await createStarted(jobs, user.userId);
  await makeFinalizable(jobs, job);
  const jobDocument = [...firestore.documents.values()].find(({ name }) =>
    name.endsWith(`/v1AccountDeletions/${user.userId}`)
  );
  const userDocument = [...firestore.documents.values()].find(({ name }) =>
    name.endsWith(`/v1UserDirectory/${user.userId}`)
  );
  assert.ok(jobDocument);
  assert.ok(userDocument);

  jobDocument.fields.startedAt.timestampValue = "2026-07-28T12:00:00Z";
  jobDocument.fields.deadline.timestampValue =
    "2026-08-04T12:00:00.000000000Z";
  userDocument.fields.deletionStartedAt.timestampValue =
    "2026-07-28T12:00:00.000000Z";
  userDocument.fields.deletionDeadline.timestampValue =
    "2026-08-04T12:00:00Z";

  assert.equal(await users.deleteForAccount(job, [IDENTITY.uid]), true);
  assert.equal(await jobs.isFinalized(user.userId), true);
});

test("a failed atomic start leaves the User active and stores no retry job", async () => {
  const { firestore, jobs, user, users } = await createStores();
  const { statusToken } = await prepare(jobs, user.userId);
  firestore.setMaxCommitWrites(1);
  await assert.rejects(() =>
    jobs.start(user.userId, CREDENTIALS, statusToken)
  );
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
