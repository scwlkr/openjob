import type { ProviderPreview } from "../../shared/provider-contracts";
import type { PersonalAgentGrant } from "../../shared/personal-agent-grants";
import type { AuthSession, User } from "../openjob-contracts";
import { TASK_CALENDAR_REVISION, validateTaskCalendarProjection, validateTaskCalendarSyncInput } from "../../shared/task-calendar-sync";
import type { TaskCalendarSyncSnapshot, TaskCalendarSyncInput, TaskCalendarSyncAck } from "../../shared/task-calendar-sync";
import type { WorkspaceView } from "../../shared/workspace-contracts";
import type { PersonalWorkspaceCommand } from "../../shared/personal-workspace";

export class PersonalWorkspaceError extends Error {
  constructor(public readonly code: string, public readonly status = 0) {
    super(code === "sign_in_method_unrecognized" ? "Finish account setup before opening your personal workspace." : "The personal workspace request could not be completed.");
  }
}

export type PersonalWorkspaceClient = {
  me(session: AuthSession, signal: AbortSignal): Promise<User>;
  readTaskCalendarSync(session: AuthSession, owner: string, signal: AbortSignal): Promise<TaskCalendarSyncSnapshot>;
  syncTaskCalendar(session: AuthSession, owner: string, input: TaskCalendarSyncInput, signal: AbortSignal): Promise<TaskCalendarSyncAck>;
  snapshot(session: AuthSession, signal: AbortSignal): Promise<WorkspaceView>;
  command(session: AuthSession, input: PersonalWorkspaceCommand, signal: AbortSignal): Promise<unknown>;
  listAgents(session: AuthSession, signal: AbortSignal): Promise<PersonalAgentGrant[]>;
  revokeAgent(session: AuthSession, id: string, signal: AbortSignal): Promise<void>;
  providerPreview(session: AuthSession, signal: AbortSignal, query?: { accountId?: string; cursor?: string }): Promise<ProviderPreview>;
};

export function createPersonalWorkspaceClient(): PersonalWorkspaceClient {
  async function request(session: AuthSession, signal: AbortSignal, input?: unknown, path = input ? "commands" : "snapshot", method = input ? "POST" : "GET") {
    signal.throwIfAborted();
    const token = await session.getIdToken();
    // A deferred token must never start a request after this identity's lease ends.
    signal.throwIfAborted();
    const response = await fetch(path === "../me" ? "/api/v1/me" : `/api/v1/workspace/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(input ? { "content-type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (response.status === 204) { signal.throwIfAborted(); return undefined; }
    const raw = await response.text(); signal.throwIfAborted();
    const invalidResponse = () => new PersonalWorkspaceError(response.status === 401 ? "authentication_required" : response.status === 410 ? "account_deletion_pending" : "invalid_response", [401, 410].includes(response.status) ? response.status : 502);
    if (new TextEncoder().encode(raw).length > 1500000) throw invalidResponse();
    let body: { data?: unknown; error?: { code?: string } };
    try { body = JSON.parse(raw); } catch { throw invalidResponse(); }
    signal.throwIfAborted();
    if (!response.ok) {
      const safe = new Set(["authentication_required", "account_deletion_pending", "sign_in_method_unrecognized", "conflict", "sync_expired", "workspace_capacity", "body_too_large", "invalid_input", "invalid_request", "forbidden"]);
      throw new PersonalWorkspaceError(safe.has(body?.error?.code ?? "") ? body.error!.code! : "request_failed", response.status);
    }
    if (!body || typeof body !== "object" || !("data" in body)) throw new PersonalWorkspaceError("invalid_response", 502);
    return body.data;
  }
  const exact = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys.sort().join(",")) throw new PersonalWorkspaceError("invalid_response", 502);
    return value as Record<string, unknown>;
  };
  async function me(session: AuthSession, signal: AbortSignal): Promise<User> {
    const value = exact(await request(session, signal, undefined, "../me"), ["userId", "username", "usernameRequired"]);
    if (typeof value.userId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.userId) || typeof value.usernameRequired !== "boolean" || !(value.username === null || typeof value.username === "string" && value.username.length <= 128)) throw new PersonalWorkspaceError("invalid_response", 502);
    return value as User;
  }
  async function verifyOwner(session: AuthSession, owner: string, signal: AbortSignal) {
    const current = await me(session, signal); signal.throwIfAborted();
    if (current.userId !== owner) throw new PersonalWorkspaceError("authentication_required", 401);
  }
  return {
    me,
    readTaskCalendarSync: async (session, owner, signal) => {
      await verifyOwner(session, owner, signal);
      const value = exact(await request(session, signal, undefined, "task-calendar-sync"), ["revision", "projection"]);
      try {
        if (typeof value.revision !== "string" || !TASK_CALENDAR_REVISION.test(value.revision)) throw new Error();
        return { revision: value.revision, projection: validateTaskCalendarProjection(owner, value.projection) };
      } catch { throw new PersonalWorkspaceError("invalid_response", 502); }
    },
    syncTaskCalendar: async (session, owner, input, signal) => {
      let validated: TaskCalendarSyncInput;
      try { validated = validateTaskCalendarSyncInput(owner, input); } catch { throw new PersonalWorkspaceError("invalid_input", 400); }
      await verifyOwner(session, owner, signal); signal.throwIfAborted();
      const value = exact(await request(session, signal, validated, "task-calendar-sync", "POST"), ["operationId", "revision"]);
      if (value.operationId !== validated.operationId || typeof value.revision !== "string" || !TASK_CALENDAR_REVISION.test(value.revision)) throw new PersonalWorkspaceError("invalid_response", 502);
      return { operationId: validated.operationId, revision: value.revision };
    },
    snapshot: async (session, signal) => await request(session, signal) as WorkspaceView,
    command: (session, input, signal) => request(session, signal, input),
    listAgents: async (session, signal) => await request(session, signal, undefined, "agent-grants") as PersonalAgentGrant[],
    revokeAgent: async (session, id, signal) => { await request(session, signal, undefined, `agent-grants/${encodeURIComponent(id)}`, "DELETE"); },
    providerPreview: async (session, signal, query = {}) => {
      const search = new URLSearchParams();
      if (query.accountId) search.set("accountId", query.accountId);
      if (query.cursor) search.set("cursor", query.cursor);
      return await request(session, signal, undefined, `provider-preview${search.size ? `?${search}` : ""}`) as ProviderPreview;
    },
  };
}
