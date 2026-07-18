import {
  createFirestoreRestClient,
  FirestoreRequestError,
  type FirebaseConfig,
  type FirestoreDocument,
} from "./firestore-rest.ts";
import {
  advanceGroupStateRevisionWrite,
  readGroupStateRevision,
} from "./group-state.ts";
import type {
  DueDate,
  OpenJobTask,
  TaskId,
  TaskPriority,
  TaskStore,
  TaskText,
} from "../server/v1-tasks.ts";
import type { GroupId } from "../server/v1-groups.ts";
import type { Username } from "../server/v1-identity.ts";

type TaskStoreOptions = {
  now?: () => number;
  randomUUID?: () => string;
};

type TaskUpdateInput = Parameters<TaskStore["update"]>[3];

type PersistedTask = OpenJobTask & {
  assigneeMembershipId: string | null;
};

type StoredTask = PersistedTask & {
  path: string;
  updateTime: string;
};

const MAX_CONCURRENT_ATTEMPTS = 3;

function parseTask(document: FirestoreDocument, path: string): StoredTask {
  const taskId = document.fields?.taskId?.stringValue;
  const groupId = document.fields?.groupId?.stringValue;
  const text = document.fields?.text?.stringValue;
  const assigneeState = document.fields?.assigneeState?.stringValue;
  const assigneeMembershipId =
    document.fields?.assigneeMembershipId?.stringValue ?? null;
  const priority = document.fields?.priority?.stringValue ?? "normal";
  const dueDate = document.fields?.dueDate?.stringValue ?? null;
  const state = document.fields?.state?.stringValue;
  const createdAt = document.fields?.createdAt?.timestampValue;
  const completedAt = document.fields?.completedAt?.timestampValue ?? null;
  if (
    !taskId ||
    !groupId ||
    text === undefined ||
    !["assigned", "unassigned"].includes(assigneeState ?? "") ||
    !["high", "normal", "low"].includes(priority) ||
    !["open", "done"].includes(state ?? "") ||
    !createdAt ||
    !document.updateTime ||
    (state === "open" && completedAt !== null) ||
    (state === "done" && completedAt === null)
  ) {
    throw new Error("Firestore returned an invalid Task record.");
  }

  let assignee: OpenJobTask["assignee"];
  if (assigneeState === "unassigned") {
    assignee = { state: "unassigned" };
  } else {
    const userId = document.fields?.assigneeUserId?.stringValue;
    const username = document.fields?.assigneeUsername?.stringValue;
    if (!userId || !username) {
      throw new Error("Firestore returned an incomplete Task assignee.");
    }
    assignee = {
      state: "assigned",
      userId,
      username: username as Username,
    };
  }

  return {
    taskId: taskId as TaskId,
    groupId: groupId as GroupId,
    text: text as TaskText,
    assignee,
    assigneeMembershipId:
      assigneeState === "assigned" ? assigneeMembershipId : null,
    priority: priority as TaskPriority,
    dueDate: dueDate as DueDate | null,
    state: state as OpenJobTask["state"],
    createdAt,
    completedAt,
    path,
    updateTime: document.updateTime,
  };
}

function publicTask(task: PersistedTask): OpenJobTask {
  return {
    taskId: task.taskId,
    groupId: task.groupId,
    text: task.text,
    assignee: task.assignee,
    priority: task.priority,
    dueDate: task.dueDate,
    state: task.state,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  };
}

export function isOpenTaskAssignedTo(
  document: FirestoreDocument,
  userId: string,
  membershipId: string | null,
) {
  const task = parseTask(document, document.name);
  return (
    task.state === "open" &&
    task.assignee.state === "assigned" &&
    task.assignee.userId === userId &&
    task.assigneeMembershipId === membershipId
  );
}

function taskFields(task: PersistedTask) {
  return {
    taskId: { stringValue: task.taskId },
    groupId: { stringValue: task.groupId },
    text: { stringValue: task.text },
    assigneeState: { stringValue: task.assignee.state },
    ...(task.assignee.state === "assigned"
      ? {
          ...(task.assigneeMembershipId
            ? {
                assigneeMembershipId: {
                  stringValue: task.assigneeMembershipId,
                },
              }
            : {}),
          assigneeUserId: { stringValue: task.assignee.userId },
          assigneeUsername: { stringValue: task.assignee.username },
        }
      : {}),
    priority: { stringValue: task.priority },
    ...(task.dueDate !== null
      ? { dueDate: { stringValue: task.dueDate } }
      : {}),
    state: { stringValue: task.state },
    createdAt: { timestampValue: task.createdAt },
    ...(task.completedAt !== null
      ? { completedAt: { timestampValue: task.completedAt } }
      : {}),
  };
}

function isConcurrentWrite(error: unknown) {
  return (
    error instanceof FirestoreRequestError &&
    ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION", "NOT_FOUND"].includes(
      error.code ?? "",
    )
  );
}

export function createFirestoreTaskStore(
  config: FirebaseConfig,
  fetchImplementation: typeof fetch = fetch,
  {
    now = Date.now,
    randomUUID = () => crypto.randomUUID(),
  }: TaskStoreOptions = {},
): TaskStore {
  const firestore = createFirestoreRestClient(config, fetchImplementation);

  function groupPath(groupId: GroupId) {
    return `v1Groups/${groupId}`;
  }

  function membershipPath(groupId: GroupId, userId: string) {
    return `${groupPath(groupId)}/members/${userId}`;
  }

  function taskPath(groupId: GroupId, taskId: TaskId) {
    return `${groupPath(groupId)}/tasks/${taskId}`;
  }

  function stateRevisionWrite(group: FirestoreDocument) {
    if (!group.name || !group.updateTime) {
      throw new Error("Firestore returned an invalid Group record.");
    }
    return advanceGroupStateRevisionWrite({
      documentName: group.name,
      revision: readGroupStateRevision(group),
      updateTime: group.updateTime,
    });
  }

  async function readDocument(path: string) {
    const response = await firestore.request(path, {}, { allowNotFound: true });
    if (response.status === 404) return null;
    return (await response.json()) as FirestoreDocument;
  }

  function membershipId(document: FirestoreDocument) {
    return document.fields?.membershipId?.stringValue ?? null;
  }

  async function resolveOpenTaskAssignee(
    task: StoredTask,
    membershipReads?: Map<string, Promise<FirestoreDocument | null>>,
  ) {
    if (task.state !== "open" || task.assignee.state !== "assigned") {
      return task;
    }
    const path = membershipPath(task.groupId, task.assignee.userId);
    let memberRead = membershipReads?.get(path);
    if (!memberRead) {
      memberRead = readDocument(path);
      membershipReads?.set(path, memberRead);
    }
    const member = await memberRead;
    return member && membershipId(member) === task.assigneeMembershipId
      ? task
      : {
          ...task,
          assignee: { state: "unassigned" as const },
          assigneeMembershipId: null,
        };
  }

  async function readAccess(userId: string, groupId: GroupId) {
    const [group, member] = await Promise.all([
      readDocument(groupPath(groupId)),
      readDocument(membershipPath(groupId, userId)),
    ]);
    return group && member ? { group, member } : null;
  }

  async function readCreationAccess(
    actorUserId: string,
    groupId: GroupId,
    assigneeUserId: string,
  ) {
    const [access, assigneeMember] = await Promise.all([
      readAccess(actorUserId, groupId),
      readDocument(membershipPath(groupId, assigneeUserId)),
    ]);
    if (!access) return { kind: "not_found" as const };
    if (!assigneeMember) return { kind: "assignee_not_member" as const };
    return { kind: "ready" as const, access, assigneeMember };
  }

  async function readTaskAccess(
    actorUserId: string,
    groupId: GroupId,
    taskId: TaskId,
  ) {
    const [access, taskDocument] = await Promise.all([
      readAccess(actorUserId, groupId),
      readDocument(taskPath(groupId, taskId)),
    ]);
    if (!access) return { kind: "group_not_found" as const };
    if (!taskDocument) return { kind: "task_not_found" as const };
    const task = await resolveOpenTaskAssignee(
      parseTask(taskDocument, taskDocument.name),
    );
    return { kind: "ready" as const, access, task };
  }

  async function readUpdateAccess(
    actorUserId: string,
    groupId: GroupId,
    taskId: TaskId,
    input: TaskUpdateInput,
  ) {
    const [taskAccess, assigneeMember] = await Promise.all([
      readTaskAccess(actorUserId, groupId, taskId),
      input.assignee
        ? readDocument(membershipPath(groupId, input.assignee.userId))
        : Promise.resolve(null),
    ]);
    if (taskAccess.kind !== "ready") return taskAccess;
    if (taskAccess.task.state === "done") {
      return { kind: "task_done" as const };
    }
    if (input.assignee && !assigneeMember) {
      return { kind: "assignee_not_member" as const };
    }
    return { ...taskAccess, assigneeMember };
  }

  async function commit(writes: unknown[]) {
    return firestore.request(":commit", {
      method: "POST",
      body: JSON.stringify({ writes }),
    });
  }

  function accessVerifies(access: {
    group: FirestoreDocument;
    member: FirestoreDocument;
  }) {
    return [
      {
        verify: access.group.name,
        currentDocument: { updateTime: access.group.updateTime },
      },
      {
        verify: access.member.name,
        currentDocument: { updateTime: access.member.updateTime },
      },
    ];
  }

  function guardedAccessWrites(access: {
    group: FirestoreDocument;
    member: FirestoreDocument;
  }) {
    return [
      stateRevisionWrite(access.group),
      {
        verify: access.member.name,
        currentDocument: { updateTime: access.member.updateTime },
      },
    ];
  }

  async function retryTaskMutation<
    TCurrent extends { kind: string },
    TResult,
  >(
    readCurrent: () => Promise<TCurrent>,
    mutate: (
      current: Extract<TCurrent, { kind: "ready" }>,
    ) => Promise<TResult>,
    exhaustedMessage: string,
  ): Promise<TResult | Exclude<TCurrent, { kind: "ready" }>> {
    for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
      const current = await readCurrent();
      if (current.kind !== "ready") {
        return current as Exclude<TCurrent, { kind: "ready" }>;
      }
      try {
        return await mutate(
          current as Extract<TCurrent, { kind: "ready" }>,
        );
      } catch (error) {
        if (!isConcurrentWrite(error)) throw error;
      }
    }

    const current = await readCurrent();
    if (current.kind !== "ready") {
      return current as Exclude<TCurrent, { kind: "ready" }>;
    }
    throw new Error(exhaustedMessage);
  }

  return Object.freeze({
    async hasAccess(actorUserId, groupId) {
      return Boolean(await readAccess(actorUserId, groupId));
    },

    async create(actorUserId, groupId, assignee, input) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const creationAccess = await readCreationAccess(
          actorUserId,
          groupId,
          assignee.userId,
        );
        if (creationAccess.kind !== "ready") return creationAccess;
        const { access, assigneeMember } = creationAccess;

        const taskId = `task_${randomUUID().replaceAll("-", "")}` as TaskId;
        const createdAt = new Date(now()).toISOString();
        const task: PersistedTask = {
          taskId,
          groupId,
          text: input.text,
          assignee: {
            state: "assigned",
            userId: assignee.userId,
            username: assignee.username,
          },
          assigneeMembershipId: membershipId(assigneeMember),
          priority: input.priority,
          dueDate: input.dueDate,
          state: "open",
          createdAt,
          completedAt: null,
        };
        const actorMemberName = access.member.name;
        const assigneeMemberName = assigneeMember.name;
        const membershipVerifies = [
          {
            verify: actorMemberName,
            currentDocument: { updateTime: access.member.updateTime },
          },
          ...(assigneeMemberName === actorMemberName
            ? []
            : [
                {
                  verify: assigneeMemberName,
                  currentDocument: { updateTime: assigneeMember.updateTime },
                },
              ]),
        ];
        try {
          await commit([
            stateRevisionWrite(access.group),
            ...membershipVerifies,
            {
              update: {
                name: firestore.documentName(taskPath(groupId, taskId)),
                fields: taskFields(task),
              },
              currentDocument: { exists: false },
            },
          ]);
          return { kind: "created" as const, task: publicTask(task) };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }

      const creationAccess = await readCreationAccess(
        actorUserId,
        groupId,
        assignee.userId,
      );
      if (creationAccess.kind !== "ready") return creationAccess;
      throw new Error("Task creation could not resolve concurrent writes.");
    },

    async get(actorUserId, groupId, taskId) {
      if (!(await readAccess(actorUserId, groupId))) {
        return { kind: "group_not_found" as const };
      }
      const document = await readDocument(taskPath(groupId, taskId));
      if (!document) return { kind: "task_not_found" as const };
      const task = await resolveOpenTaskAssignee(
        parseTask(document, document.name),
      );
      return { kind: "found" as const, task: publicTask(task) };
    },

    async update(actorUserId, groupId, taskId, input) {
      return retryTaskMutation(
        () => readUpdateAccess(actorUserId, groupId, taskId, input),
        async ({ access, assigneeMember, task }) => {
          const updated: StoredTask = {
            ...task,
            ...(input.text !== undefined ? { text: input.text } : {}),
            ...(input.assignee
              ? {
                  assignee: {
                    state: "assigned" as const,
                    userId: input.assignee.userId,
                    username: input.assignee.username,
                  },
                  assigneeMembershipId: membershipId(assigneeMember!),
                }
              : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...("dueDate" in input ? { dueDate: input.dueDate ?? null } : {}),
          };
          const actorMemberName = access.member.name;
          const assigneeMemberName = assigneeMember?.name;
          await commit([
            ...guardedAccessWrites(access),
            ...(assigneeMemberName && assigneeMemberName !== actorMemberName
              ? [
                  {
                    verify: assigneeMemberName,
                    currentDocument: { updateTime: assigneeMember!.updateTime },
                  },
                ]
              : []),
            {
              update: {
                name: task.path,
                fields: taskFields(updated),
              },
              currentDocument: { updateTime: task.updateTime },
            },
          ]);
          return { kind: "updated" as const, task: publicTask(updated) };
        },
        "Task update could not resolve concurrent writes.",
      );
    },

    async setState(actorUserId, groupId, taskId, desiredState) {
      return retryTaskMutation(
        () => readTaskAccess(actorUserId, groupId, taskId),
        async ({ access, task }) => {
          if (task.state === desiredState) {
            await commit([
              ...accessVerifies(access),
              {
                verify: task.path,
                currentDocument: { updateTime: task.updateTime },
              },
            ]);
            return { kind: "updated" as const, task: publicTask(task) };
          }
          const transitioned: StoredTask = {
            ...task,
            state: desiredState,
            completedAt:
              desiredState === "done" ? new Date(now()).toISOString() : null,
          };
          const updated = await resolveOpenTaskAssignee(transitioned);
          await commit([
            ...guardedAccessWrites(access),
            {
              update: {
                name: task.path,
                fields: taskFields(updated),
              },
              currentDocument: { updateTime: task.updateTime },
            },
          ]);
          return { kind: "updated" as const, task: publicTask(updated) };
        },
        "Task state update could not resolve concurrent writes.",
      );
    },

    async delete(actorUserId, groupId, taskId) {
      return retryTaskMutation(
        () => readTaskAccess(actorUserId, groupId, taskId),
        async ({ access, task }) => {
          await commit([
            ...guardedAccessWrites(access),
            {
              delete: task.path,
              currentDocument: { updateTime: task.updateTime },
            },
          ]);
          return { kind: "deleted" as const };
        },
        "Task deletion could not resolve concurrent writes.",
      );
    },

    async list(actorUserId, groupId) {
      if (!(await readAccess(actorUserId, groupId))) {
        return { kind: "not_found" as const };
      }
      const tasks: OpenJobTask[] = [];
      const membershipReads = new Map<
        string,
        Promise<FirestoreDocument | null>
      >();
      let pageToken: string | null = null;
      do {
        const parameters = new URLSearchParams({
          pageSize: "500",
          orderBy: "__name__",
        });
        if (pageToken !== null) parameters.set("pageToken", pageToken);
        const response = await firestore.request(
          `${groupPath(groupId)}/tasks?${parameters}`,
        );
        const page = (await response.json()) as {
          documents?: FirestoreDocument[];
          nextPageToken?: string;
        };
        const pageTasks = await Promise.all(
          (page.documents ?? []).map(async (document) =>
            publicTask(
              await resolveOpenTaskAssignee(
                parseTask(document, document.name),
                membershipReads,
              ),
            ),
          ),
        );
        tasks.push(...pageTasks);
        pageToken = page.nextPageToken ?? null;
      } while (pageToken !== null);
      return { kind: "found" as const, tasks };
    },
  });
}
