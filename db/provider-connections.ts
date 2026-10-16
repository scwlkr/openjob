import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from "./firestore-rest.ts";
import { activeUserHistoryWrite, assertActiveUser } from "./user-history.ts";
import { validateProviderConnection, type ProviderConnection, type ProviderConnectionStore } from "../server/providers/provider-connections.ts";

export type ProviderConnectionInput = Omit<ProviderConnection, "ownerId" | "revision">;
export type DurableProviderConnectionStore = ProviderConnectionStore & {
  putForOwner(ownerId: string, input: ProviderConnectionInput, expectedRevision: string | null): Promise<ProviderConnection>;
  revokeForOwner(ownerId: string, accountId: string, expectedRevision: string): Promise<ProviderConnection | null>;
  removeAllForUser(ownerId: string): Promise<number>;
};
const MAX_BYTES = 200_000;
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validRevision = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function fail(code: string): never { throw Object.assign(new Error(`Provider connection store: ${code.replaceAll("_", " ")}.`), { code }); }
function concurrent(error: unknown) { return error instanceof FirestoreRequestError && ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION", "NOT_FOUND"].includes(error.code ?? ""); }

/** Metadata only. Token provisioning/cleanup is separate and is never atomic with this store. */
export function createFirestoreProviderConnectionStore(config: FirebaseConfig, fetchImplementation: typeof fetch = fetch,
  { revision = () => crypto.randomUUID() }: { revision?: () => string } = {}): DurableProviderConnectionStore {
  const firestore = createFirestoreRestClient(config, fetchImplementation);
  const path = (owner: string) => { if (!validId(owner)) fail("invalid_input"); return `v1ProviderConnections/${owner}`; };
  async function read(owner: string) {
    const response = await firestore.request(path(owner), {}, { allowNotFound: true }); if (response.status === 404) return null;
    const doc = await response.json() as FirestoreDocument;
    if (doc.name !== firestore.documentName(path(owner)) || !doc.updateTime || Object.keys(doc.fields ?? {}).sort().join(",") !== "connectionsJson,ownerUserId" || doc.fields?.ownerUserId?.stringValue !== owner || new TextEncoder().encode(JSON.stringify(doc)).length > MAX_BYTES) fail("invalid_state");
    return doc;
  }
  function rows(owner: string, document: FirestoreDocument | null): ProviderConnection[] {
    if (!document) return [];
    let data: unknown; try { data = JSON.parse(document.fields!.connectionsJson.stringValue!); } catch { fail("invalid_state"); }
    if (!Array.isArray(data) || data.length > 100) fail("invalid_state");
    let records: ProviderConnection[]; try { records = data.map(row => validateProviderConnection(row, owner)); } catch { return fail("invalid_state"); }
    const accounts = new Set<string>(); const subjects = new Set<string>(); const refs = new Set<string>(); const revisions = new Set<string>();
    for (const row of records) {
      if (!validRevision(row.revision) || accounts.has(row.accountId) || subjects.has(row.subject) || refs.has(row.credentialRef) || revisions.has(row.revision)) fail("invalid_state");
      accounts.add(row.accountId); subjects.add(row.subject); refs.add(row.credentialRef); revisions.add(row.revision);
    }
    return records;
  }
  async function commit(writes: unknown[]) { await firestore.request(":commit", { method: "POST", body: JSON.stringify({ writes }) }); }
  async function list(owner: string) {
    path(owner); await assertActiveUser(firestore, owner); const result = rows(owner, await read(owner)); await assertActiveUser(firestore, owner); return result;
  }
  async function mutate(owner: string, change: (records: ProviderConnection[]) => { records: ProviderConnection[]; result: ProviderConnection | null; unchanged?: boolean }) {
    path(owner);
    for (let attempt = 0; attempt < 3; attempt++) {
      await assertActiveUser(firestore, owner); const current = await read(owner); const next = change(rows(owner, current));
      if (next.unchanged) { await assertActiveUser(firestore, owner); return structuredClone(next.result); }
      const update = { name: firestore.documentName(path(owner)), fields: { ownerUserId: { stringValue: owner }, connectionsJson: { stringValue: JSON.stringify(next.records) } } };
      if (new TextEncoder().encode(JSON.stringify(update)).length > MAX_BYTES - 1024) fail("connection_capacity");
      try { await commit([await activeUserHistoryWrite(firestore, owner), { update, currentDocument: current ? { updateTime: current.updateTime } : { exists: false } }]); return structuredClone(next.result); }
      catch (error) { if (!concurrent(error)) throw error; }
    }
    return fail("conflict");
  }
  function nextRevision(records: ProviderConnection[]) {
    const next = revision(); if (!validRevision(next) || records.some(row => row.revision === next)) fail("conflict");
    // Default random UUIDs prevent practical ABA; this is not a durable revision history.
    return next;
  }
  return {
    listForOwner: list,
    async getForOwner(owner, account) { if (!validId(account)) fail("invalid_input"); return (await list(owner)).find(row => row.accountId === account) ?? null; },
    async putForOwner(owner, input, expectedRevision) {
      path(owner); if (expectedRevision !== null && !validRevision(expectedRevision)) fail("invalid_input");
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== "accountId,address,credentialRef,expiresAt,label,mode,scopes,state,subject") fail("invalid_input");
      let candidate: ProviderConnection; try { candidate = validateProviderConnection({ ...input, ownerId: owner, revision: "pending" }, owner); } catch { return fail("invalid_input"); }
      return await mutate(owner, records => {
        const current = records.find(row => row.accountId === candidate.accountId);
        if (expectedRevision === null ? !!current : !current || current.revision !== expectedRevision) fail("conflict");
        if (!current && records.length >= 100) fail("connection_capacity");
        if (records.some(row => row.accountId !== candidate.accountId && (row.subject === candidate.subject || row.credentialRef === candidate.credentialRef))) fail("conflict");
        const updated = { ...candidate, revision: nextRevision(records) };
        return { records: [...records.filter(row => row.accountId !== candidate.accountId), updated], result: updated };
      }) as ProviderConnection;
    },
    async revokeForOwner(owner, account, expectedRevision) {
      if (!validId(account) || !validRevision(expectedRevision)) fail("invalid_input");
      return mutate(owner, records => {
        const current = records.find(row => row.accountId === account); if (!current) return { records, result: null, unchanged: true };
        if (current.revision !== expectedRevision) fail("conflict");
        if (current.state === "revoked") return { records, result: current, unchanged: true };
        const updated = { ...current, state: "revoked" as const, revision: nextRevision(records) };
        return { records: records.map(row => row.accountId === account ? updated : row), result: updated };
      });
    },
    async removeAllForUser(owner) {
      path(owner);
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await read(owner); if (!current) return 0; const count = rows(owner, current).length;
        try { await commit([{ delete: current.name, currentDocument: { updateTime: current.updateTime } }]); return count; }
        catch (error) { if (!concurrent(error)) throw error; }
      }
      return fail("conflict");
    },
  };
}
