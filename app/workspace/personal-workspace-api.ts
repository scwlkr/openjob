import type { PersonalAgentGrant } from "../../shared/personal-agent-grants";
import type { AuthSession } from "../openjob-contracts";
import type { WorkspaceCommand, WorkspaceView } from "../../shared/workspace-contracts";

export class PersonalWorkspaceError extends Error {
  constructor(public readonly code: string) {
    super(code === "sign_in_method_unrecognized" ? "Finish account setup before opening your personal workspace." : "The personal workspace request could not be completed.");
  }
}

export type PersonalWorkspaceClient = {
  snapshot(session: AuthSession, signal: AbortSignal): Promise<WorkspaceView>;
  command(session: AuthSession, input: WorkspaceCommand, signal: AbortSignal): Promise<unknown>;
  listAgents(session: AuthSession, signal: AbortSignal): Promise<PersonalAgentGrant[]>;
  revokeAgent(session: AuthSession, id: string, signal: AbortSignal): Promise<void>;
};

export function createPersonalWorkspaceClient(): PersonalWorkspaceClient {
  async function request(session: AuthSession, signal: AbortSignal, input?: WorkspaceCommand, path = input ? "commands" : "snapshot", method = input ? "POST" : "GET") {
    signal.throwIfAborted();
    const token = await session.getIdToken();
    // A deferred token must never start a request after this identity's lease ends.
    signal.throwIfAborted();
    const response = await fetch(`/api/v1/workspace/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(input ? { "content-type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
      signal,
      cache: "no-store",
    });
    if (response.status === 204) { signal.throwIfAborted(); return undefined; }
    const body = await response.json() as { data?: unknown; error?: { code?: string } };
    signal.throwIfAborted();
    if (!response.ok) throw new PersonalWorkspaceError(body.error?.code === "sign_in_method_unrecognized" ? body.error.code : "request_failed");
    if (!body || !("data" in body)) throw new PersonalWorkspaceError("invalid_response");
    return body.data;
  }
  return {
    snapshot: async (session, signal) => await request(session, signal) as WorkspaceView,
    command: (session, input, signal) => request(session, signal, input),
    listAgents: async (session, signal) => await request(session, signal, undefined, "agent-grants") as PersonalAgentGrant[],
    revokeAgent: async (session, id, signal) => { await request(session, signal, undefined, `agent-grants/${encodeURIComponent(id)}`, "DELETE"); },
  };
}
