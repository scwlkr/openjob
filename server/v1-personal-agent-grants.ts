import type { FirebaseTokenIdentity } from "./firebase-id-token.ts";
import type { OpenJobUser } from "./v1-identity.ts";
import type { PersonalWorkspaceStore } from "../shared/personal-workspace.ts";
import { PERSONAL_AGENT_ID, PERSONAL_AGENT_TOKEN, validatePersonalAgentInput, type PersonalAgentGrant } from "../shared/personal-agent-grants.ts";
import { isInactiveUserError } from "../db/user-history.ts";
import { defaultRequestId, errorResponse, jsonResponse, internalErrorResponse, accountDeletionPendingResponse, signInMethodUnrecognizedResponse, isRateLimitError, rateLimitedErrorResponse } from "./v1-http.ts";

type Options = {
  workspace: Pick<PersonalWorkspaceStore, "createAgent" | "listAgents" | "revokeAgent">;
  users: { resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null> };
  verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null>;
  requestId?: () => string;
};

function publicGrant(agent: PersonalAgentGrant, owner: string) {
  if (agent.ownerUserId !== owner) throw new Error("Invalid grant owner");
  const { id, ownerUserId, name, scopes, resourceIds, createdAt, expiresAt, revoked } = agent;
  return { id, ownerUserId, name, scopes: [...scopes], resourceIds: [...resourceIds], createdAt, expiresAt, revoked };
}

export function createV1PersonalAgentGrantsApi({ workspace, users, verifyIdToken, requestId = defaultRequestId }: Options) {
  const fail = (code: string, message: string, status: number) => errorResponse(requestId, { code, message, status });
  return Object.freeze({
    async fetch(request: Request): Promise<Response> {
      try {
        if (/^Bearer\s+oj_(?:agent_|personal_)/i.test(request.headers.get("authorization") || "")) return fail("authentication_required", "A human Firebase identity is required to manage personal agents.", 401);
        const identity = await verifyIdToken(request);
        if (!identity) return fail("authentication_required", "Authentication is required.", 401);
        const user = await users.resolve(identity);
        if (!user) return signInMethodUnrecognizedResponse(requestId);
        if (user.deletionPending) return accountDeletionPendingResponse(requestId);
        const url = new URL(request.url);
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin) return fail("origin_denied", "Cross-origin workspace requests are denied.", 403);
        let data: unknown;
        let status = 200;
        if (url.pathname === "/api/v1/workspace/agent-grants" && request.method === "GET") {
          data = (await workspace.listAgents(user.userId)).map((agent) => publicGrant(agent, user.userId));
        } else if (url.pathname === "/api/v1/workspace/agent-grants" && request.method === "POST") {
          if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return fail("invalid_content_type", "Grant requests require application/json.", 415);
          const reader = request.body?.getReader();
          if (!reader) return fail("invalid_request", "A JSON grant request is required.", 400);
          const chunks: Uint8Array[] = [];
          let length = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 32 * 1024) { await reader.cancel(); return fail("body_too_large", "Grant requests cannot exceed 32 KiB.", 413); }
            chunks.push(value);
          }
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          let input: unknown;
          try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
          catch { return fail("invalid_request", "A valid UTF-8 JSON grant request is required.", 400); }
          const validated = validatePersonalAgentInput(input);
          const created = await workspace.createAgent(user.userId, validated);
          const parsed = PERSONAL_AGENT_TOKEN.exec(created.token);
          if (!parsed || parsed[1] !== user.userId || parsed[2] !== created.agent.id) throw new Error("Invalid generated grant");
          data = { agent: publicGrant(created.agent, user.userId), token: created.token };
          status = 201;
        } else {
          const id = url.pathname.match(/^\/api\/v1\/workspace\/agent-grants\/([^/]+)$/)?.[1];
          if (!id || !PERSONAL_AGENT_ID.test(id) || request.method !== "DELETE") return fail("not_found", "The requested resource was not found.", 404);
          if (!await workspace.revokeAgent(user.userId, id)) return fail("not_found", "The requested resource was not found.", 404);
          status = 204;
        }
        const current = await users.resolve(identity);
        if (!current || current.userId !== user.userId || current.deletionPending) return accountDeletionPendingResponse(requestId);
        return status === 204 ? new Response(null, { status: 204, headers: { "cache-control": "no-store" } }) : jsonResponse({ data }, status);
      } catch (error) {
        if (isInactiveUserError(error)) return accountDeletionPendingResponse(requestId);
        if (isRateLimitError(error)) return rateLimitedErrorResponse(requestId);
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code === "invalid_input") return fail("invalid_request", "Choose a 1–80 character plain-text name and supported personal scopes and resources.", 400);
        if (code === "forbidden") return fail(code, "The personal workspace resource is unavailable.", 403);
        if (code === "workspace_capacity" || code === "agent_capacity") return fail("workspace_capacity", "Personal workspace capacity was exceeded.", 413);
        if (code === "conflict") return fail(code, "The workspace changed. Reload before retrying.", 409);
        return internalErrorResponse(requestId);
      }
    },
  });
}

export function createV1PersonalAgentGrantsHandler(getApi: () => ReturnType<typeof createV1PersonalAgentGrantsApi>, requestId = defaultRequestId) {
  return async (request: Request) => {
    try { return await getApi().fetch(request); }
    catch { return internalErrorResponse(requestId); }
  };
}
