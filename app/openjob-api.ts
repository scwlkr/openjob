import {
  ApiError,
  type Group,
  type Member,
  type OpenJobApi,
  type Task,
  type User,
} from "./openjob-contracts";

type ErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  };
};

async function request<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");

  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers,
  });
  const payload = (await response.json().catch(() => ({}))) as
    | ErrorEnvelope
    | T;

  if (!response.ok) {
    const error = (payload as ErrorEnvelope).error;
    throw new ApiError(
      response.status,
      error?.code ?? "unexpected_response",
      error?.message ?? "OpenJob returned an unexpected response.",
      error?.fields,
    );
  }
  return payload as T;
}

async function listAll<T>(
  path: string,
  token: string,
  parameters?: URLSearchParams,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams(parameters);
    query.set("limit", "500");
    if (cursor) query.set("cursor", cursor);
    const response: { data: T[]; nextCursor: string | null } = await request(
      `${path}?${query.toString()}`,
      token,
    );
    items.push(...response.data);
    cursor = response.nextCursor;
  } while (cursor !== null);
  return items;
}

export function createOpenJobApi(): OpenJobApi {
  return Object.freeze({
    async getMe(token) {
      const response = await request<{ data: User }>("/api/v1/me", token);
      return response.data;
    },

    async claimUsername(token, username) {
      const response = await request<{ data: User }>(
        "/api/v1/me/username",
        token,
        { method: "PUT", body: JSON.stringify({ username }) },
      );
      return response.data;
    },

    async listGroups(token) {
      return listAll<Group>("/api/v1/groups", token);
    },

    async getGroup(token, groupId) {
      const response = await request<{ data: Group }>(
        `/api/v1/groups/${encodeURIComponent(groupId)}`,
        token,
      );
      return response.data;
    },

    async createGroup(token, name) {
      const response = await request<{ data: Group }>("/api/v1/groups", token, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      return response.data;
    },

    async listMembers(token, groupId) {
      return listAll<Member>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/members`,
        token,
      );
    },

    async listTasks(token, groupId, filters) {
      const query = new URLSearchParams({ status: filters.status });
      if (filters.assignee) query.set("assignee", filters.assignee);
      return listAll<Task>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/tasks`,
        token,
        query,
      );
    },

    async createTask(token, groupId, input) {
      const response = await request<{ data: Task }>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/tasks`,
        token,
        { method: "POST", body: JSON.stringify(input) },
      );
      return response.data;
    },

    async updateTask(token, groupId, taskId, input) {
      const response = await request<{ data: Task }>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(taskId)}`,
        token,
        { method: "PATCH", body: JSON.stringify(input) },
      );
      return response.data;
    },

    async setTaskState(token, groupId, taskId, state) {
      const response = await request<{ data: Task }>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(taskId)}/state`,
        token,
        { method: "PUT", body: JSON.stringify({ state }) },
      );
      return response.data;
    },

    async deleteTask(token, groupId, taskId) {
      await request<void>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(taskId)}`,
        token,
        { method: "DELETE" },
      );
    },
  });
}
