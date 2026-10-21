import type { PrivateGoogleGrant, GoogleConsentBinding } from '../providers/google-oauth-adapter.ts';
import type { ConnectionStatus } from '../../shared/connection-onboarding.ts';
import { connectionFail } from '../../shared/connection-onboarding.ts';
export type { GoogleConnectionCatalog } from '../../shared/google-connection-catalog.ts';

export type GooglePending = { stateHash: string; verifier: string; nonce: string; callbackUri: string; clientId: string; expiresAt: number };
/** PRIVATE atomic envelope. Never store this in ordinary connection metadata. */
export type GoogleConnection = {
  id: string; ownerId: string; workspaceId: string; address: string; accountId: string;
  attemptId: string; credentialRef: string; status: ConnectionStatus; subject?: string;
  stateHash?: string; pending?: GooglePending; operation?: 'exchange' | 'refresh'; consentExpiresAt?: number; grant?: PrivateGoogleGrant;
};
/** Inject a private durable backend with active-owner fencing and atomic CAS retry.
 * apply is pure and may rerun. Never replay an ambiguous successful change. */
export type PrivateGoogleConnections = {
  read(owner: string): Promise<GoogleConnection[]>;
  change(owner: string, apply: (rows: GoogleConnection[]) => GoogleConnection[]): Promise<GoogleConnection[]>;
};
export const uuid = () => crypto.randomUUID().replaceAll('-', '');
export const validAddress = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function googleBinding(row: GoogleConnection): GoogleConsentBinding {
  return { ownerId: row.ownerId, accountId: row.accountId, address: row.address, revision: row.attemptId, credentialRef: row.credentialRef, ...(row.subject ? { subject: row.subject } : {}) };
}
export function googleRows(value: unknown, owner: string): GoogleConnection[] {
  if (!Array.isArray(value) || value.length > 50 || JSON.stringify(value).length > 900_000) connectionFail('capacity');
  const seen = new Set<string>(), addresses = new Set<string>();
  for (const row of value as GoogleConnection[]) {
    if (!row || row.ownerId !== owner || !/^con_[a-f0-9]{32}$/.test(row.id) || !/^wsp_[a-f0-9]{32}$/.test(row.workspaceId) || !validAddress(row.address) || !/^gmail_[a-f0-9]{32}$/.test(row.accountId) || !/^[a-f0-9]{32}$/.test(row.attemptId) || row.credentialRef !== `google_${row.attemptId}` || !['authorizing', 'consent_required', 'connected', 'cancelled', 'reconnect_required', 'cleanup_pending', 'disconnected'].includes(row.status) || seen.has(row.id) || addresses.has(row.address.toLowerCase())) connectionFail('invalid_state');
    if (row.pending && (row.status !== 'consent_required' || !/^[A-Za-z0-9_-]{43}$/.test(row.pending.stateHash) || row.pending.stateHash !== row.stateHash || !Number.isSafeInteger(row.pending.expiresAt))) connectionFail('invalid_state');
    if (row.status === 'consent_required' && !row.pending || row.status === 'connected' && (!row.subject || !row.grant)) connectionFail('invalid_state');
    if (row.grant && (row.status !== 'connected' && !(row.status === 'authorizing' && row.operation === 'refresh') || row.grant.binding.subject !== row.subject || Object.entries(googleBinding(row)).some(([key, field]) => row.grant!.binding[key as keyof GoogleConsentBinding] !== field))) connectionFail('invalid_state');
    seen.add(row.id); addresses.add(row.address.toLowerCase());
  }
  return structuredClone(value);
}
