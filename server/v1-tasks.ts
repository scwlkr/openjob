import { isGroupId, type GroupId } from "./v1-groups.ts";
import {
  isReservedUsername,
  isUsernameSyntax,
  type OpenJobUser,
  type Username,
} from "./v1-identity.ts";
import {
  defaultRequestId,
  errorResponse,
  internalErrorResponse,
  isRateLimitError,
  jsonResponse,
  readPagination,
  rateLimitedErrorResponse,
  type RequestIdFactory,
} from "./v1-http.ts";

declare const taskIdBrand: unique symbol;
declare const taskTextBrand: unique symbol;
declare const dueDateBrand: unique symbol;

export type TaskId = string & { readonly [taskIdBrand]: true };
export type TaskText = string & { readonly [taskTextBrand]: true };
export type DueDate = string & { readonly [dueDateBrand]: true };

export type AssignedTaskAssignee = {
  state: "assigned";
  userId: string;
  username: Username;
};

export type TaskAssignee = AssignedTaskAssignee | { state: "unassigned" };

export type OpenJobTask = {
  taskId: TaskId;
  groupId: GroupId;
  text: TaskText;
  assignee: TaskAssignee;
  dueDate: DueDate | null;
  state: "open" | "done";
  createdAt: string;
  completedAt: string | null;
};

export type TaskStore = {
  hasAccess(actorUserId: string, groupId: GroupId): Promise<boolean>;
  create(
    actorUserId: string,
    groupId: GroupId,
    assignee: { userId: string; username: Username },
    input: { text: TaskText; dueDate: DueDate | null },
  ): Promise<
    | { kind: "created"; task: OpenJobTask }
    | { kind: "assignee_not_member" }
    | { kind: "not_found" }
  >;
  get(
    actorUserId: string,
    groupId: GroupId,
    taskId: TaskId,
  ): Promise<
    | { kind: "found"; task: OpenJobTask }
    | { kind: "group_not_found" }
    | { kind: "task_not_found" }
  >;
  update(
    actorUserId: string,
    groupId: GroupId,
    taskId: TaskId,
    input: {
      text?: TaskText;
      assignee?: { userId: string; username: Username };
      dueDate?: DueDate | null;
    },
  ): Promise<
    | { kind: "updated"; task: OpenJobTask }
    | { kind: "assignee_not_member" }
    | { kind: "group_not_found" }
    | { kind: "task_not_found" }
    | { kind: "task_done" }
  >;
  setState(
    actorUserId: string,
    groupId: GroupId,
    taskId: TaskId,
    state: "open" | "done",
  ): Promise<
    | { kind: "updated"; task: OpenJobTask }
    | { kind: "group_not_found" }
    | { kind: "task_not_found" }
  >;
  delete(
    actorUserId: string,
    groupId: GroupId,
    taskId: TaskId,
  ): Promise<
    | { kind: "deleted" }
    | { kind: "group_not_found" }
    | { kind: "task_not_found" }
  >;
  list(
    actorUserId: string,
    groupId: GroupId,
  ): Promise<
    | { kind: "found"; tasks: OpenJobTask[] }
    | { kind: "not_found" }
  >;
};

type UserStore = {
  getByUsername(username: Username): Promise<OpenJobUser | null>;
  getOrCreate(firebaseUid: string): Promise<OpenJobUser>;
};

type TasksApiOptions = {
  requestId?: () => string;
  tasks: TaskStore;
  users: UserStore;
  verifyIdToken(request: Request): Promise<{ uid: string } | null>;
};

const TASK_TEXT_CONTROL_CHARACTERS =
  /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

function groupNotFound(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "group_not_found",
    message: "Group was not found.",
    status: 404,
  });
}

function taskNotFound(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "task_not_found",
    message: "Task was not found.",
    status: 404,
  });
}

function assigneeNotMember(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "assignee_not_member",
    message: "Assign the Task to a current Member.",
    status: 409,
  });
}

function taskDone(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "task_done",
    message: "Reopen the Task before changing its content.",
    status: 409,
  });
}

function invalidTaskInput(
  requestId: RequestIdFactory,
  fields: Record<string, string>,
) {
  return errorResponse(requestId, {
    code: "invalid_request",
    message: "One or more fields are invalid.",
    fields,
    status: 400,
  });
}

function validDueDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

async function readCreateTask(
  request: Request,
): Promise<
  | { fields: Record<string, string> }
  | {
      input: {
        text: TaskText;
        assigneeUsername: Username;
        dueDate: DueDate | null;
      };
    }
> {
  try {
    const input = (await request.json()) as unknown;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { fields: { text: "Must contain 1 to 2,000 characters." } };
    }
    const keys = Object.keys(input);
    const allowedKeys = new Set(["text", "assigneeUsername", "dueDate"]);
    if (
      keys.some((key) => !allowedKeys.has(key)) ||
      !("text" in input) ||
      !("assigneeUsername" in input)
    ) {
      return { fields: { text: "Send only the documented Task fields." } };
    }

    const fields: Record<string, string> = {};
    let text: TaskText | null = null;
    if (typeof input.text !== "string") {
      fields.text = "Must contain 1 to 2,000 characters.";
    } else {
      const normalized = input.text.replace(/\r\n?/g, "\n").trim();
      if (
        normalized.length === 0 ||
        Array.from(normalized).length > 2_000 ||
        TASK_TEXT_CONTROL_CHARACTERS.test(normalized)
      ) {
        fields.text = "Must contain 1 to 2,000 plain-text characters.";
      } else {
        text = normalized as TaskText;
      }
    }

    let assigneeUsername: Username | null = null;
    if (
      typeof input.assigneeUsername !== "string" ||
      !isUsernameSyntax(input.assigneeUsername) ||
      isReservedUsername(input.assigneeUsername)
    ) {
      fields.assigneeUsername = "Use a valid current Member Username.";
    } else {
      assigneeUsername = input.assigneeUsername as Username;
    }

    let dueDate: DueDate | null = null;
    if ("dueDate" in input) {
      if (typeof input.dueDate !== "string" || !validDueDate(input.dueDate)) {
        fields.dueDate = "Use a valid YYYY-MM-DD calendar date.";
      } else {
        dueDate = input.dueDate as DueDate;
      }
    }

    return Object.keys(fields).length > 0
      ? { fields }
      : { input: { text: text!, assigneeUsername: assigneeUsername!, dueDate } };
  } catch {
    return { fields: { text: "Send a JSON Task object." } };
  }
}

async function readUpdateTask(
  request: Request,
): Promise<
  | { fields: Record<string, string> }
  | {
      input: {
        text?: TaskText;
        assigneeUsername?: Username;
        dueDate?: DueDate | null;
      };
    }
> {
  try {
    const input = (await request.json()) as unknown;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { fields: { text: "Send a JSON Task object." } };
    }
    const keys = Object.keys(input);
    const allowedKeys = new Set(["text", "assigneeUsername", "dueDate"]);
    if (keys.length === 0 || keys.some((key) => !allowedKeys.has(key))) {
      return { fields: { text: "Send at least one documented Task field." } };
    }

    const fields: Record<string, string> = {};
    const update: {
      text?: TaskText;
      assigneeUsername?: Username;
      dueDate?: DueDate | null;
    } = {};
    if ("text" in input) {
      if (typeof input.text !== "string") {
        fields.text = "Must contain 1 to 2,000 characters.";
      } else {
        const normalized = input.text.replace(/\r\n?/g, "\n").trim();
        if (
          normalized.length === 0 ||
          Array.from(normalized).length > 2_000 ||
          TASK_TEXT_CONTROL_CHARACTERS.test(normalized)
        ) {
          fields.text = "Must contain 1 to 2,000 plain-text characters.";
        } else {
          update.text = normalized as TaskText;
        }
      }
    }
    if ("assigneeUsername" in input) {
      if (
        typeof input.assigneeUsername !== "string" ||
        !isUsernameSyntax(input.assigneeUsername) ||
        isReservedUsername(input.assigneeUsername)
      ) {
        fields.assigneeUsername = "Use a valid current Member Username.";
      } else {
        update.assigneeUsername = input.assigneeUsername as Username;
      }
    }
    if ("dueDate" in input) {
      if (input.dueDate === null) {
        update.dueDate = null;
      } else if (
        typeof input.dueDate !== "string" ||
        !validDueDate(input.dueDate)
      ) {
        fields.dueDate = "Use a valid YYYY-MM-DD calendar date or null.";
      } else {
        update.dueDate = input.dueDate as DueDate;
      }
    }

    return Object.keys(fields).length > 0 ? { fields } : { input: update };
  } catch {
    return { fields: { text: "Send a JSON Task object." } };
  }
}

async function readTaskState(
  request: Request,
): Promise<
  | { fields: Record<string, string> }
  | { state: "open" | "done" }
> {
  try {
    const input = (await request.json()) as unknown;
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).join(",") !== "state" ||
      !("state" in input) ||
      !["open", "done"].includes(String(input.state))
    ) {
      return { fields: { state: "Use open or done." } };
    }
    return { state: input.state as "open" | "done" };
  } catch {
    return { fields: { state: "Send a JSON state object." } };
  }
}

function taskResourceFromPath(pathname: string) {
  const match = pathname.match(
    /^\/api\/v1\/groups\/([^/]+)\/tasks(?:\/([^/]+)(?:\/(state))?)?$/,
  );
  if (!match) return { kind: "none" as const };
  try {
    const groupId = decodeURIComponent(match[1]);
    const taskId = match[2] === undefined ? null : decodeURIComponent(match[2]);
    if (!isGroupId(groupId)) {
      return taskId === null
        ? { kind: "invalid_group" as const }
        : { kind: "invalid_task" as const };
    }
    if (
      taskId !== null &&
      (taskId.length > 1_500 || !/^task_[A-Za-z0-9_-]+$/.test(taskId))
    ) {
      return { kind: "invalid_task" as const };
    }
    return {
      kind: "valid" as const,
      groupId: groupId as GroupId,
      taskId: taskId as TaskId | null,
      state: match[3] === "state",
    };
  } catch {
    return match[2] === undefined
      ? { kind: "invalid_group" as const }
      : { kind: "invalid_task" as const };
  }
}

type TaskListOptions = {
  status: "open" | "done" | "all";
  assignee: Username | "unassigned" | null;
  cursor: string | null;
  limit: number;
};

function readTaskListOptions(url: URL):
  | { fields: Record<string, string> }
  | TaskListOptions {
  const statuses = url.searchParams.getAll("status");
  const assignees = url.searchParams.getAll("assignee");
  if (
    statuses.length > 1 ||
    (statuses.length === 1 && !["open", "done", "all"].includes(statuses[0]))
  ) {
    return { fields: { status: "Use open, done, or all." } };
  }
  if (assignees.length > 1) {
    return { fields: { assignee: "Use one Username or unassigned." } };
  }
  const assignee = assignees[0] ?? null;
  if (
    assignee !== null &&
    assignee !== "unassigned" &&
    (!isUsernameSyntax(assignee) || isReservedUsername(assignee))
  ) {
    return { fields: { assignee: "Use one Username or unassigned." } };
  }
  const pagination = readPagination(url);
  if ("error" in pagination) {
    return {
      fields: {
        [pagination.error]:
          pagination.error === "cursor"
            ? "Use a cursor returned by this collection."
            : "Use an integer from 1 to 500.",
      },
    };
  }
  return {
    status: (statuses[0] ?? "open") as "open" | "done" | "all",
    assignee: assignee as Username | "unassigned" | null,
    cursor: pagination.cursor,
    limit: pagination.limit,
  };
}

type TaskCursor = {
  v: 1;
  g: string;
  s: "open" | "done" | "all";
  a: string | null;
  t: string;
};

function encodeTaskCursor(
  groupId: GroupId,
  options: TaskListOptions,
  taskId: TaskId,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      v: 1,
      g: groupId,
      s: options.status,
      a: options.assignee,
      t: taskId,
    } satisfies TaskCursor),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `cur_${btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;
}

function decodeTaskCursor(value: string): TaskCursor | null {
  if (!value.startsWith("cur_")) return null;
  try {
    const encoded = value.slice("cur_".length).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(",") !== "a,g,s,t,v" ||
      !("v" in parsed) ||
      parsed.v !== 1 ||
      !("g" in parsed) ||
      typeof parsed.g !== "string" ||
      !("s" in parsed) ||
      !["open", "done", "all"].includes(String(parsed.s)) ||
      !("a" in parsed) ||
      (parsed.a !== null && typeof parsed.a !== "string") ||
      !("t" in parsed) ||
      typeof parsed.t !== "string"
    ) {
      return null;
    }
    return parsed as TaskCursor;
  } catch {
    return null;
  }
}

function compareTasks(left: OpenJobTask, right: OpenJobTask) {
  if (left.assignee.state !== right.assignee.state) {
    return left.assignee.state === "unassigned" ? 1 : -1;
  }
  if (
    left.assignee.state === "assigned" &&
    right.assignee.state === "assigned" &&
    left.assignee.username !== right.assignee.username
  ) {
    return left.assignee.username < right.assignee.username ? -1 : 1;
  }
  if (left.state !== right.state) return left.state === "open" ? -1 : 1;
  if (left.state === "open" && right.state === "open") {
    if (left.dueDate === null && right.dueDate !== null) return 1;
    if (left.dueDate !== null && right.dueDate === null) return -1;
    if (left.dueDate !== right.dueDate) {
      return (left.dueDate ?? "").localeCompare(right.dueDate ?? "");
    }
  }
  if (left.state === "done" && right.state === "done") {
    const completionOrder = (right.completedAt ?? "").localeCompare(
      left.completedAt ?? "",
    );
    if (completionOrder !== 0) return completionOrder;
  }
  const creationOrder = left.createdAt.localeCompare(right.createdAt);
  return creationOrder !== 0
    ? creationOrder
    : left.taskId.localeCompare(right.taskId);
}

export function createV1TasksApi({
  requestId = defaultRequestId,
  tasks,
  users,
  verifyIdToken,
}: TasksApiOptions) {
  return Object.freeze({
    async fetch(request: Request) {
      try {
        const identity = await verifyIdToken(request);
        if (!identity) {
          return errorResponse(requestId, {
            code: "authentication_required",
            message: "Authentication is required.",
            status: 401,
          });
        }
        const user = await users.getOrCreate(identity.uid);
        const url = new URL(request.url);
        const path = taskResourceFromPath(url.pathname);
        if (path.kind === "invalid_group") return groupNotFound(requestId);
        if (path.kind === "invalid_task") return taskNotFound(requestId);

        if (path.kind === "valid" && path.taskId === null && request.method === "POST") {
          if (!(await tasks.hasAccess(user.userId, path.groupId))) {
            return groupNotFound(requestId);
          }
          const parsed = await readCreateTask(request);
          if ("fields" in parsed) {
            return invalidTaskInput(requestId, parsed.fields);
          }
          const assignee = await users.getByUsername(parsed.input.assigneeUsername);
          if (!assignee?.username) return assigneeNotMember(requestId);
          const result = await tasks.create(user.userId, path.groupId, {
            userId: assignee.userId,
            username: assignee.username as Username,
          }, parsed.input);
          if (result.kind === "created") {
            return jsonResponse({ data: result.task }, 201);
          }
          if (result.kind === "assignee_not_member") {
            return assigneeNotMember(requestId);
          }
          return groupNotFound(requestId);
        }

        if (path.kind === "valid" && path.taskId === null && request.method === "GET") {
          if (!(await tasks.hasAccess(user.userId, path.groupId))) {
            return groupNotFound(requestId);
          }
          const options = readTaskListOptions(url);
          if ("fields" in options) {
            return invalidTaskInput(requestId, options.fields);
          }
          const result = await tasks.list(user.userId, path.groupId);
          if (result.kind === "not_found") return groupNotFound(requestId);
          const ordered = result.tasks
            .filter(
              (task) =>
                (options.status === "all" || task.state === options.status) &&
                (options.assignee === null ||
                  (options.assignee === "unassigned"
                    ? task.assignee.state === "unassigned"
                    : task.assignee.state === "assigned" &&
                      task.assignee.username === options.assignee)),
            )
            .sort(compareTasks);
          let start = 0;
          if (options.cursor !== null) {
            const cursor = decodeTaskCursor(options.cursor);
            if (
              !cursor ||
              cursor.g !== path.groupId ||
              cursor.s !== options.status ||
              cursor.a !== options.assignee
            ) {
              return invalidTaskInput(requestId, {
                cursor: "Use a cursor returned by this collection.",
              });
            }
            const cursorIndex = ordered.findIndex(
              ({ taskId }) => taskId === cursor.t,
            );
            if (cursorIndex < 0) {
              return invalidTaskInput(requestId, {
                cursor: "Use a cursor returned by this collection.",
              });
            }
            start = cursorIndex + 1;
          }
          const page = ordered.slice(start, start + options.limit);
          const hasMore = start + page.length < ordered.length;
          return jsonResponse({
            data: page,
            nextCursor:
              hasMore && page.length > 0
                ? encodeTaskCursor(path.groupId, options, page.at(-1)!.taskId)
                : null,
          });
        }

        if (
          path.kind === "valid" &&
          path.taskId !== null &&
          !path.state &&
          request.method === "GET"
        ) {
          const result = await tasks.get(user.userId, path.groupId, path.taskId);
          return result.kind === "found"
            ? jsonResponse({ data: result.task })
            : taskNotFound(requestId);
        }

        if (
          path.kind === "valid" &&
          path.taskId !== null &&
          !path.state &&
          request.method === "DELETE"
        ) {
          const result = await tasks.delete(
            user.userId,
            path.groupId,
            path.taskId,
          );
          return result.kind === "deleted"
            ? new Response(null, {
                status: 204,
                headers: { "cache-control": "no-store" },
              })
            : taskNotFound(requestId);
        }

        if (
          path.kind === "valid" &&
          path.taskId !== null &&
          !path.state &&
          request.method === "PATCH"
        ) {
          const current = await tasks.get(
            user.userId,
            path.groupId,
            path.taskId,
          );
          if (current.kind !== "found") {
            return taskNotFound(requestId);
          }
          if (current.task.state === "done") return taskDone(requestId);
          const parsed = await readUpdateTask(request);
          if ("fields" in parsed) {
            return invalidTaskInput(requestId, parsed.fields);
          }
          let assignee: { userId: string; username: Username } | undefined;
          if (parsed.input.assigneeUsername !== undefined) {
            const assigneeUser = await users.getByUsername(
              parsed.input.assigneeUsername,
            );
            if (!assigneeUser?.username) return assigneeNotMember(requestId);
            assignee = {
              userId: assigneeUser.userId,
              username: assigneeUser.username as Username,
            };
          }
          const result = await tasks.update(user.userId, path.groupId, path.taskId, {
            ...(parsed.input.text !== undefined ? { text: parsed.input.text } : {}),
            ...(assignee ? { assignee } : {}),
            ...("dueDate" in parsed.input ? { dueDate: parsed.input.dueDate } : {}),
          });
          if (result.kind === "updated") {
            return jsonResponse({ data: result.task });
          }
          if (result.kind === "assignee_not_member") {
            return assigneeNotMember(requestId);
          }
          if (result.kind === "task_done") return taskDone(requestId);
          return taskNotFound(requestId);
        }

        if (
          path.kind === "valid" &&
          path.taskId !== null &&
          path.state &&
          request.method === "PUT"
        ) {
          const current = await tasks.get(
            user.userId,
            path.groupId,
            path.taskId,
          );
          if (current.kind !== "found") {
            return taskNotFound(requestId);
          }
          const parsed = await readTaskState(request);
          if ("fields" in parsed) {
            return invalidTaskInput(requestId, parsed.fields);
          }
          const result = await tasks.setState(
            user.userId,
            path.groupId,
            path.taskId,
            parsed.state,
          );
          return result.kind === "updated"
            ? jsonResponse({ data: result.task })
            : taskNotFound(requestId);
        }

        return errorResponse(requestId, {
          code: "not_found",
          message: "The requested resource was not found.",
          status: 404,
        });
      } catch (error) {
        if (isRateLimitError(error)) return rateLimitedErrorResponse(requestId);
        return internalErrorResponse(requestId);
      }
    },
  });
}

export function createV1TasksHandler(
  getTasksApi: () => ReturnType<typeof createV1TasksApi>,
  requestId = defaultRequestId,
) {
  return async function handleV1TasksRequest(request: Request) {
    try {
      return await getTasksApi().fetch(request);
    } catch {
      return internalErrorResponse(requestId);
    }
  };
}
