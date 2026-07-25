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

export function createNativeOpenJobApi({
  apiBaseUrl,
  fetchImplementation = fetch,
}: NativeOpenJobApiConfig) {
  const baseUrl = apiBaseUrl.replace(/\/+$/u, "");

  async function requestEnvelope(
    path: string,
    token: string,
    init: RequestInit = {},
  ) {
    let response: Response;
    try {
      response = await fetchImplementation(`${baseUrl}${path}`, {
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
    if (!response.ok) {
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

    listTasks(token: string, groupId: string) {
      return listAll(
        `/groups/${encodeURIComponent(groupId)}/tasks`,
        token,
        isTask,
        new URLSearchParams({ status: "all" }),
      );
    },

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
