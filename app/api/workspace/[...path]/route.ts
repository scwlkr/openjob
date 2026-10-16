declare const __OPENJOB_WORKSPACE_FIXTURE__: boolean;

async function proxy(request: Request) {
  if (typeof __OPENJOB_WORKSPACE_FIXTURE__ === "undefined" || !__OPENJOB_WORKSPACE_FIXTURE__) {
    return Response.json({ error: { code: "fixture_disabled", message: "Workspace fixture disabled." } }, { status: 503 });
  }
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    return Response.json({ error: { code: "fixture_loopback_only", message: "Loopback fixture access required." } }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return Response.json({ error: { code: "origin_denied", message: "Cross-origin fixture requests denied." } }, { status: 403 });
  if (!["/api/workspace/snapshot", "/api/workspace/commands"].includes(url.pathname)) return new Response(null, { status: 404 });
  const headers = new Headers();
  for (const name of ["x-openjob-fixture-owner", "x-openjob-fixture-agent", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let body: Uint8Array | undefined;
  if (request.method === "POST") {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 32 * 1024) {
        await reader.cancel();
        return Response.json({ error: { code: "body_too_large", message: "Command exceeds 32 KiB." } }, { status: 413 });
      }
      chunks.push(next.value);
    }
    body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  }
  // Fixed destination only: the persistent local fixture service, never a provider URL.
  try {
    const response = await fetch(`http://127.0.0.1:4180${url.pathname}`, {
      method: request.method, headers, body: body as BodyInit | undefined,
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    // Fetch responses have immutable headers; the app runtime appends Vary.
    return new Response(response.body, { status: response.status, headers: new Headers(response.headers) });
  } catch {
    return Response.json({ error: { code: "fixture_unavailable", message: "Start the local workspace fixture service." } }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;
