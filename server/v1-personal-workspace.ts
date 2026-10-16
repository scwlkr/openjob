import type { FirebaseTokenIdentity } from "./firebase-id-token.ts";
import type { OpenJobUser } from "./v1-identity.ts";
import type { PersonalWorkspaceStore } from "../shared/personal-workspace.ts";
import { isInactiveUserError } from "../db/user-history.ts";
import {
  defaultRequestId, errorResponse, jsonResponse, internalErrorResponse,
  accountDeletionPendingResponse, signInMethodUnrecognizedResponse,
  isRateLimitError, rateLimitedErrorResponse,
} from "./v1-http.ts";

type Options = {
  workspace: PersonalWorkspaceStore;
  users: { resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null> };
  verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null>;
  requestId?: () => string;
};
const COMMAND_FIELDS: Record<string, string[]> = {
  "task.create": ["type", "title"], "task.update": ["type", "taskId", "title"],
  "task.complete": ["type", "taskId", "completed"], "task.unschedule": ["type", "taskId"],
  "task.delete": ["type", "taskId"], "task.schedule": ["type", "taskId", "calendarId", "start", "end"],
  "calendar.create": ["type", "calendarId", "title", "start", "end"],
  "calendar.update": ["type", "eventId", "title", "start", "end"], "calendar.delete": ["type", "eventId"],
};

export function createV1PersonalWorkspaceApi({ workspace, users, verifyIdToken, requestId = defaultRequestId }: Options) {
  const fail = (code: string, message: string, status: number) => errorResponse(requestId, { code, message, status });
  return Object.freeze({
    async fetch(request: Request): Promise<Response> {
      try {
        // Existing group-agent credentials do not grant personal workspace access.
        if (/^Bearer\s+oj_agent_/i.test(request.headers.get("authorization") || "")) {
          return fail("authentication_required", "Authenticate with a human Firebase identity. Agent access is not available for this endpoint.", 401);
        }
        const identity = await verifyIdToken(request);
        if (!identity) return fail("authentication_required", "Authentication is required.", 401);
        const user = await users.resolve(identity);
        if (!user) return signInMethodUnrecognizedResponse(requestId);
        if (user.deletionPending) return accountDeletionPendingResponse(requestId);
        const url = new URL(request.url);
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin) return fail("origin_denied", "Cross-origin workspace requests are denied.", 403);
        let data: unknown;
        if (url.pathname === "/api/v1/workspace/snapshot" && request.method === "GET") {
          data = await workspace.snapshot(user.userId);
        } else if (url.pathname === "/api/v1/workspace/commands" && request.method === "POST") {
          if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
            return fail("invalid_content_type", "Commands require application/json.", 415);
          }
          const reader = request.body?.getReader();
          if (!reader) return fail("invalid_request", "A JSON command is required.", 400);
          const chunks: Uint8Array[] = [];
          let length = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 32 * 1024) {
              await reader.cancel();
              return fail("body_too_large", "Commands cannot exceed 32 KiB.", 413);
            }
            chunks.push(value);
          }
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          let input: unknown;
          try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
          catch { return fail("invalid_request", "A valid UTF-8 JSON command is required.", 400); }
          if (!input || typeof input !== "object" || Array.isArray(input) || !("type" in input) || typeof input.type !== "string") return fail("invalid_request", "A command object with a type is required.", 400);
          if (!Object.hasOwn(COMMAND_FIELDS, input.type)) return fail("forbidden", "Only personal Tasks and Calendar commands are available.", 403);
          const fields = Object.keys(input);
          const allowed = COMMAND_FIELDS[input.type];
          if (fields.length !== allowed.length || fields.some(field => !allowed.includes(field))) return fail("invalid_request", "The command contains missing or unknown fields.", 400);
          // Owner identity is resolved above; neither request bodies nor fixture headers select it.
          data = await workspace.command(user.userId, input);
        } else return fail("not_found", "The requested resource was not found.", 404);
        const current = await users.resolve(identity);
        if (!current || current.userId !== user.userId || current.deletionPending) return accountDeletionPendingResponse(requestId);
        return jsonResponse({ data });
      } catch (error) {
        if (isInactiveUserError(error)) return accountDeletionPendingResponse(requestId);
        if (isRateLimitError(error)) return rateLimitedErrorResponse(requestId);
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code === "invalid_input") return fail(code, "One or more command fields are invalid.", 400);
        if (code === "forbidden") return fail(code, "The personal workspace resource is unavailable.", 403);
        if (code === "workspace_capacity") return fail(code, "Personal workspace capacity was exceeded.", 413);
        if (code === "conflict") return fail(code, "The workspace changed. Reload before retrying.", 409);
        return internalErrorResponse(requestId);
      }
    },
  });
}

export function createV1PersonalWorkspaceHandler(getApi: () => ReturnType<typeof createV1PersonalWorkspaceApi>, requestId = defaultRequestId) {
  return async function handleV1PersonalWorkspaceRequest(request: Request) {
    try { return await getApi().fetch(request); }
    catch { return internalErrorResponse(requestId); }
  };
}
