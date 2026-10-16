import type { WorkspaceActor, WorkspaceEngine } from "../shared/workspace-contracts.ts";

const MAX_BODY = 32 * 1024;
export function isWorkspaceLoopback(url: URL) {
  return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-openjob-mode": "fixture" } });
}
function fail(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status);
}

/** Deliberately simulated identities, available only in an explicitly enabled loopback fixture. */
export function createWorkspaceApi({ engine, enabled = false }: { engine: WorkspaceEngine; enabled?: boolean }) {
  return async function handle(request: Request): Promise<Response> {
    if (!enabled) return fail("fixture_disabled", "The workspace fixture is disabled.", 503);
    const url = new URL(request.url);
    if (!isWorkspaceLoopback(url)) return fail("fixture_loopback_only", "Workspace fixtures require loopback access.", 403);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return fail("origin_denied", "Cross-origin fixture requests are denied.", 403);
    const ownerId = request.headers.get("x-openjob-fixture-owner");
    const agentId = request.headers.get("x-openjob-fixture-agent");
    if (!ownerId || !/^demo_[a-z]+$/.test(ownerId)) return fail("fixture_identity_required", "Supply an explicit fixture owner identity.", 401);
    if (agentId !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(agentId)) return fail("invalid_agent", "Invalid fixture agent identity.", 400);
    const actor: WorkspaceActor = agentId ? { kind: "agent", ownerId, agentId } : { kind: "human", ownerId };
    try {
      if (url.pathname === "/api/workspace/snapshot" && request.method === "GET") return json({ data: engine.snapshot(actor) });
      if (url.pathname !== "/api/workspace/commands") return fail("not_found", "Unknown workspace fixture route.", 404);
      if (request.method !== "POST") return fail("method_not_allowed", "Use POST for workspace commands.", 405);
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return fail("invalid_content_type", "Commands require application/json.", 415);
      const reader = request.body?.getReader();
      if (!reader) return fail("invalid_json", "A JSON command is required.", 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BODY) { await reader.cancel(); return fail("body_too_large", "Command exceeds 32 KiB.", 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let input: unknown;
      try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { return fail("invalid_json", "A valid JSON command is required.", 400); }
      return json({ data: engine.command(actor, input) });
    } catch (error) {
      const known = error as { status?: unknown; code?: unknown; message?: unknown };
      const statuses: Record<string, number> = { unauthorized: 401, forbidden: 403, invalid_input: 400, sending_disabled: 403 };
      if (typeof known.code === "string" && statuses[known.code]) {
        return fail(known.code, typeof known.message === "string" ? known.message : "Command denied.", statuses[known.code]);
      }
      return fail("internal_error", "Workspace fixture request failed.", 500);
    }
  };
}
