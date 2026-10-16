import type { DurableProviderConnectionStore } from "../../db/provider-connections.ts";
import type { ProviderVaultEntry, ProviderTokenVault } from "./provider-token-vault.ts";
export const MOCK_OAUTH_SCOPES: readonly string[] = Object.freeze(["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"]);
export type ProviderOAuthTransaction = {
  stateHash: string; ownerId: string; accountId: string; expectedSubject: string; label: string;
  callbackUri: string; clientId: string; scopes: string[]; nonce: string; verifier: string;
  createdAt: number; expiresAt: number; mode: "mock";
};
export type ProviderOAuthTransactions = {
  create(transaction: ProviderOAuthTransaction): Promise<void>;
  /** Must atomically consume only when the owner matches. Foreign owners must not burn state. */
  consumeForOwner(ownerId: string, stateHash: string): Promise<ProviderOAuthTransaction | null>;
};
export type ProviderOAuthExchange = { accessToken: string; idToken: string; scopes: string[]; expiresAt: number };
export type VerifiedProviderIdentity = { iss: string; aud: string; exp: number; nonce: string; sub: string; email: string; email_verified: boolean };
export type ProviderOAuthProvisioner = ProviderTokenVault & {
  /** Creation is conditional: never overwrite an existing reference. */
  write(entry: ProviderVaultEntry): Promise<void>;
  /** Idempotent deletion must match the entire supplied owner/account/subject/ref/revision binding. */
  delete(binding: Omit<ProviderVaultEntry, "credential">): Promise<void>;
};
export type ProviderOAuthOptions = {
  executionMode?: "disabled" | "mock"; clientId: string; callbackUri: string;
  transactions: ProviderOAuthTransactions; connections: DurableProviderConnectionStore; vault: ProviderOAuthProvisioner;
  isOwnerActive(ownerId: string): Promise<boolean>; now?: () => number; cleanupLimit?: number;
  exchange(input: { code: string; codeVerifier: string; redirectUri: string; clientId: string; requestedScopes: string[] }): Promise<ProviderOAuthExchange>;
  /** Injected attestation, not a cryptographic verifier implemented by this mock lifecycle. */
  verifyIdentity(input: { idToken: string; clientId: string; nonce: string }): Promise<VerifiedProviderIdentity>;
};
export class ProviderOAuthError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Mock provider OAuth: ${code.replaceAll("_", " ")}.`); this.code = code; this.name = "ProviderOAuthError"; }
}
export function oauthFail(code: string): never { throw new ProviderOAuthError(code); }
export const oauthId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const oauthOpaque = (value: unknown, max = 256): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export function oauthRandom() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
export async function oauthHash(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }

export const PROVIDER_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
/** Structural server-storage validation; the lifecycle separately binds its configured client/callback. */
export function validateProviderOAuthTransaction(value: unknown, ownerId?: string, stateHash?: string): ProviderOAuthTransaction {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "accountId,callbackUri,clientId,createdAt,expectedSubject,expiresAt,label,mode,nonce,ownerId,scopes,stateHash,verifier") oauthFail("invalid_transaction");
  const row = value as ProviderOAuthTransaction;
  let callback: URL; try { callback = new URL(row.callbackUri); } catch { return oauthFail("invalid_transaction"); }
  if (!oauthId(row.ownerId) || ownerId !== undefined && row.ownerId !== ownerId || !oauthId(row.accountId) || typeof row.stateHash !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(row.stateHash) || stateHash !== undefined && row.stateHash !== stateHash || typeof row.expectedSubject !== "string" || !/^[\x21-\x7e]{1,255}$/.test(row.expectedSubject) || !oauthOpaque(row.label, 80) || !oauthOpaque(row.clientId, 256) || !oauthOpaque(row.callbackUri, 2048) || callback.protocol !== "https:" || callback.username || callback.password || callback.search || callback.hash || callback.href !== row.callbackUri || !Array.isArray(row.scopes) || row.scopes.length !== MOCK_OAUTH_SCOPES.length || new Set(row.scopes).size !== row.scopes.length || row.scopes.some(scope => !MOCK_OAUTH_SCOPES.includes(scope)) || typeof row.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(row.nonce) || typeof row.verifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(row.verifier) || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || !Number.isSafeInteger(row.expiresAt) || row.expiresAt - row.createdAt !== PROVIDER_OAUTH_TRANSACTION_TTL_MS || row.mode !== "mock") oauthFail("invalid_transaction");
  return structuredClone(row);
}
