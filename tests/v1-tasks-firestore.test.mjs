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

test("the black-box Task journey persists through the Group-scoped Firestore adapter", async (t) => {
  const authority = await createTestFirebaseAuthority({ now: NOW });
  const firestore = createFakeFirestore();
  const database = "projects/openjob-dev/databases/(default)/documents";
  const legacyTaskName = `${database}/tasks/legacy_sentinel`;
  const legacyTask = {
    name: legacyTaskName,
    fields: {
      description: { stringValue: "Preserve the frozen legacy Task" },
    },
    updateTime: "2026-07-14T12:00:00.000000Z",
  };
  firestore.documents.set(legacyTaskName, structuredClone(legacyTask));
  const privateKey = await createPrivateKey();
  const assertContract = await createOpenApiResponseValidator();
  const userIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const groupIds = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ];
  const taskIds = [
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
  ];
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
      const groupsApi = createV1GroupsApi({ groups, users, verifyIdToken });
      const tasksApi = createV1TasksApi({ tasks, users, verifyIdToken });
      return {
        fetch(request) {
          const pathname = new URL(request.url).pathname;
          if (pathname.includes("/tasks")) return tasksApi.fetch(request);
          if (
            pathname.startsWith("/api/v1/groups") ||
            pathname.startsWith("/api/v1/invites")
          ) {
            return groupsApi.fetch(request);
          }
          return identityApi.fetch(request);
        },
      };
    },
  });
  t.after(() => harness.close());

  async function token(uid) {
    return { authorization: `Bearer ${await authority.issue({ uid })}` };
  }

  async function claim(headers, username) {
    const response = await harness.request({
      body: { username },
      headers,
      method: "PUT",
      path: "/api/v1/me/username",
    });
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  const shaneHeaders = await token("firebase_shane");
  const eliHeaders = await token("firebase_eli");
  const mayaHeaders = await token("firebase_maya");
  const shane = await claim(shaneHeaders, "shane");
  const eli = await claim(eliHeaders, "eli");
  await claim(mayaHeaders, "maya");

  const groupResponse = await harness.request({
    body: { name: "Task Team" },
    headers: shaneHeaders,
    method: "POST",
    path: "/api/v1/groups",
  });
  const group = (await groupResponse.json()).data;
  const inviteResponse = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/invite-link`,
  });
  const invite = (await inviteResponse.json()).data;
  const joined = await harness.request({
    headers: eliHeaders,
    method: "POST",
    path: `/api/v1/invites/${invite.token}/actions/join`,
  });
  assert.equal(joined.status, 200);

  const createdResponse = await harness.request({
    body: {
      text: "  Prepare release\r\n\r\nVerify persistence  ",
      assigneeUsername: "shane",
      dueDate: "2026-07-18",
    },
    headers: eliHeaders,
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/tasks`,
  });
  assert.equal(createdResponse.status, 201);
  await assertContract(
    createdResponse,
    "/api/v1/groups/{groupId}/tasks",
    "post",
  );
  const task = (await createdResponse.json()).data;
  assert.deepEqual(task, {
    taskId: "task_dddddddddddd4ddd8ddddddddddddddd",
    groupId: group.groupId,
    text: "Prepare release\n\nVerify persistence",
    assignee: {
      state: "assigned",
      userId: shane.userId,
      username: "shane",
    },
    dueDate: "2026-07-18",
    state: "open",
    createdAt: NOW,
    completedAt: null,
  });

  const laterForEliResponse = await harness.request({
    body: {
      text: "Eli later",
      assigneeUsername: "eli",
      dueDate: "2026-07-20",
    },
    headers: shaneHeaders,
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/tasks`,
  });
  assert.equal(laterForEliResponse.status, 201);
  const laterForEli = (await laterForEliResponse.json()).data;

  const soonerForEliResponse = await harness.request({
    body: {
      text: "Eli sooner",
      assigneeUsername: "eli",
      dueDate: "2026-07-17",
    },
    headers: shaneHeaders,
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/tasks`,
  });
  assert.equal(soonerForEliResponse.status, 201);
  const soonerForEli = (await soonerForEliResponse.json()).data;

  await harness.restart();
  const retrieved = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/tasks/${task.taskId}`,
  });
  await assertContract(
    retrieved,
    "/api/v1/groups/{groupId}/tasks/{taskId}",
    "get",
  );
  assert.deepEqual(await retrieved.json(), { data: task });

  const listed = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/tasks`,
  });
  await assertContract(listed, "/api/v1/groups/{groupId}/tasks", "get");
  assert.deepEqual(await listed.json(), {
    data: [soonerForEli, laterForEli, task],
    nextCursor: null,
  });

  const inaccessible = await harness.request({
    body: { text: "Private", assigneeUsername: "shane" },
    headers: mayaHeaders,
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/tasks`,
  });
  assert.equal(inaccessible.status, 404);
  assert.equal((await inaccessible.json()).error.code, "group_not_found");

  firestore.documents.delete(
    `${database}/v1Groups/${group.groupId}/members/${eli.userId}`,
  );
  const formerAssignee = await harness.request({
    body: { text: "Former Member", assigneeUsername: "eli" },
    headers: shaneHeaders,
    method: "POST",
    path: `/api/v1/groups/${group.groupId}/tasks`,
  });
  assert.equal(formerAssignee.status, 409);
  assert.equal((await formerAssignee.json()).error.code, "assignee_not_member");

  assert.equal(
    firestore.documents.has(
      `${database}/v1Groups/${group.groupId}/tasks/${task.taskId}`,
    ),
    true,
  );
  assert.deepEqual(
    [...firestore.documents.keys()].filter((name) =>
      name.startsWith(`${database}/tasks/`),
    ),
    [legacyTaskName],
  );
  assert.deepEqual(firestore.documents.get(legacyTaskName), legacyTask);
});
