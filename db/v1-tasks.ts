import {
  createFirestoreRestClient,
  FirestoreRequestError,
  type FirebaseConfig,
  type FirestoreDocument,
} from "./firestore-rest.ts";
import type {
  OpenJobTask,
  TaskId,
  TaskStore,
} from "../server/v1-tasks.ts";
import type { GroupId } from "../server/v1-groups.ts";

type TaskStoreOptions = {
  now?: () => number;
  randomUUID?: () => string;
};

type StoredTask = OpenJobTask & {
  path: string;
  updateTime: string;
};

const MAX_CONCURRENT_ATTEMPTS = 3;

function parseTask(document: FirestoreDocument, path: string): StoredTask {
  const taskId = document.fields?.taskId?.stringValue;
  const groupId = document.fields?.groupId?.stringValue;
  const text = document.fields?.text?.stringValue;
  const assigneeState = document.fields?.assigneeState?.stringValue;
  const dueDate = document.fields?.dueDate?.stringValue ?? null;
  const state = document.fields?.state?.stringValue;
  const createdAt = document.fields?.createdAt?.timestampValue;
  const completedAt = document.fields?.completedAt?.timestampValue ?? null;
  if (
    !taskId ||
    !groupId ||
    text === undefined ||
    !["assigned", "unassigned"].includes(assigneeState ?? "") ||
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
    assignee = { state: "assigned", userId, username };
  }

  return {
    taskId: taskId as TaskId,
    groupId: groupId as GroupId,
    text,
    assignee,
    dueDate,
    state: state as OpenJobTask["state"],
    createdAt,
    completedAt,
    path,
    updateTime: document.updateTime,
  };
}

function publicTask(task: StoredTask): OpenJobTask {
  const { path: _path, updateTime: _updateTime, ...result } = task;
  return result;
}

function isConcurrentWrite(error: unknown) {
  return (
    error instanceof FirestoreRequestError &&
    ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION"].includes(
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

  async function readDocument(path: string) {
    const response = await firestore.request(path, {}, { allowNotFound: true });
    if (response.status === 404) return null;
    return (await response.json()) as FirestoreDocument;
  }

  async function readAccess(userId: string, groupId: GroupId) {
    const [group, member] = await Promise.all([
      readDocument(groupPath(groupId)),
      readDocument(membershipPath(groupId, userId)),
    ]);
    return group && member ? { group, member } : null;
  }

  async function commit(writes: unknown[]) {
    return firestore.request(":commit", {
      method: "POST",
      body: JSON.stringify({ writes }),
    });
  }

  return Object.freeze({
    async hasAccess(actorUserId, groupId) {
      return Boolean(await readAccess(actorUserId, groupId));
    },

    async create(actorUserId, groupId, assignee, input) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const [access, assigneeMember] = await Promise.all([
          readAccess(actorUserId, groupId),
          readDocument(membershipPath(groupId, assignee.userId)),
        ]);
        if (!access) return { kind: "not_found" as const };
        if (!assigneeMember) return { kind: "assignee_not_member" as const };

        const taskId = `task_${randomUUID().replaceAll("-", "")}` as TaskId;
        const createdAt = new Date(now()).toISOString();
        const task: OpenJobTask = {
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
            {
              verify: access.group.name,
              currentDocument: { updateTime: access.group.updateTime },
            },
            ...membershipVerifies,
            {
              update: {
                name: firestore.documentName(taskPath(groupId, taskId)),
                fields: {
                  taskId: { stringValue: taskId },
                  groupId: { stringValue: groupId },
                  text: { stringValue: input.text },
                  assigneeState: { stringValue: "assigned" },
                  assigneeUserId: { stringValue: assignee.userId },
                  assigneeUsername: { stringValue: assignee.username },
                  ...(input.dueDate
                    ? { dueDate: { stringValue: input.dueDate } }
                    : {}),
                  state: { stringValue: "open" },
                  createdAt: { timestampValue: createdAt },
                },
              },
              currentDocument: { exists: false },
            },
          ]);
          return { kind: "created" as const, task };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }

      const [access, assigneeMember] = await Promise.all([
        readAccess(actorUserId, groupId),
        readDocument(membershipPath(groupId, assignee.userId)),
      ]);
      if (!access) return { kind: "not_found" as const };
      if (!assigneeMember) return { kind: "assignee_not_member" as const };
      throw new Error("Task creation could not resolve concurrent writes.");
    },

    async get(actorUserId, groupId, taskId) {
      if (!(await readAccess(actorUserId, groupId))) {
        return { kind: "group_not_found" as const };
      }
      const document = await readDocument(taskPath(groupId, taskId));
      return document
        ? {
            kind: "found" as const,
            task: publicTask(parseTask(document, document.name)),
          }
        : { kind: "task_not_found" as const };
    },

    async list(actorUserId, groupId) {
      if (!(await readAccess(actorUserId, groupId))) {
        return { kind: "not_found" as const };
      }
      const tasks: OpenJobTask[] = [];
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
        tasks.push(
          ...(page.documents ?? []).map((document) =>
            publicTask(parseTask(document, document.name)),
          ),
        );
        pageToken = page.nextPageToken ?? null;
      } while (pageToken !== null);
      return { kind: "found" as const, tasks };
    },
  });
}
