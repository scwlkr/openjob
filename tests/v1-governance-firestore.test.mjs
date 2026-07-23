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
    const creation = await request(name, {
      body: { confirmation: "create" },
      method: "POST",
      path: "/api/v1/me",
    });
    assert.ok(creation.status === 200 || creation.status === 201);
    const response = await request(name, {
      body: { username: name },
      method: "PUT",
      path: "/api/v1/me/username",
    });
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  async function createGroup(name = "Governance Team") {
    const creation = await request("shane", {
      body: { confirmation: "create" },
      method: "POST",
      path: "/api/v1/me",
    });
    assert.ok(creation.status === 200 || creation.status === 201);
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

test("Kick removes access, preserves work atomically, and allows ordinary rejoin", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createGovernanceHarness(["shane", "eli", "maya"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  const shane = await claim("shane");
  const eli = await claim("eli");
  const maya = await claim("maya");
  const group = await createGroup("Kick Recovery");
  await join("eli", group.groupId);
  await join("maya", group.groupId);
  const tasksPath = `/api/v1/groups/${group.groupId}/tasks`;
  const kickPath = `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/kick`;

  const inviteResponse = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/invite-link`,
  });
  const invite = (await inviteResponse.json()).data;
  const memberAttempt = await request("maya", {
    method: "POST",
    path: kickPath,
  });
  assert.equal(memberAttempt.status, 403);
  await assertContract(
    memberAttempt,
    "/api/v1/groups/{groupId}/members/{userId}/actions/kick",
    "post",
  );
  assert.equal((await memberAttempt.json()).error.code, "admin_required");
  const selfKick = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/members/${shane.userId}/actions/kick`,
  });
  assert.equal(selfKick.status, 409);
  await assertContract(
    selfKick,
    "/api/v1/groups/{groupId}/members/{userId}/actions/kick",
    "post",
  );
  assert.equal((await selfKick.json()).error.code, "self_removal");
  const promoted = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/promote`,
  });
  assert.equal(promoted.status, 200);

  const openResponse = await request("shane", {
    body: { text: "Recover this work", assigneeUsername: "eli" },
    method: "POST",
    path: tasksPath,
  });
  const openTask = (await openResponse.json()).data;
  const doneResponse = await request("shane", {
    body: { text: "Keep historical credit", assigneeUsername: "eli" },
    method: "POST",
    path: tasksPath,
  });
  const doneTask = (await doneResponse.json()).data;
  const completed = await request("maya", {
    body: { state: "done" },
    method: "PUT",
    path: `${tasksPath}/${doneTask.taskId}/state`,
  });
  assert.equal(completed.status, 200);

  const kicked = await request("shane", { method: "POST", path: kickPath });
  assert.equal(kicked.status, 204);
  assert.equal(await kicked.text(), "");
  await assertContract(
    kicked,
    "/api/v1/groups/{groupId}/members/{userId}/actions/kick",
    "post",
  );

  const formerMemberRead = await request("eli", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}`,
  });
  assert.equal(formerMemberRead.status, 404);
  assert.equal((await formerMemberRead.json()).error.code, "group_not_found");

  const listed = await request("maya", {
    method: "GET",
    path: `${tasksPath}?status=all`,
  });
  assert.equal(listed.status, 200);
  const tasks = (await listed.json()).data;
  assert.deepEqual(
    tasks.find(({ taskId }) => taskId === openTask.taskId).assignee,
    { state: "unassigned" },
  );
  assert.deepEqual(
    tasks.find(({ taskId }) => taskId === doneTask.taskId).assignee,
    { state: "assigned", userId: eli.userId, username: "eli" },
  );

  const rejoined = await request("eli", {
    method: "POST",
    path: `/api/v1/invites/${invite.token}/actions/join`,
  });
  assert.equal(rejoined.status, 200);
  assert.equal((await rejoined.json()).data.role, "member");
  const roster = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/members`,
  });
  const members = (await roster.json()).data;
  assert.equal(members.find(({ userId }) => userId === eli.userId).role, "member");
  const stillUnassigned = await request("eli", {
    method: "GET",
    path: `${tasksPath}/${openTask.taskId}`,
  });
  assert.deepEqual((await stillUnassigned.json()).data.assignee, {
    state: "unassigned",
  });
  const leftAfterRejoin = await request("eli", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/actions/leave`,
  });
  assert.equal(leftAfterRejoin.status, 204);

  const recovered = await request("maya", {
    body: { assigneeUsername: "maya" },
    method: "PATCH",
    path: `${tasksPath}/${openTask.taskId}`,
  });
  assert.equal(recovered.status, 200);
  assert.deepEqual((await recovered.json()).data.assignee, {
    state: "assigned",
    userId: maya.userId,
    username: "maya",
  });

  const manualClear = await request("maya", {
    body: { assigneeUsername: "unassigned" },
    method: "PATCH",
    path: `${tasksPath}/${openTask.taskId}`,
  });
  assert.equal(manualClear.status, 400);
  assert.equal((await manualClear.json()).error.code, "invalid_request");
  const manualCreate = await request("maya", {
    body: { text: "Invalid recovery", assigneeUsername: "unassigned" },
    method: "POST",
    path: tasksPath,
  });
  assert.equal(manualCreate.status, 400);
  assert.equal((await manualCreate.json()).error.code, "invalid_request");
});

test("Ban removes a current Member atomically and denies every Invite Link", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createGovernanceHarness(["shane", "eli", "maya"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  await claim("shane");
  const eli = await claim("eli");
  await claim("maya");
  const group = await createGroup("Ban Recovery");
  await join("eli", group.groupId);
  await join("maya", group.groupId);
  const tasksPath = `/api/v1/groups/${group.groupId}/tasks`;
  const inviteResponse = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/invite-link`,
  });
  const invite = (await inviteResponse.json()).data;

  const openResponse = await request("shane", {
    body: { text: "Recover banned work", assigneeUsername: "eli" },
    method: "POST",
    path: tasksPath,
  });
  const openTask = (await openResponse.json()).data;
  const doneResponse = await request("shane", {
    body: { text: "Retain banned attribution", assigneeUsername: "eli" },
    method: "POST",
    path: tasksPath,
  });
  const doneTask = (await doneResponse.json()).data;
  const completed = await request("maya", {
    body: { state: "done" },
    method: "PUT",
    path: `${tasksPath}/${doneTask.taskId}/state`,
  });
  assert.equal(completed.status, 200);

  const banned = await request("shane", {
    body: { userId: eli.userId },
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/bans/actions/ban`,
  });
  assert.equal(banned.status, 201);
  await assertContract(
    banned,
    "/api/v1/groups/{groupId}/bans/actions/ban",
    "post",
  );
  assert.deepEqual((await banned.json()).data, {
    userId: eli.userId,
    username: "eli",
    bannedAt: NOW,
  });

  const removedAccess = await request("eli", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}`,
  });
  assert.equal(removedAccess.status, 404);
  assert.equal((await removedAccess.json()).error.code, "group_not_found");
  const listed = await request("maya", {
    method: "GET",
    path: `${tasksPath}?status=all`,
  });
  const tasks = (await listed.json()).data;
  assert.deepEqual(
    tasks.find(({ taskId }) => taskId === openTask.taskId).assignee,
    { state: "unassigned" },
  );
  assert.deepEqual(
    tasks.find(({ taskId }) => taskId === doneTask.taskId).assignee,
    { state: "assigned", userId: eli.userId, username: "eli" },
  );

  const denied = await request("eli", {
    method: "POST",
    path: `/api/v1/invites/${invite.token}/actions/join`,
  });
  assert.equal(denied.status, 403);
  await assertContract(
    denied,
    "/api/v1/invites/{token}/actions/join",
    "post",
  );
  assert.equal((await denied.json()).error.code, "membership_denied");
});

test("an Admin can Ban an unclaimed current Member", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  const eli = await claim("eli");
  const group = await createGroup("Onboarding Ban");
  const creatorResponse = await request("shane", {
    method: "GET",
    path: "/api/v1/me",
  });
  const creator = (await creatorResponse.json()).data;
  assert.equal(creator.username, null);
  await join("eli", group.groupId);
  const promoted = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/promote`,
  });
  assert.equal(promoted.status, 200);

  const banned = await request("eli", {
    body: { userId: creator.userId },
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/bans/actions/ban`,
  });
  assert.equal(banned.status, 201);
  await assertContract(
    banned,
    "/api/v1/groups/{groupId}/bans/actions/ban",
    "post",
  );
  assert.deepEqual((await banned.json()).data, {
    userId: creator.userId,
    username: null,
    bannedAt: NOW,
  });
});

test("Admins ban former Members, list bans, and unban without restoring membership", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createGovernanceHarness(["shane", "eli", "maya", "zoe"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  await claim("shane");
  const eli = await claim("eli");
  const maya = await claim("maya");
  await claim("zoe");
  const group = await createGroup("Former Members");
  await join("eli", group.groupId);
  await join("maya", group.groupId);
  await join("zoe", group.groupId);
  const bansPath = `/api/v1/groups/${group.groupId}/bans`;
  const inviteResponse = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/invite-link`,
  });
  const invite = (await inviteResponse.json()).data;

  const left = await request("eli", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/actions/leave`,
  });
  assert.equal(left.status, 204);
  const kicked = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/members/${maya.userId}/actions/kick`,
  });
  assert.equal(kicked.status, 204);

  for (const former of [eli, maya]) {
    const banned = await request("shane", {
      body: { userId: former.userId },
      method: "POST",
      path: `${bansPath}/actions/ban`,
    });
    assert.equal(banned.status, 201);
    await assertContract(
      banned,
      "/api/v1/groups/{groupId}/bans/actions/ban",
      "post",
    );
  }

  const memberList = await request("zoe", {
    method: "GET",
    path: bansPath,
  });
  assert.equal(memberList.status, 403);
  await assertContract(memberList, "/api/v1/groups/{groupId}/bans", "get");
  assert.equal((await memberList.json()).error.code, "admin_required");

  const firstPageResponse = await request("shane", {
    method: "GET",
    path: `${bansPath}?limit=1`,
  });
  assert.equal(firstPageResponse.status, 200);
  await assertContract(
    firstPageResponse,
    "/api/v1/groups/{groupId}/bans",
    "get",
  );
  const firstPage = await firstPageResponse.json();
  assert.deepEqual(firstPage.data, [
    { userId: eli.userId, username: "eli", bannedAt: NOW },
  ]);
  assert.equal(typeof firstPage.nextCursor, "string");
  const secondPageResponse = await request("shane", {
    method: "GET",
    path: `${bansPath}?limit=1&cursor=${firstPage.nextCursor}`,
  });
  assert.deepEqual(await secondPageResponse.json(), {
    data: [{ userId: maya.userId, username: "maya", bannedAt: NOW }],
    nextCursor: null,
  });

  const memberUnban = await request("zoe", {
    method: "POST",
    path: `${bansPath}/${eli.userId}/actions/unban`,
  });
  assert.equal(memberUnban.status, 403);
  assert.equal((await memberUnban.json()).error.code, "admin_required");
  const unbanned = await request("shane", {
    method: "POST",
    path: `${bansPath}/${eli.userId}/actions/unban`,
  });
  assert.equal(unbanned.status, 204);
  await assertContract(
    unbanned,
    "/api/v1/groups/{groupId}/bans/{userId}/actions/unban",
    "post",
  );

  const stillDeparted = await request("eli", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}`,
  });
  assert.equal(stillDeparted.status, 404);
  const bannedAgain = await request("shane", {
    body: { userId: eli.userId },
    method: "POST",
    path: `${bansPath}/actions/ban`,
  });
  assert.equal(bannedAgain.status, 201);
  const unbannedAgain = await request("shane", {
    method: "POST",
    path: `${bansPath}/${eli.userId}/actions/unban`,
  });
  assert.equal(unbannedAgain.status, 204);

  const rejoined = await request("eli", {
    method: "POST",
    path: `/api/v1/invites/${invite.token}/actions/join`,
  });
  assert.equal(rejoined.status, 200);
  assert.equal((await rejoined.json()).data.role, "member");
  const repeatedUnban = await request("shane", {
    method: "POST",
    path: `${bansPath}/${eli.userId}/actions/unban`,
  });
  assert.equal(repeatedUnban.status, 404);
  await assertContract(
    repeatedUnban,
    "/api/v1/groups/{groupId}/bans/{userId}/actions/unban",
    "post",
  );
  assert.equal((await repeatedUnban.json()).error.code, "ban_not_found");
});

test("Ban governance preserves Admin-only privacy and settled conflicts", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createGovernanceHarness(["shane", "eli", "maya", "outsider"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  const shane = await claim("shane");
  await claim("eli");
  const maya = await claim("maya");
  const outsider = await claim("outsider");
  const group = await createGroup("Ban Boundaries");
  await join("eli", group.groupId);
  await join("maya", group.groupId);
  const bansPath = `/api/v1/groups/${group.groupId}/bans`;

  const memberAttempt = await request("eli", {
    body: { userId: maya.userId },
    method: "POST",
    path: `${bansPath}/actions/ban`,
  });
  assert.equal(memberAttempt.status, 403);
  assert.equal((await memberAttempt.json()).error.code, "admin_required");
  const selfBan = await request("shane", {
    body: { userId: shane.userId },
    method: "POST",
    path: `${bansPath}/actions/ban`,
  });
  assert.equal(selfBan.status, 409);
  await assertContract(
    selfBan,
    "/api/v1/groups/{groupId}/bans/actions/ban",
    "post",
  );
  assert.equal((await selfBan.json()).error.code, "self_removal");
  const preemptive = await request("shane", {
    body: { userId: outsider.userId },
    method: "POST",
    path: `${bansPath}/actions/ban`,
  });
  assert.equal(preemptive.status, 404);
  assert.equal((await preemptive.json()).error.code, "user_not_found");

  const invalidInput = await request("shane", {
    body: { userId: maya.userId, reason: "not in v1" },
    method: "POST",
    path: `${bansPath}/actions/ban`,
  });
  assert.equal(invalidInput.status, 400);
  await assertContract(
    invalidInput,
    "/api/v1/groups/{groupId}/bans/actions/ban",
    "post",
  );
  assert.equal((await invalidInput.json()).error.code, "invalid_request");

  const banned = await request("shane", {
    body: { userId: maya.userId },
    method: "POST",
    path: `${bansPath}/actions/ban`,
  });
  assert.equal(banned.status, 201);
  const repeated = await request("shane", {
    body: { userId: maya.userId },
    method: "POST",
    path: `${bansPath}/actions/ban`,
  });
  assert.equal(repeated.status, 409);
  await assertContract(
    repeated,
    "/api/v1/groups/{groupId}/bans/actions/ban",
    "post",
  );
  assert.equal((await repeated.json()).error.code, "ban_not_allowed");

  const invalidCursor = await request("shane", {
    method: "GET",
    path: `${bansPath}?cursor=not-a-real-cursor`,
  });
  assert.equal(invalidCursor.status, 400);
  assert.equal((await invalidCursor.json()).error.code, "invalid_request");
  const memberInvalidCursor = await request("eli", {
    method: "GET",
    path: `${bansPath}?cursor=`,
  });
  assert.equal(memberInvalidCursor.status, 403);
  assert.equal((await memberInvalidCursor.json()).error.code, "admin_required");
  const concealedInvalidCursor = await request("outsider", {
    method: "GET",
    path: `${bansPath}?cursor=`,
  });
  assert.equal(concealedInvalidCursor.status, 404);
  assert.equal((await concealedInvalidCursor.json()).error.code, "group_not_found");
  const concealedList = await request("outsider", {
    method: "GET",
    path: bansPath,
  });
  assert.equal(concealedList.status, 404);
  assert.equal((await concealedList.json()).error.code, "group_not_found");
  const concealedUnban = await request("outsider", {
    method: "POST",
    path: `${bansPath}/${maya.userId}/actions/unban`,
  });
  assert.equal(concealedUnban.status, 404);
  assert.equal((await concealedUnban.json()).error.code, "ban_not_found");
  const invalidUnban = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/not-a-group/bans/${maya.userId}/actions/unban`,
  });
  assert.equal(invalidUnban.status, 404);
  await assertContract(
    invalidUnban,
    "/api/v1/groups/{groupId}/bans/{userId}/actions/unban",
    "post",
  );
  assert.equal((await invalidUnban.json()).error.code, "ban_not_found");
});

test("concurrent Task assignment and Ban cannot leave an invalid assignee", async (t) => {
  const { claim, createGroup, firestore, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  const shane = await claim("shane");
  const eli = await claim("eli");

  const assignmentFirstGroup = await createGroup("Ban Assignment First");
  await join("eli", assignmentFirstGroup.groupId);
  const assignmentFirstTasks = `/api/v1/groups/${assignmentFirstGroup.groupId}/tasks`;
  const firstTaskResponse = await request("shane", {
    body: { text: "Assign before Ban", assigneeUsername: "shane" },
    method: "POST",
    path: assignmentFirstTasks,
  });
  const firstTask = (await firstTaskResponse.json()).data;
  const [assignment, laterBan] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        body: { assigneeUsername: "eli" },
        method: "PATCH",
        path: `${assignmentFirstTasks}/${firstTask.taskId}`,
      }),
    () =>
      request("shane", {
        body: { userId: eli.userId },
        method: "POST",
        path: `/api/v1/groups/${assignmentFirstGroup.groupId}/bans/actions/ban`,
      }),
  );
  assert.equal(assignment.status, 200);
  assert.equal(laterBan.status, 201);
  const unassigned = await request("shane", {
    method: "GET",
    path: `${assignmentFirstTasks}/${firstTask.taskId}`,
  });
  assert.deepEqual((await unassigned.json()).data.assignee, {
    state: "unassigned",
  });

  const banFirstGroup = await createGroup("Ban First");
  await join("eli", banFirstGroup.groupId);
  const banFirstTasks = `/api/v1/groups/${banFirstGroup.groupId}/tasks`;
  const secondTaskResponse = await request("shane", {
    body: { text: "Keep valid after Ban", assigneeUsername: "shane" },
    method: "POST",
    path: banFirstTasks,
  });
  const secondTask = (await secondTaskResponse.json()).data;
  const [firstBan, lateAssignment] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        body: { userId: eli.userId },
        method: "POST",
        path: `/api/v1/groups/${banFirstGroup.groupId}/bans/actions/ban`,
      }),
    () =>
      request("shane", {
        body: { assigneeUsername: "eli" },
        method: "PATCH",
        path: `${banFirstTasks}/${secondTask.taskId}`,
      }),
  );
  assert.equal(firstBan.status, 201);
  assert.equal(lateAssignment.status, 409);
  assert.equal((await lateAssignment.json()).error.code, "assignee_not_member");
  const stillAssigned = await request("shane", {
    method: "GET",
    path: `${banFirstTasks}/${secondTask.taskId}`,
  });
  assert.equal((await stillAssigned.json()).data.assignee.userId, shane.userId);
  assert.equal(firestore.preconditionFailures() >= 2, true);
});

test("concurrent rejoin and Ban leave the former Member banned and removed", async (t) => {
  const { claim, createGroup, firestore, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  await claim("shane");
  const eli = await claim("eli");

  async function inviteFor(groupId) {
    const response = await request("shane", {
      method: "GET",
      path: `/api/v1/groups/${groupId}/invite-link`,
    });
    return (await response.json()).data;
  }

  const joinFirstGroup = await createGroup("Rejoin Before Ban");
  await join("eli", joinFirstGroup.groupId);
  const joinFirstInvite = await inviteFor(joinFirstGroup.groupId);
  const firstLeave = await request("eli", {
    method: "POST",
    path: `/api/v1/groups/${joinFirstGroup.groupId}/actions/leave`,
  });
  assert.equal(firstLeave.status, 204);
  const [rejoinedFirst, laterBan] = await runOrderedCommitRace(
    firestore,
    () =>
      request("eli", {
        method: "POST",
        path: `/api/v1/invites/${joinFirstInvite.token}/actions/join`,
      }),
    () =>
      request("shane", {
        body: { userId: eli.userId },
        method: "POST",
        path: `/api/v1/groups/${joinFirstGroup.groupId}/bans/actions/ban`,
      }),
  );
  assert.equal(rejoinedFirst.status, 200);
  assert.equal(laterBan.status, 201);
  const removedAgain = await request("eli", {
    method: "GET",
    path: `/api/v1/groups/${joinFirstGroup.groupId}`,
  });
  assert.equal(removedAgain.status, 404);

  const banFirstGroup = await createGroup("Ban Before Rejoin");
  await join("eli", banFirstGroup.groupId);
  const banFirstInvite = await inviteFor(banFirstGroup.groupId);
  const secondLeave = await request("eli", {
    method: "POST",
    path: `/api/v1/groups/${banFirstGroup.groupId}/actions/leave`,
  });
  assert.equal(secondLeave.status, 204);
  const [bannedFirst, lateRejoin] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        body: { userId: eli.userId },
        method: "POST",
        path: `/api/v1/groups/${banFirstGroup.groupId}/bans/actions/ban`,
      }),
    () =>
      request("eli", {
        method: "POST",
        path: `/api/v1/invites/${banFirstInvite.token}/actions/join`,
      }),
  );
  assert.equal(bannedFirst.status, 201);
  assert.equal(lateRejoin.status, 403);
  assert.equal((await lateRejoin.json()).error.code, "membership_denied");
  assert.equal(firestore.preconditionFailures() >= 2, true);
});

test("concurrent Ban and demotion cannot remove every Admin", async (t) => {
  const { claim, createGroup, firestore, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  const shane = await claim("shane");
  const eli = await claim("eli");
  const group = await createGroup("Ban Role Race");
  await join("eli", group.groupId);
  const promoted = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/promote`,
  });
  assert.equal(promoted.status, 200);

  const [ban, demotion] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        body: { userId: eli.userId },
        method: "POST",
        path: `/api/v1/groups/${group.groupId}/bans/actions/ban`,
      }),
    () =>
      request("eli", {
        method: "POST",
        path: `/api/v1/groups/${group.groupId}/members/${shane.userId}/actions/demote`,
      }),
  );
  assert.equal(ban.status, 201);
  assert.equal(demotion.status, 404);
  assert.equal((await demotion.json()).error.code, "member_not_found");
  assert.equal(firestore.preconditionFailures() >= 1, true);

  const roster = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/members`,
  });
  assert.deepEqual(await roster.json(), {
    data: [
      {
        userId: shane.userId,
        username: "shane",
        role: "admin",
        joinedAt: NOW,
      },
    ],
    nextCursor: null,
  });
});

test("concurrent Task assignment and Kick cannot leave an invalid assignee", async (t) => {
  const { claim, createGroup, firestore, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  const shane = await claim("shane");
  const eli = await claim("eli");

  const assignmentFirstGroup = await createGroup("Assignment First");
  await join("eli", assignmentFirstGroup.groupId);
  const assignmentFirstTasks = `/api/v1/groups/${assignmentFirstGroup.groupId}/tasks`;
  const assignmentFirstTaskResponse = await request("shane", {
    body: { text: "Race to Eli", assigneeUsername: "shane" },
    method: "POST",
    path: assignmentFirstTasks,
  });
  const assignmentFirstTask = (await assignmentFirstTaskResponse.json()).data;
  const [assignment, laterKick] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        body: { assigneeUsername: "eli" },
        method: "PATCH",
        path: `${assignmentFirstTasks}/${assignmentFirstTask.taskId}`,
      }),
    () =>
      request("shane", {
        method: "POST",
        path: `/api/v1/groups/${assignmentFirstGroup.groupId}/members/${eli.userId}/actions/kick`,
      }),
  );
  assert.equal(assignment.status, 200);
  assert.equal(laterKick.status, 204);
  const unassignedResponse = await request("shane", {
    method: "GET",
    path: `${assignmentFirstTasks}/${assignmentFirstTask.taskId}`,
  });
  assert.deepEqual((await unassignedResponse.json()).data.assignee, {
    state: "unassigned",
  });

  const kickFirstGroup = await createGroup("Kick First");
  await join("eli", kickFirstGroup.groupId);
  const kickFirstTasks = `/api/v1/groups/${kickFirstGroup.groupId}/tasks`;
  const kickFirstTaskResponse = await request("shane", {
    body: { text: "Keep a valid assignee", assigneeUsername: "shane" },
    method: "POST",
    path: kickFirstTasks,
  });
  const kickFirstTask = (await kickFirstTaskResponse.json()).data;
  const [firstKick, lateAssignment] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        method: "POST",
        path: `/api/v1/groups/${kickFirstGroup.groupId}/members/${eli.userId}/actions/kick`,
      }),
    () =>
      request("shane", {
        body: { assigneeUsername: "eli" },
        method: "PATCH",
        path: `${kickFirstTasks}/${kickFirstTask.taskId}`,
      }),
  );
  assert.equal(firstKick.status, 204);
  assert.equal(lateAssignment.status, 409);
  assert.equal((await lateAssignment.json()).error.code, "assignee_not_member");
  const stillAssignedResponse = await request("shane", {
    method: "GET",
    path: `${kickFirstTasks}/${kickFirstTask.taskId}`,
  });
  assert.deepEqual((await stillAssignedResponse.json()).data.assignee, {
    state: "assigned",
    userId: shane.userId,
    username: "shane",
  });
  assert.equal(firestore.preconditionFailures() >= 2, true);
});

test("Kick remains atomic independently of the removed Member's open Task count", async (t) => {
  const { claim, createGroup, firestore, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  await claim("shane");
  const eli = await claim("eli");
  const group = await createGroup("Bounded Kick");
  await join("eli", group.groupId);
  const tasksPath = `/api/v1/groups/${group.groupId}/tasks`;
  const tasks = [];
  for (let index = 1; index <= 6; index += 1) {
    const created = await request("shane", {
      body: { text: `Bounded work ${index}`, assigneeUsername: "eli" },
      method: "POST",
      path: tasksPath,
    });
    assert.equal(created.status, 201);
    tasks.push((await created.json()).data);
  }

  firestore.setMaxCommitWrites(4);
  const commitsBeforeKick = firestore.commitAttempts();
  const kicked = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/kick`,
  });
  assert.equal(kicked.status, 204);
  assert.equal(firestore.commitAttempts(), commitsBeforeKick + 1);

  const listed = await request("shane", {
    method: "GET",
    path: `${tasksPath}?status=all`,
  });
  assert.equal(listed.status, 200);
  assert.deepEqual(
    (await listed.json()).data.map(({ taskId, assignee }) => ({ taskId, assignee })),
    tasks.map(({ taskId }) => ({ taskId, assignee: { state: "unassigned" } })),
  );
});

test("Kick supports memberships and Tasks persisted before membership generations", async (t) => {
  const { claim, createGroup, firestore, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  const shane = await claim("shane");
  const eli = await claim("eli");
  const group = await createGroup("Compatible Kick");
  await join("eli", group.groupId);
  const tasksPath = `/api/v1/groups/${group.groupId}/tasks`;
  const created = await request("shane", {
    body: { text: "Existing assigned work", assigneeUsername: "eli" },
    method: "POST",
    path: tasksPath,
  });
  const task = (await created.json()).data;
  const database = "projects/openjob-dev/databases/(default)/documents";
  for (const userId of [shane.userId, eli.userId]) {
    delete firestore.documents.get(
      `${database}/v1Groups/${group.groupId}/members/${userId}`,
    ).fields.membershipId;
  }
  delete firestore.documents.get(
    `${database}/v1Groups/${group.groupId}/tasks/${task.taskId}`,
  ).fields.assigneeMembershipId;

  const existingTask = await request("shane", {
    method: "GET",
    path: `${tasksPath}/${task.taskId}`,
  });
  assert.equal(existingTask.status, 200);
  assert.equal((await existingTask.json()).data.assignee.userId, eli.userId);
  const kicked = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/kick`,
  });
  assert.equal(kicked.status, 204);
  const unassigned = await request("shane", {
    method: "GET",
    path: `${tasksPath}/${task.taskId}`,
  });
  assert.deepEqual((await unassigned.json()).data.assignee, {
    state: "unassigned",
  });
});

test("a Task list racing Kick exposes one atomic assignee state", async (t) => {
  const { claim, createGroup, firestore, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  await claim("shane");
  const eli = await claim("eli");
  const group = await createGroup("List Kick Race");
  await join("eli", group.groupId);
  const tasksPath = `/api/v1/groups/${group.groupId}/tasks`;
  for (let index = 1; index <= 3; index += 1) {
    const created = await request("shane", {
      body: { text: `Racing work ${index}`, assigneeUsername: "eli" },
      method: "POST",
      path: tasksPath,
    });
    assert.equal(created.status, 201);
  }

  const pausedRead = firestore.pauseNextDocumentRead(
    `v1Groups/${group.groupId}/members/${eli.userId}`,
  );
  const listing = request("shane", {
    method: "GET",
    path: `${tasksPath}?status=all`,
  });
  await pausedRead.waitUntilPaused();
  const kicked = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/kick`,
  });
  pausedRead.release();
  assert.equal(kicked.status, 204);

  const listed = await listing;
  assert.equal(listed.status, 200);
  assert.deepEqual(
    (await listed.json()).data.map(({ assignee }) => assignee),
    Array.from({ length: 3 }, () => ({ state: "unassigned" })),
  );
});

test("concurrent Kick and demotion cannot remove every Admin", async (t) => {
  const { claim, createGroup, firestore, harness, join, request } =
    await createGovernanceHarness(["shane", "eli"]);
  t.after(() => harness.close());
  const shane = await claim("shane");
  const eli = await claim("eli");
  const group = await createGroup("Kick Role Race");
  await join("eli", group.groupId);
  const promoted = await request("shane", {
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/promote`,
  });
  assert.equal(promoted.status, 200);

  const [kick, demotion] = await runOrderedCommitRace(
    firestore,
    () =>
      request("shane", {
        method: "POST",
        path: `/api/v1/groups/${group.groupId}/members/${eli.userId}/actions/kick`,
      }),
    () =>
      request("eli", {
        method: "POST",
        path: `/api/v1/groups/${group.groupId}/members/${shane.userId}/actions/demote`,
      }),
  );
  assert.equal(kick.status, 204);
  assert.equal(demotion.status, 404);
  assert.equal((await demotion.json()).error.code, "member_not_found");
  assert.equal(firestore.preconditionFailures() >= 1, true);

  const roster = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/members`,
  });
  assert.deepEqual(await roster.json(), {
    data: [
      {
        userId: shane.userId,
        username: "shane",
        role: "admin",
        joinedAt: NOW,
      },
    ],
    nextCursor: null,
  });
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
