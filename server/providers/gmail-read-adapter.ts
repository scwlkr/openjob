import type { ProviderAccount, ProviderConnectorStatus, ProviderReadAdapter, ProviderMessage } from "../../shared/provider-contracts.ts";
import { fail, object, string, upstream, mapLabels, mapMessage } from "./gmail-wire.ts";
import { gmailGet } from "./gmail-transport.ts";
export { GmailReadError } from "./gmail-wire.ts";

export type GmailAccountBinding = { ownerId: string; accountId: string; subject: string; address: string; label: string };
export type GmailReadCredential = { accessToken: string; subject: string; scopes: string[]; expiresAt: number };
export type GmailReadAdapterOptions = {
  bindings: GmailAccountBinding[];
  resolveCredential(binding: GmailAccountBinding): Promise<GmailReadCredential | null>;
  approveExecution?(binding: GmailAccountBinding): boolean | Promise<boolean>;
  fetchImplementation?: typeof fetch; now?: () => number; timeoutMs?: number;
};
const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const email = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const opaque = (value: unknown): value is string => typeof value === "string" && !!value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

export function describeGmailReadAdapter(): ProviderConnectorStatus[] {
  return [{ provider: "gmail", adapter: "gmail-rest-read", status: "not_connected", consent: "required", liveExecutionEnabled: false,
    implementedOperations: ["mail.read", "mail.labels"], unsupportedOperations: ["calendar.read", "calendar.write", "mail.draft", "mail.send", "sync.history", "reconnect"],
    message: "Gmail read mapping is implemented with synthetic HTTP evidence. No live account is connected. No production connection repository, secure token vault or OAuth callback is configured. Explicit consent for Mail reads and reviewed server wiring are required; runtime execution remains disabled.",
  }];
}
function account(binding: GmailAccountBinding): ProviderAccount {
  const unavailable = { available: false, reason: "This Gmail adapter has no implementation for this operation." };
  return { id: binding.accountId, upstreamId: binding.subject, provider: "gmail", label: binding.label, address: binding.address, mode: "provider", status: "not_connected", statusReason: "Server binding metadata only. No live connection or sync has been verified.",
    capabilities: { mailRead: { available: true, reason: "Read mapping requires server-approved execution, an owned binding and Gmail readonly consent." }, calendarRead: { ...unavailable }, draft: { ...unavailable }, send: { ...unavailable }, calendarWrite: { ...unavailable }, reconnect: { ...unavailable } }, sync: { state: "blocked", asOf: null, reason: "No synchronization has been performed; Gmail history is unsupported." },
  };
}
type PageCursor = { version: 1; mode: "gmail-read-page"; owner: string; account: string; subject: string; pageToken: string };
function encode(cursor: PageCursor) {
  const encoded = `gm1.${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
  if (encoded.length > 4096) fail("malformed_response"); return encoded;
}
function pageToken(value: string | undefined, binding: GmailAccountBinding) {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== "string" || value.length > 4096 || !/^gm1\.[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value.slice(4).replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0)))) as PageCursor;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "account,mode,owner,pageToken,subject,version" || encode(parsed) !== value || parsed.version !== 1 || parsed.mode !== "gmail-read-page" || parsed.owner !== binding.ownerId || parsed.account !== binding.accountId || parsed.subject !== binding.subject || !opaque(parsed.pageToken)) throw new Error();
    return parsed.pageToken;
  } catch { return fail("invalid_cursor"); }
}

/** Unbound by runtime. Approval is closed by default, before credential lookup or HTTP. */
export function createGmailReadAdapter(options: GmailReadAdapterOptions): ProviderReadAdapter & { getMessage(input: { ownerId: string; accountId: string; messageId: string }): Promise<ProviderMessage> } {
  const { resolveCredential, approveExecution = () => false, fetchImplementation = fetch, now = Date.now, timeoutMs = 10000 } = options;
  if (!Array.isArray(options.bindings) || options.bindings.length > 100 || typeof resolveCredential !== "function" || typeof approveExecution !== "function" || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail("invalid_input");
  const bindings = structuredClone(options.bindings); const seen = new Set<string>(); const subjects = new Set<string>();
  for (const binding of bindings) {
    if (!binding || !id(binding.ownerId) || !id(binding.accountId) || !opaque(binding.subject) || !email(binding.address) || !opaque(binding.label) || seen.has(binding.accountId) || subjects.has(`${binding.ownerId}:${binding.subject}`)) fail("invalid_input");
    seen.add(binding.accountId); subjects.add(`${binding.ownerId}:${binding.subject}`);
  }
  const select = (ownerId: string, accountId: string) => { if (!id(ownerId) || !id(accountId)) fail("invalid_input"); const found = bindings.find(binding => binding.ownerId === ownerId && binding.accountId === accountId); if (!found) fail("forbidden"); return found; };
  async function approved(binding: GmailAccountBinding) { let allowed = false; try { allowed = await approveExecution(structuredClone(binding)); } catch { fail("execution_disabled"); } if (allowed !== true) fail("execution_disabled"); }
  function consent(binding: GmailAccountBinding, credential: GmailReadCredential | null): asserts credential is GmailReadCredential {
    if (!credential || !opaque(credential.subject) || credential.subject !== binding.subject || typeof credential.accessToken !== "string" || !/^[A-Za-z0-9._~+\/-]{1,8192}={0,2}$/.test(credential.accessToken) || !Number.isFinite(credential.expiresAt) || credential.expiresAt <= now()) fail("authentication_required");
    if (!Array.isArray(credential.scopes) || credential.scopes.length > 100 || !credential.scopes.includes(READ_SCOPE)) fail("consent_required");
  }
  async function client(binding: GmailAccountBinding) {
    await approved(binding);
    let credential: GmailReadCredential | null;
    try { credential = structuredClone(await resolveCredential(structuredClone(binding))); } catch { return fail('authentication_required'); }
    consent(binding, credential);
    const check = async () => { await approved(binding); consent(binding, credential); };
    const get = async (path: string, query = new URLSearchParams()) => { await check(); return gmailGet(path, query, credential.accessToken, fetchImplementation, timeoutMs); };
    const profile = await get('profile');
    if (!email(profile.emailAddress) || profile.emailAddress.toLowerCase() !== binding.address.toLowerCase()) fail('authentication_required');
    return { get, check };
  }
  return {
    async listAccounts(ownerId) { if (!id(ownerId)) fail("invalid_input"); return bindings.filter(binding => binding.ownerId === ownerId).map(account); },
    async listMessages({ ownerId, accountId, cursor }) {
      const binding = select(ownerId, accountId); const token = pageToken(cursor, binding);
      const { get, check } = await client(binding);
      const folders = mapLabels(await get("labels"), accountId); const labelIds = new Set(folders.map(folder => folder.upstreamId));
      const query = new URLSearchParams({ maxResults: "10" }); if (token !== undefined) query.set("pageToken", token);
      const page = await get("messages", query); const raw = page.messages ?? [];
      if (!Array.isArray(raw) || raw.length > 10) fail("malformed_response");
      if (page.nextPageToken !== undefined && (!opaque(page.nextPageToken) || page.nextPageToken === token)) fail("malformed_response");
      const seenMessages = new Set<string>(); const rows = raw.map(value => { const row = object(value); const messageId = upstream(row.id); const threadId = upstream(row.threadId); if (seenMessages.has(messageId)) fail("malformed_response"); seenMessages.add(messageId); return { messageId, threadId }; });
      const messages = [];
      for (const row of rows) messages.push(mapMessage(await get(`messages/${row.messageId}`, new URLSearchParams({ format: "full" })), accountId, row.messageId, row.threadId, labelIds));
      // Recheck after all async reads before returning potentially private content.
      await check();
      return { messages, folders, calendars: [], events: [], syncCursor: null, nextCursor: page.nextPageToken === undefined ? null : encode({ version: 1, mode: "gmail-read-page", owner: ownerId, account: accountId, subject: binding.subject, pageToken: string(page.nextPageToken, 256) }) };
    },
    async getMessage({ ownerId, accountId, messageId }) {
      const binding = select(ownerId, accountId); upstream(messageId);
      const { get, check } = await client(binding);
      const folders = mapLabels(await get('labels'), accountId);
      const raw = await get(`messages/${messageId}`, new URLSearchParams({ format: 'full' }));
      const message = mapMessage(raw, accountId, messageId, upstream(raw.threadId), new Set(folders.map(folder => folder.upstreamId)));
      await check(); return message;
    },
    async readChanges() { return fail("unsupported_operation"); },
  };
}
