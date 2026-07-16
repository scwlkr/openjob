import { ApiError, type Group, type OpenJobApi, type User } from "./openjob-app";

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
      const groups: Group[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: "500" });
        if (cursor) query.set("cursor", cursor);
        const response: { data: Group[]; nextCursor: string | null } =
          await request(`/api/v1/groups?${query.toString()}`, token);
        groups.push(...response.data);
        cursor = response.nextCursor;
      } while (cursor !== null);
      return groups;
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
  });
}
