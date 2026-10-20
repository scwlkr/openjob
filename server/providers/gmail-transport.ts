import { fail, GmailReadError, object, type GmailReadErrorCode } from "./gmail-wire.ts";

const MAX_BYTES = 262144;
async function json(response: Response) {
  const length = response.headers.get("content-length"); if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) fail("malformed_response");
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) fail("malformed_response");
  const reader = response.body?.getReader(); if (!reader) fail("malformed_response");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { await reader.cancel(); fail("malformed_response"); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); } catch { return fail("malformed_response"); }
}
/** Fixed-origin GET transport; provider response fields are never interpreted as URLs. */
export async function gmailGet(path: string, query: URLSearchParams, token: string, fetcher: typeof fetch, timeoutMs: number) {
  if (!/^(?:profile|labels|messages(?:\/[A-Za-z0-9_-]{1,128})?)$/.test(path)) fail("invalid_input");
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`); url.search = query.toString();
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = async () => {
    const response = await fetcher(url, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error", cache: "no-store", signal: controller.signal });
    if (response.redirected || response.status >= 300 && response.status < 400) fail("network_error");
    if (response.status === 400 && path === "messages" && query.has("pageToken")) fail("invalid_cursor");
    if (response.status === 400 && path === "messages" && query.has("q")) fail("search_rejected");
    if (response.status === 404 && path.startsWith("messages/")) fail("message_unavailable");
    if (response.status === 401) fail("authentication_required");
    if (response.status === 429) fail("rate_limited");
    if (response.status >= 500) fail("provider_error");
    if (response.status === 403) {
      let code: GmailReadErrorCode = "provider_forbidden";
      try { const payload = await json(response); const error = object(payload.error); const reasons = Array.isArray(error.errors) ? error.errors.map(item => object(item).reason) : [];
        if (reasons.includes("insufficientPermissions")) code = "consent_required";
        if (reasons.some(reason => ["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"].includes(String(reason)))) code = "rate_limited";
      } catch { /* Only fixed error categories leave this boundary. */ }
      fail(code);
    }
    if (!response.ok) fail("provider_error");
    return json(response);
  };
  try { return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new GmailReadError("timeout")); }, timeoutMs); })]); }
  catch (error) { if (error instanceof GmailReadError) throw error; return fail("network_error"); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
