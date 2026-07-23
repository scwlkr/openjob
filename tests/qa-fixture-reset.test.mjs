import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createQaFixtureStore,
  resetQaFixture,
  runQaFixtureResetCli,
} from "../scripts/reset-qa-fixture.mjs";
import {
  createFakeFirestore,
  createPrivateKey,
} from "./support/fake-firestore.mjs";

const NOW = "2026-07-23T12:00:00.000Z";
const FIXTURE_ID = "openjob-two-user-qa-v1";
const GROUP_ID = "grp_9f5d28b6c10e4a7db3f924681c7e50aa";
const CONFIRMATION = `${FIXTURE_ID}:openjob-nonprod:${GROUP_ID}`;
const QA_ONE_USER_ID = "user_qa_one_stable";
const QA_TWO_USER_ID = "user_qa_two_stable";
const DATABASE =
  "projects/openjob-nonprod/databases/(default)/documents";
const GROUP_PATH = `${DATABASE}/v1Groups/${GROUP_ID}`;

function document(path, fields) {
  return {
    name: `${DATABASE}/${path}`,
    fields,
    updateTime: "2026-07-23T00:00:00.000001Z",
  };
}

function seedQaUsers(firestore) {
  const users = [
    [QA_ONE_USER_ID, "qa-one"],
    [QA_TWO_USER_ID, "qa-two"],
  ];
  for (const [userId, username] of users) {
    firestore.documents.set(
      `${DATABASE}/v1UserDirectory/${userId}`,
      document(`v1UserDirectory/${userId}`, {
        userId: { stringValue: userId },
        username: { stringValue: username },
      }),
    );
    firestore.documents.set(
      `${DATABASE}/v1Usernames/${username}`,
      document(`v1Usernames/${username}`, {
        userId: { stringValue: userId },
        claimedAt: { timestampValue: "2026-07-23T00:00:00.000Z" },
      }),
    );
  }
}

async function createFixtureHarness() {
  const firestore = createFakeFirestore({ projectId: "openjob-nonprod" });
  const privateKey = await createPrivateKey();
  const config = {
    projectId: "openjob-nonprod",
    clientEmail: "worker@openjob-nonprod.iam.gserviceaccount.com",
    privateKey,
  };
  seedQaUsers(firestore);
  return {
    firestore,
    store: createQaFixtureStore(config, firestore.fetch),
  };
}

function resetInput(store, overrides = {}) {
  return {
    confirmation: CONFIRMATION,
    environment: "preview",
    now: () => Date.parse(NOW),
    qaOneUserId: QA_ONE_USER_ID,
    qaTwoUserId: QA_TWO_USER_ID,
    store,
    ...overrides,
  };
}

test("a clean QA fixture reset creates the canonical state and is idempotent", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);

  const first = await resetQaFixture(input);
  assert.deepEqual(first, {
    changed: true,
    environment: "preview",
    fixtureId: FIXTURE_ID,
    groupId: GROUP_ID,
    taskCount: 7,
    writes: 16,
  });

  const group = firestore.documents.get(GROUP_PATH);
  assert.equal(group.fields.name.stringValue, "OpenJob QA Preview (Disposable)");
  assert.equal(
    group.fields.fixtureId.stringValue,
    FIXTURE_ID,
  );
  assert.equal(group.fields.stateRevision.integerValue, "0");

  const members = [...firestore.documents.values()]
    .filter(({ name }) =>
      name.includes(`/v1Groups/${GROUP_ID}/members/`),
    )
    .map(({ fields }) => [
      fields.username.stringValue,
      fields.role.stringValue,
    ])
    .sort();
  assert.deepEqual(members, [
    ["qa-one", "admin"],
    ["qa-two", "member"],
  ]);

  const tasks = [...firestore.documents.values()].filter(({ name }) =>
    name.includes(`/v1Groups/${GROUP_ID}/tasks/`),
  );
  assert.equal(tasks.length, 7);
  assert.deepEqual(
    new Set(tasks.map(({ fields }) => fields.priority.stringValue)),
    new Set(["high", "normal", "low"]),
  );
  assert.deepEqual(
    new Set(tasks.map(({ fields }) => fields.state.stringValue)),
    new Set(["open", "done"]),
  );
  assert.deepEqual(
    new Set(tasks.map(({ fields }) => fields.assigneeState.stringValue)),
    new Set(["assigned", "unassigned"]),
  );
  assert.deepEqual(
    new Set(
      tasks
        .map(({ fields }) => fields.assigneeUsername?.stringValue)
        .filter(Boolean),
    ),
    new Set(["qa-one", "qa-two"]),
  );
  assert.deepEqual(
    new Set(
      tasks.map(({ fields }) => fields.dueDate?.stringValue ?? null),
    ),
    new Set([null, "2026-07-16", "2026-07-23", "2026-07-30"]),
  );

  const commitsAfterFirstReset = firestore.commitAttempts();
  const second = await resetQaFixture(input);
  assert.deepEqual(second, {
    changed: false,
    environment: "preview",
    fixtureId: FIXTURE_ID,
    groupId: GROUP_ID,
    taskCount: 7,
    writes: 0,
  });
  assert.equal(firestore.commitAttempts(), commitsAfterFirstReset + 1);
});

test("a dirty QA fixture reset restores roles, Tasks, and notification state narrowly", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);

  const groupPath = GROUP_PATH;
  const group = structuredClone(firestore.documents.get(groupPath));
  group.fields.name = { stringValue: "Dirty QA Group" };
  group.updateTime = "2026-07-23T02:00:00.000001Z";
  firestore.documents.set(groupPath, group);

  const qaOneMemberPath =
    `${groupPath}/members/${QA_ONE_USER_ID}`;
  const qaOneMember = structuredClone(
    firestore.documents.get(qaOneMemberPath),
  );
  qaOneMember.fields.role = { stringValue: "member" };
  qaOneMember.updateTime = "2026-07-23T02:00:00.000002Z";
  firestore.documents.set(qaOneMemberPath, qaOneMember);

  firestore.documents.delete(
    `${groupPath}/tasks/task_qa_one_open_normal_none`,
  );
  const extraTask = structuredClone(
    firestore.documents.get(
      `${groupPath}/tasks/task_qa_one_open_high_overdue`,
    ),
  );
  extraTask.name = `${groupPath}/tasks/task_qa_extra_dirty`;
  extraTask.fields.taskId = { stringValue: "task_qa_extra_dirty" };
  extraTask.fields.text = { stringValue: "Dirty extra Task" };
  extraTask.updateTime = "2026-07-23T02:00:00.000003Z";
  firestore.documents.set(extraTask.name, extraTask);

  const banPath = `${groupPath}/bans/${QA_TWO_USER_ID}`;
  firestore.documents.set(
    banPath,
    document(
      `v1Groups/${GROUP_ID}/bans/${QA_TWO_USER_ID}`,
      {
        userId: { stringValue: QA_TWO_USER_ID },
        username: { stringValue: "qa-two" },
        bannedAt: { timestampValue: "2026-07-23T02:00:00.000Z" },
      },
    ),
  );

  const qaInstallationId = "installation_qa_one_dirty";
  const qaSubscriptionPath =
    `${DATABASE}/v1NotificationSubscriptions/${qaInstallationId}`;
  firestore.documents.set(
    qaSubscriptionPath,
    document(`v1NotificationSubscriptions/${qaInstallationId}`, {
      installationId: { stringValue: qaInstallationId },
      userId: { stringValue: QA_ONE_USER_ID },
      endpoint: { stringValue: "https://push.example.test/qa-one" },
      p256dh: { stringValue: "qa-one-p256dh" },
      auth: { stringValue: "qa-one-auth" },
      state: { stringValue: "active" },
      createdAt: { timestampValue: "2026-07-23T02:00:00.000Z" },
      updatedAt: { timestampValue: "2026-07-23T02:00:00.000Z" },
      stateChangedAt: { timestampValue: "2026-07-23T02:00:00.000Z" },
    }),
  );
  const qaIndexPath =
    `${DATABASE}/v1NotificationSubscriptionUsers/${QA_ONE_USER_ID}` +
    `/installations/${qaInstallationId}`;
  firestore.documents.set(
    qaIndexPath,
    document(
      `v1NotificationSubscriptionUsers/${QA_ONE_USER_ID}` +
        `/installations/${qaInstallationId}`,
      {
        installationId: { stringValue: qaInstallationId },
        userId: { stringValue: QA_ONE_USER_ID },
        state: { stringValue: "active" },
      },
    ),
  );

  const foreignSubscriptionPath =
    `${DATABASE}/v1NotificationSubscriptions/installation_foreign`;
  firestore.documents.set(
    foreignSubscriptionPath,
    document("v1NotificationSubscriptions/installation_foreign", {
      installationId: { stringValue: "installation_foreign" },
      userId: { stringValue: "user_foreign" },
      endpoint: { stringValue: "https://push.example.test/foreign" },
      p256dh: { stringValue: "foreign-p256dh" },
      auth: { stringValue: "foreign-auth" },
      state: { stringValue: "active" },
      createdAt: { timestampValue: "2026-07-23T02:00:00.000Z" },
      updatedAt: { timestampValue: "2026-07-23T02:00:00.000Z" },
      stateChangedAt: { timestampValue: "2026-07-23T02:00:00.000Z" },
    }),
  );

  const result = await resetQaFixture(input);
  assert.equal(result.changed, true);
  assert.equal(
    firestore.documents.get(groupPath).fields.name.stringValue,
    "OpenJob QA Preview (Disposable)",
  );
  assert.equal(
    firestore.documents.get(qaOneMemberPath).fields.role.stringValue,
    "admin",
  );
  assert.equal(
    [...firestore.documents.keys()].filter((path) =>
      path.startsWith(`${groupPath}/tasks/`),
    ).length,
    7,
  );
  assert.equal(firestore.documents.has(banPath), false);
  assert.equal(firestore.documents.has(qaSubscriptionPath), false);
  assert.equal(firestore.documents.has(qaIndexPath), false);
  assert.equal(firestore.documents.has(foreignSubscriptionPath), true);
  assert.deepEqual(await resetQaFixture(input), {
    changed: false,
    environment: "preview",
    fixtureId: FIXTURE_ID,
    groupId: GROUP_ID,
    taskCount: 7,
    writes: 0,
  });
});

test("a QA fixture reset invalidates only the fixture Invite Link graph", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);

  const routeId = "1234567890abcdef1234567890abcdef";
  const invitePath = `${GROUP_PATH}/invite/current`;
  const routePath = `${DATABASE}/v1InviteRoutes/${routeId}`;
  const staleRoutePath =
    `${DATABASE}/v1InviteRoutes/abcdef1234567890abcdef1234567890`;
  const foreignRoutePath =
    `${DATABASE}/v1InviteRoutes/fedcba0987654321fedcba0987654321`;
  firestore.documents.set(
    invitePath,
    document(`v1Groups/${GROUP_ID}/invite/current`, {
      baseIssuedAt: { timestampValue: NOW },
      groupId: { stringValue: GROUP_ID },
      joinWindow: { integerValue: "0" },
      routeId: { stringValue: routeId },
      secret: { stringValue: "never-log-this-secret" },
      successfulJoins: { integerValue: "1" },
    }),
  );
  for (const [path, routeGroupId] of [
    [routePath, GROUP_ID],
    [staleRoutePath, GROUP_ID],
    [foreignRoutePath, "grp_foreign"],
  ]) {
    firestore.documents.set(
      path,
      document(
        path.slice(`${DATABASE}/`.length),
        { groupId: { stringValue: routeGroupId } },
      ),
    );
  }

  const result = await resetQaFixture(input);

  assert.equal(result.changed, true);
  assert.equal(firestore.documents.has(invitePath), false);
  assert.equal(firestore.documents.has(routePath), false);
  assert.equal(firestore.documents.has(staleRoutePath), false);
  assert.equal(firestore.documents.has(foreignRoutePath), true);
});

test("a QA fixture reset preserves a colliding foreign Invite Link route", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);

  const routeId = "99999999999999999999999999999999";
  const invitePath = `${GROUP_PATH}/invite/current`;
  const foreignRoutePath = `${DATABASE}/v1InviteRoutes/${routeId}`;
  firestore.documents.set(
    invitePath,
    document(`v1Groups/${GROUP_ID}/invite/current`, {
      baseIssuedAt: { timestampValue: NOW },
      groupId: { stringValue: GROUP_ID },
      joinWindow: { integerValue: "0" },
      routeId: { stringValue: routeId },
      secret: { stringValue: "never-log-this-secret" },
      successfulJoins: { integerValue: "0" },
    }),
  );
  firestore.documents.set(
    foreignRoutePath,
    document(`v1InviteRoutes/${routeId}`, {
      groupId: { stringValue: "grp_foreign" },
    }),
  );

  const result = await resetQaFixture(input);

  assert.equal(result.changed, true);
  assert.equal(firestore.documents.has(invitePath), false);
  assert.equal(firestore.documents.has(foreignRoutePath), true);
});

test("a QA fixture reset repairs one-sided notification indexes narrowly", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);

  const switchedInstallationId = "installation_switched_owner";
  const switchedSubscriptionPath =
    `${DATABASE}/v1NotificationSubscriptions/${switchedInstallationId}`;
  const switchedIndexPath =
    `${DATABASE}/v1NotificationSubscriptionUsers/${QA_ONE_USER_ID}` +
    `/installations/${switchedInstallationId}`;
  const foreignInstallationId = "installation_now_foreign";
  const foreignSubscriptionPath =
    `${DATABASE}/v1NotificationSubscriptions/${foreignInstallationId}`;
  const staleQaIndexPath =
    `${DATABASE}/v1NotificationSubscriptionUsers/${QA_ONE_USER_ID}` +
    `/installations/${foreignInstallationId}`;
  for (const [path, installationId, userId] of [
    [switchedSubscriptionPath, switchedInstallationId, QA_TWO_USER_ID],
    [foreignSubscriptionPath, foreignInstallationId, "user_foreign"],
  ]) {
    firestore.documents.set(
      path,
      document(path.slice(`${DATABASE}/`.length), {
        installationId: { stringValue: installationId },
        userId: { stringValue: userId },
      }),
    );
  }
  for (const [path, installationId] of [
    [switchedIndexPath, switchedInstallationId],
    [staleQaIndexPath, foreignInstallationId],
  ]) {
    firestore.documents.set(
      path,
      document(path.slice(`${DATABASE}/`.length), {
        installationId: { stringValue: installationId },
        userId: { stringValue: QA_ONE_USER_ID },
      }),
    );
  }

  const result = await resetQaFixture(input);

  assert.equal(result.changed, true);
  assert.equal(firestore.documents.has(switchedSubscriptionPath), false);
  assert.equal(firestore.documents.has(switchedIndexPath), false);
  assert.equal(firestore.documents.has(staleQaIndexPath), false);
  assert.equal(firestore.documents.has(foreignSubscriptionPath), true);
});

test("a QA fixture reset fails closed when an expected membership belongs to another User", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);

  const memberPath =
    `${GROUP_PATH}/members/${QA_ONE_USER_ID}`;
  const member = structuredClone(firestore.documents.get(memberPath));
  member.fields.userId = { stringValue: "user_foreign" };
  member.updateTime = "2026-07-23T03:00:00.000001Z";
  firestore.documents.set(memberPath, member);
  const commitsBeforeBlockedReset = firestore.commitAttempts();

  await assert.rejects(
    resetQaFixture(input),
    /membership belongs to an unexpected User/,
  );
  assert.equal(firestore.commitAttempts(), commitsBeforeBlockedReset);
  assert.equal(
    firestore.documents.get(memberPath).fields.userId.stringValue,
    "user_foreign",
  );
});

test("a QA fixture reset fails closed on a foreign child fixture marker", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);

  const memberPath = `${GROUP_PATH}/members/${QA_ONE_USER_ID}`;
  const member = structuredClone(firestore.documents.get(memberPath));
  member.fields.fixtureId = { stringValue: "foreign-fixture" };
  member.updateTime = "2026-07-23T03:30:00.000001Z";
  firestore.documents.set(memberPath, member);
  const commitsBeforeBlockedReset = firestore.commitAttempts();

  await assert.rejects(
    resetQaFixture(input),
    /membership fixture identity does not match/,
  );
  assert.equal(firestore.commitAttempts(), commitsBeforeBlockedReset);
  assert.equal(
    firestore.documents.get(memberPath).fields.fixtureId.stringValue,
    "foreign-fixture",
  );
});

test("a partially missing QA fixture is restored without broad collection writes", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);

  const groupPath = GROUP_PATH;
  const missingPaths = [
    groupPath,
    `${groupPath}/members/${QA_TWO_USER_ID}`,
    `${groupPath}/membershipEvidence/${QA_ONE_USER_ID}`,
    `${DATABASE}/v1GroupAccess/${QA_TWO_USER_ID}` +
      `/groups/${GROUP_ID}`,
    `${groupPath}/tasks/task_qa_two_open_normal_today`,
  ];
  for (const path of missingPaths) firestore.documents.delete(path);
  const unrelatedPath = `${DATABASE}/v1Groups/grp_unrelated`;
  firestore.documents.set(
    unrelatedPath,
    document("v1Groups/grp_unrelated", {
      groupId: { stringValue: "grp_unrelated" },
      name: { stringValue: "Unrelated Group" },
      createdAt: { timestampValue: NOW },
      stateRevision: { integerValue: "5" },
    }),
  );

  const result = await resetQaFixture(input);
  assert.equal(result.changed, true);
  for (const path of missingPaths) {
    assert.equal(firestore.documents.has(path), true, path);
  }
  assert.equal(
    firestore.documents.get(groupPath).fields.stateRevision.integerValue,
    "0",
  );
  assert.equal(
    firestore.documents.get(unrelatedPath).fields.name.stringValue,
    "Unrelated Group",
  );
  assert.deepEqual(await resetQaFixture(input), {
    changed: false,
    environment: "preview",
    fixtureId: FIXTURE_ID,
    groupId: GROUP_ID,
    taskCount: 7,
    writes: 0,
  });
});

test("an exact reservation-only QA fixture state is recoverable", async () => {
  const { firestore, store } = await createFixtureHarness();
  const reservationPath = `${DATABASE}/v1GroupIds/${GROUP_ID}`;
  firestore.documents.set(
    reservationPath,
    document(`v1GroupIds/${GROUP_ID}`, {
      environment: { stringValue: "preview" },
      firebaseProjectId: { stringValue: "openjob-nonprod" },
      fixtureId: { stringValue: FIXTURE_ID },
      groupId: { stringValue: GROUP_ID },
      schemaVersion: { integerValue: "1" },
    }),
  );

  const result = await resetQaFixture(resetInput(store));

  assert.equal(result.changed, true);
  assert.equal(firestore.documents.has(GROUP_PATH), true);
  assert.equal(
    firestore.documents.has(`${DATABASE}/v1QaFixtures/${FIXTURE_ID}`),
    true,
  );
});

test("a QA fixture reset fails closed when an access record points to another Group", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);

  const accessPath =
    `${DATABASE}/v1GroupAccess/${QA_TWO_USER_ID}` +
    `/groups/${GROUP_ID}`;
  const access = structuredClone(firestore.documents.get(accessPath));
  access.fields.groupId = { stringValue: "grp_unexpected" };
  access.updateTime = "2026-07-23T04:00:00.000001Z";
  firestore.documents.set(accessPath, access);
  const commitsBeforeBlockedReset = firestore.commitAttempts();

  await assert.rejects(
    resetQaFixture(input),
    /access record points to an unexpected Group/,
  );
  assert.equal(firestore.commitAttempts(), commitsBeforeBlockedReset);
});

test("a QA fixture reset detects foreign membership without an access index", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);

  const foreignGroupId = "grp_11111111111111111111111111111111";
  const foreignGroupPath = `${DATABASE}/v1Groups/${foreignGroupId}`;
  const foreignMemberPath =
    `${foreignGroupPath}/members/${QA_ONE_USER_ID}`;
  firestore.documents.set(
    foreignGroupPath,
    document(`v1Groups/${foreignGroupId}`, {
      createdAt: { timestampValue: NOW },
      groupId: { stringValue: foreignGroupId },
      name: { stringValue: "Foreign Group" },
      stateRevision: { integerValue: "0" },
    }),
  );
  firestore.documents.set(
    foreignMemberPath,
    document(`v1Groups/${foreignGroupId}/members/${QA_ONE_USER_ID}`, {
      joinedAt: { timestampValue: NOW },
      membershipId: { stringValue: "foreign_membership" },
      role: { stringValue: "member" },
      userId: { stringValue: QA_ONE_USER_ID },
      username: { stringValue: "qa-one" },
    }),
  );
  const commitsBeforeBlockedReset = firestore.commitAttempts();

  await assert.rejects(
    resetQaFixture(input),
    /belongs to a non-QA Group/,
  );
  assert.equal(firestore.commitAttempts(), commitsBeforeBlockedReset);
  assert.equal(firestore.documents.has(foreignMemberPath), true);
});

test("the operator command accepts secrets only through named environment bindings", async () => {
  let output = "";
  const helpExit = await runQaFixtureResetCli({
    argv: ["--help"],
    env: {},
    stdout: {
      write(chunk) {
        output += chunk;
      },
    },
  });
  assert.equal(helpExit, 0);
  assert.match(output, /npm run qa:fixture:reset/);
  assert.doesNotMatch(output, /private key|password|token/i);

  await assert.rejects(
    runQaFixtureResetCli({
      argv: [
        "--environment",
        "preview",
        "--confirm",
        CONFIRMATION,
      ],
      env: {},
      stdout: { write() {} },
    }),
    /FIREBASE_PROJECT_ID binding is unavailable/,
  );
});

test("the repository exposes one canonical QA fixture reset command", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["qa:fixture:reset"],
    "node scripts/reset-qa-fixture.mjs",
  );
});

test("the QA fixture keeps Group identity opaque and Unassigned Tasks open", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("../config/qa-fixture.json", import.meta.url), "utf8"),
  );
  assert.match(
    fixture.environments.preview.groupId,
    /^grp_[a-f0-9]{32}$/,
  );
  for (const task of fixture.tasks) {
    if (task.assignee === "unassigned") {
      assert.equal(task.state, "open", task.taskId);
    }
  }
});

test("the QA fixture captures one Chicago calendar date for every Task", async () => {
  const { firestore, store } = await createFixtureHarness();
  let nowCalls = 0;
  const input = resetInput(store, {
    now() {
      nowCalls += 1;
      return Date.parse(
        nowCalls === 1
          ? "2026-07-24T00:30:00.000Z"
          : "2026-07-25T00:30:00.000Z",
      );
    },
  });

  await resetQaFixture(input);

  assert.equal(nowCalls, 1);
  const tasks = [...firestore.documents.values()].filter(({ name }) =>
    name.startsWith(`${GROUP_PATH}/tasks/`),
  );
  assert.deepEqual(
    new Set(tasks.map(({ fields }) => fields.dueDate?.stringValue ?? null)),
    new Set([null, "2026-07-16", "2026-07-23", "2026-07-30"]),
  );
});

test("the QA fixture runbook covers access, reset, recovery, rotation, and safe evidence", async () => {
  const runbook = await readFile(
    new URL("../docs/qa-fixture.md", import.meta.url),
    "utf8",
  );
  for (const heading of [
    "## Access",
    "## Reset",
    "## Recovery",
    "## Rotation",
    "## Evidence",
  ]) {
    assert.match(runbook, new RegExp(`^${heading}$`, "m"));
  }
  assert.match(runbook, /npm run qa:fixture:reset/);
  assert.match(runbook, /#34.*#36.*#37/s);
  assert.match(runbook, /1Password/);
  assert.match(runbook, /America\/Chicago/);
  assert.match(runbook, /transaction/i);
  assert.match(runbook, /must remain open/i);
});

test("a concurrent fixture Task aborts a no-op reset", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);
  const extraTaskPath = `${GROUP_PATH}/tasks/task_qa_concurrent`;
  const template = firestore.documents.get(
    `${GROUP_PATH}/tasks/task_qa_one_open_high_overdue`,
  );
  const commitsBeforeRace = firestore.commitAttempts();
  firestore.mutateBeforeNextTransactionCommit(() => {
    const task = structuredClone(template);
    task.name = extraTaskPath;
    task.fields.taskId = { stringValue: "task_qa_concurrent" };
    task.updateTime = "2026-07-23T04:30:00.000001Z";
    firestore.documents.set(extraTaskPath, task);
  });

  await assert.rejects(
    resetQaFixture(input),
    (error) => error?.code === "ABORTED",
  );
  assert.equal(firestore.commitAttempts(), commitsBeforeRace + 1);
  assert.equal(firestore.documents.has(extraTaskPath), true);
});

test("a concurrent foreign membership aborts a dirty reset", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);
  const group = structuredClone(firestore.documents.get(GROUP_PATH));
  group.fields.name = { stringValue: "Dirty before race" };
  group.updateTime = "2026-07-23T04:45:00.000001Z";
  firestore.documents.set(GROUP_PATH, group);
  const foreignGroupId = "grp_22222222222222222222222222222222";
  const foreignGroupPath = `${DATABASE}/v1Groups/${foreignGroupId}`;
  const foreignMemberPath =
    `${foreignGroupPath}/members/${QA_ONE_USER_ID}`;
  firestore.mutateBeforeNextTransactionCommit(() => {
    firestore.documents.set(
      foreignGroupPath,
      document(`v1Groups/${foreignGroupId}`, {
        createdAt: { timestampValue: NOW },
        groupId: { stringValue: foreignGroupId },
        name: { stringValue: "Concurrent foreign Group" },
        stateRevision: { integerValue: "0" },
      }),
    );
    firestore.documents.set(
      foreignMemberPath,
      document(`v1Groups/${foreignGroupId}/members/${QA_ONE_USER_ID}`, {
        joinedAt: { timestampValue: NOW },
        membershipId: { stringValue: "concurrent_foreign_membership" },
        role: { stringValue: "member" },
        userId: { stringValue: QA_ONE_USER_ID },
        username: { stringValue: "qa-one" },
      }),
    );
  });

  await assert.rejects(
    resetQaFixture(input),
    (error) => error?.code === "ABORTED",
  );
  assert.equal(
    firestore.documents.get(GROUP_PATH).fields.name.stringValue,
    "Dirty before race",
  );
  assert.equal(firestore.documents.has(foreignMemberPath), true);
});

test("the QA fixture reset refuses an unexpectedly broad write plan", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);
  await resetQaFixture(input);

  const groupPath = GROUP_PATH;
  const template = firestore.documents.get(
    `${groupPath}/tasks/task_qa_one_open_high_overdue`,
  );
  for (let index = 0; index < 101; index += 1) {
    const taskId = `task_qa_unexpected_${index}`;
    const task = structuredClone(template);
    task.name = `${groupPath}/tasks/${taskId}`;
    task.fields.taskId = { stringValue: taskId };
    task.updateTime =
      `2026-07-23T05:00:00.${String(index).padStart(6, "0")}Z`;
    firestore.documents.set(task.name, task);
  }
  const commitsBeforeBlockedReset = firestore.commitAttempts();

  await assert.rejects(
    resetQaFixture(input),
    /write plan exceeds the narrow safety limit/,
  );
  assert.equal(firestore.commitAttempts(), commitsBeforeBlockedReset);
});

test("wrong environment, target, or fixture identity fails closed", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = resetInput(store);

  await assert.rejects(
    resetQaFixture({ ...input, environment: "production" }),
    /environment is not allowed/,
  );
  await assert.rejects(
    resetQaFixture({ ...input, confirmation: "wrong-target" }),
    /confirmation does not match/,
  );
  await assert.rejects(
    resetQaFixture({
      ...input,
      store: { ...store, projectId: "openjob-dev" },
    }),
    /Firebase project does not match/,
  );
  await assert.rejects(
    resetQaFixture({
      ...input,
      qaOneUserId: "user_wrong",
    }),
    /does not resolve to the expected stable User ID/,
  );
  assert.equal(firestore.commitAttempts(), 0);

  await resetQaFixture(input);
  const groupPath = GROUP_PATH;
  const group = structuredClone(firestore.documents.get(groupPath));
  group.fields.fixtureId = { stringValue: "another-fixture" };
  group.updateTime = "2026-07-23T06:00:00.000001Z";
  firestore.documents.set(groupPath, group);
  const commitsBeforeCollision = firestore.commitAttempts();
  await assert.rejects(
    resetQaFixture(input),
    /Group identity does not match/,
  );
  assert.equal(firestore.commitAttempts(), commitsBeforeCollision);
});
