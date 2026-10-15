import type { FirebaseTokenIdentity } from "./firebase-id-token.ts";
import type { OpenJobUser } from "./v1-identity.ts";
import { isGroupId } from "./v1-groups.ts";
import { accountDeletionPendingResponse, defaultRequestId, errorResponse, internalErrorResponse, isRateLimitError, jsonResponse, rateLimitedErrorResponse, signInMethodUnrecognizedResponse } from "./v1-http.ts";
import { isInactiveUserError } from "../db/user-history.ts";
import { AGENT_ID, AGENT_LIFETIME_MS, AGENT_TOKEN, agentTokenHash, newAgentSecret, type AgentGrantStore, type AgentGrant } from "./agent-grants.ts";

type Options = {
  grants: AgentGrantStore;
  users: { resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null> };
  verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null>;
  now?: () => number;
  agentId?: () => string;
  secret?: () => string;
  requestId?: () => string;
};

export function createV1AgentGrantsApi({ grants, users, verifyIdToken, now = Date.now,
  agentId = () => `agt_${crypto.randomUUID().replaceAll("-", "")}`, secret = newAgentSecret,
  requestId = defaultRequestId }: Options) {
  const notFound = () => errorResponse(requestId, { code: "not_found", message: "The requested resource was not found.", status: 404 });
  return Object.freeze({
    async fetch(request: Request) {
      try {
        const identity = await verifyIdToken(request);
        if (!identity) return errorResponse(requestId, { code: "authentication_required", message: "Authentication is required.", status: 401 });
        const user = await users.resolve(identity);
        if (!user) return signInMethodUnrecognizedResponse(requestId);
        if (user.deletionPending) return accountDeletionPendingResponse(requestId);
        const pathname = new URL(request.url).pathname;
        if (pathname === "/api/v1/agent-grants" && request.method === "GET") {
          const data = await grants.list(user.userId);
          const current = await users.resolve(identity);
          if (!current || current.userId !== user.userId || current.deletionPending) return accountDeletionPendingResponse(requestId);
          return jsonResponse({ data });
        }
        if (pathname === "/api/v1/agent-grants" && request.method === "POST") {
          const input = await request.json().catch(() => null) as { groupId?: unknown; name?: unknown } | null;
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== "groupId,name" ||
            typeof input.groupId !== "string" || !isGroupId(input.groupId) || typeof input.name !== "string" ||
            input.name.trim().length < 1 || [...input.name.trim()].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(input.name)) {
            return errorResponse(requestId, { code: "invalid_request", message: "Send a Group ID and 1–80 character plain-text agent name.", status: 400 });
          }
          const id = agentId();
          const token = `oj_agent_${id}.${secret()}`;
          if (!AGENT_ID.test(id) || !AGENT_TOKEN.test(token)) throw new Error("Invalid generated agent credential.");
          const grant: AgentGrant = { agentId: id, ownerUserId: user.userId, groupId: input.groupId,
            name: input.name.trim(), scope: "tasks:read", createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + AGENT_LIFETIME_MS).toISOString() };
          if (!(await grants.create(grant, await agentTokenHash(token)))) return notFound();
          return jsonResponse({ data: { agent: grant, token } }, 201);
        }
        const id = pathname.match(/^\/api\/v1\/agent-grants\/(agt_[a-f0-9]{32})$/)?.[1];
        if (id && request.method === "DELETE") {
          return await grants.revoke(user.userId, id)
            ? new Response(null, { status: 204, headers: { "cache-control": "no-store" } }) : notFound();
        }
        return notFound();
      } catch (error) {
        if (isInactiveUserError(error)) return accountDeletionPendingResponse(requestId);
        if (isRateLimitError(error)) return rateLimitedErrorResponse(requestId);
        return internalErrorResponse(requestId);
      }
    },
  });
}
