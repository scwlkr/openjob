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
};

export function createPersonalWorkspaceClient(): PersonalWorkspaceClient {
  async function request(session: AuthSession, signal: AbortSignal, input?: WorkspaceCommand) {
    signal.throwIfAborted();
    const token = await session.getIdToken();
    // A deferred token must never start a request after this identity's lease ends.
    signal.throwIfAborted();
    const response = await fetch(`/api/v1/workspace/${input ? "commands" : "snapshot"}`, {
      method: input ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, ...(input ? { "content-type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
      signal,
      cache: "no-store",
    });
    const body = await response.json() as { data?: unknown; error?: { code?: string } };
    signal.throwIfAborted();
    if (!response.ok) throw new PersonalWorkspaceError(body.error?.code === "sign_in_method_unrecognized" ? body.error.code : "request_failed");
    if (!body || !("data" in body)) throw new PersonalWorkspaceError("invalid_response");
    return body.data;
  }
  return {
    snapshot: async (session, signal) => await request(session, signal) as WorkspaceView,
    command: (session, input, signal) => request(session, signal, input),
  };
}
