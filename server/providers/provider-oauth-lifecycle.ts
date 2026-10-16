import type { ProviderConnectionInput } from "../../db/provider-connections.ts";
import { providerConnectionFingerprint, validateProviderConnection, type ProviderConnection } from "./provider-connections.ts";
import type { ProviderVaultEntry } from "./provider-token-vault.ts";
import { MOCK_OAUTH_SCOPES, ProviderOAuthError, oauthFail, oauthHash, oauthId, oauthOpaque, oauthRandom, type ProviderOAuthOptions, type ProviderOAuthTransaction, type ProviderOAuthExchange, type VerifiedProviderIdentity } from "./provider-oauth-types.ts";

const TTL = 10 * 60 * 1000;
const scopeMatch = (value: unknown) => Array.isArray(value) && value.length === MOCK_OAUTH_SCOPES.length && new Set(value).size === value.length && value.every(scope => MOCK_OAUTH_SCOPES.includes(scope));
const subject = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e]{1,255}$/.test(value);
const email = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const label = (value: unknown): value is string => oauthOpaque(value, 80);
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) oauthFail("invalid_input"); }
function vaultBinding(row: ProviderConnection): Omit<ProviderVaultEntry, "credential"> { return { credentialRef: row.credentialRef, ownerId: row.ownerId, accountId: row.accountId, subject: row.subject, revision: row.revision }; }

/** Server-only mock orchestration. Exchange, identity verification and vault writes are injected attestations. */
export function createMockProviderOAuthLifecycle(options: ProviderOAuthOptions) {
  const { executionMode = "disabled", clientId, callbackUri, transactions, connections, vault, isOwnerActive, exchange, verifyIdentity, now = Date.now, cleanupLimit = 1000 } = options;
  let uri: URL; try { uri = new URL(callbackUri); } catch { return oauthFail("invalid_configuration"); }
  if (!Number.isInteger(cleanupLimit) || cleanupLimit < 1 || cleanupLimit > 1000 || !["disabled", "mock"].includes(executionMode) || !oauthOpaque(clientId, 256) || uri.protocol !== "https:" || uri.username || uri.password || uri.hash || uri.search || uri.href !== callbackUri || [transactions?.create, transactions?.consumeForOwner, connections?.getForOwner, connections?.putForOwner, connections?.approveReservedForOwner, connections?.revokeForOwner, vault?.write, vault?.read, vault?.delete, isOwnerActive, exchange, verifyIdentity].some(fn => typeof fn !== "function")) oauthFail("invalid_configuration");
  const pendingCleanup = new Map<string, ProviderConnection>();
  const vaultTouched = new Set<string>();
  const pendingReservations = new Map<string, { ownerId: string; candidate: ProviderConnectionInput; settled: boolean }>();
  const activeReservations = new Set<string>();
  let activeCallbacks = 0;
  const key = (row: ProviderConnection) => `${row.ownerId}:${row.accountId}:${row.revision}`;
  const enabled = () => { if (executionMode !== "mock") oauthFail("execution_disabled"); };
  async function active(owner: string) { if (!oauthId(owner)) oauthFail("invalid_input"); let allowed = false; try { allowed = await isOwnerActive(owner); } catch { oauthFail("owner_inactive"); } if (allowed !== true) oauthFail("owner_inactive"); }
  function validTransaction(value: unknown, owner: string, hash: string): ProviderOAuthTransaction {
    exact(value, ["stateHash", "ownerId", "accountId", "expectedSubject", "label", "callbackUri", "clientId", "scopes", "nonce", "verifier", "createdAt", "expiresAt", "mode"]);
    const row = value as unknown as ProviderOAuthTransaction;
    if (row.stateHash !== hash || row.ownerId !== owner || !oauthId(row.accountId) || !subject(row.expectedSubject) || !label(row.label) || row.callbackUri !== callbackUri || row.clientId !== clientId || !scopeMatch(row.scopes) || !/^[A-Za-z0-9_-]{43}$/.test(row.nonce) || !/^[A-Za-z0-9_-]{43,128}$/.test(row.verifier) || !Number.isFinite(row.createdAt) || !Number.isFinite(row.expiresAt) || row.expiresAt - row.createdAt !== TTL || row.createdAt > now() || row.mode !== "mock") oauthFail("invalid_transaction");
    return structuredClone(row);
  }
  function alive(row: ProviderOAuthTransaction) { if (row.expiresAt <= now()) oauthFail("transaction_expired"); }
  async function guard(row: ProviderOAuthTransaction) { alive(row); await active(row.ownerId); alive(row); }
  function identity(value: VerifiedProviderIdentity, row: ProviderOAuthTransaction) {
    if (!value || typeof value !== "object" || !["https://accounts.google.com", "accounts.google.com"].includes(value.iss) || value.aud !== row.clientId || !Number.isSafeInteger(value.exp) || value.exp * 1000 <= now() || value.nonce !== row.nonce || !subject(value.sub) || value.sub !== row.expectedSubject || value.email_verified !== true || !email(value.email)) oauthFail("identity_mismatch");
    return { subject: value.sub, address: value.email };
  }
  function exchanged(value: ProviderOAuthExchange) {
    exact(value, ["accessToken", "idToken", "scopes", "expiresAt"]);
    if (typeof value.accessToken !== "string" || !/^[A-Za-z0-9._~+\/-]{1,8192}={0,2}$/.test(value.accessToken) || !oauthOpaque(value.idToken, 16384) || !scopeMatch(value.scopes) || !Number.isFinite(value.expiresAt) || value.expiresAt <= now() || value.expiresAt - now() > 86400000) oauthFail("exchange_mismatch");
    return structuredClone(value);
  }
  async function cleanup(reserved: ProviderConnection) {
    let metadataDone = false; let vaultDone = false;
    try {
      const raw = await connections.getForOwner(reserved.ownerId, reserved.accountId);
      const current = raw ? validateProviderConnection(raw, reserved.ownerId, reserved.accountId) : null;
      if (!current || current.revision !== reserved.revision || current.state === "revoked") metadataDone = true;
      else { const result = await connections.revokeForOwner(reserved.ownerId, reserved.accountId, reserved.revision); metadataDone = !result || result.state === "revoked"; }
    } catch { /* Preserve a retryable queue entry, never publish backend messages. */ }
    if (metadataDone && !vaultTouched.has(key(reserved))) vaultDone = true;
    else if (metadataDone) try { await vault.delete(vaultBinding(reserved)); vaultDone = true; } catch { /* Denial is confirmed; vault removal can be retried independently. */ }
    if (metadataDone && vaultDone) { pendingCleanup.delete(key(reserved)); vaultTouched.delete(key(reserved)); }
    return metadataDone && vaultDone;
  }
  async function recoverReservation(pendingKey: string) {
    const pending = pendingReservations.get(pendingKey); if (!pending) return true;
    if (!pending.settled) return false;
    let current: ProviderConnection | null;
    try { current = await connections.getForOwner(pending.ownerId, pending.candidate.accountId); } catch { return false; }
    if (!current) {
      // A failed HTTP response can precede a late server commit. An absent read is
      // not final: CAS-create a denied tombstone, preventing that late creation.
      try { await connections.putForOwner(pending.ownerId, { ...pending.candidate, state: "revoked" }, null); } catch { /* It may have raced the original creation. */ }
      try { current = await connections.getForOwner(pending.ownerId, pending.candidate.accountId); } catch { return false; }
      if (!current) return false;
    }
    try { current = validateProviderConnection(current, pending.ownerId, pending.candidate.accountId); } catch { return false; }
    if (current.credentialRef !== pending.candidate.credentialRef) { pendingReservations.delete(pendingKey); return true; }
    if (current.state === "revoked") { pendingReservations.delete(pendingKey); return true; }
    if (current.state !== "needs_consent" || providerConnectionFingerprint(current) !== providerConnectionFingerprint({ ...pending.candidate, ownerId: pending.ownerId, revision: current.revision })) return false;
    pendingCleanup.set(key(current), current); pendingReservations.delete(pendingKey);
    // Provisioning never started: only deny the recovered exact reservation; do not touch a vault entry.
    return cleanup(current);
  }
  async function consume(owner: string, state: string) {
    if (!oauthId(owner) || typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state)) oauthFail("invalid_input");
    const hash = await oauthHash(state); let value: ProviderOAuthTransaction | null;
    try { value = await transactions.consumeForOwner(owner, hash); } catch { return oauthFail("transaction_unavailable"); }
    if (!value) oauthFail("invalid_state"); return validTransaction(value, owner, hash);
  }
  return {
    async begin(input: { ownerId: string; accountId: string; expectedSubject: string; label: string }) {
      enabled(); exact(input, ["ownerId", "accountId", "expectedSubject", "label"]);
      if (!oauthId(input.ownerId) || !oauthId(input.accountId) || !subject(input.expectedSubject) || !label(input.label)) oauthFail("invalid_input");
      if (pendingCleanup.size + pendingReservations.size + activeCallbacks >= cleanupLimit) oauthFail("cleanup_capacity");
      await active(input.ownerId); let existing: ProviderConnection | null;
      try { existing = await connections.getForOwner(input.ownerId, input.accountId); } catch { return oauthFail("metadata_unavailable"); }
      if (existing) oauthFail("account_exists");
      const state = oauthRandom(); const nonce = oauthRandom(); const verifier = oauthRandom(); const createdAt = now();
      const row: ProviderOAuthTransaction = { stateHash: await oauthHash(state), ownerId: input.ownerId, accountId: input.accountId, expectedSubject: input.expectedSubject, label: input.label, callbackUri, clientId, scopes: [...MOCK_OAUTH_SCOPES], nonce, verifier, createdAt, expiresAt: createdAt + TTL, mode: "mock" };
      await guard(row); try { await transactions.create(structuredClone(row)); } catch { return oauthFail("transaction_unavailable"); } await guard(row);
      return { mode: "mock" as const, state, nonce, codeChallenge: await oauthHash(verifier), codeChallengeMethod: "S256" as const, callbackUri, clientId, scopes: [...row.scopes], expiresAt: row.expiresAt };
    },
    async cancel(owner: string, state: string) { enabled(); const row = await consume(owner, state); await guard(row); return { mode: "mock" as const, status: "cancelled" as const }; },
    async callback(input: { ownerId: string; state: string; callbackUri: string; code?: string; error?: string }) {
      enabled();
      exact(input, input?.error !== undefined ? ["ownerId", "state", "callbackUri", "error"] : ["ownerId", "state", "callbackUri", "code"]);
      if (input.callbackUri !== callbackUri) oauthFail("callback_mismatch");
      if (pendingCleanup.size + pendingReservations.size + activeCallbacks >= cleanupLimit) oauthFail("cleanup_capacity");
      activeCallbacks++;
      try {
      const row = await consume(input.ownerId, input.state);
      await guard(row); if (input.error !== undefined) { if (input.error !== "access_denied") oauthFail("invalid_input"); return { mode: "mock" as const, status: "cancelled" as const }; }
      if (!oauthOpaque(input.code, 4096)) oauthFail("invalid_input");
      let reserved: ProviderConnection | undefined; let reservationKey: string | undefined;
      try {
        let token: ProviderOAuthExchange; try { token = exchanged(await exchange({ code: input.code, codeVerifier: row.verifier, redirectUri: row.callbackUri, clientId: row.clientId, requestedScopes: [...row.scopes] })); } catch (error) { if (error instanceof ProviderOAuthError) throw error; return oauthFail("exchange_failed"); }
        await guard(row); let claims: VerifiedProviderIdentity;
        try { claims = structuredClone(await verifyIdentity({ idToken: token.idToken, clientId: row.clientId, nonce: row.nonce })); } catch { return oauthFail("identity_mismatch"); }
        await guard(row); const verified = identity(claims, row);
        const credentialAlive = () => { if (token.expiresAt <= now() || claims.exp * 1000 <= now()) oauthFail("credential_expired"); };
        credentialAlive();
        const candidate = { accountId: row.accountId, subject: verified.subject, address: verified.address, label: row.label, credentialRef: `mock_oauth_${crypto.randomUUID()}`, scopes: [...row.scopes], state: "needs_consent" as const, expiresAt: token.expiresAt, mode: "mock" as const };
        reservationKey = `${row.ownerId}:${row.accountId}:${candidate.credentialRef}`;
        const pendingReservation = { ownerId: row.ownerId, candidate: structuredClone(candidate), settled: false };
        pendingReservations.set(reservationKey, pendingReservation);
        // A lost response is recovered by its new unique reference; no code exchange retry.
        let reservation: ProviderConnection;
        try { reservation = await connections.putForOwner(row.ownerId, candidate, null); } catch { return oauthFail("reservation_uncertain"); } finally { pendingReservation.settled = true; }
        const parsed = validateProviderConnection(reservation, row.ownerId, row.accountId);
        if (parsed.state !== "needs_consent" || parsed.subject !== row.expectedSubject || parsed.credentialRef !== candidate.credentialRef || providerConnectionFingerprint(parsed) !== providerConnectionFingerprint({ ...candidate, ownerId: row.ownerId, revision: parsed.revision })) oauthFail("reservation_mismatch");
        reserved = parsed;
        pendingCleanup.set(key(reserved), structuredClone(reserved)); activeReservations.add(key(reserved)); pendingReservations.delete(reservationKey); await guard(row); credentialAlive();
        const stored: ProviderVaultEntry = { ...vaultBinding(reserved), credential: { accessToken: token.accessToken, subject: verified.subject, scopes: [...token.scopes], expiresAt: token.expiresAt } };
        vaultTouched.add(key(reserved)); await vault.write(structuredClone(stored)); await guard(row); credentialAlive();
        const readback = structuredClone(await vault.read(stored.credentialRef)); await guard(row); credentialAlive();
        exact(readback, ["credentialRef", "ownerId", "accountId", "subject", "revision", "credential"]);
        const actual = readback as unknown as ProviderVaultEntry;
        exact(actual.credential, ["accessToken", "subject", "scopes", "expiresAt"]);
        if (Object.entries(vaultBinding(reserved)).some(([field, value]) => actual[field as keyof Omit<ProviderVaultEntry, "credential">] !== value) || actual.credential.accessToken !== stored.credential.accessToken || actual.credential.subject !== stored.subject || actual.credential.expiresAt !== stored.credential.expiresAt || !scopeMatch(actual.credential.scopes)) oauthFail("vault_mismatch");
        const approved = await connections.approveReservedForOwner(row.ownerId, structuredClone(reserved)); await guard(row); credentialAlive();
        if (providerConnectionFingerprint(approved) !== providerConnectionFingerprint({ ...reserved, state: "approved" })) oauthFail("approval_mismatch");
        const latest = await connections.getForOwner(row.ownerId, row.accountId); await guard(row); credentialAlive();
        if (!latest || providerConnectionFingerprint(latest) !== providerConnectionFingerprint(approved)) oauthFail("approval_mismatch");
        pendingCleanup.delete(key(reserved)); activeReservations.delete(key(reserved)); vaultTouched.delete(key(reserved)); return { mode: "mock" as const, status: "approved" as const, accountId: row.accountId };
      } catch (error) {
        if (reserved) { activeReservations.delete(key(reserved)); pendingCleanup.set(key(reserved), structuredClone(reserved)); if (!await cleanup(reserved)) oauthFail("cleanup_required"); }
        else if (reservationKey && !await recoverReservation(reservationKey)) oauthFail("cleanup_required");
        if (error instanceof ProviderOAuthError) throw error; return oauthFail("provisioning_failed");
      }
      } finally { activeCallbacks--; }
    },
    async retryCleanup(owner: string) {
      enabled(); if (!oauthId(owner)) oauthFail("invalid_input"); let completed = 0;
      for (const row of [...pendingCleanup.values()].filter(item => item.ownerId === owner)) if (!activeReservations.has(key(row)) && await cleanup(row)) completed++;
      for (const [pendingKey, pending] of [...pendingReservations]) if (pending.ownerId === owner && await recoverReservation(pendingKey)) completed++;
      return { completed, pending: [...pendingCleanup.values()].filter(item => item.ownerId === owner).length + [...pendingReservations.values()].filter(item => item.ownerId === owner).length };
    },
  };
}
