import type { ProviderAccount, ProviderCapability, ProviderChanges, ProviderMessagePage, ProviderPreview, ProviderReadAdapter, ProviderStatus } from "./provider-contracts.ts";

const AS_OF = "2026-10-17T09:00:00.000Z";
const KEYS = ["personal", "studio", "work_reconnect", "work_error", "standards"];
const DISABLED = "This synthetic read adapter cannot perform provider writes or deliver mail.";
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
async function ownerScope(ownerId: string) {
  if (typeof ownerId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) fail("invalid_input", "Invalid preview owner");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerId));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
const capability = (available: boolean, reason: string): ProviderCapability => ({ available, reason });
function accounts(scope: string): ProviderAccount[] {
  const rows: { key: string; provider: ProviderAccount["provider"]; label: string; address: string; status: ProviderStatus; reason: string }[] = [
    { key: KEYS[0], provider: "gmail", label: "Personal Gmail", address: "alex.personal@gmail.example.invalid", status: "ready", reason: "Ready to read invented messages and calendar events. No Gmail connection exists." },
    { key: KEYS[1], provider: "gmail", label: "Studio Gmail", address: "alex.studio@gmail.example.invalid", status: "ready", reason: "A second invented account from the same provider; its resources remain distinct." },
    { key: KEYS[2], provider: "outlook", label: "Work Outlook · reconnect example", address: "alex@work.example.invalid", status: "reconnect_required", reason: "Synthetic reconnect-required example. No real account or OAuth session exists." },
    { key: KEYS[3], provider: "outlook", label: "Archive Outlook · error example", address: "alex@archive.example.invalid", status: "error", reason: "Synthetic adapter error example. No external request was attempted." },
    { key: KEYS[4], provider: "imap", label: "Standards mailbox · adapter unavailable", address: "alex@standards.example.invalid", status: "unsupported", reason: "A standards adapter is not implemented in this preview. This does not describe IMAP provider capabilities." },
  ];
  return rows.map(row => {
    const ready = row.status === "ready";
    const readReason = ready ? "Read-only invented data from the synthetic adapter." : row.reason;
    return { id: `pa_${scope}_${row.key}`, upstreamId: `account_${row.key}`, provider: row.provider, label: row.label, address: row.address, mode: "synthetic", status: row.status, statusReason: row.reason,
      capabilities: { mailRead: capability(ready, readReason), calendarRead: capability(ready, readReason), draft: capability(false, DISABLED), send: capability(false, DISABLED), calendarWrite: capability(false, DISABLED), reconnect: capability(false, "Real account connection and reconnection are not implemented in this preview.") },
      sync: { state: ready ? "synthetic_ready" : "blocked", asOf: AS_OF, reason: ready ? "Deterministic synthetic snapshot, not live synchronization." : row.reason },
    };
  });
}
export type ProviderResourceKind = "message" | "thread" | "folder" | "calendar" | "event";
export function createProviderResourceRef(accountId: string, kind: ProviderResourceKind, upstreamId: string) {
  if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId) || !["message", "thread", "folder", "calendar", "event"].includes(kind) || typeof upstreamId !== "string" || !upstreamId || upstreamId.length > 256 || /[\u0000-\u001f\u007f]/.test(upstreamId)) fail("invalid_input", "Invalid account-qualified provider reference");
  try { return `${accountId}:${kind}:${encodeURIComponent(upstreamId)}`; }
  catch { return fail("invalid_input", "Invalid upstream provider identity"); }
}
export function parseProviderResourceRef(value: string, accountId: string, kind: ProviderResourceKind) {
  const prefix = `${accountId}:${kind}:`;
  if (typeof value !== "string" || !value.startsWith(prefix)) fail("invalid_input", "Provider reference does not match account and resource kind");
  let upstreamId: string;
  try { upstreamId = decodeURIComponent(value.slice(prefix.length)); } catch { return fail("invalid_input", "Malformed provider reference"); }
  if (createProviderResourceRef(accountId, kind, upstreamId) !== value) fail("invalid_input", "Noncanonical provider reference");
  return { accountId, kind, upstreamId };
}
const ref = createProviderResourceRef;
type Cursor = { version: 1; mode: "page" | "delta"; owner: string; account: string; position: number };
function encode(cursor: Cursor) { return `pv1.${btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`; }
function decode(value: string, scope: string, account: string, mode: Cursor["mode"]) {
  let parsed: Cursor;
  try {
    if (typeof value !== "string" || value.length > 512 || !/^pv1\.[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    parsed = JSON.parse(atob(value.slice(4).replaceAll("-", "+").replaceAll("_", "/"))) as Cursor;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "account,mode,owner,position,version" || encode(parsed) !== value || parsed.version !== 1 || parsed.owner !== scope || parsed.account !== account || parsed.mode !== mode || !Number.isInteger(parsed.position) || !(mode === "page" ? parsed.position === 2 : [0, 1].includes(parsed.position))) throw new Error();
  } catch { return fail("invalid_cursor", "The preview cursor is invalid for this owner, account or operation"); }
  return parsed.position;
}
function data(account: ProviderAccount) {
  const accountId = account.id;
  const folders = ["INBOX", "Archive"].map(name => ({ id: ref(accountId, "folder", name), accountId, upstreamId: name, name: name === "INBOX" ? "Inbox" : name }));
  const subjects = ["Launch checklist for Friday", "Design review notes", "Studio booking confirmation"];
  const bodies = ["Could you review the invented launch checklist and reserve half an hour to prepare the demo? This message exists only in the synthetic adapter.", "The fictional team agreed on simpler navigation. This invented design review has never been received from a provider.", "This invented booking is a synthetic preview record. No reservation exists and no message was received."];
  const messages = subjects.map((subject, index) => ({ id: ref(accountId, "message", `msg_${index + 1}`), accountId, upstreamId: `msg_${index + 1}`, upstreamThreadId: index < 2 ? "thread_shared" : "thread_booking", threadId: ref(accountId, "thread", index < 2 ? "thread_shared" : "thread_booking"), folderIds: [folders[0].id], subject, from: index === 0 ? "mia@team.example.invalid" : "noah@work.example.invalid", to: account.address, body: bodies[index], receivedAt: `2026-10-17T0${8 - index}:00:00.000Z`, read: index === 2 }));
  const calendars = [{ id: ref(accountId, "calendar", "primary"), accountId, upstreamId: "primary", name: `${account.label} calendar`, color: "#2454dc" }];
  const events = ["Synthetic planning block", "Synthetic review block"].map((title, index) => ({ id: ref(accountId, "event", `event_${index + 1}`), accountId, upstreamId: `event_${index + 1}`, calendarId: calendars[0].id, title, start: `2026-10-17T1${index}:00:00.000Z`, end: `2026-10-17T1${index}:30:00.000Z` }));
  return { messages, folders, calendars, events };
}
async function selection(ownerId: string, accountId: string) {
  const scope = await ownerScope(ownerId); const account = accounts(scope).find(item => item.id === accountId);
  if (!account) fail("forbidden", "The selected provider preview account is unavailable");
  return { scope, account };
}

/** A deterministic read adapter. It has no credentials, network, mutation or live provider path. */
export function createSyntheticProviderAdapter(): ProviderReadAdapter {
  return {
    async listAccounts(ownerId) { return accounts(await ownerScope(ownerId)); },
    async listMessages({ ownerId, accountId, cursor }): Promise<ProviderMessagePage> {
      const { scope, account } = await selection(ownerId, accountId);
      const offset = cursor === undefined ? 0 : decode(cursor, scope, accountId, "page");
      if (account.status !== "ready") fail("provider_unavailable", account.statusReason);
      const current = data(account);
      return { ...current, messages: current.messages.slice(offset, offset + 2), nextCursor: offset === 0 ? encode({ version: 1, mode: "page", owner: scope, account: accountId, position: 2 }) : null, syncCursor: encode({ version: 1, mode: "delta", owner: scope, account: accountId, position: 0 }) };
    },
    async readChanges({ ownerId, accountId, syncCursor }): Promise<ProviderChanges> {
      const { scope, account } = await selection(ownerId, accountId); const revision = decode(syncCursor, scope, accountId, "delta");
      if (account.status !== "ready") fail("provider_unavailable", account.statusReason);
      const current = data(account);
      return { mode: "synthetic", accountId, changes: revision === 0 ? [{ kind: "message", value: { ...current.messages[0], subject: "Launch checklist updated", read: true } }, { kind: "event", value: { ...current.events[0], title: "Synthetic planning block updated" } }] : [],
        tombstones: revision === 0 ? [{ kind: "message", id: current.messages[2].id, accountId }, { kind: "event", id: current.events[1].id, accountId }] : [],
        syncCursor: encode({ version: 1, mode: "delta", owner: scope, account: accountId, position: 1 }),
      };
    },
  };
}
export async function createProviderPreview({ ownerId, accountId, cursor }: { ownerId: string; accountId?: string; cursor?: string }): Promise<ProviderPreview> {
  const adapter = createSyntheticProviderAdapter(); const ownedAccounts = await adapter.listAccounts(ownerId);
  const selectedAccountId = accountId ?? ownedAccounts[0].id; const { scope, account } = await selection(ownerId, selectedAccountId);
  if (account.status !== "ready") {
    if (cursor !== undefined) fail("invalid_cursor", "Unavailable accounts have no message pages");
    return { mode: "synthetic", accounts: ownedAccounts, selectedAccountId, messages: [], folders: [], calendars: [], events: [], nextCursor: null, syncCursor: encode({ version: 1, mode: "delta", owner: scope, account: selectedAccountId, position: 0 }) };
  }
  return { mode: "synthetic", accounts: ownedAccounts, selectedAccountId, ...await adapter.listMessages({ ownerId, accountId: selectedAccountId, cursor }) };
}
