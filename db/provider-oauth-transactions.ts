import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from "./firestore-rest.ts";
import { activeUserHistoryWrite, assertActiveUser, isInactiveUserError } from "./user-history.ts";
import { oauthFail, oauthId, ProviderOAuthError, PROVIDER_OAUTH_TRANSACTION_TTL_MS, validateProviderOAuthTransaction, type ProviderOAuthTransaction, type ProviderOAuthTransactions } from "../server/providers/provider-oauth-types.ts";

export type DurableProviderOAuthTransactions = ProviderOAuthTransactions & {
  cleanupExpiredForOwner(ownerId: string): Promise<number>;
  removeAllForUser(ownerId: string): Promise<number>;
};
type Spent = { stateHash: string; createdAt: number; expiresAt: number };
type Envelope = { pending: ProviderOAuthTransaction[]; spent: Spent[] };
const MAX_RECORDS = 100, MAX_BYTES = 200000;
const hash = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
function concurrent(error: unknown) { return error instanceof FirestoreRequestError && ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION", "NOT_FOUND"].includes(error.code ?? ""); }

/** Private server transaction storage only; unbound from production and any public API. */
export function createFirestoreProviderOAuthTransactions(config: FirebaseConfig, fetchImplementation: typeof fetch = fetch,
  { now = Date.now }: { now?: () => number } = {}): DurableProviderOAuthTransactions {
  const firestore = createFirestoreRestClient(config, fetchImplementation);
  const path = (owner: string) => { if (!oauthId(owner)) oauthFail("invalid_input"); return `v1ProviderOAuthTransactions/${owner}`; };
  async function read(owner: string) {
    const response = await firestore.request(path(owner), {}, { allowNotFound: true }); if (response.status === 404) return null;
    const doc = await response.json() as FirestoreDocument;
    if (doc.name !== firestore.documentName(path(owner)) || !doc.updateTime || Object.keys(doc.fields ?? {}).sort().join(",") !== "ownerUserId,transactionsJson" || doc.fields?.ownerUserId?.stringValue !== owner || new TextEncoder().encode(JSON.stringify(doc)).length > MAX_BYTES) oauthFail("invalid_state");
    return doc;
  }
  function envelope(owner: string, doc: FirestoreDocument | null): Envelope {
    if (!doc) return { pending: [], spent: [] };
    let value: Envelope;
    try { value = JSON.parse(doc.fields!.transactionsJson.stringValue!) as Envelope; } catch { return oauthFail("invalid_state"); }
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "pending,spent" || !Array.isArray(value.pending) || !Array.isArray(value.spent) || value.pending.length + value.spent.length > MAX_RECORDS) oauthFail("invalid_state");
    try { value.pending = value.pending.map(row => validateProviderOAuthTransaction(row, owner)); } catch { return oauthFail("invalid_state"); }
    const seen = new Set<string>();
    for (const row of value.pending) { if (row.createdAt > now() || seen.has(row.stateHash)) oauthFail("invalid_state"); seen.add(row.stateHash); }
    for (const row of value.spent) {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join(",") !== "createdAt,expiresAt,stateHash" || !hash(row.stateHash) || seen.has(row.stateHash) || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || row.createdAt > now() || !Number.isSafeInteger(row.expiresAt) || row.expiresAt - row.createdAt !== PROVIDER_OAUTH_TRANSACTION_TTL_MS) oauthFail("invalid_state");
      seen.add(row.stateHash);
    }
    return structuredClone(value);
  }
  function prune(value: Envelope) { return { pending: value.pending.filter(row => row.expiresAt > now()), spent: value.spent.filter(row => row.expiresAt > now()) }; }
  async function commit(writes: unknown[]) { await firestore.request(":commit", { method: "POST", body: JSON.stringify({ writes }) }); }
  async function mutate<T>(owner: string, apply: (value: Envelope) => { next: Envelope; result: T; changed: boolean; validBeforeCommit?: () => void }): Promise<T> {
    path(owner);
    for (let attempt = 0; attempt < 3; attempt++) {
      await assertActiveUser(firestore, owner); const current = await read(owner); const next = apply(envelope(owner, current));
      if (!next.changed) { await assertActiveUser(firestore, owner); return structuredClone(next.result); }
      const update = { name: firestore.documentName(path(owner)), fields: { ownerUserId: { stringValue: owner }, transactionsJson: { stringValue: JSON.stringify(next.next) } } };
      if (new TextEncoder().encode(JSON.stringify(update)).length > MAX_BYTES - 1024) oauthFail("transaction_capacity");
      try {
        const fence = await activeUserHistoryWrite(firestore, owner); next.validBeforeCommit?.();
        await commit([fence, { update, currentDocument: current ? { updateTime: current.updateTime } : { exists: false } }]);
        await assertActiveUser(firestore, owner); return structuredClone(next.result);
      } catch (error) { if (!concurrent(error)) throw error; }
    }
    return oauthFail("conflict");
  }
  const store: DurableProviderOAuthTransactions = {
    async create(input) {
      const transaction = validateProviderOAuthTransaction(input);
      if (transaction.createdAt > now() || transaction.expiresAt <= now()) oauthFail("invalid_transaction");
      await mutate(transaction.ownerId, value => {
        const next = prune(value);
        if ([...next.pending, ...next.spent].some(row => row.stateHash === transaction.stateHash)) oauthFail("invalid_state");
        if (next.pending.length + next.spent.length >= MAX_RECORDS) oauthFail("transaction_capacity");
        next.pending.push(transaction);
        return { next, changed: true, result: undefined, validBeforeCommit: () => { if (transaction.expiresAt <= now()) oauthFail("transaction_expired"); } };
      });
    },
    async consumeForOwner(owner, stateHash) {
      path(owner); if (!hash(stateHash)) oauthFail("invalid_input");
      const consumed = await mutate(owner, value => {
        const next = prune(value); const found = next.pending.find(row => row.stateHash === stateHash);
        if (found) { next.pending = next.pending.filter(row => row.stateHash !== stateHash); next.spent.push({ stateHash, createdAt: found.createdAt, expiresAt: found.expiresAt }); }
        return { next, result: found ?? null, changed: !!found || next.pending.length !== value.pending.length || next.spent.length !== value.spent.length,
          validBeforeCommit: () => { if (found && found.expiresAt <= now()) oauthFail("transaction_expired"); } };
      });
      return consumed && consumed.expiresAt > now() ? consumed : null;
    },
    async cleanupExpiredForOwner(owner) {
      return mutate(owner, value => { const next = prune(value); const removed = value.pending.length + value.spent.length - next.pending.length - next.spent.length; return { next, result: removed, changed: !!removed }; });
    },
    async removeAllForUser(owner) {
      path(owner);
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await read(owner); if (!current) return 0; const value = envelope(owner, current);
        try { await commit([{ delete: current.name, currentDocument: { updateTime: current.updateTime } }]); return value.pending.length + value.spent.length; }
        catch (error) { if (!concurrent(error)) throw error; }
      }
      return oauthFail("conflict");
    },
  };
  async function guarded<T>(operation: () => Promise<T>) {
    try { return await operation(); }
    catch (error) { if (error instanceof ProviderOAuthError || isInactiveUserError(error)) throw error; return oauthFail("transaction_unavailable"); }
  }
  return {
    create: input => guarded(() => store.create(input)),
    consumeForOwner: (owner, stateHash) => guarded(() => store.consumeForOwner(owner, stateHash)),
    cleanupExpiredForOwner: owner => guarded(() => store.cleanupExpiredForOwner(owner)),
    removeAllForUser: owner => guarded(() => store.removeAllForUser(owner)),
  };
}
