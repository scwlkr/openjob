import assert from "node:assert/strict";
import test from "node:test";
import { createV1TasksApi } from "../server/v1-tasks.ts";

const GROUP_ID = "grp_notifications";

function request(api, { body, method, path, user = "shane" }) {
  return api.fetch(new Request(`https://openjob.test${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Bearer ${user}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    method,
  }));
}

test("a Task assigned by another Member schedules one server-owned assignment notification", async () => {
  const scheduled = [];
  const intents = [];
  const task = {
    taskId: "task_assignment",
    groupId: GROUP_ID,
    text: "Prepare release notes",
    assignee: { state: "assigned", userId: "user_eli", username: "eli" },
    priority: "normal",
    dueDate: null,
    state: "open",
    createdAt: "2026-07-18T12:00:00.000Z",
    completedAt: null,
  };
  const api = createV1TasksApi({
    notifications: {
      dispatch: async (intent) => intents.push(intent),
      schedule: (delivery) => scheduled.push(delivery),
    },
    tasks: {
      async hasAccess() { return true; },
      async create() {
        return {
          kind: "created",
          task,
          change: {
            creatorUserId: "user_shane",
            previousAssigneeUserId: null,
            previousState: null,
          },
        };
      },
    },
    users: {
      async getByUsername(username) {
        return username === "eli"
          ? { userId: "user_eli", username: "eli" }
          : null;
      },
      async getOrCreate(firebaseUid) {
        return { userId: `user_${firebaseUid}`, username: firebaseUid };
      },
    },
    verifyIdToken: async (incoming) => ({
      uid: incoming.headers.get("authorization").replace("Bearer ", ""),
    }),
  });

  const response = await request(api, {
    body: { text: task.text, assigneeUsername: "eli" },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: task });
  assert.equal(scheduled.length, 1);
  assert.deepEqual(intents, []);

  await scheduled[0]();
  assert.deepEqual(intents, [{
    eventKind: "assignment",
    groupId: GROUP_ID,
    taskId: task.taskId,
    taskText: task.text,
    recipientUserIds: ["user_eli"],
  }]);
});

test("reassigning an open Task schedules its new Assignee notification", async () => {
  const scheduled = [];
  const intents = [];
  const before = {
    taskId: "task_reassignment",
    groupId: GROUP_ID,
    text: "Prepare release notes",
    assignee: { state: "assigned", userId: "user_shane", username: "shane" },
    priority: "normal",
    dueDate: null,
    state: "open",
    createdAt: "2026-07-18T12:00:00.000Z",
    completedAt: null,
  };
  const after = {
    ...before,
    assignee: { state: "assigned", userId: "user_eli", username: "eli" },
  };
  const api = createV1TasksApi({
    notifications: {
      dispatch: async (intent) => intents.push(intent),
      schedule: (delivery) => scheduled.push(delivery),
    },
    tasks: {
      async get() { return { kind: "found", task: before }; },
      async update() {
        return {
          kind: "updated",
          task: after,
          change: {
            creatorUserId: "user_shane",
            previousAssigneeUserId: "user_shane",
            previousState: "open",
          },
        };
      },
    },
    users: {
      async getByUsername(username) {
        return username === "eli"
          ? { userId: "user_eli", username: "eli" }
          : null;
      },
      async getOrCreate(firebaseUid) {
        return { userId: `user_${firebaseUid}`, username: firebaseUid };
      },
    },
    verifyIdToken: async (incoming) => ({
      uid: incoming.headers.get("authorization").replace("Bearer ", ""),
    }),
  });

  const response = await request(api, {
    body: { assigneeUsername: "eli" },
    method: "PATCH",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${before.taskId}`,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: after });
  assert.equal(scheduled.length, 1);
  await scheduled[0]();
  assert.deepEqual(intents, [{
    eventKind: "assignment",
    groupId: GROUP_ID,
    taskId: after.taskId,
    taskText: after.text,
    recipientUserIds: ["user_eli"],
  }]);
});

test("a real completion schedules the current Task Creator and Assignee without the actor", async () => {
  const scheduled = [];
  const intents = [];
  const before = {
    taskId: "task_completion",
    groupId: GROUP_ID,
    text: "Verify production",
    assignee: { state: "assigned", userId: "user_eli", username: "eli" },
    priority: "high",
    dueDate: "2026-07-18",
    state: "open",
    createdAt: "2026-07-18T12:00:00.000Z",
    completedAt: null,
  };
  const after = {
    ...before,
    state: "done",
    completedAt: "2026-07-18T13:00:00.000Z",
  };
  const api = createV1TasksApi({
    notifications: {
      dispatch: async (intent) => intents.push(intent),
      schedule: (delivery) => scheduled.push(delivery),
    },
    tasks: {
      async get() { return { kind: "found", task: before }; },
      async setState() {
        return {
          kind: "updated",
          task: after,
          change: {
            creatorUserId: "user_shane",
            previousAssigneeUserId: "user_eli",
            previousState: "open",
          },
        };
      },
    },
    users: {
      async getOrCreate(firebaseUid) {
        return { userId: `user_${firebaseUid}`, username: firebaseUid };
      },
    },
    verifyIdToken: async (incoming) => ({
      uid: incoming.headers.get("authorization").replace("Bearer ", ""),
    }),
  });

  const response = await request(api, {
    body: { state: "done" },
    method: "PUT",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${before.taskId}/state`,
    user: "maya",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: after });
  assert.equal(scheduled.length, 1);
  await scheduled[0]();
  assert.deepEqual(intents, [{
    eventKind: "completion",
    groupId: GROUP_ID,
    taskId: after.taskId,
    taskText: after.text,
    recipientUserIds: ["user_shane", "user_eli"],
  }]);
});

test("self-assignment and unchanged-Assignee edits do not schedule notifications", async () => {
  const scheduled = [];
  let task = {
    taskId: "task_suppressed",
    groupId: GROUP_ID,
    text: "Prepare release notes",
    assignee: { state: "assigned", userId: "user_shane", username: "shane" },
    priority: "normal",
    dueDate: null,
    state: "open",
    createdAt: "2026-07-18T12:00:00.000Z",
    completedAt: null,
  };
  const api = createV1TasksApi({
    notifications: {
      async dispatch() { throw new Error("must not dispatch"); },
      schedule: (delivery) => scheduled.push(delivery),
    },
    tasks: {
      async hasAccess() { return true; },
      async create() {
        return {
          kind: "created",
          task,
          change: {
            creatorUserId: "user_shane",
            previousAssigneeUserId: null,
            previousState: null,
          },
        };
      },
      async get() { return { kind: "found", task }; },
      async update() {
        task = { ...task, text: "Publish release notes" };
        return {
          kind: "updated",
          task,
          change: {
            creatorUserId: "user_shane",
            previousAssigneeUserId: "user_shane",
            previousState: "open",
          },
        };
      },
    },
    users: {
      async getByUsername(username) {
        return { userId: `user_${username}`, username };
      },
      async getOrCreate(firebaseUid) {
        return { userId: `user_${firebaseUid}`, username: firebaseUid };
      },
    },
    verifyIdToken: async (incoming) => ({
      uid: incoming.headers.get("authorization").replace("Bearer ", ""),
    }),
  });

  assert.equal((await request(api, {
    body: { text: task.text, assigneeUsername: "shane" },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  })).status, 201);
  assert.equal((await request(api, {
    body: { text: "Publish release notes", assigneeUsername: "shane" },
    method: "PATCH",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${task.taskId}`,
  })).status, 200);
  assert.deepEqual(scheduled, []);
});

test("completion deduplicates overlapping roles and ignores repeated done state", async () => {
  const scheduled = [];
  const intents = [];
  const completed = {
    taskId: "task_deduplicated",
    groupId: GROUP_ID,
    text: "Verify production",
    assignee: { state: "assigned", userId: "user_eli", username: "eli" },
    priority: "normal",
    dueDate: null,
    state: "done",
    createdAt: "2026-07-18T12:00:00.000Z",
    completedAt: "2026-07-18T13:00:00.000Z",
  };
  let previousState = "open";
  const api = createV1TasksApi({
    notifications: {
      dispatch: async (intent) => intents.push(intent),
      schedule: (delivery) => scheduled.push(delivery),
    },
    tasks: {
      async get() { return { kind: "found", task: completed }; },
      async setState() {
        const change = {
          creatorUserId: "user_eli",
          previousAssigneeUserId: "user_eli",
          previousState,
        };
        previousState = "done";
        return { kind: "updated", task: completed, change };
      },
    },
    users: {
      async getOrCreate(firebaseUid) {
        return { userId: `user_${firebaseUid}`, username: firebaseUid };
      },
    },
    verifyIdToken: async (incoming) => ({
      uid: incoming.headers.get("authorization").replace("Bearer ", ""),
    }),
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(api, {
      body: { state: "done" },
      method: "PUT",
      path: `/api/v1/groups/${GROUP_ID}/tasks/${completed.taskId}/state`,
    });
    assert.equal(response.status, 200);
  }
  assert.equal(scheduled.length, 1);
  await scheduled[0]();
  assert.deepEqual(intents[0].recipientUserIds, ["user_eli"]);
});
