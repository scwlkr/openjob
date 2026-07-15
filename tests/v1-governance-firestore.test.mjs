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

const NOW = "2026-07-15T12:00:00.000Z";

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function createGovernanceHarness(names) {
  const authority = await createTestFirebaseAuthority({ now: NOW });
  const firestore = createFakeFirestore();
  const privateKey = await createPrivateKey();
  const userIds = names.map((_, index) => uuid(index + 1));
  const groupIds = Array.from({ length: 30 }, (_, index) => uuid(index + 501));
  const taskIds = Array.from({ length: 30 }, (_, index) => uuid(index + 901));
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
        randomUUID: () => groupIds.shift(),
      });
      const tasks = createFirestoreTaskStore(config, firestore.fetch, {
        now: () => Date.parse(controls.clock.now()),
        randomUUID: () => taskIds.shift(),
      });
      const verifyIdToken = createFirebaseIdTokenVerifier({
        fetchImplementation: authority.fetch,
        now: () => Date.parse(controls.clock.now()),
        projectId: "openjob-dev",
      });
      const identityApi = createV1IdentityApi({ groups, users, verifyIdToken });
      const groupsApi = createV1GroupsApi({
        groups,
        requestId: () => "req_governance_test",
        users,
        verifyIdToken,
      });
      const tasksApi = createV1TasksApi({ tasks, users, verifyIdToken });
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

  async function createGroup(name = "Governance Team") {
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
  }

  return { claim, createGroup, firestore, harness, join, request };
}

async function runOrderedCommitRace(firestore, firstRequest, secondRequest) {
  firestore.synchronizeNextCommits();
  const first = firstRequest();
  await firestore.waitForPendingCommits();
  return Promise.all([first, secondRequest()]);
}

test("an Admin promotes only a current Member through the stable API contract", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createGovernanceHarness(["shane", "eli", "maya"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  const shane = await claim("shane");
  const eli = await claim("eli");
  const maya = await claim("maya");
  const group = await createGroup();
  await join("eli", group.groupId);
  const promotePath = (userId) =>
    `/api/v1/groups/${group.groupId}/members/${userId}/actions/promote`;

  const memberAttempt = await request("eli", {
    method: "POST",
    path: promotePath(eli.userId),
  });
  assert.equal(memberAttempt.status, 403);
  await assertContract(
    memberAttempt,
    "/api/v1/groups/{groupId}/members/{userId}/actions/promote",
    "post",
  );
  assert.equal((await memberAttempt.json()).error.code, "admin_required");

  const promoted = await request("shane", {
    method: "POST",
    path: promotePath(eli.userId),
  });
  assert.equal(promoted.status, 200);
  await assertContract(
    promoted,
    "/api/v1/groups/{groupId}/members/{userId}/actions/promote",
    "post",
  );
  assert.deepEqual((await promoted.json()).data, {
    userId: eli.userId,
    username: "eli",
    role: "admin",
    joinedAt: NOW,
  });

  const repeated = await request("eli", {
    method: "POST",
    path: promotePath(shane.userId),
  });
  assert.equal(repeated.status, 409);
  await assertContract(
    repeated,
    "/api/v1/groups/{groupId}/members/{userId}/actions/promote",
    "post",
  );
  assert.equal((await repeated.json()).error.code, "member_role_conflict");

  const outsideMember = await request("shane", {
    method: "POST",
    path: promotePath(maya.userId),
  });
  assert.equal(outsideMember.status, 404);
  await assertContract(
    outsideMember,
    "/api/v1/groups/{groupId}/members/{userId}/actions/promote",
    "post",
  );
  assert.equal((await outsideMember.json()).error.code, "member_not_found");
});

test("Admins demote themselves and the creator only while another Admin remains", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createGovernanceHarness(["shane", "eli", "maya"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  const shane = await claim("shane");
  const eli = await claim("eli");
  await claim("maya");
  const group = await createGroup();
  await join("eli", group.groupId);
  await join("maya", group.groupId);
  const memberPath = (userId, action) =>
    `/api/v1/groups/${group.groupId}/members/${userId}/actions/${action}`;

  const promoted = await request("shane", {
    method: "POST",
    path: memberPath(eli.userId, "promote"),
  });
  assert.equal(promoted.status, 200);

  const memberAttempt = await request("maya", {
    method: "POST",
    path: memberPath(shane.userId, "demote"),
  });
  assert.equal(memberAttempt.status, 403);
  await assertContract(
    memberAttempt,
    "/api/v1/groups/{groupId}/members/{userId}/actions/demote",
    "post",
  );
  assert.equal((await memberAttempt.json()).error.code, "admin_required");

  const creatorDemoted = await request("eli", {
    method: "POST",
    path: memberPath(shane.userId, "demote"),
  });
  assert.equal(creatorDemoted.status, 200);
  await assertContract(
    creatorDemoted,
    "/api/v1/groups/{groupId}/members/{userId}/actions/demote",
    "post",
  );
  assert.deepEqual((await creatorDemoted.json()).data, {
    userId: shane.userId,
    username: "shane",
    role: "member",
    joinedAt: NOW,
  });

  const repeated = await request("eli", {
    method: "POST",
    path: memberPath(shane.userId, "demote"),
  });
  assert.equal(repeated.status, 409);
  await assertContract(
    repeated,
    "/api/v1/groups/{groupId}/members/{userId}/actions/demote",
    "post",
  );
  assert.equal((await repeated.json()).error.code, "member_role_conflict");

  const lastAdmin = await request("eli", {
    method: "POST",
    path: memberPath(eli.userId, "demote"),
  });
  assert.equal(lastAdmin.status, 409);
  await assertContract(
    lastAdmin,
    "/api/v1/groups/{groupId}/members/{userId}/actions/demote",
    "post",
  );
  assert.equal((await lastAdmin.json()).error.code, "last_admin");

  const restored = await request("eli", {
    method: "POST",
    path: memberPath(shane.userId, "promote"),
  });
  assert.equal(restored.status, 200);
  const selfDemoted = await request("eli", {
    method: "POST",
    path: memberPath(eli.userId, "demote"),
  });
  assert.equal(selfDemoted.status, 200);
  assert.equal((await selfDemoted.json()).data.role, "member");
});

test("Leave Group protects open work and the final Admin while preserving done attribution", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  await claim("shane");
  const eli = await claim("eli");
  const group = await createGroup();
  await join("eli", group.groupId);
  const leavePath = `/api/v1/groups/${group.groupId}/actions/leave`;
  const tasksPath = `/api/v1/groups/${group.groupId}/tasks`;

  const created = await request("shane", {
    body: { text: "Preserve historical attribution", assigneeUsername: "eli" },
    method: "POST",
    path: tasksPath,
  });
  assert.equal(created.status, 201);
  const task = (await created.json()).data;

  const blockedByTask = await request("eli", {
    method: "POST",
    path: leavePath,
  });
  assert.equal(blockedByTask.status, 409);
  await assertContract(
    blockedByTask,
    "/api/v1/groups/{groupId}/actions/leave",
    "post",
  );
  assert.equal(
    (await blockedByTask.json()).error.code,
    "open_tasks_assigned",
  );

  const completed = await request("eli", {
    body: { state: "done" },
    method: "PUT",
    path: `${tasksPath}/${task.taskId}/state`,
  });
  assert.equal(completed.status, 200);

  const left = await request("eli", {
    method: "POST",
    path: leavePath,
  });
  assert.equal(left.status, 204);
  await assertContract(
    left,
    "/api/v1/groups/{groupId}/actions/leave",
    "post",
  );

  const formerMemberRead = await request("eli", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}`,
  });
  assert.equal(formerMemberRead.status, 404);
  assert.equal((await formerMemberRead.json()).error.code, "group_not_found");
  const formerMemberGroups = await request("eli", {
    method: "GET",
    path: "/api/v1/groups",
  });
  assert.deepEqual(await formerMemberGroups.json(), {
    data: [],
    nextCursor: null,
  });

  const retainedTask = await request("shane", {
    method: "GET",
    path: `${tasksPath}/${task.taskId}`,
  });
  assert.equal(retainedTask.status, 200);
  const retained = (await retainedTask.json()).data;
  assert.equal(retained.state, "done");
  assert.deepEqual(retained.assignee, {
    state: "assigned",
    userId: eli.userId,
    username: "eli",
  });

  const adminTask = await request("shane", {
    body: { text: "Final Admin work", assigneeUsername: "shane" },
    method: "POST",
    path: tasksPath,
  });
  assert.equal(adminTask.status, 201);
  const finalAdmin = await request("shane", {
    method: "POST",
    path: leavePath,
  });
  assert.equal(finalAdmin.status, 409);
  await assertContract(
    finalAdmin,
    "/api/v1/groups/{groupId}/actions/leave",
    "post",
  );
  assert.equal((await finalAdmin.json()).error.code, "last_admin");

  const repeated = await request("eli", {
    method: "POST",
    path: leavePath,
  });
  assert.equal(repeated.status, 404);
  await assertContract(
    repeated,
    "/api/v1/groups/{groupId}/actions/leave",
    "post",
  );
  assert.equal((await repeated.json()).error.code, "group_not_found");
});

test("concurrent departure and self-demotion cannot remove every Admin", async (t) => {
  const { claim, createGroup, firestore, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  await claim("shane");
  const eli = await claim("eli");
  const group = await createGroup("Concurrent Admins");
  await join("eli", group.groupId);
  const promoted = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/promote`,
  });
  assert.equal(promoted.status, 200);

  const [departure, demotion] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        method: "POST",
        path: `/api/v1/groups/${group.groupId}/actions/leave`,
      }),
    () =>
      request("eli", {
        method: "POST",
        path: `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/demote`,
      }),
  );
  assert.equal(departure.status, 204);
  assert.equal(demotion.status, 409);
  assert.equal((await demotion.json()).error.code, "last_admin");
  assert.equal(firestore.preconditionFailures() >= 1, true);

  const roster = await request("eli", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/members`,
  });
  assert.equal(roster.status, 200);
  assert.deepEqual(await roster.json(), {
    data: [
      {
        userId: eli.userId,
        username: "eli",
        role: "admin",
        joinedAt: NOW,
      },
    ],
    nextCursor: null,
  });
});

test("Task assignment changes and departure cannot orphan open work", async (t) => {
  const { claim, createGroup, firestore, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  await claim("shane");
  await claim("eli");

  const createFirstGroup = await createGroup("Create First");
  await join("eli", createFirstGroup.groupId);
  const createFirstTasks = `/api/v1/groups/${createFirstGroup.groupId}/tasks`;
  const createFirstLeave = `/api/v1/groups/${createFirstGroup.groupId}/actions/leave`;
  const [creation, createFirstDeparture] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        body: { text: "Created during departure", assigneeUsername: "eli" },
        method: "POST",
        path: createFirstTasks,
      }),
    () =>
      request("eli", {
        method: "POST",
        path: createFirstLeave,
      }),
  );
  assert.equal(creation.status, 201);
  assert.equal(createFirstDeparture.status, 409);
  assert.equal(
    (await createFirstDeparture.json()).error.code,
    "open_tasks_assigned",
  );

  const leaveFirstGroup = await createGroup("Leave First");
  await join("eli", leaveFirstGroup.groupId);
  const leaveFirstTasks = `/api/v1/groups/${leaveFirstGroup.groupId}/tasks`;
  const leaveFirstPath = `/api/v1/groups/${leaveFirstGroup.groupId}/actions/leave`;
  const [leaveFirstDeparture, lateCreation] = await runOrderedCommitRace(
    firestore,
    () =>
      request("eli", {
        method: "POST",
        path: leaveFirstPath,
      }),
    () =>
      request("shane", {
        body: { text: "Too late to assign", assigneeUsername: "eli" },
        method: "POST",
        path: leaveFirstTasks,
      }),
  );
  assert.equal(leaveFirstDeparture.status, 204);
  assert.equal(lateCreation.status, 409);
  assert.equal((await lateCreation.json()).error.code, "assignee_not_member");

  const reassignGroup = await createGroup("Reassign First");
  await join("eli", reassignGroup.groupId);
  const reassignTasks = `/api/v1/groups/${reassignGroup.groupId}/tasks`;
  const originalResponse = await request("shane", {
    body: { text: "Reassigned during departure", assigneeUsername: "shane" },
    method: "POST",
    path: reassignTasks,
  });
  const original = (await originalResponse.json()).data;
  const [reassignment, reassignDeparture] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        body: { assigneeUsername: "eli" },
        method: "PATCH",
        path: `${reassignTasks}/${original.taskId}`,
      }),
    () =>
      request("eli", {
        method: "POST",
        path: `/api/v1/groups/${reassignGroup.groupId}/actions/leave`,
      }),
  );
  assert.equal(reassignment.status, 200);
  assert.equal(reassignDeparture.status, 409);
  assert.equal(
    (await reassignDeparture.json()).error.code,
    "open_tasks_assigned",
  );

  const reopenGroup = await createGroup("Reopen First");
  await join("eli", reopenGroup.groupId);
  const reopenTasks = `/api/v1/groups/${reopenGroup.groupId}/tasks`;
  const doneTaskResponse = await request("shane", {
    body: { text: "Reopened during departure", assigneeUsername: "eli" },
    method: "POST",
    path: reopenTasks,
  });
  const doneTask = (await doneTaskResponse.json()).data;
  const completed = await request("shane", {
    body: { state: "done" },
    method: "PUT",
    path: `${reopenTasks}/${doneTask.taskId}/state`,
  });
  assert.equal(completed.status, 200);
  const [reopened, reopenDeparture] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        body: { state: "open" },
        method: "PUT",
        path: `${reopenTasks}/${doneTask.taskId}/state`,
      }),
    () =>
      request("eli", {
        method: "POST",
        path: `/api/v1/groups/${reopenGroup.groupId}/actions/leave`,
      }),
  );
  assert.equal(reopened.status, 200);
  assert.equal(reopenDeparture.status, 409);
  assert.equal(
    (await reopenDeparture.json()).error.code,
    "open_tasks_assigned",
  );
});
