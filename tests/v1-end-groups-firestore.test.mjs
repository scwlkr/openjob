import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreGroupStore } from "../db/groups.ts";
import { createFirestoreTaskStore } from "../db/v1-tasks.ts";
import { createFirestoreUserStore } from "../db/users.ts";
import { createFirebaseIdTokenVerifier } from "../server/firebase-id-token.ts";
import { createV1GroupsApi } from "../server/v1-groups.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
import { createV1TasksApi } from "../server/v1-tasks.ts";
import { createTestFirebaseAuthority } from "./support/firebase-id-tokens.mjs";
import {
  createFakeFirestore,
  createPrivateKey,
} from "./support/fake-firestore.mjs";
import { createOpenApiResponseValidator } from "./support/openapi-response.mjs";
import { createV1TestHarness } from "./support/v1-harness.mjs";

const NOW = "2026-07-16T12:00:00.000Z";

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function createEndGroupsHarness(names, { groupUuids = [] } = {}) {
  const authority = await createTestFirebaseAuthority({ now: NOW });
  const firestore = createFakeFirestore();
  const privateKey = await createPrivateKey();
  const userIds = names.map((_, index) => uuid(index + 1));
  let nextGroupUuid = 501;
  const queuedGroupUuids = [...groupUuids];
  let nextTaskUuid = 901;
  const tokens = new Map(
    await Promise.all(
      names.map(async (name) => [
        name,
        await authority.issue({ uid: `firebase_${name}` }),
      ]),
    ),
  );
  const config = {
    projectId: "openjob-dev",
    clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
    privateKey,
  };
  const harness = createV1TestHarness({
    initialNow: NOW,
    createWorker(controls) {
      const users = createFirestoreUserStore(config, firestore.fetch, {
        now: () => Date.parse(controls.clock.now()),
        randomUUID: () => userIds.shift(),
      });
      const groups = createFirestoreGroupStore(config, firestore.fetch, {
        now: () => Date.parse(controls.clock.now()),
        randomUUID: () => queuedGroupUuids.shift() ?? uuid(nextGroupUuid++),
      });
      const tasks = createFirestoreTaskStore(config, firestore.fetch, {
        now: () => Date.parse(controls.clock.now()),
        randomUUID: () => uuid(nextTaskUuid++),
      });
      const verifyIdToken = createFirebaseIdTokenVerifier({
        fetchImplementation: authority.fetch,
        now: () => Date.parse(controls.clock.now()),
        projectId: "openjob-dev",
      });
      const identityApi = createV1IdentityApi({ groups, users, verifyIdToken });
      const tasksApi = createV1TasksApi({ tasks, users, verifyIdToken });
      const groupsApi = createV1GroupsApi({
        groups,
        requestId: () => "req_end_group_test",
        users,
        verifyIdToken,
      });
      return {
        fetch(request) {
          const pathname = new URL(request.url).pathname;
          if (pathname.includes("/tasks")) return tasksApi.fetch(request);
          return pathname.startsWith("/api/v1/groups") ||
            pathname.startsWith("/api/v1/invites")
            ? groupsApi.fetch(request)
            : identityApi.fetch(request);
        },
      };
    },
  });

  async function request(name, options) {
    const token = tokens.get(name);
    return harness.request({
      ...options,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
  }

  async function claim(name) {
    const response = await request(name, {
      body: { username: name },
      method: "PUT",
      path: "/api/v1/me/username",
    });
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  async function createGroup(name) {
    const response = await request("shane", {
      body: { name },
      method: "POST",
      path: "/api/v1/groups",
    });
    assert.equal(response.status, 201);
    return (await response.json()).data;
  }

  async function join(name, groupId) {
    const inviteResponse = await request("shane", {
      method: "GET",
      path: `/api/v1/groups/${groupId}/invite-link`,
    });
    assert.equal(inviteResponse.status, 200);
    const invite = (await inviteResponse.json()).data;
    const response = await request(name, {
      method: "POST",
      path: `/api/v1/invites/${invite.token}/actions/join`,
    });
    assert.equal(response.status, 200);
    return invite;
  }

  return { claim, createGroup, firestore, harness, join, request };
}

async function runOrderedCommitRace(firestore, firstRequest, secondRequest) {
  firestore.synchronizeNextCommits();
  const first = firstRequest();
  await firestore.waitForPendingCommits();
  return Promise.all([first, secondRequest()]);
}

test("End Group conceals private Groups and enforces exact Admin-only eligibility", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createEndGroupsHarness(["shane", "eli", "maya"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  await claim("shane");
  await claim("eli");
  await claim("maya");
  const group = await createGroup("Exact Team");
  await join("eli", group.groupId);
  const path = `/api/v1/groups/${group.groupId}/actions/end`;

  const concealed = await request("maya", {
    body: {},
    method: "POST",
    path,
  });
  assert.equal(concealed.status, 404);
  await assertContract(
    concealed,
    "/api/v1/groups/{groupId}/actions/end",
    "post",
  );
  assert.equal((await concealed.json()).error.code, "group_not_found");

  const memberAttempt = await request("eli", {
    body: {},
    method: "POST",
    path,
  });
  assert.equal(memberAttempt.status, 403);
  await assertContract(
    memberAttempt,
    "/api/v1/groups/{groupId}/actions/end",
    "post",
  );
  assert.equal((await memberAttempt.json()).error.code, "admin_required");

  const invalid = await request("shane", {
    body: {},
    method: "POST",
    path,
  });
  assert.equal(invalid.status, 400);
  await assertContract(invalid, "/api/v1/groups/{groupId}/actions/end", "post");
  assert.deepEqual((await invalid.json()).error.fields, {
    confirmationName: "Provide the exact current Group Name.",
  });

  const mismatch = await request("shane", {
    body: { confirmationName: " exact team " },
    method: "POST",
    path,
  });
  assert.equal(mismatch.status, 409);
  await assertContract(mismatch, "/api/v1/groups/{groupId}/actions/end", "post");
  assert.equal((await mismatch.json()).error.code, "confirmation_mismatch");

  const membersRemain = await request("shane", {
    body: { confirmationName: "Exact Team" },
    method: "POST",
    path,
  });
  assert.equal(membersRemain.status, 409);
  await assertContract(
    membersRemain,
    "/api/v1/groups/{groupId}/actions/end",
    "post",
  );
  assert.equal((await membersRemain.json()).error.code, "members_remain");
});

test("End Group atomically purges every Group boundary and conceals stale state", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createEndGroupsHarness(["shane", "eli"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  const shane = await claim("shane");
  const eli = await claim("eli");
  const group = await createGroup("Purge Team");
  const invite = await join("eli", group.groupId);
  const tasksPath = `/api/v1/groups/${group.groupId}/tasks`;
  const firstTaskResponse = await request("shane", {
    body: { text: "Keep no task data", assigneeUsername: "eli" },
    method: "POST",
    path: tasksPath,
  });
  assert.equal(firstTaskResponse.status, 201);
  const firstTask = (await firstTaskResponse.json()).data;
  const secondTaskResponse = await request("shane", {
    body: { text: "Keep no history", assigneeUsername: "eli" },
    method: "POST",
    path: tasksPath,
  });
  const secondTask = (await secondTaskResponse.json()).data;
  const completed = await request("shane", {
    body: { state: "done" },
    method: "PUT",
    path: `${tasksPath}/${secondTask.taskId}/state`,
  });
  assert.equal(completed.status, 200);
  const banned = await request("shane", {
    body: { userId: eli.userId },
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/bans/actions/ban`,
  });
  assert.equal(banned.status, 201);

  const membersBefore = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/members`,
  });
  assert.deepEqual(
    (await membersBefore.json()).data.map(({ userId }) => userId),
    [shane.userId],
  );
  const bansBefore = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/bans`,
  });
  assert.deepEqual(
    (await bansBefore.json()).data.map(({ userId }) => userId),
    [eli.userId],
  );
  const tasksBefore = await request("shane", {
    method: "GET",
    path: `${tasksPath}?status=all`,
  });
  assert.deepEqual(
    (await tasksBefore.json()).data.map(({ taskId }) => taskId).sort(),
    [firstTask.taskId, secondTask.taskId].sort(),
  );

  const ended = await request("shane", {
    body: { confirmationName: "Purge Team" },
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/actions/end`,
  });
  assert.equal(ended.status, 204);
  await assertContract(ended, "/api/v1/groups/{groupId}/actions/end", "post");

  const staleGroup = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}`,
  });
  assert.equal(staleGroup.status, 404);
  assert.equal((await staleGroup.json()).error.code, "group_not_found");
  const staleGroupList = await request("shane", {
    method: "GET",
    path: "/api/v1/groups",
  });
  assert.deepEqual(await staleGroupList.json(), { data: [], nextCursor: null });
  for (const staleCollection of ["members", "bans", "tasks?status=all"]) {
    const response = await request("shane", {
      method: "GET",
      path: `/api/v1/groups/${group.groupId}/${staleCollection}`,
    });
    assert.equal(response.status, 404, staleCollection);
    assert.equal((await response.json()).error.code, "group_not_found");
  }
  const staleTask = await request("eli", {
    method: "GET",
    path: `${tasksPath}/${firstTask.taskId}`,
  });
  assert.equal(staleTask.status, 404);
  assert.equal((await staleTask.json()).error.code, "task_not_found");
  const staleInvite = await request("eli", {
    method: "GET",
    path: `/api/v1/invites/${invite.token}`,
  });
  assert.equal(staleInvite.status, 404);
  assert.equal((await staleInvite.json()).error.code, "invite_not_found");
  const repeated = await request("shane", {
    body: { confirmationName: "Purge Team" },
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/actions/end`,
  });
  assert.equal(repeated.status, 404);
  assert.equal((await repeated.json()).error.code, "group_not_found");
});

test("a failed End Group commit leaves every document intact", async (t) => {
  const { claim, createGroup, firestore, harness, request } =
    await createEndGroupsHarness(["shane"]);
  t.after(() => harness.close());
  await claim("shane");
  const group = await createGroup("Atomic Failure");
  const createdTask = await request("shane", {
    body: { text: "Must survive a failed purge", assigneeUsername: "shane" },
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/tasks`,
  });
  assert.equal(createdTask.status, 201);
  const task = (await createdTask.json()).data;
  const inviteBefore = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/invite-link`,
  });
  const invite = (await inviteBefore.json()).data;
  firestore.setMaxCommitWrites(1);

  const failed = await request("shane", {
    body: { confirmationName: "Atomic Failure" },
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/actions/end`,
  });
  assert.equal(failed.status, 500);
  assert.equal((await failed.json()).error.code, "internal_error");
  const groupAfter = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}`,
  });
  assert.deepEqual((await groupAfter.json()).data, group);
  const taskAfter = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/tasks/${task.taskId}`,
  });
  assert.deepEqual((await taskAfter.json()).data, task);
  const inviteAfter = await request("shane", {
    method: "GET",
    path: `/api/v1/invites/${invite.token}`,
  });
  assert.deepEqual(await inviteAfter.json(), {
    data: { groupName: "Atomic Failure" },
  });
});

test("concurrent End Group requests yield one success without a partial purge", async (t) => {
  const { claim, createGroup, firestore, harness, request } =
    await createEndGroupsHarness(["shane"]);
  t.after(() => harness.close());
  await claim("shane");
  const group = await createGroup("Concurrent End");
  const path = `/api/v1/groups/${group.groupId}/actions/end`;
  firestore.synchronizeNextCommits();

  const first = request("shane", {
    body: { confirmationName: "Concurrent End" },
    method: "POST",
    path,
  });
  await firestore.waitForPendingCommits();
  const responses = await Promise.all([
    first,
    request("shane", {
      body: { confirmationName: "Concurrent End" },
      method: "POST",
      path,
    }),
  ]);
  assert.deepEqual(
    responses.map(({ status }) => status).sort(),
    [204, 404],
  );
  const groupsAfter = await request("shane", {
    method: "GET",
    path: "/api/v1/groups",
  });
  assert.deepEqual(await groupsAfter.json(), { data: [], nextCursor: null });
});

test("Task creation racing End Group is either purged or rejected", async (t) => {
  const { claim, createGroup, firestore, harness, request } =
    await createEndGroupsHarness(["shane"]);
  t.after(() => harness.close());
  await claim("shane");

  const taskFirstGroup = await createGroup("Task First");
  const taskFirstPath = `/api/v1/groups/${taskFirstGroup.groupId}/tasks`;
  const [created, endedAfterCreation] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        body: { text: "Created before ending", assigneeUsername: "shane" },
        method: "POST",
        path: taskFirstPath,
      }),
    () =>
      request("shane", {
        body: { confirmationName: "Task First" },
        method: "POST",
        path: `/api/v1/groups/${taskFirstGroup.groupId}/actions/end`,
      }),
  );
  assert.equal(created.status, 201);
  assert.equal(endedAfterCreation.status, 204);

  const endFirstGroup = await createGroup("End First");
  const [endedBeforeCreation, rejected] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        body: { confirmationName: "End First" },
        method: "POST",
        path: `/api/v1/groups/${endFirstGroup.groupId}/actions/end`,
      }),
    () =>
      request("shane", {
        body: { text: "Created too late", assigneeUsername: "shane" },
        method: "POST",
        path: `/api/v1/groups/${endFirstGroup.groupId}/tasks`,
      }),
  );
  assert.equal(endedBeforeCreation.status, 204);
  assert.equal(rejected.status, 404);
  assert.equal((await rejected.json()).error.code, "group_not_found");

  for (const group of [taskFirstGroup, endFirstGroup]) {
    const groupAfter = await request("shane", {
      method: "GET",
      path: `/api/v1/groups/${group.groupId}`,
    });
    assert.equal(groupAfter.status, 404);
    assert.equal((await groupAfter.json()).error.code, "group_not_found");
    const tasksAfter = await request("shane", {
      method: "GET",
      path: `/api/v1/groups/${group.groupId}/tasks?status=all`,
    });
    assert.equal(tasksAfter.status, 404);
    assert.equal((await tasksAfter.json()).error.code, "group_not_found");
  }
});

test("an ended Group ID remains reserved when generation collides", async (t) => {
  const firstUuid = uuid(501);
  const secondUuid = uuid(506);
  const { claim, createGroup, harness, request } = await createEndGroupsHarness(
    ["shane"],
    {
      groupUuids: [
        firstUuid,
        uuid(502),
        uuid(503),
        firstUuid,
        uuid(504),
        uuid(505),
        secondUuid,
        uuid(507),
        uuid(508),
      ],
    },
  );
  t.after(() => harness.close());
  await claim("shane");
  const endedGroup = await createGroup("Original Group");
  const ended = await request("shane", {
    body: { confirmationName: "Original Group" },
    method: "POST",
    path: `/api/v1/groups/${endedGroup.groupId}/actions/end`,
  });
  assert.equal(ended.status, 204);

  const replacement = await createGroup("Replacement Group");
  assert.equal(
    endedGroup.groupId,
    `grp_${firstUuid.replaceAll("-", "")}`,
  );
  assert.equal(replacement.groupId, `grp_${secondUuid.replaceAll("-", "")}`);
  assert.notEqual(replacement.groupId, endedGroup.groupId);
});
