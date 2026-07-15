import assert from "node:assert/strict";
import test from "node:test";
import { createV1TasksApi } from "../server/v1-tasks.ts";
import { createOpenApiResponseValidator } from "./support/openapi-response.mjs";
import { createV1TestHarness } from "./support/v1-harness.mjs";

const GROUP_ID = "grp_tasks";
const USERS = {
  shane: { userId: "user_shane", username: "shane" },
  eli: { userId: "user_eli", username: "eli" },
  maya: { userId: "user_maya", username: "maya" },
};

function createMemoryTaskStore(controls) {
  let nextTask = 1;

  async function isMember(state, groupId, userId) {
    return Boolean(
      await state.get(["groups", groupId, "members", userId]),
    );
  }

  return Object.freeze({
    async hasAccess(actorUserId, groupId) {
      return isMember(controls.state, groupId, actorUserId);
    },

    async create(actorUserId, groupId, assignee, input) {
      return controls.state.transaction(async (state) => {
        if (!(await isMember(state, groupId, actorUserId))) {
          return { kind: "not_found" };
        }
        if (!(await isMember(state, groupId, assignee.userId))) {
          return { kind: "assignee_not_member" };
        }
        const taskId = `task_${String(nextTask).padStart(4, "0")}`;
        nextTask += 1;
        const task = {
          taskId,
          groupId,
          text: input.text,
          assignee: {
            state: "assigned",
            userId: assignee.userId,
            username: assignee.username,
          },
          dueDate: input.dueDate,
          state: "open",
          createdAt: controls.clock.now(),
          completedAt: null,
        };
        await state.put(["groups", groupId, "tasks", taskId], task);
        return { kind: "created", task };
      });
    },

    async get(actorUserId, groupId, taskId) {
      if (!(await isMember(controls.state, groupId, actorUserId))) {
        return { kind: "group_not_found" };
      }
      const task = await controls.state.get([
        "groups",
        groupId,
        "tasks",
        taskId,
      ]);
      return task ? { kind: "found", task } : { kind: "task_not_found" };
    },

    async update(actorUserId, groupId, taskId, input) {
      return controls.state.transaction(async (state) => {
        if (!(await isMember(state, groupId, actorUserId))) {
          return { kind: "group_not_found" };
        }
        const path = ["groups", groupId, "tasks", taskId];
        const task = await state.get(path);
        if (!task) return { kind: "task_not_found" };
        if (task.state === "done") return { kind: "task_done" };
        if (
          input.assignee &&
          !(await isMember(state, groupId, input.assignee.userId))
        ) {
          return { kind: "assignee_not_member" };
        }
        const updated = {
          ...task,
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.assignee !== undefined
            ? { assignee: { state: "assigned", ...input.assignee } }
            : {}),
          ...("dueDate" in input ? { dueDate: input.dueDate } : {}),
        };
        await state.put(path, updated);
        return { kind: "updated", task: updated };
      });
    },

    async setState(actorUserId, groupId, taskId, desiredState) {
      return controls.state.transaction(async (state) => {
        if (!(await isMember(state, groupId, actorUserId))) {
          return { kind: "group_not_found" };
        }
        const path = ["groups", groupId, "tasks", taskId];
        const task = await state.get(path);
        if (!task) return { kind: "task_not_found" };
        if (task.state === desiredState) return { kind: "updated", task };
        const updated = {
          ...task,
          state: desiredState,
          completedAt:
            desiredState === "done" ? controls.clock.now() : null,
        };
        await state.put(path, updated);
        return { kind: "updated", task: updated };
      });
    },

    async delete(actorUserId, groupId, taskId) {
      return controls.state.transaction(async (state) => {
        if (!(await isMember(state, groupId, actorUserId))) {
          return { kind: "group_not_found" };
        }
        const deleted = await state.delete([
          "groups",
          groupId,
          "tasks",
          taskId,
        ]);
        return deleted ? { kind: "deleted" } : { kind: "task_not_found" };
      });
    },

    async list(actorUserId, groupId) {
      if (!(await isMember(controls.state, groupId, actorUserId))) {
        return { kind: "not_found" };
      }
      const records = await controls.state.list(["groups", groupId, "tasks"]);
      return {
        kind: "found",
        tasks: records.map(({ value }) => value),
        nextCursor: null,
      };
    },
  });
}

function createTasksHarness({
  memberNames = ["shane", "eli"],
  seedTasks = [],
} = {}) {
  return createV1TestHarness({
    async createWorker(controls) {
      for (const name of memberNames) {
        const user = USERS[name];
        await controls.state.put(
          ["groups", GROUP_ID, "members", user.userId],
          { role: user.userId === USERS.shane.userId ? "admin" : "member" },
        );
      }
      for (const task of seedTasks) {
        await controls.state.put(
          ["groups", GROUP_ID, "tasks", task.taskId],
          task,
        );
      }
      const users = {
        async getByUsername(username) {
          return USERS[username] ?? null;
        },
        async getOrCreate(firebaseUid) {
          return USERS[firebaseUid.replace("firebase_", "")];
        },
      };
      const verifyIdToken = async (request) => {
        const identity = controls.identities.authenticate(request);
        return identity ? { uid: identity.claims.sub } : null;
      };
      return createV1TasksApi({
        requestId: () => "req_tasks_test",
        tasks: createMemoryTaskStore(controls),
        users,
        verifyIdToken,
      });
    },
  });
}

test("a Member creates an assigned Task and another Member retrieves it", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());

  const createdResponse = await harness.request({
    as: "shane",
    body: {
      text: "  Ship the release\r\n\r\nConfirm production  ",
      assigneeUsername: "eli",
      dueDate: "2026-07-18",
    },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  assert.equal(createdResponse.status, 201);
  const task = (await createdResponse.json()).data;
  assert.deepEqual(task, {
    taskId: "task_0001",
    groupId: GROUP_ID,
    text: "Ship the release\n\nConfirm production",
    assignee: {
      state: "assigned",
      userId: USERS.eli.userId,
      username: USERS.eli.username,
    },
    dueDate: "2026-07-18",
    state: "open",
    createdAt: "2026-07-15T12:00:00.000Z",
    completedAt: null,
  });

  const retrieved = await harness.request({
    as: "eli",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${task.taskId}`,
  });
  assert.equal(retrieved.status, 200);
  assert.deepEqual(await retrieved.json(), { data: task });
});

test("a Member edits an open Task and reassigns it to a current Member", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());

  const createdResponse = await harness.request({
    as: "shane",
    body: {
      text: "Draft release notes",
      assigneeUsername: "eli",
      dueDate: "2026-07-18",
    },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  const created = (await createdResponse.json()).data;

  const editedResponse = await harness.request({
    as: "eli",
    body: {
      text: "  Publish release notes\r\n\r\nConfirm links  ",
      assigneeUsername: "shane",
      dueDate: null,
    },
    method: "PATCH",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${created.taskId}`,
  });

  assert.equal(editedResponse.status, 200);
  assert.deepEqual(await editedResponse.json(), {
    data: {
      ...created,
      text: "Publish release notes\n\nConfirm links",
      assignee: {
        state: "assigned",
        userId: USERS.shane.userId,
        username: USERS.shane.username,
      },
      dueDate: null,
    },
  });
});

test("desired Task state is idempotent and reopening preserves Task content", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());

  const createdResponse = await harness.request({
    as: "shane",
    body: {
      text: "Publish release notes",
      assigneeUsername: "eli",
      dueDate: "2026-07-18",
    },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  const created = (await createdResponse.json()).data;

  harness.setNow("2026-07-15T13:00:00.000Z");
  const completedResponse = await harness.request({
    as: "eli",
    body: { state: "done" },
    method: "PUT",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${created.taskId}/state`,
  });
  assert.equal(completedResponse.status, 200);
  const completed = (await completedResponse.json()).data;
  assert.deepEqual(completed, {
    ...created,
    state: "done",
    completedAt: "2026-07-15T13:00:00.000Z",
  });

  harness.setNow("2026-07-15T14:00:00.000Z");
  const repeatedResponse = await harness.request({
    as: "shane",
    body: { state: "done" },
    method: "PUT",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${created.taskId}/state`,
  });
  assert.deepEqual(await repeatedResponse.json(), { data: completed });

  const reopenedResponse = await harness.request({
    as: "shane",
    body: { state: "open" },
    method: "PUT",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${created.taskId}/state`,
  });
  assert.deepEqual(await reopenedResponse.json(), {
    data: { ...created, state: "open", completedAt: null },
  });
});

test("a Member permanently deletes open and done Tasks", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());

  async function createTask(text) {
    const response = await harness.request({
      as: "shane",
      body: { text, assigneeUsername: "eli" },
      method: "POST",
      path: `/api/v1/groups/${GROUP_ID}/tasks`,
    });
    return (await response.json()).data;
  }

  const openTask = await createTask("Delete while open");
  const doneTask = await createTask("Delete after completion");
  await harness.request({
    as: "eli",
    body: { state: "done" },
    method: "PUT",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${doneTask.taskId}/state`,
  });

  for (const task of [openTask, doneTask]) {
    const deleted = await harness.request({
      as: "eli",
      method: "DELETE",
      path: `/api/v1/groups/${GROUP_ID}/tasks/${task.taskId}`,
    });
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), "");

    const missing = await harness.request({
      as: "shane",
      method: "GET",
      path: `/api/v1/groups/${GROUP_ID}/tasks/${task.taskId}`,
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "task_not_found");
  }
});

test("an unknown Task returns the missing-resource result before mutation validation", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());
  const path = `/api/v1/groups/${GROUP_ID}/tasks/task_unknown`;

  const patch = await harness.request({
    as: "shane",
    body: { assigneeUsername: "nobody" },
    method: "PATCH",
    path,
  });
  const state = await harness.request({
    as: "shane",
    body: { state: "closed" },
    method: "PUT",
    path: `${path}/state`,
  });
  const deleted = await harness.request({
    as: "shane",
    method: "DELETE",
    path,
  });

  for (const response of [patch, state, deleted]) {
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "task_not_found");
  }
});

test("Task mutations recheck current Group membership", async (t) => {
  const harness = createTasksHarness({ memberNames: ["shane"] });
  t.after(() => harness.close());
  const createdResponse = await harness.request({
    as: "shane",
    body: { text: "Private Task", assigneeUsername: "shane" },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  const task = (await createdResponse.json()).data;
  const path = `/api/v1/groups/${GROUP_ID}/tasks/${task.taskId}`;
  const requests = [
    { body: { text: "No access" }, method: "PATCH", path },
    { body: { state: "done" }, method: "PUT", path: `${path}/state` },
    { method: "DELETE", path },
  ];

  for (const request of requests) {
    const response = await harness.request({ as: "eli", ...request });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "task_not_found");
  }
});

test("done Tasks reject edits until reopened", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());
  const createdResponse = await harness.request({
    as: "shane",
    body: {
      text: "Freeze after completion",
      assigneeUsername: "eli",
      dueDate: "2026-07-18",
    },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  const created = (await createdResponse.json()).data;
  const completedResponse = await harness.request({
    as: "eli",
    body: { state: "done" },
    method: "PUT",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${created.taskId}/state`,
  });
  const completed = (await completedResponse.json()).data;

  const edit = await harness.request({
    as: "shane",
    body: { text: "This must not replace done content" },
    method: "PATCH",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${created.taskId}`,
  });
  assert.equal(edit.status, 409);
  assert.equal((await edit.json()).error.code, "task_done");

  const retrieved = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${created.taskId}`,
  });
  assert.deepEqual(await retrieved.json(), { data: completed });
});

test("Task mutation inputs reject unsupported fields and non-Member assignees", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());
  const createdResponse = await harness.request({
    as: "shane",
    body: { text: "Validate edits", assigneeUsername: "eli" },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  const task = (await createdResponse.json()).data;
  const path = `/api/v1/groups/${GROUP_ID}/tasks/${task.taskId}`;

  for (const [body, field] of [
    [{}, "text"],
    [{ text: "" }, "text"],
    [{ text: "Bell\u0007" }, "text"],
    [{ dueDate: "2026-02-29" }, "dueDate"],
    [{ assigneeUsername: null }, "assigneeUsername"],
    [{ assigneeUsername: "unassigned" }, "assigneeUsername"],
    [{ text: "Valid", extra: true }, "text"],
  ]) {
    const response = await harness.request({
      as: "shane",
      body,
      method: "PATCH",
      path,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.fields[field] !== undefined, true);
  }

  for (const assigneeUsername of ["maya", "nobody"]) {
    const response = await harness.request({
      as: "shane",
      body: { assigneeUsername },
      method: "PATCH",
      path,
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "assignee_not_member");
  }

  for (const body of [
    {},
    { state: ["done"] },
    { state: "closed" },
    { state: "open", extra: true },
  ]) {
    const response = await harness.request({
      as: "eli",
      body,
      method: "PUT",
      path: `${path}/state`,
    });
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys((await response.json()).error.fields), ["state"]);
  }
});

test("a Member recovers an Unassigned open Task", async (t) => {
  const unassigned = {
    taskId: "task_recovery",
    groupId: GROUP_ID,
    text: "Recover release work",
    assignee: { state: "unassigned" },
    dueDate: "2026-07-18",
    state: "open",
    createdAt: "2026-07-15T11:00:00.000Z",
    completedAt: null,
  };
  const harness = createTasksHarness({ seedTasks: [unassigned] });
  t.after(() => harness.close());

  const response = await harness.request({
    as: "shane",
    body: { assigneeUsername: "eli" },
    method: "PATCH",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${unassigned.taskId}`,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      ...unassigned,
      assignee: {
        state: "assigned",
        userId: USERS.eli.userId,
        username: USERS.eli.username,
      },
    },
  });
});

test("Task mutations update ordering and concurrent edits use last-accepted-write", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());

  async function createTask(text, dueDate) {
    const response = await harness.request({
      as: "shane",
      body: { text, assigneeUsername: "eli", dueDate },
      method: "POST",
      path: `/api/v1/groups/${GROUP_ID}/tasks`,
    });
    return (await response.json()).data;
  }

  const later = await createTask("Later", "2026-07-20");
  const sooner = await createTask("Sooner", "2026-07-18");
  const taskPath = `/api/v1/groups/${GROUP_ID}/tasks/${later.taskId}`;

  await harness.request({
    as: "eli",
    body: { dueDate: "2026-07-17" },
    method: "PATCH",
    path: taskPath,
  });
  const reordered = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  assert.deepEqual(
    (await reordered.json()).data.map(({ taskId }) => taskId),
    [later.taskId, sooner.taskId],
  );

  const accepted = [];
  const statuses = await Promise.all(
    ["Concurrent edit A", "Concurrent edit B"].map((text) =>
      harness
        .request({
          as: "shane",
          body: { text },
          method: "PATCH",
          path: taskPath,
        })
        .then(async (response) => {
          const body = await response.json();
          accepted.push(body.data.text);
          return response.status;
        }),
    ),
  );
  assert.deepEqual(statuses, [200, 200]);

  const current = await harness.request({
    as: "eli",
    method: "GET",
    path: taskPath,
  });
  assert.equal((await current.json()).data.text, accepted.at(-1));

  harness.setNow("2026-07-15T13:00:00.000Z");
  await harness.request({
    as: "shane",
    body: { state: "done" },
    method: "PUT",
    path: `${taskPath}/state`,
  });
  harness.setNow("2026-07-15T14:00:00.000Z");
  await harness.request({
    as: "shane",
    body: { state: "done" },
    method: "PUT",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${sooner.taskId}/state`,
  });
  const done = await harness.request({
    as: "eli",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks?status=done&assignee=eli`,
  });
  assert.deepEqual(
    (await done.json()).data.map(({ taskId }) => taskId),
    [sooner.taskId, later.taskId],
  );
});

test("Task creation conceals an inaccessible Group before validating input", async (t) => {
  const harness = createTasksHarness({ memberNames: ["shane"] });
  t.after(() => harness.close());

  const inaccessible = await harness.request({
    as: "eli",
    body: { assigneeUsername: "unknown", text: "" },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  const unknown = await harness.request({
    as: "eli",
    body: { assigneeUsername: "unknown", text: "" },
    method: "POST",
    path: "/api/v1/groups/grp_unknown/tasks",
  });

  assert.equal(inaccessible.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await inaccessible.json(), await unknown.json());

  const inaccessibleList = await harness.request({
    as: "eli",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  assert.equal(inaccessibleList.status, 404);
  assert.equal((await inaccessibleList.json()).error.code, "group_not_found");

  const inaccessibleTask = await harness.request({
    as: "eli",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks/task_private`,
  });
  const unknownTask = await harness.request({
    as: "eli",
    method: "GET",
    path: "/api/v1/groups/grp_unknown/tasks/task_private",
  });
  assert.equal(inaccessibleTask.status, 404);
  const unknownTaskBody = await unknownTask.json();
  assert.deepEqual(await inaccessibleTask.json(), unknownTaskBody);

  const malformedGroupTask = await harness.request({
    as: "eli",
    method: "GET",
    path: "/api/v1/groups/not-a-group/tasks/task_private",
  });
  assert.deepEqual(await malformedGroupTask.json(), unknownTaskBody);
});

test("Task listing orders Username columns, Unassigned last, and Tasks within each column", async (t) => {
  const common = {
    groupId: GROUP_ID,
    completedAt: null,
    state: "open",
  };
  const assigned = {
    state: "assigned",
    userId: USERS.eli.userId,
    username: USERS.eli.username,
  };
  const assignedToShane = {
    state: "assigned",
    userId: USERS.shane.userId,
    username: USERS.shane.username,
  };
  const tasks = [
    {
      ...common,
      taskId: "task_undated_later",
      text: "Undated later",
      assignee: assigned,
      dueDate: null,
      createdAt: "2026-07-15T12:05:00.000Z",
    },
    {
      ...common,
      taskId: "task_due_later",
      text: "Due later",
      assignee: assigned,
      dueDate: "2026-07-20",
      createdAt: "2026-07-15T12:01:00.000Z",
    },
    {
      ...common,
      taskId: "task_due_same_b",
      text: "Due same B",
      assignee: assigned,
      dueDate: "2026-07-18",
      createdAt: "2026-07-15T12:03:00.000Z",
    },
    {
      ...common,
      taskId: "task_due_same_a",
      text: "Due same A",
      assignee: assigned,
      dueDate: "2026-07-18",
      createdAt: "2026-07-15T12:03:00.000Z",
    },
    {
      ...common,
      taskId: "task_unassigned",
      text: "Recover this",
      assignee: { state: "unassigned" },
      dueDate: null,
      createdAt: "2026-07-15T12:00:00.000Z",
    },
    {
      ...common,
      taskId: "task_shane_earliest",
      text: "Shane due earliest",
      assignee: assignedToShane,
      dueDate: "2026-07-17",
      createdAt: "2026-07-15T11:00:00.000Z",
    },
    {
      ...common,
      taskId: "task_done",
      text: "Already done",
      assignee: assigned,
      dueDate: null,
      state: "done",
      completedAt: "2026-07-15T13:00:00.000Z",
      createdAt: "2026-07-15T11:00:00.000Z",
    },
  ];
  const harness = createTasksHarness({ seedTasks: tasks });
  t.after(() => harness.close());

  const response = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(
    body.data.map(({ taskId }) => taskId),
    [
      "task_due_same_a",
      "task_due_same_b",
      "task_due_later",
      "task_undated_later",
      "task_shane_earliest",
      "task_unassigned",
    ],
  );
  assert.deepEqual(body.data.at(-1).assignee, { state: "unassigned" });
  assert.equal(body.nextCursor, null);
});

test("status and one assignee filter combine before Task ordering", async (t) => {
  const eli = {
    state: "assigned",
    userId: USERS.eli.userId,
    username: USERS.eli.username,
  };
  const shane = {
    state: "assigned",
    userId: USERS.shane.userId,
    username: USERS.shane.username,
  };
  const seedTasks = [
    {
      taskId: "task_eli_open",
      groupId: GROUP_ID,
      text: "Eli open",
      assignee: eli,
      dueDate: null,
      state: "open",
      createdAt: "2026-07-15T12:00:00.000Z",
      completedAt: null,
    },
    {
      taskId: "task_eli_done_older",
      groupId: GROUP_ID,
      text: "Eli done older",
      assignee: eli,
      dueDate: null,
      state: "done",
      createdAt: "2026-07-15T11:00:00.000Z",
      completedAt: "2026-07-15T13:00:00.000Z",
    },
    {
      taskId: "task_eli_done_newer",
      groupId: GROUP_ID,
      text: "Eli done newer",
      assignee: eli,
      dueDate: null,
      state: "done",
      createdAt: "2026-07-15T11:30:00.000Z",
      completedAt: "2026-07-15T14:00:00.000Z",
    },
    {
      taskId: "task_shane_done",
      groupId: GROUP_ID,
      text: "Shane done",
      assignee: shane,
      dueDate: null,
      state: "done",
      createdAt: "2026-07-15T10:00:00.000Z",
      completedAt: "2026-07-15T15:00:00.000Z",
    },
    {
      taskId: "task_unassigned_open",
      groupId: GROUP_ID,
      text: "Unassigned open",
      assignee: { state: "unassigned" },
      dueDate: null,
      state: "open",
      createdAt: "2026-07-15T09:00:00.000Z",
      completedAt: null,
    },
  ];
  const harness = createTasksHarness({ seedTasks });
  t.after(() => harness.close());

  const assigned = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks?status=all&assignee=eli`,
  });
  assert.deepEqual(
    (await assigned.json()).data.map(({ taskId }) => taskId),
    ["task_eli_open", "task_eli_done_newer", "task_eli_done_older"],
  );

  const unassigned = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks?status=all&assignee=unassigned`,
  });
  assert.deepEqual(
    (await unassigned.json()).data.map(({ taskId }) => taskId),
    ["task_unassigned_open"],
  );
});

test("done Tasks use completion, creation, then Task ID tie-breakers", async (t) => {
  const assignee = {
    state: "assigned",
    userId: USERS.eli.userId,
    username: USERS.eli.username,
  };
  const common = {
    groupId: GROUP_ID,
    assignee,
    dueDate: null,
    state: "done",
  };
  const seedTasks = [
    {
      ...common,
      taskId: "task_done_same_late_b",
      text: "Same completion and creation B",
      createdAt: "2026-07-15T11:00:00.000Z",
      completedAt: "2026-07-15T14:00:00.000Z",
    },
    {
      ...common,
      taskId: "task_done_latest",
      text: "Latest completion",
      createdAt: "2026-07-15T12:00:00.000Z",
      completedAt: "2026-07-15T15:00:00.000Z",
    },
    {
      ...common,
      taskId: "task_done_same_early",
      text: "Same completion, earlier creation",
      createdAt: "2026-07-15T10:00:00.000Z",
      completedAt: "2026-07-15T14:00:00.000Z",
    },
    {
      ...common,
      taskId: "task_done_same_late_a",
      text: "Same completion and creation A",
      createdAt: "2026-07-15T11:00:00.000Z",
      completedAt: "2026-07-15T14:00:00.000Z",
    },
  ];
  const harness = createTasksHarness({ seedTasks });
  t.after(() => harness.close());

  const response = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks?status=done&assignee=eli`,
  });
  assert.deepEqual(
    (await response.json()).data.map(({ taskId }) => taskId),
    [
      "task_done_latest",
      "task_done_same_early",
      "task_done_same_late_a",
      "task_done_same_late_b",
    ],
  );
});

test("Task pagination follows stable ordering with collection-scoped cursors", async (t) => {
  const seedTasks = ["task_c", "task_a", "task_b"].map((taskId) => ({
    taskId,
    groupId: GROUP_ID,
    text: taskId,
    assignee: {
      state: "assigned",
      userId: USERS.eli.userId,
      username: USERS.eli.username,
    },
    dueDate: "2026-07-18",
    state: "open",
    createdAt: "2026-07-15T12:00:00.000Z",
    completedAt: null,
  }));
  const harness = createTasksHarness({ seedTasks });
  t.after(() => harness.close());

  const firstResponse = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks?limit=2`,
  });
  const first = await firstResponse.json();
  assert.deepEqual(
    first.data.map(({ taskId }) => taskId),
    ["task_a", "task_b"],
  );
  assert.equal(typeof first.nextCursor, "string");

  const secondResponse = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
  });
  assert.deepEqual(await secondResponse.json(), {
    data: [seedTasks.find(({ taskId }) => taskId === "task_c")],
    nextCursor: null,
  });

  const wrongCollection = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks?status=done&cursor=${encodeURIComponent(first.nextCursor)}`,
  });
  assert.equal(wrongCollection.status, 400);
  assert.deepEqual(Object.keys((await wrongCollection.json()).error.fields), [
    "cursor",
  ]);
});

test("Task creation rejects invalid text, dates, and non-Member assignees", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());

  for (const [body, field] of [
    [{ text: "", assigneeUsername: "eli" }, "text"],
    [{ text: "x".repeat(2_001), assigneeUsername: "eli" }, "text"],
    [{ text: "Bell\u0007", assigneeUsername: "eli" }, "text"],
    [
      { text: "Invalid date", assigneeUsername: "eli", dueDate: "2026-02-29" },
      "dueDate",
    ],
    [
      { text: "No null date", assigneeUsername: "eli", dueDate: null },
      "dueDate",
    ],
    [{ text: "No manual clearing", assigneeUsername: "unassigned" }, "assigneeUsername"],
  ]) {
    const response = await harness.request({
      as: "shane",
      body,
      method: "POST",
      path: `/api/v1/groups/${GROUP_ID}/tasks`,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.fields[field] !== undefined, true);
  }

  for (const assigneeUsername of ["maya", "nobody"]) {
    const response = await harness.request({
      as: "shane",
      body: { text: "Cannot assign", assigneeUsername },
      method: "POST",
      path: `/api/v1/groups/${GROUP_ID}/tasks`,
    });
    assert.equal(response.status, 409, assigneeUsername);
    assert.equal((await response.json()).error.code, "assignee_not_member");
  }
});

test("Task collection rejects invalid filters and page fields", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());

  for (const [query, field] of [
    ["status=closed", "status"],
    ["status=open&status=done", "status"],
    ["assignee=", "assignee"],
    ["assignee=eli&assignee=shane", "assignee"],
    ["limit=0", "limit"],
    ["limit=501", "limit"],
    ["limit=1.5", "limit"],
    ["cursor=", "cursor"],
    ["cursor=cur_a&cursor=cur_b", "cursor"],
  ]) {
    const response = await harness.request({
      as: "shane",
      method: "GET",
      path: `/api/v1/groups/${GROUP_ID}/tasks?${query}`,
    });
    assert.equal(response.status, 400, query);
    assert.deepEqual(Object.keys((await response.json()).error.fields), [field]);
  }
});

test("Task pages default to 100 records and allow at most 500", async (t) => {
  const assignee = {
    state: "assigned",
    userId: USERS.eli.userId,
    username: USERS.eli.username,
  };
  const seedTasks = Array.from({ length: 501 }, (_, index) => ({
    taskId: `task_${String(index).padStart(4, "0")}`,
    groupId: GROUP_ID,
    text: `Task ${index}`,
    assignee,
    dueDate: null,
    state: "open",
    createdAt: "2026-07-15T12:00:00.000Z",
    completedAt: null,
  }));
  const harness = createTasksHarness({ seedTasks });
  t.after(() => harness.close());

  const defaultResponse = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  const defaultPage = await defaultResponse.json();
  assert.equal(defaultPage.data.length, 100);
  assert.equal(typeof defaultPage.nextCursor, "string");

  const maximumResponse = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks?limit=500`,
  });
  const maximumPage = await maximumResponse.json();
  assert.equal(maximumPage.data.length, 500);
  assert.equal(typeof maximumPage.nextCursor, "string");

  const finalResponse = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks?limit=500&cursor=${encodeURIComponent(maximumPage.nextCursor)}`,
  });
  const finalPage = await finalResponse.json();
  assert.equal(finalPage.data.length, 1);
  assert.equal(finalPage.data[0].taskId, "task_0500");
  assert.equal(finalPage.nextCursor, null);
});

test("Task creation accepts exact text and calendar boundaries", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());

  const response = await harness.request({
    as: "shane",
    body: {
      text: "🧰".repeat(2_000),
      assigneeUsername: "shane",
      dueDate: "2028-02-29",
    },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  assert.equal(response.status, 201);
  const task = (await response.json()).data;
  assert.equal(Array.from(task.text).length, 2_000);
  assert.equal(task.dueDate, "2028-02-29");

  const optionalDate = await harness.request({
    as: "eli",
    body: { text: "No date", assigneeUsername: "eli" },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  assert.equal((await optionalDate.json()).data.dueDate, null);
});

test("representative Task responses validate against OpenAPI", async (t) => {
  const harness = createTasksHarness();
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();

  const created = await harness.request({
    as: "shane",
    body: { text: "Contract Task", assigneeUsername: "eli" },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  await assertContract(created, "/api/v1/groups/{groupId}/tasks", "post");
  const taskId = (await created.json()).data.taskId;

  const listed = await harness.request({
    as: "eli",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  await assertContract(listed, "/api/v1/groups/{groupId}/tasks", "get");

  const retrieved = await harness.request({
    as: "eli",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${taskId}`,
  });
  await assertContract(
    retrieved,
    "/api/v1/groups/{groupId}/tasks/{taskId}",
    "get",
  );

  const edited = await harness.request({
    as: "eli",
    body: { text: "Updated contract Task", assigneeUsername: "shane" },
    method: "PATCH",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${taskId}`,
  });
  await assertContract(
    edited,
    "/api/v1/groups/{groupId}/tasks/{taskId}",
    "patch",
  );

  const completed = await harness.request({
    as: "shane",
    body: { state: "done" },
    method: "PUT",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${taskId}/state`,
  });
  await assertContract(
    completed,
    "/api/v1/groups/{groupId}/tasks/{taskId}/state",
    "put",
  );

  const frozen = await harness.request({
    as: "shane",
    body: { text: "Blocked while done" },
    method: "PATCH",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${taskId}`,
  });
  await assertContract(
    frozen,
    "/api/v1/groups/{groupId}/tasks/{taskId}",
    "patch",
  );

  const deleted = await harness.request({
    as: "eli",
    method: "DELETE",
    path: `/api/v1/groups/${GROUP_ID}/tasks/${taskId}`,
  });
  await assertContract(
    deleted,
    "/api/v1/groups/{groupId}/tasks/{taskId}",
    "delete",
  );

  const invalid = await harness.request({
    as: "shane",
    body: { text: "", assigneeUsername: "eli" },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  await assertContract(invalid, "/api/v1/groups/{groupId}/tasks", "post");

  const conflict = await harness.request({
    as: "shane",
    body: { text: "Outside", assigneeUsername: "maya" },
    method: "POST",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  await assertContract(conflict, "/api/v1/groups/{groupId}/tasks", "post");

  const unauthenticated = await harness.request({
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks`,
  });
  await assertContract(
    unauthenticated,
    "/api/v1/groups/{groupId}/tasks",
    "get",
  );

  const concealed = await harness.request({
    as: "shane",
    method: "GET",
    path: "/api/v1/groups/grp_unknown/tasks",
  });
  await assertContract(concealed, "/api/v1/groups/{groupId}/tasks", "get");

  const missing = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${GROUP_ID}/tasks/task_unknown`,
  });
  await assertContract(
    missing,
    "/api/v1/groups/{groupId}/tasks/{taskId}",
    "get",
  );
});
