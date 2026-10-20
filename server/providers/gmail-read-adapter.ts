import type { ProviderAccount, ProviderConnectorStatus, ProviderReadAdapter, ProviderMessage, ProviderMessagePage, ProviderMessageSummary, ProviderMessageSummaryPage } from "../../shared/provider-contracts.ts";
import { fail, object, string, upstream, mapLabels, mapMessage, mapMessageSummary, replyHeaders, type GmailReplyHeaders } from "./gmail-wire.ts";
import { parseProviderResourceRef } from "../../shared/provider-preview.ts";
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
    implementedOperations: ["mail.read", "mail.labels", "mail.search"], unsupportedOperations: ["calendar.read", "calendar.write", "mail.draft", "mail.send", "sync.history", "reconnect"],
    message: "Gmail read mapping is implemented with synthetic HTTP evidence. No live account is connected. No production connection repository, secure token vault or OAuth callback is configured. Explicit consent for Mail reads and reviewed server wiring are required; runtime execution remains disabled.",
  }];
}
function account(binding: GmailAccountBinding): ProviderAccount {
  const unavailable = { available: false, reason: "This Gmail adapter has no implementation for this operation." };
  return { id: binding.accountId, upstreamId: binding.subject, provider: "gmail", label: binding.label, address: binding.address, mode: "provider", status: "not_connected", statusReason: "Server binding metadata only. No live connection or sync has been verified.",
    capabilities: { mailRead: { available: true, reason: "Read mapping requires server-approved execution, an owned binding and Gmail readonly consent." }, calendarRead: { ...unavailable }, draft: { ...unavailable }, send: { ...unavailable }, calendarWrite: { ...unavailable }, reconnect: { ...unavailable } }, sync: { state: "blocked", asOf: null, reason: "No synchronization has been performed; Gmail history is unsupported." },
  };
}
type PageCursor = { version: 3; mode: "gmail-read-page"; owner: string; account: string; subject: string; folderId: string | null; searchHash: string | null; pageToken: string };
function encode(cursor: PageCursor) {
  const encoded = `gm3.${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
  if (encoded.length > 4096) fail("malformed_response"); return encoded;
}
function pageToken(value: string | undefined, binding: GmailAccountBinding, folderId: string | null, searchHash: string | null) {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== "string" || value.length > 4096 || !/^gm3\.[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value.slice(4).replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0)))) as PageCursor;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "account,folderId,mode,owner,pageToken,searchHash,subject,version" || encode(parsed) !== value || parsed.version !== 3 || parsed.mode !== "gmail-read-page" || parsed.owner !== binding.ownerId || parsed.account !== binding.accountId || parsed.subject !== binding.subject || parsed.folderId !== folderId || parsed.searchHash !== searchHash || !opaque(parsed.pageToken)) throw new Error();
    return parsed.pageToken;
  } catch { return fail("invalid_cursor"); }
}

/** Unbound by runtime. Approval is closed by default, before credential lookup or HTTP. */
type MessageInput = { ownerId: string; accountId: string; messageId: string };
type ListInput = { ownerId: string; accountId: string; cursor?: string; folderId?: string; search?: string };
function metadataQuery() {
  const query = new URLSearchParams({ format: 'metadata' });
  for (const name of ['Subject', 'From', 'To']) query.append('metadataHeaders', name);
  return query;
}
export function createGmailReadAdapter(options: GmailReadAdapterOptions): Omit<ProviderReadAdapter, "listMessages"> & { listMessages(input: ListInput): Promise<ProviderMessagePage>; listMessageSummaries(input: ListInput): Promise<ProviderMessageSummaryPage>; getMessageSummary(input: MessageInput): Promise<ProviderMessageSummary>; getMessage(input: MessageInput): Promise<ProviderMessage>; getReplySource(input: MessageInput): Promise<{ message: ProviderMessage; headers: GmailReplyHeaders }> } {
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
  async function readMessage({ ownerId, accountId, messageId }: MessageInput) {
    const binding = select(ownerId, accountId); upstream(messageId);
    const { get, check } = await client(binding);
    const folders = mapLabels(await get('labels'), accountId);
    const raw = await get(`messages/${messageId}`, new URLSearchParams({ format: 'full' }));
    const message = mapMessage(raw, accountId, messageId, upstream(raw.threadId), new Set(folders.map(folder => folder.upstreamId)));
    await check(); return { raw, message };
  }
  async function listPage<T extends ProviderMessageSummary>({ ownerId, accountId, cursor, folderId, search }: ListInput, map: (value: unknown, account: string, id: string, thread: string, labels: Set<string>) => T, metadata: boolean) {
    const binding = select(ownerId, accountId);
    let label: string | undefined;
    if (folderId !== undefined) {
      try { label = parseProviderResourceRef(folderId, accountId, 'folder').upstreamId; } catch { fail('invalid_input'); }
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(label!)) fail('invalid_input');
    }
    if (search !== undefined && (typeof search !== 'string' || search.length > 512 || !search.trim() || /[\u0000-\u001f\u007f]/.test(search))) fail('invalid_input');
    const queryText = search?.trim() ?? '';
    const searchHash = queryText ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(queryText))), byte => byte.toString(16).padStart(2, '0')).join('') : null;
    const token = pageToken(cursor, binding, folderId ?? null, searchHash);
    const { get, check } = await client(binding);
    const folders = mapLabels(await get("labels"), accountId); const labelIds = new Set(folders.map(folder => folder.upstreamId));
    if (label !== undefined && !labelIds.has(label)) fail('folder_unavailable');
    const query = new URLSearchParams({ maxResults: "10" });
    if (label !== undefined) query.set('labelIds', label);
    if (queryText) query.set('q', queryText);
    if (label === 'SPAM' || label === 'TRASH') query.set('includeSpamTrash', 'true');
    if (token !== undefined) query.set("pageToken", token);
    const page = await get("messages", query); const raw = page.messages ?? [];
    if (!Array.isArray(raw) || raw.length > 10) fail("malformed_response");
    if (page.nextPageToken !== undefined && (!opaque(page.nextPageToken) || page.nextPageToken === token)) fail("malformed_response");
    const seenMessages = new Set<string>(); const rows = raw.map(value => { const row = object(value); const messageId = upstream(row.id); const threadId = upstream(row.threadId); if (seenMessages.has(messageId)) fail("malformed_response"); seenMessages.add(messageId); return { messageId, threadId }; });
    const messages = [];
    for (const row of rows) {
      const message = map(await get(`messages/${row.messageId}`, metadata ? metadataQuery() : new URLSearchParams({ format: "full" })), accountId, row.messageId, row.threadId, labelIds);
      if (label !== 'SPAM' && label !== 'TRASH' && ['SPAM', 'TRASH'].some(excluded => message.folderIds.includes(`${accountId}:folder:${excluded}`))) continue;
      if (folderId !== undefined && !message.folderIds.includes(folderId)) continue; // Label removed after listing: never show another folder's content.
      messages.push(message);
    }
    // Recheck after all async reads before returning potentially private content.
    await check();
    return { messages, folders, calendars: [], events: [], syncCursor: null, nextCursor: page.nextPageToken === undefined ? null : encode({ version: 3, mode: "gmail-read-page", owner: ownerId, account: accountId, subject: binding.subject, folderId: folderId ?? null, searchHash, pageToken: string(page.nextPageToken, 256) }) };
  }
  return {
    async listAccounts(ownerId) { if (!id(ownerId)) fail("invalid_input"); return bindings.filter(binding => binding.ownerId === ownerId).map(account); },
    listMessages: input => listPage(input, mapMessage, false),
    listMessageSummaries: input => listPage(input, mapMessageSummary, true),
    async getMessageSummary({ ownerId, accountId, messageId }) {
      const binding = select(ownerId, accountId); upstream(messageId);
      const { get, check } = await client(binding);
      const folders = mapLabels(await get('labels'), accountId);
      const raw = await get(`messages/${messageId}`, metadataQuery());
      const message = mapMessageSummary(raw, accountId, messageId, upstream(raw.threadId), new Set(folders.map(folder => folder.upstreamId)));
      await check(); return message;
    },
    async getMessage(input) { return (await readMessage(input)).message; },
    async getReplySource(input) { const { message, raw } = await readMessage(input); return { message, headers: replyHeaders(raw) }; },
    async readChanges() { return fail("unsupported_operation"); },
  };
}
