import {
  OpenJobApiError,
  type OpenJobUser,
  ProviderSignInError,
  type SignInMethod,
} from "./coordinator";
import type { FetchImplementation } from "./firebase-rest";
import type {
  NativeGroup,
  NativeMember,
  NativeTask,
  NativeTaskListReadResult,
} from "../task-list-contracts";

type NativeOpenJobApiConfig = {
  apiBaseUrl: string;
  fetchImplementation?: FetchImplementation;
};

function isUser(value: unknown): value is OpenJobUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<OpenJobUser>;
  return (
    typeof user.userId === "string" &&
    (typeof user.username === "string" || user.username === null) &&
    typeof user.usernameRequired === "boolean"
  );
}

function isMethod(value: unknown): value is SignInMethod {
  return value === "apple" || value === "google";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRole(value: unknown): value is NativeGroup["role"] {
  return value === "admin" || value === "member";
}

function isGroup(value: unknown): value is NativeGroup {
  return (
    isRecord(value) &&
    typeof value.groupId === "string" &&
    typeof value.name === "string" &&
    isRole(value.role) &&
    typeof value.createdAt === "string"
  );
}

function isMember(value: unknown): value is NativeMember {
  return (
    isRecord(value) &&
    typeof value.userId === "string" &&
    (typeof value.username === "string" || value.username === null) &&
    isRole(value.role) &&
    typeof value.joinedAt === "string"
  );
}

function isTask(value: unknown): value is NativeTask {
  if (!isRecord(value) || !isRecord(value.assignee)) return false;
  const assignee =
    value.assignee.state === "unassigned" ||
    value.assignee.state === "deleted" ||
    (value.assignee.state === "assigned" &&
      typeof value.assignee.userId === "string" &&
      typeof value.assignee.username === "string");
  const state =
    (value.state === "open" && value.completedAt === null) ||
    (value.state === "done" && typeof value.completedAt === "string");
  return (
    typeof value.taskId === "string" &&
    typeof value.groupId === "string" &&
    typeof value.text === "string" &&
    assignee &&
    (value.priority === "high" ||
      value.priority === "normal" ||
      value.priority === "low") &&
    (typeof value.dueDate === "string" || value.dueDate === null) &&
    state &&
    typeof value.createdAt === "string"
  );
}

function isEntityTag(value: string | null): value is string {
  return (
    value !== null &&
    /^(?:W\/)?"[\x21\x23-\x7E\x80-\xFF]*"$/u.test(value)
  );
}

function isSameEntityTag(left: string, right: string) {
  return left.replace(/^W\//u, "") === right.replace(/^W\//u, "");
}

function invalidTaskListValidator() {
  return new OpenJobApiError(
    502,
    "invalid_response",
    "OpenJob returned an invalid Task List validator.",
  );
}

function invalidPaginatedTaskList() {
  return new OpenJobApiError(
    502,
    "invalid_response",
    "OpenJob returned an invalid paginated Task List response.",
  );
}

export function createNativeOpenJobApi({
  apiBaseUrl,
  fetchImplementation = fetch,
}: NativeOpenJobApiConfig) {
  const baseUrl = apiBaseUrl.replace(/\/+$/u, "");

  async function sendRequest(
    path: string,
    token: string,
    init: RequestInit = {},
  ) {
    try {
      return await fetchImplementation(`${baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        method: init.method ?? "GET",
      });
    } catch {
      throw new ProviderSignInError("offline");
    }
  }

  async function readEnvelope(response: Response) {
    let body: {
      data?: unknown;
      error?: { code?: unknown; message?: unknown };
      nextCursor?: unknown;
    } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Status handling below remains stable for empty or non-JSON edge errors.
    }
    return body;
  }

  function throwResponseError(
    response: Response,
    body: Awaited<ReturnType<typeof readEnvelope>>,
  ): never {
    throw new OpenJobApiError(
      response.status,
      typeof body.error?.code === "string"
        ? body.error.code
        : "request_failed",
      typeof body.error?.message === "string"
        ? body.error.message
        : "OpenJob could not complete the request.",
    );
  }

  async function requestEnvelope(
    path: string,
    token: string,
    init: RequestInit = {},
  ) {
    const response = await sendRequest(path, token, init);
    const body = await readEnvelope(response);
    if (!response.ok) {
      throwResponseError(response, body);
    }
    return body;
  }

  async function request<T>(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<T> {
    const body = await requestEnvelope(path, token, init);
    return body.data as T;
  }

  async function listAll<T>(
    path: string,
    token: string,
    isItem: (value: unknown) => value is T,
    parameters = new URLSearchParams(),
  ) {
    const items: T[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams(parameters);
      query.set("limit", "500");
      if (cursor) query.set("cursor", cursor);
      const body = await requestEnvelope(
        `${path}?${query.toString()}`,
        token,
      );
      if (
        !Array.isArray(body.data) ||
        !body.data.every(isItem) ||
        (body.nextCursor !== null &&
          (typeof body.nextCursor !== "string" ||
            body.nextCursor.length === 0 ||
            seenCursors.has(body.nextCursor)))
      ) {
        throw new OpenJobApiError(
          502,
          "invalid_response",
          "OpenJob returned invalid Task List data.",
        );
      }
      items.push(...body.data);
      cursor = body.nextCursor;
      if (cursor) seenCursors.add(cursor);
    } while (cursor !== null);
    return items;
  }

  async function readTaskPage(response: Response) {
    const body = await readEnvelope(response);
    if (!response.ok) throwResponseError(response, body);
    const validator = response.headers.get("etag");
    if (!isEntityTag(validator)) throw invalidTaskListValidator();
    if (
      !Array.isArray(body.data) ||
      !body.data.every(isTask) ||
      (body.nextCursor !== null &&
        (typeof body.nextCursor !== "string" ||
          body.nextCursor.length === 0))
    ) {
      throw new OpenJobApiError(
        502,
        "invalid_response",
        "OpenJob returned invalid Task List data.",
      );
    }
    return {
      nextCursor: body.nextCursor,
      tasks: body.data,
      validator,
    };
  }

  async function listTasks(
    token: string,
    groupId: string,
    previousValidator?: string | null,
  ): Promise<NativeTaskListReadResult> {
    const path = `/groups/${encodeURIComponent(groupId)}/tasks`;
    const parameters = new URLSearchParams({ status: "all", limit: "500" });
    const firstPath = `${path}?${parameters.toString()}`;
    const firstResponse = await sendRequest(firstPath, token, {
      headers:
        previousValidator === undefined || previousValidator === null
          ? undefined
          : { "if-none-match": previousValidator },
    });

    if (firstResponse.status === 304) {
      const validator = firstResponse.headers.get("etag");
      if (!isEntityTag(validator)) throw invalidTaskListValidator();
      return { kind: "not-modified", validator };
    }

    const firstPage = await readTaskPage(firstResponse);
    const tasks = [...firstPage.tasks];
    const seenCursors = new Set<string>();
    let cursor = firstPage.nextCursor;
    while (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw new OpenJobApiError(
          502,
          "invalid_response",
          "OpenJob returned invalid Task List data.",
        );
      }
      seenCursors.add(cursor);
      const query = new URLSearchParams(parameters);
      query.set("cursor", cursor);
      const continuationResponse = await sendRequest(
        `${path}?${query.toString()}`,
        token,
      );
      if (continuationResponse.status === 304) {
        throw invalidPaginatedTaskList();
      }
      const page = await readTaskPage(continuationResponse);
      tasks.push(...page.tasks);
      cursor = page.nextCursor;
    }

    const revalidationResponse = await sendRequest(firstPath, token, {
      headers: { "if-none-match": firstPage.validator },
    });
    if (revalidationResponse.status === 304) {
      const validator = revalidationResponse.headers.get("etag");
      if (
        !isEntityTag(validator) ||
        !isSameEntityTag(validator, firstPage.validator)
      ) {
        throw invalidTaskListValidator();
      }
      return {
        kind: "changed",
        tasks,
        validator,
      };
    }
    if (revalidationResponse.ok) {
      throw new OpenJobApiError(
        409,
        "task_list_changed",
        "The Task List changed while it was loading.",
      );
    }
    throwResponseError(
      revalidationResponse,
      await readEnvelope(revalidationResponse),
    );
  }

  async function userRequest(
    path: string,
    token: string,
    init?: RequestInit,
  ) {
    const user = await request<unknown>(path, token, init);
    if (!isUser(user)) {
      throw new OpenJobApiError(
        502,
        "invalid_response",
        "OpenJob returned an invalid User.",
      );
    }
    return user;
  }

  return {
    createUser(token: string) {
      return userRequest("/me", token, {
        body: JSON.stringify({ confirmation: "create" }),
        method: "POST",
      });
    },

    async deleteUser(
      token: string,
      credentials: {
        credentialToken: string;
        provider: SignInMethod;
        revocation:
          | { kind: "access_token"; value: string }
          | { clientId: string; kind: "authorization_code"; value: string };
      }[],
    ) {
      const result = await request<unknown>("/me/deletion", token, {
        body: JSON.stringify({ confirmation: "delete", credentials }),
        method: "POST",
      });
      if (
        !isRecord(result) ||
        (result.status !== "completed" && result.status !== "pending")
      ) {
        throw new OpenJobApiError(
          502,
          "invalid_response",
          "OpenJob returned an invalid deletion status.",
        );
      }
      return { status: result.status } as const;
    },

    claimUsername(token: string, username: string) {
      return userRequest("/me/username", token, {
        body: JSON.stringify({ username }),
        method: "PUT",
      });
    },

    getMe(token: string) {
      return userRequest("/me", token);
    },

    listGroups(token: string) {
      return listAll("/groups", token, isGroup);
    },

    listMembers(token: string, groupId: string) {
      return listAll(
        `/groups/${encodeURIComponent(groupId)}/members`,
        token,
        isMember,
      );
    },

    async listSignInMethods(token: string) {
      const methods = await request<unknown>("/me/sign-in-methods", token);
      if (!Array.isArray(methods) || !methods.every(isMethod)) {
        throw new OpenJobApiError(
          502,
          "invalid_response",
          "OpenJob returned invalid Sign-in Methods.",
        );
      }
      return methods;
    },

    listTasks,

    linkSignInMethod(
      token: string,
      credentialToken: string,
      expectedTargetUserId: string,
    ) {
      return userRequest("/me/sign-in-methods", token, {
        body: JSON.stringify({
          confirmation: "link",
          credentialToken,
          expectedTargetUserId,
        }),
        method: "POST",
      });
    },
  };
}
