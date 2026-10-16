import type { ProviderAccount, ProviderReadAdapter } from "../../shared/provider-contracts.ts";
import { createGmailReadAdapter, type GmailReadCredential } from "./gmail-read-adapter.ts";
import { fail, GmailReadError } from "./gmail-wire.ts";

export type ProviderConnection = {
  ownerId: string; accountId: string; subject: string; address: string; label: string;
  credentialRef: string; scopes: string[]; state: "approved" | "needs_consent" | "revoked";
  expiresAt: number; revision: string; mode: "mock";
};
export type ProviderConnectionStore = {
  listForOwner(ownerId: string): Promise<ProviderConnection[]>;
  getForOwner(ownerId: string, accountId: string): Promise<ProviderConnection | null>;
};
export type ProviderCredentialBroker = {
  resolve(credentialRef: string, binding: { ownerId: string; accountId: string; subject: string }): Promise<GmailReadCredential | null>;
};
export type ProviderConnectionReader = Pick<ProviderReadAdapter, "listAccounts" | "listMessages">;
export type ProviderConnectionReaderOptions = {
  store: ProviderConnectionStore; broker: ProviderCredentialBroker;
  isOwnerActive(ownerId: string): Promise<boolean>;
  executionMode?: "disabled" | "mock"; fetchImplementation?: typeof fetch;
  now?: () => number; timeoutMs?: number;
};
const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const opaque = (value: unknown, max = 256): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
function connection(value: unknown, owner: string, account?: string): ProviderConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("malformed_response");
  const row = value as ProviderConnection;
  if (Object.keys(row).sort().join(",") !== "accountId,address,credentialRef,expiresAt,label,mode,ownerId,revision,scopes,state,subject") fail("malformed_response");
  if (!validId(row.ownerId) || !validId(row.accountId) || row.ownerId !== owner || account !== undefined && row.accountId !== account) fail("forbidden");
  if (!opaque(row.subject) || !opaque(row.label) || !opaque(row.credentialRef, 512) || !opaque(row.revision, 128) || typeof row.address !== "string" || row.address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.address) || row.mode !== "mock" || !["approved", "needs_consent", "revoked"].includes(row.state) || !Number.isFinite(row.expiresAt) || !Array.isArray(row.scopes) || row.scopes.length > 100 || row.scopes.some(scope => !opaque(scope, 256)) || new Set(row.scopes).size !== row.scopes.length) fail("malformed_response");
  return structuredClone(row);
}
function fingerprint(row: ProviderConnection) {
  return JSON.stringify({ ownerId: row.ownerId, accountId: row.accountId, subject: row.subject, address: row.address, label: row.label, credentialRef: row.credentialRef, scopes: [...row.scopes].sort(), state: row.state, expiresAt: row.expiresAt, revision: row.revision, mode: row.mode });
}
function metadata(row: ProviderConnection, mode: "disabled" | "mock", now: number): ProviderAccount {
  const status = row.state === "revoked" ? "revoked" : row.state === "needs_consent" || !row.scopes.includes(READ_SCOPE) || row.expiresAt <= now ? "needs_consent" : mode === "disabled" ? "not_connected" : "ready";
  const reason = status === "revoked" ? "Mock connection approval was revoked; no broker or mailbox read is allowed." : status === "needs_consent" ? "Mock connection needs current Gmail read approval. No credential lookup or provider read is allowed." : status === "not_connected" ? "Connection execution is disabled. This is mock binding metadata, not a connected live mailbox." : "Approved mock Gmail protocol connection using invented HTTP data. No live account is connected.";
  const unavailable = { available: false, reason: "This mock reader does not implement provider writes, calendars or reconnection." };
  return { id: row.accountId, upstreamId: row.subject, provider: "gmail", label: row.label, address: row.address, mode: "mock", status, statusReason: reason,
    capabilities: { mailRead: { available: status === "ready", reason }, calendarRead: { ...unavailable }, draft: { ...unavailable }, send: { ...unavailable }, calendarWrite: { ...unavailable }, reconnect: { ...unavailable } },
    sync: { state: "blocked", asOf: null, reason: "No live synchronization exists. Mock message reads do not implement Gmail history synchronization." },
  };
}
/** Server injection only: there is deliberately no live mode or environment enable switch. */
export function createProviderConnectionReader(options: ProviderConnectionReaderOptions): ProviderConnectionReader {
  const { store, broker, isOwnerActive, executionMode = "disabled", fetchImplementation, now = Date.now, timeoutMs } = options;
  if (!["disabled", "mock"].includes(executionMode) || typeof isOwnerActive !== "function" || typeof store?.listForOwner !== "function" || typeof store?.getForOwner !== "function" || typeof broker?.resolve !== "function" || executionMode === "mock" && typeof fetchImplementation !== "function") fail("invalid_input");
  async function active(owner: string) {
    if (!validId(owner)) fail("invalid_input");
    let allowed = false; try { allowed = await isOwnerActive(owner); } catch { fail("authentication_required"); }
    if (allowed !== true) fail("authentication_required");
  }
  async function read(owner: string, account: string) {
    let value: unknown; try { value = await store.getForOwner(owner, account); } catch { return fail("malformed_response"); }
    if (value === null) fail("forbidden"); return connection(value, owner, account);
  }
  function approved(row: ProviderConnection) {
    if (row.state === "revoked") fail("execution_disabled");
    if (row.state !== "approved" || !row.scopes.includes(READ_SCOPE)) fail("consent_required");
    if (row.expiresAt <= now()) fail("authentication_required");
  }
  return {
    async listAccounts(owner) {
      await active(owner); let values: unknown;
      try { values = await store.listForOwner(owner); } catch { return fail("malformed_response"); }
      if (!Array.isArray(values) || values.length > 100) fail("malformed_response");
      const rows = values.map(value => connection(value, owner)); const ids = new Set<string>(); const subjects = new Set<string>();
      for (const row of rows) { if (ids.has(row.accountId) || subjects.has(row.subject)) fail("malformed_response"); ids.add(row.accountId); subjects.add(row.subject); }
      await active(owner); return rows.map(row => metadata(row, executionMode, now()));
    },
    async listMessages({ ownerId, accountId, cursor }) {
      if (!validId(ownerId) || !validId(accountId)) fail("invalid_input");
      if (executionMode !== "mock") fail("execution_disabled");
      await active(ownerId); const initial = await read(ownerId, accountId); approved(initial); const expected = fingerprint(initial);
      const recheck = async () => { await active(ownerId); const current = await read(ownerId, accountId); if (fingerprint(current) !== expected) fail("execution_disabled"); approved(current); await active(ownerId); approved(current); return true; };
      await recheck();
      const adapter = createGmailReadAdapter({ bindings: [{ ownerId, accountId, subject: initial.subject, address: initial.address, label: initial.label }], now, timeoutMs,
        fetchImplementation,
        approveExecution: recheck,
        resolveCredential: async () => {
          await recheck(); let credential: GmailReadCredential | null;
          try { credential = structuredClone(await broker.resolve(initial.credentialRef, { ownerId, accountId, subject: initial.subject })); } catch { return fail("authentication_required"); }
          await recheck(); return credential;
        },
      });
      try { const page = await adapter.listMessages({ ownerId, accountId, cursor }); await recheck(); return page; }
      catch (error) { if (error instanceof GmailReadError) throw error; return fail("malformed_response"); }
    },
  };
}
