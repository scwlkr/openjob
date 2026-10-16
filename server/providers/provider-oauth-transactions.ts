import { oauthFail, oauthId, type ProviderOAuthTransaction, type ProviderOAuthTransactions } from "./provider-oauth-types.ts";

/** Bounded process-memory mock only; it does not claim durable or multi-process consumption. */
export function createMockProviderOAuthTransactions({ now = Date.now }: { now?: () => number } = {}): ProviderOAuthTransactions {
  const pending = new Map<string, ProviderOAuthTransaction>();
  return {
    async create(transaction) {
      if (!transaction || !/^[A-Za-z0-9_-]{43}$/.test(transaction.stateHash) || !oauthId(transaction.ownerId) || transaction.mode !== "mock" || !Number.isFinite(transaction.expiresAt) || transaction.expiresAt <= now()) oauthFail("invalid_transaction");
      for (const [key, row] of pending) if (row.expiresAt <= now()) pending.delete(key);
      if (pending.size >= 1000 || pending.has(transaction.stateHash)) oauthFail("transaction_capacity");
      pending.set(transaction.stateHash, structuredClone(transaction));
    },
    async consumeForOwner(owner, stateHash) {
      const row = pending.get(stateHash); if (!row || row.ownerId !== owner) return null;
      pending.delete(stateHash); return structuredClone(row);
    },
  };
}
