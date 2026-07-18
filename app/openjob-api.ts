import {
  ApiError,
  type Ban,
  type BrowserPushSubscription,
  type Group,
  type InviteLink,
  type InvitePreview,
  type Member,
  type NotificationSubscriptionState,
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

    async renameGroup(token, groupId, name) {
      const response = await request<{ data: Group }>(
        `/api/v1/groups/${encodeURIComponent(groupId)}`,
        token,
        { method: "PATCH", body: JSON.stringify({ name }) },
      );
      return response.data;
    },

    async leaveGroup(token, groupId) {
      await request<void>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/actions/leave`,
        token,
        { method: "POST" },
      );
    },

    async endGroup(token, groupId, confirmationName) {
      await request<void>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/actions/end`,
        token,
        { method: "POST", body: JSON.stringify({ confirmationName }) },
      );
    },

    async inspectInvite(token, inviteToken) {
      const response = await request<{ data: InvitePreview }>(
        `/api/v1/invites/${encodeURIComponent(inviteToken)}`,
        token,
      );
      return response.data;
    },

    async joinInvite(token, inviteToken) {
      const response = await request<{ data: Group }>(
        `/api/v1/invites/${encodeURIComponent(inviteToken)}/actions/join`,
        token,
        { method: "POST" },
      );
      return response.data;
    },

    async listMembers(token, groupId) {
      return listAll<Member>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/members`,
        token,
      );
    },

    async promoteMember(token, groupId, userId) {
      const response = await request<{ data: Member }>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/actions/promote`,
        token,
        { method: "POST" },
      );
      return response.data;
    },

    async demoteMember(token, groupId, userId) {
      const response = await request<{ data: Member }>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/actions/demote`,
        token,
        { method: "POST" },
      );
      return response.data;
    },

    async kickMember(token, groupId, userId) {
      await request<void>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/actions/kick`,
        token,
        { method: "POST" },
      );
    },

    async listBans(token, groupId) {
      return listAll<Ban>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/bans`,
        token,
      );
    },

    async banMember(token, groupId, userId) {
      const response = await request<{ data: Ban }>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/bans/actions/ban`,
        token,
        { method: "POST", body: JSON.stringify({ userId }) },
      );
      return response.data;
    },

    async unbanMember(token, groupId, userId) {
      await request<void>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/bans/${encodeURIComponent(userId)}/actions/unban`,
        token,
        { method: "POST" },
      );
    },

    async getInviteLink(token, groupId) {
      const response = await request<{ data: InviteLink }>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/invite-link`,
        token,
      );
      return response.data;
    },

    async rotateInviteLink(token, groupId) {
      const response = await request<{ data: InviteLink }>(
        `/api/v1/groups/${encodeURIComponent(groupId)}/invite-link/actions/rotate`,
        token,
        { method: "POST" },
      );
      return response.data;
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

    async getNotificationSubscription(token, installationId) {
      const response = await request<{ data: NotificationSubscriptionState }>(
        `/api/v1/me/notification-subscriptions/${encodeURIComponent(installationId)}`,
        token,
      );
      return response.data;
    },

    async registerNotificationSubscription(
      token,
      installationId,
      subscription: BrowserPushSubscription,
    ) {
      const response = await request<{ data: NotificationSubscriptionState }>(
        `/api/v1/me/notification-subscriptions/${encodeURIComponent(installationId)}`,
        token,
        { method: "PUT", body: JSON.stringify(subscription) },
      );
      return response.data;
    },

    async setNotificationSubscriptionState(token, installationId, state) {
      const response = await request<{ data: NotificationSubscriptionState }>(
        `/api/v1/me/notification-subscriptions/${encodeURIComponent(installationId)}`,
        token,
        { method: "PATCH", body: JSON.stringify({ state }) },
      );
      return response.data;
    },
  });
}
