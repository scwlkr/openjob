import type {
  NativeMember,
  NativeTask,
  NativeTaskListSnapshot,
} from "./task-list-contracts";

export const POLL_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;

export function nextPollDelayMs(unchangedCount: number): number {
  const index = Number.isFinite(unchangedCount)
    ? Math.min(
        Math.max(0, Math.floor(unchangedCount)),
        POLL_DELAYS_MS.length - 1,
      )
    : 0;
  return POLL_DELAYS_MS[index]!;
}

export function retainRemovedTasksForExit(
  previous: NativeTaskListSnapshot,
  next: NativeTaskListSnapshot,
  removedTaskIds: readonly string[],
): NativeTaskListSnapshot {
  if (removedTaskIds.length === 0) return next;
  const removed = new Set(removedTaskIds);
  const tasks = [...next.tasks];
  for (let index = previous.tasks.length - 1; index >= 0; index -= 1) {
    const task = previous.tasks[index]!;
    if (removed.has(task.taskId)) {
      tasks.splice(Math.min(index, tasks.length), 0, task);
    }
  }
  return { members: next.members, tasks };
}

function sameAssignee(
  previous: NativeTask["assignee"],
  next: NativeTask["assignee"],
): boolean {
  if (previous.state !== next.state) {
    return false;
  }
  if (previous.state === "unassigned" || next.state === "unassigned") {
    return true;
  }
  return (
    previous.userId === next.userId && previous.username === next.username
  );
}

function sameTask(previous: NativeTask, next: NativeTask): boolean {
  return (
    previous.taskId === next.taskId &&
    previous.groupId === next.groupId &&
    previous.text === next.text &&
    sameAssignee(previous.assignee, next.assignee) &&
    previous.priority === next.priority &&
    previous.dueDate === next.dueDate &&
    previous.state === next.state &&
    previous.createdAt === next.createdAt &&
    previous.completedAt === next.completedAt
  );
}

function sameMember(previous: NativeMember, next: NativeMember): boolean {
  return (
    previous.userId === next.userId &&
    previous.username === next.username &&
    previous.role === next.role &&
    previous.joinedAt === next.joinedAt
  );
}

export function reconcileTaskListSnapshot(
  previous: NativeTaskListSnapshot,
  next: NativeTaskListSnapshot,
): {
  snapshot: NativeTaskListSnapshot;
  changedTaskIds: string[];
  removedTaskIds: string[];
} {
  const previousTasks = new Map(
    previous.tasks.map((task) => [task.taskId, task]),
  );
  const previousMembers = new Map(
    previous.members.map((member) => [member.userId, member]),
  );
  const nextTaskIds = new Set(next.tasks.map(({ taskId }) => taskId));
  const changedTaskIds: string[] = [];

  const tasks = next.tasks.map((task) => {
    const prior = previousTasks.get(task.taskId);
    if (prior && sameTask(prior, task)) {
      return prior;
    }
    changedTaskIds.push(task.taskId);
    return task;
  });

  const members = next.members.map((member) => {
    const prior = previousMembers.get(member.userId);
    return prior && sameMember(prior, member) ? prior : member;
  });

  return {
    changedTaskIds,
    removedTaskIds: previous.tasks
      .filter(({ taskId }) => !nextTaskIds.has(taskId))
      .map(({ taskId }) => taskId),
    snapshot: { members, tasks },
  };
}
