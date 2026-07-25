import {
  POLL_DELAYS_MS,
  nextPollDelayMs,
  reconcileTaskListSnapshot,
  retainRemovedTasksForExit,
} from "../src/task-list-freshness";
import type {
  NativeMember,
  NativeTask,
  NativeTaskListSnapshot,
} from "../src/task-list-contracts";

function member(
  userId: string,
  overrides: Partial<NativeMember> = {},
): NativeMember {
  return {
    joinedAt: "2026-07-25T12:00:00.000Z",
    role: "member",
    userId,
    username: userId,
    ...overrides,
  };
}

function task(
  taskId: string,
  overrides: Partial<NativeTask> = {},
): NativeTask {
  return {
    assignee: { state: "unassigned" },
    completedAt: null,
    createdAt: "2026-07-25T12:00:00.000Z",
    dueDate: null,
    groupId: "grp_one",
    priority: "normal",
    state: "open",
    taskId,
    text: `Task ${taskId}`,
    ...overrides,
  };
}

function snapshot(
  tasks: NativeTask[],
  members: NativeMember[],
): NativeTaskListSnapshot {
  return { members, tasks };
}

test("poll cadence backs off through the fixed sequence and caps", () => {
  expect(POLL_DELAYS_MS).toEqual([5_000, 10_000, 20_000, 40_000, 60_000]);
  expect([0, 1, 2, 3, 4, 5, 20].map(nextPollDelayMs)).toEqual([
    5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000,
  ]);
});

test("reuses structurally unchanged task and member objects", () => {
  const previousTask = task("task_one", {
    assignee: {
      state: "assigned",
      userId: "usr_one",
      username: "walker",
    },
  });
  const previousMember = member("usr_one", { username: "walker" });
  const previous = snapshot([previousTask], [previousMember]);
  const next = snapshot(
    [
      task("task_one", {
        assignee: {
          state: "assigned",
          userId: "usr_one",
          username: "walker",
        },
      }),
    ],
    [member("usr_one", { username: "walker" })],
  );

  const result = reconcileTaskListSnapshot(previous, next);

  expect(result.snapshot.tasks[0]).toBe(previousTask);
  expect(result.snapshot.members[0]).toBe(previousMember);
  expect(result.changedTaskIds).toEqual([]);
  expect(result.removedTaskIds).toEqual([]);
});

test("reports inserts, updates, and removals while preserving service order", () => {
  const removed = task("task_removed");
  const unchanged = task("task_unchanged");
  const updated = task("task_updated");
  const previous = snapshot(
    [removed, unchanged, updated],
    [member("usr_one")],
  );
  const inserted = task("task_inserted");
  const next = snapshot(
    [
      { ...updated, dueDate: "2026-08-01" },
      inserted,
      { ...unchanged },
    ],
    [{ ...previous.members[0]! }],
  );

  const result = reconcileTaskListSnapshot(previous, next);

  expect(result.snapshot.tasks.map(({ taskId }) => taskId)).toEqual([
    "task_updated",
    "task_inserted",
    "task_unchanged",
  ]);
  expect(result.snapshot.tasks[0]).toBe(next.tasks[0]);
  expect(result.snapshot.tasks[1]).toBe(inserted);
  expect(result.snapshot.tasks[2]).toBe(unchanged);
  expect(result.changedTaskIds).toEqual(["task_updated", "task_inserted"]);
  expect(result.removedTaskIds).toEqual(["task_removed"]);
});

test("retains removed rows at their old anchors for the exit animation only", () => {
  const removedFirst = task("task_removed_first");
  const keptOne = task("task_kept_one");
  const removedMiddle = task("task_removed_middle");
  const keptTwo = task("task_kept_two");
  const inserted = task("task_inserted");

  const transition = retainRemovedTasksForExit(
    snapshot([removedFirst, keptOne, removedMiddle, keptTwo], []),
    snapshot([inserted, keptOne, keptTwo], []),
    ["task_removed_first", "task_removed_middle"],
  );

  expect(transition.tasks.map(({ taskId }) => taskId)).toEqual([
    "task_removed_first",
    "task_inserted",
    "task_kept_one",
    "task_removed_middle",
    "task_kept_two",
  ]);
  expect(transition.tasks[0]).toBe(removedFirst);
  expect(transition.tasks[3]).toBe(removedMiddle);
});

test("compares every task field, including assigned identity", () => {
  const original = task("task_one", {
    assignee: {
      state: "assigned",
      userId: "usr_one",
      username: "walker",
    },
  });
  const fields: NativeTask[] = [
    { ...original, groupId: "grp_two" },
    { ...original, text: "Changed" },
    {
      ...original,
      assignee: {
        state: "assigned",
        userId: "usr_two",
        username: "walker",
      },
    },
    {
      ...original,
      assignee: {
        state: "assigned",
        userId: "usr_one",
        username: "renamed",
      },
    },
    { ...original, assignee: { state: "unassigned" } },
    { ...original, priority: "high" },
    { ...original, dueDate: "2026-08-01" },
    { ...original, state: "done" },
    { ...original, createdAt: "2026-07-25T12:01:00.000Z" },
    { ...original, completedAt: "2026-07-25T12:02:00.000Z" },
  ];

  for (const changed of fields) {
    const result = reconcileTaskListSnapshot(
      snapshot([original], []),
      snapshot([changed], []),
    );
    expect(result.snapshot.tasks[0]).toBe(changed);
    expect(result.changedTaskIds).toEqual(["task_one"]);
  }
});

test("membership-only changes reuse equal members without task changes", () => {
  const previousTask = task("task_one");
  const unchangedMember = member("usr_one");
  const changedMember = member("usr_two");
  const previous = snapshot(
    [previousTask],
    [unchangedMember, changedMember],
  );
  const nextChangedMember = { ...changedMember, role: "admin" as const };
  const next = snapshot(
    [{ ...previousTask }],
    [{ ...unchangedMember }, nextChangedMember, member("usr_three")],
  );

  const result = reconcileTaskListSnapshot(previous, next);

  expect(result.snapshot.tasks[0]).toBe(previousTask);
  expect(result.snapshot.members[0]).toBe(unchangedMember);
  expect(result.snapshot.members[1]).toBe(nextChangedMember);
  expect(result.snapshot.members[2]).toBe(next.members[2]);
  expect(result.changedTaskIds).toEqual([]);
  expect(result.removedTaskIds).toEqual([]);
});
