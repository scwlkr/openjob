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
const QA_ONE_USER_ID = "user_qa_one_stable";
const QA_TWO_USER_ID = "user_qa_two_stable";
const DATABASE =
  "projects/openjob-nonprod/databases/(default)/documents";

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

test("a clean QA fixture reset creates the canonical state and is idempotent", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = {
    confirmation:
      "openjob-two-user-qa-v1:openjob-nonprod:grp_qa_two_user_preview_v1",
    environment: "preview",
    now: () => Date.parse(NOW),
    qaOneUserId: QA_ONE_USER_ID,
    qaTwoUserId: QA_TWO_USER_ID,
    store,
  };

  const first = await resetQaFixture(input);
  assert.deepEqual(first, {
    changed: true,
    environment: "preview",
    fixtureId: "openjob-two-user-qa-v1",
    groupId: "grp_qa_two_user_preview_v1",
    taskCount: 7,
    writes: 16,
  });

  const group = firestore.documents.get(
    `${DATABASE}/v1Groups/grp_qa_two_user_preview_v1`,
  );
  assert.equal(group.fields.name.stringValue, "OpenJob QA Preview (Disposable)");
  assert.equal(
    group.fields.fixtureId.stringValue,
    "openjob-two-user-qa-v1",
  );
  assert.equal(group.fields.stateRevision.integerValue, "0");

  const members = [...firestore.documents.values()]
    .filter(({ name }) =>
      name.includes("/v1Groups/grp_qa_two_user_preview_v1/members/"),
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
    name.includes("/v1Groups/grp_qa_two_user_preview_v1/tasks/"),
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
    fixtureId: "openjob-two-user-qa-v1",
    groupId: "grp_qa_two_user_preview_v1",
    taskCount: 7,
    writes: 0,
  });
  assert.equal(firestore.commitAttempts(), commitsAfterFirstReset);
});

test("a dirty QA fixture reset restores roles, Tasks, and notification state narrowly", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = {
    confirmation:
      "openjob-two-user-qa-v1:openjob-nonprod:grp_qa_two_user_preview_v1",
    environment: "preview",
    now: () => Date.parse(NOW),
    qaOneUserId: QA_ONE_USER_ID,
    qaTwoUserId: QA_TWO_USER_ID,
    store,
  };
  await resetQaFixture(input);

  const groupPath = `${DATABASE}/v1Groups/grp_qa_two_user_preview_v1`;
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
      `v1Groups/grp_qa_two_user_preview_v1/bans/${QA_TWO_USER_ID}`,
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
});

test("a QA fixture reset fails closed when an expected membership belongs to another User", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = {
    confirmation:
      "openjob-two-user-qa-v1:openjob-nonprod:grp_qa_two_user_preview_v1",
    environment: "preview",
    now: () => Date.parse(NOW),
    qaOneUserId: QA_ONE_USER_ID,
    qaTwoUserId: QA_TWO_USER_ID,
    store,
  };
  await resetQaFixture(input);

  const memberPath =
    `${DATABASE}/v1Groups/grp_qa_two_user_preview_v1/members/` +
    QA_ONE_USER_ID;
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

test("a partially missing QA fixture is restored without broad collection writes", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = {
    confirmation:
      "openjob-two-user-qa-v1:openjob-nonprod:grp_qa_two_user_preview_v1",
    environment: "preview",
    now: () => Date.parse(NOW),
    qaOneUserId: QA_ONE_USER_ID,
    qaTwoUserId: QA_TWO_USER_ID,
    store,
  };
  await resetQaFixture(input);

  const groupPath = `${DATABASE}/v1Groups/grp_qa_two_user_preview_v1`;
  const missingPaths = [
    groupPath,
    `${groupPath}/members/${QA_TWO_USER_ID}`,
    `${groupPath}/membershipEvidence/${QA_ONE_USER_ID}`,
    `${DATABASE}/v1GroupAccess/${QA_TWO_USER_ID}` +
      "/groups/grp_qa_two_user_preview_v1",
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
});

test("a QA fixture reset fails closed when an access record points to another Group", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = {
    confirmation:
      "openjob-two-user-qa-v1:openjob-nonprod:grp_qa_two_user_preview_v1",
    environment: "preview",
    now: () => Date.parse(NOW),
    qaOneUserId: QA_ONE_USER_ID,
    qaTwoUserId: QA_TWO_USER_ID,
    store,
  };
  await resetQaFixture(input);

  const accessPath =
    `${DATABASE}/v1GroupAccess/${QA_TWO_USER_ID}` +
    "/groups/grp_qa_two_user_preview_v1";
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
        "openjob-two-user-qa-v1:openjob-nonprod:" +
          "grp_qa_two_user_preview_v1",
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
  assert.match(runbook, /must remain open/i);
});

test("the QA fixture reset refuses an unexpectedly broad write plan", async () => {
  const { firestore, store } = await createFixtureHarness();
  const input = {
    confirmation:
      "openjob-two-user-qa-v1:openjob-nonprod:grp_qa_two_user_preview_v1",
    environment: "preview",
    now: () => Date.parse(NOW),
    qaOneUserId: QA_ONE_USER_ID,
    qaTwoUserId: QA_TWO_USER_ID,
    store,
  };
  await resetQaFixture(input);

  const groupPath = `${DATABASE}/v1Groups/grp_qa_two_user_preview_v1`;
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
  const input = {
    confirmation:
      "openjob-two-user-qa-v1:openjob-nonprod:grp_qa_two_user_preview_v1",
    environment: "preview",
    now: () => Date.parse(NOW),
    qaOneUserId: QA_ONE_USER_ID,
    qaTwoUserId: QA_TWO_USER_ID,
    store,
  };

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
  assert.equal(firestore.commitAttempts(), 0);

  await resetQaFixture(input);
  const groupPath = `${DATABASE}/v1Groups/grp_qa_two_user_preview_v1`;
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
