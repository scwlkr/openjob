import type { GmailReadCredential } from "./gmail-read-adapter.ts";
import { effectiveProvider, validProviderImap, providerImapFingerprint, providerReadScopes, providerConnectionFingerprint, validateProviderConnection, type ProviderImapConfig, type ProviderConnection, type ProviderConnectionStore, type ProviderCredentialBroker } from "./provider-connections.ts";
import { fail } from "./gmail-wire.ts";

export type ProviderVaultEntry = {
  imap?: ProviderImapConfig; provider?: "gmail" | "outlook" | "imap"; credentialRef: string; ownerId: string; accountId: string; subject: string; revision: string;
  /** IMAP uses an injected mock session handle; imap.read is local approval, not an OAuth scope. */
  credential: GmailReadCredential;
};
export type ProviderTokenVault = { read(credentialRef: string): Promise<ProviderVaultEntry | null> };
export type ProviderTokenVaultOptions = {
  vault: ProviderTokenVault; connections: ProviderConnectionStore; isOwnerActive(ownerId: string): Promise<boolean>;
  executionMode?: "disabled" | "mock"; now?: () => number;
};
type Binding = Parameters<ProviderCredentialBroker["resolve"]>[1];

const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const opaque = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

/** Read-only vault seam, not a secret-store implementation. No live mode or token provisioning. */
export function createProviderTokenVaultBroker({ vault, connections, isOwnerActive, executionMode = "disabled", now = Date.now }: ProviderTokenVaultOptions): ProviderCredentialBroker {
  if (!["disabled", "mock"].includes(executionMode) || typeof vault?.read !== "function" || typeof connections?.getForOwner !== "function" || typeof isOwnerActive !== "function") fail("invalid_input");
  async function active(owner: string) { let allowed = false; try { allowed = await isOwnerActive(owner); } catch { fail("authentication_required"); } if (allowed !== true) fail("authentication_required"); }
  async function current(ref: string, binding: Binding) {
    await active(binding.ownerId); let row: ProviderConnection;
    try { row = validateProviderConnection(await connections.getForOwner(binding.ownerId, binding.accountId), binding.ownerId, binding.accountId); } catch { return fail("authentication_required"); }
    if (effectiveProvider(row) !== effectiveProvider(binding) || providerImapFingerprint(row) !== providerImapFingerprint(binding) || row.credentialRef !== ref || row.subject !== binding.subject || row.revision !== binding.revision || row.state === "revoked") fail("execution_disabled");
    if (row.state !== "approved" || !providerReadScopes(effectiveProvider(row)).every(scope => row.scopes.includes(scope))) fail("consent_required");
    if (row.expiresAt <= now()) fail("authentication_required");
    await active(binding.ownerId); if (row.expiresAt <= now()) fail("authentication_required"); return row;
  }
  return {
    async resolve(ref, binding) {
      if (executionMode !== "mock") fail("execution_disabled");
      if (!opaque(ref, 512) || !binding || Object.keys(binding).filter(key => !["provider", "imap"].includes(key)).sort().join(",") !== "accountId,ownerId,revision,subject" || Object.hasOwn(binding, "provider") && !["gmail", "outlook", "imap"].includes(String(binding.provider)) || !validProviderImap(binding) || !id(binding.ownerId) || !id(binding.accountId) || !opaque(binding.subject, 256) || !opaque(binding.revision, 128)) fail("invalid_input");
      const before = await current(ref, binding); let entry: ProviderVaultEntry | null;
      try { entry = structuredClone(await vault.read(ref)); } catch { return fail("authentication_required"); }
      const after = await current(ref, binding);
      if (providerConnectionFingerprint(before) !== providerConnectionFingerprint(after)) fail("execution_disabled");
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).filter(key => !["provider", "imap"].includes(key)).sort().join(",") !== "accountId,credential,credentialRef,ownerId,revision,subject" || effectiveProvider(entry) !== effectiveProvider(binding) || !validProviderImap(entry) || providerImapFingerprint(entry) !== providerImapFingerprint(binding) || Object.hasOwn(entry, "provider") && !["gmail", "outlook", "imap"].includes(String(entry.provider)) || entry.credentialRef !== ref || entry.ownerId !== binding.ownerId || entry.accountId !== binding.accountId || entry.subject !== binding.subject || entry.revision !== binding.revision) fail("authentication_required");
      const value = entry.credential;
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "accessToken,expiresAt,scopes,subject" || value.subject !== binding.subject || typeof value.accessToken !== "string" || !/^[A-Za-z0-9._~+\/-]{1,8192}={0,2}$/.test(value.accessToken) || !Number.isFinite(value.expiresAt) || value.expiresAt <= now()) fail("authentication_required");
      if (!Array.isArray(value.scopes) || value.scopes.length > 100 || value.scopes.some(scope => !opaque(scope, 256)) || new Set(value.scopes).size !== value.scopes.length || !providerReadScopes(effectiveProvider(binding)).every(scope => value.scopes.includes(scope))) fail("consent_required");
      // No cross-store transaction exists: absent/stale vault entries deny reads. Revoke
      // metadata first; subsequent optional vault cleanup cannot restore authorization.
      return { accessToken: value.accessToken, subject: value.subject, scopes: [...value.scopes], expiresAt: Math.min(value.expiresAt, after.expiresAt) };
    },
  };
}
