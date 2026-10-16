import type { FirebaseTokenIdentity } from "./firebase-id-token.ts";
import type { OpenJobUser } from "./v1-identity.ts";
import { createProviderWorkspacePreview } from "./provider-workspace-preview.ts";
import type { ProviderPreview } from "../shared/provider-contracts.ts";
import type { ProviderConnectionReader } from "./providers/provider-connections.ts";
import { describeOutlookReadAdapter } from "./providers/outlook-read-adapter.ts";
import { describeGmailReadAdapter } from "./providers/gmail-read-adapter.ts";
import { isInactiveUserError } from "../db/user-history.ts";
import {
  defaultRequestId, errorResponse, jsonResponse, internalErrorResponse,
  accountDeletionPendingResponse, signInMethodUnrecognizedResponse,
  isRateLimitError, rateLimitedErrorResponse,
} from "./v1-http.ts";

type Options = {
  users: { resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null> };
  verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null>;
  preview?: (ownerUserId: string, input: { accountId?: string; cursor?: string }) => Promise<ProviderPreview>;
  connections?: ProviderConnectionReader;
  requestId?: () => string;
};

export function createV1ProviderPreviewApi({ users, verifyIdToken, connections, preview = createProviderWorkspacePreview({ connections }), requestId = defaultRequestId }: Options) {
  const fail = (code: string, message: string, status: number) => errorResponse(requestId, { code, message, status });
  return Object.freeze({
    async fetch(request: Request): Promise<Response> {
      try {
        if (/^Bearer\s+oj_/i.test(request.headers.get("authorization") || "")) return fail("authentication_required", "A human Firebase identity is required for provider previews.", 401);
        const identity = await verifyIdToken(request);
        if (!identity) return fail("authentication_required", "Authentication is required.", 401);
        const user = await users.resolve(identity);
        if (!user) return signInMethodUnrecognizedResponse(requestId);
        if (user.deletionPending) return accountDeletionPendingResponse(requestId);
        const url = new URL(request.url);
        if (url.pathname !== "/api/v1/workspace/provider-preview" || request.method !== "GET") return fail("not_found", "The requested resource was not found.", 404);
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin) return fail("origin_denied", "Cross-origin provider preview requests are denied.", 403);
        if ([...url.searchParams.keys()].some(key => !["accountId", "cursor"].includes(key))) return fail("invalid_request", "Use only one accountId and cursor query value.", 400);
        const input: { accountId?: string; cursor?: string } = {};
        for (const key of ["accountId", "cursor"] as const) {
          const values = url.searchParams.getAll(key);
          if (values.length > 1 || values.length === 1 && (!values[0] || values[0].length > (key === "accountId" ? 128 : 4096) || (key === "accountId" ? !/^[A-Za-z0-9_-]+$/.test(values[0]) : !/^[\x21-\x7e]+$/.test(values[0])))) return fail("invalid_request", "The provider query is invalid.", 400);
          if (values.length) input[key] = values[0];
        }
        const snapshot = await preview(user.userId, input);
        const data: ProviderPreview = { ...snapshot, connectors: [...describeGmailReadAdapter(), ...describeOutlookReadAdapter()] };
        const current = await users.resolve(identity);
        if (!current || current.userId !== user.userId || current.deletionPending) return accountDeletionPendingResponse(requestId);
        return jsonResponse({ data });
      } catch (error) {
        if (isInactiveUserError(error)) return accountDeletionPendingResponse(requestId);
        if (isRateLimitError(error)) return rateLimitedErrorResponse(requestId);
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code === "invalid_input" || code === "invalid_cursor") return fail("invalid_request", "The provider preview request is invalid.", 400);
        if (code === "forbidden" || code === "not_found") return fail("forbidden", "The provider preview resource is unavailable.", 403);
        if (code === "rate_limited") return rateLimitedErrorResponse(requestId);
        if (["provider_unavailable", "authentication_required", "consent_required", "execution_disabled", "connection_changed", "provider_forbidden", "provider_error", "network_error", "timeout", "malformed_response", "unsupported_operation"].includes(String(code))) return fail("provider_unavailable", "This provider preview is unavailable. Review its connection and consent status.", 409);
        return internalErrorResponse(requestId);
      }
    },
  });
}

export function createV1ProviderPreviewHandler(getApi: () => ReturnType<typeof createV1ProviderPreviewApi>, requestId = defaultRequestId) {
  return async function handleV1ProviderPreviewRequest(request: Request) {
    try { return await getApi().fetch(request); }
    catch { return internalErrorResponse(requestId); }
  };
}
