import type { ProviderFolder, ProviderMessage } from "../../shared/provider-contracts.ts";
import { createProviderResourceRef as ref } from "../../shared/provider-preview.ts";

export type GmailReadErrorCode = "execution_disabled" | "authentication_required" | "consent_required" | "provider_forbidden" | "rate_limited" | "provider_error" | "network_error" | "malformed_response" | "unsupported_operation" | "invalid_cursor" | "forbidden" | "invalid_input" | "timeout";
export class GmailReadError extends Error {
  readonly code: GmailReadErrorCode;
  constructor(code: GmailReadErrorCode) { super(`Gmail read adapter: ${code.replaceAll("_", " ")}.`); this.name = "GmailReadError"; this.code = code; }
}
export function fail(code: GmailReadErrorCode): never { throw new GmailReadError(code); }
export function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail("malformed_response"); return value as Record<string, unknown>; }
export function string(value: unknown, limit = 4096): string { if (typeof value !== "string" || !value || value.length > limit || /[\u0000\u007f]/.test(value)) fail("malformed_response"); return value; }
export function upstream(value: unknown): string { const id = string(value, 128); if (!/^[A-Za-z0-9_-]+$/.test(id)) fail("malformed_response"); return id; }
export function uniqueStrings(value: unknown, maximum = 500): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail("malformed_response");
  const result = value.map(upstream); if (new Set(result).size !== result.length) fail("malformed_response"); return result;
}
function headers(part: Record<string, unknown>) {
  const raw = part.headers ?? []; if (!Array.isArray(raw) || raw.length > 100) fail("malformed_response");
  const result = new Map<string, string>();
  for (const item of raw) {
    const row = object(item); const name = string(row.name, 128).toLowerCase(); const value = typeof row.value === "string" && row.value.length <= 4096 && !/[\u0000\r\n\u007f]/.test(row.value) ? row.value : fail("malformed_response");
    if (["subject", "from", "to", "content-type", "content-disposition"].includes(name)) { if (result.has(name)) fail("malformed_response"); result.set(name, value); }
  }
  return result;
}
function decodeBody(value: unknown) {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > 90_000 || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) fail("malformed_response");
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    if (binary.length > 65536) fail("malformed_response");
    const canonical = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    if (canonical !== value.replace(/=+$/, "")) fail("malformed_response");
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
  } catch { return fail("malformed_response"); }
}
function plainText(payload: unknown) {
  let count = 0; let bytes = 0; const texts: string[] = [];
  function walk(value: unknown, depth: number) {
    if (++count > 100 || depth > 10) fail("malformed_response");
    const part = object(value); const mime = string(part.mimeType, 128).toLowerCase(); const meta = headers(part);
    if (part.filename !== undefined && typeof part.filename !== "string") fail("malformed_response");
    if (part.filename || /^attachment(?:;|$)/i.test(meta.get("content-disposition") ?? "")) return;
    if (mime === "text/plain") {
      const type = meta.get("content-type") ?? ""; const charset = /charset\s*=\s*"?([^\s;\"]+)/i.exec(type)?.[1];
      if (charset && !/^utf-?8$/i.test(charset) && !/^us-ascii$/i.test(charset)) fail("unsupported_operation");
      const body = object(part.body ?? {}); if (body.attachmentId !== undefined) return;
      const decoded = decodeBody(body.data); bytes += new TextEncoder().encode(decoded).length; if (bytes > 65536) fail("malformed_response"); texts.push(decoded);
    }
    if (part.parts !== undefined) {
      if (!Array.isArray(part.parts) || part.parts.length > 100) fail("malformed_response");
      for (const child of part.parts) walk(child, depth + 1);
    }
  }
  walk(payload, 0); return texts.length ? texts.join("\n") : "[Plain-text content unavailable; HTML and attachments are not loaded.]";
}
export function mapLabels(value: unknown, accountId: string): ProviderFolder[] {
  const raw = object(value).labels ?? []; if (!Array.isArray(raw) || raw.length > 500) fail("malformed_response");
  const seen = new Set<string>();
  return raw.map(item => { const row = object(item); const id = upstream(row.id); if (seen.has(id)) fail("malformed_response"); seen.add(id); return { id: ref(accountId, "folder", id), accountId, upstreamId: id, name: string(row.name, 256) }; });
}
export function mapMessage(value: unknown, accountId: string, expectedId: string, expectedThread: string, labels: Set<string>): ProviderMessage {
  const row = object(value); const id = upstream(row.id); const thread = upstream(row.threadId);
  if (id !== expectedId || thread !== expectedThread) fail("malformed_response");
  const labelIds = uniqueStrings(row.labelIds ?? []); if (labelIds.some(label => !labels.has(label))) fail("malformed_response");
  if (typeof row.internalDate !== "string" || !/^\d{1,15}$/.test(row.internalDate) || !Number.isSafeInteger(Number(row.internalDate)) || Number(row.internalDate) > 253402300799999 || !Number.isFinite(new Date(Number(row.internalDate)).getTime())) fail("malformed_response");
  const payload = object(row.payload); const meta = headers(payload);
  return { id: ref(accountId, "message", id), accountId, upstreamId: id, upstreamThreadId: thread, threadId: ref(accountId, "thread", thread), folderIds: labelIds.map(label => ref(accountId, "folder", label)), subject: meta.get("subject") || "(No subject)", from: meta.get("from") || "", to: meta.get("to") || "", body: plainText(payload), receivedAt: new Date(Number(row.internalDate)).toISOString(), read: !labelIds.includes("UNREAD") };
}
