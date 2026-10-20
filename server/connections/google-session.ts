import { OAuth2Client } from 'google-auth-library';
import type { FirebaseTokenIdentity } from '../firebase-id-token.ts';
import { configureGoogleOAuthTransport } from '../providers/google-oauth-transport.ts';
import { createGmailReadAdapter, type GmailReadCredential } from '../providers/gmail-read-adapter.ts';
import { connectionFail } from '../../shared/connection-onboarding.ts';

export type GoogleSessionConfiguration = { origin: string; ownerUserId: string; firebaseUid: string; address: string; clientId: string };
export const SESSION_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const identityScopes = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];
type Lease = { id: string; subject: string; authenticatedAt: number; expiresAt: number; connecting?: boolean; credential?: GmailReadCredential };

/** One local process/session only. Never writes provider credentials to any store. */
export function createGoogleMailSession(options: { configuration: GoogleSessionConfiguration; googleTransport: typeof fetch; mailTransport: typeof fetch; now?: () => number }) {
  const config = Object.freeze({ ...options.configuration }), now = options.now ?? Date.now;
  const origin = new URL(config.origin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.origin !== config.origin || origin.username || origin.password || !/^user_[a-f0-9]{32}$/.test(config.ownerUserId) || !config.firebaseUid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.address) || !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId) || typeof options.googleTransport !== 'function' || typeof options.mailTransport !== 'function') throw new Error('Local Gmail session configuration invalid.');
  let lease: Lease | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clear() { if (timer) clearTimeout(timer); timer = undefined; if (lease) delete lease.credential; lease = undefined; }
  function expire() { if (lease && lease.expiresAt <= now()) clear(); }
  function schedule() {
    if (timer) clearTimeout(timer);
    if (lease) { timer = setTimeout(clear, Math.max(0, lease.expiresAt - now())); timer.unref?.(); }
  }
  function admitted(owner: string, identity: FirebaseTokenIdentity): asserts identity is FirebaseTokenIdentity & { expiresAt: number } {
    if (owner !== config.ownerUserId || identity.provider !== 'google' || identity.uid !== config.firebaseUid || !identity.providerSubject || typeof identity.expiresAt !== 'number' || identity.expiresAt <= now()) connectionFail('forbidden');
  }
  function selected(owner: string, identity: FirebaseTokenIdentity, id: string) {
    admitted(owner, identity); expire();
    if (!lease || lease.id !== id || lease.subject !== identity.providerSubject || lease.authenticatedAt !== identity.authenticatedAt) connectionFail('reconnect_required');
    return lease!;
  }
  return {
    origin: config.origin,
    status(owner: string, identity: FirebaseTokenIdentity) { admitted(owner, identity); expire(); return { mode: 'google-session' as const, address: config.address, status: 'consent_required' as const }; },
    begin(owner: string, identity: FirebaseTokenIdentity) {
      admitted(owner, identity); clear();
      lease = { id: crypto.randomUUID().replaceAll('-', ''), subject: identity.providerSubject!, authenticatedAt: identity.authenticatedAt, expiresAt: Math.min(now() + 600_000, identity.expiresAt) };
      schedule(); return { sessionId: lease.id, expiresAt: lease.expiresAt };
    },
    disconnect(owner: string, identity: FirebaseTokenIdentity, id: string) {
      admitted(owner, identity); expire();
      if (!lease) return { status: 'disconnected' };
      selected(owner, identity, id); clear(); return { status: 'disconnected' };
    },
    async connect(owner: string, identity: FirebaseTokenIdentity, id: string, accessToken: string, isCurrent: () => Promise<boolean>) {
      const current = selected(owner, identity, id);
      if (current.credential || current.connecting || typeof accessToken !== 'string' || !/^[A-Za-z0-9._~+\/-]{1,8192}={0,2}$/.test(accessToken)) connectionFail('invalid_input');
      current.connecting = true;
      const client = new OAuth2Client({ clientId: config.clientId });
      configureGoogleOAuthTransport(client, options.googleTransport);
      try {
        const info = await client.getTokenInfo(accessToken);
        if (info.aud !== config.clientId || info.azp !== undefined && info.azp !== config.clientId || info.sub !== current.subject || info.email?.toLowerCase() !== config.address.toLowerCase() || String(info.email_verified) !== 'true' || !Number.isSafeInteger(info.expiry_date) || info.expiry_date <= now() || !Array.isArray(info.scopes) || !info.scopes.includes(SESSION_READ_SCOPE) || info.scopes.some(scope => scope !== SESSION_READ_SCOPE && !identityScopes.includes(scope))) connectionFail('consent_failed');
        if (!await isCurrent() || selected(owner, identity, id) !== current) connectionFail('reconnect_required');
        current.expiresAt = Math.min(current.expiresAt, info.expiry_date);
        current.credential = { accessToken, subject: current.subject, scopes: [...info.scopes], expiresAt: current.expiresAt };
        schedule(); return { status: 'connected', address: config.address, expiresAt: current.expiresAt };
      } catch {
        if (lease === current) clear();
        return connectionFail('consent_failed');
      }
    },
    async mail(owner: string, identity: FirebaseTokenIdentity, id: string, isCurrent: () => Promise<boolean>) {
      const current = selected(owner, identity, id);
      if (!current.credential) connectionFail('reconnect_required');
      const allowed = async () => {
        try { return selected(owner, identity, id) === current && !!current.credential && await isCurrent() && selected(owner, identity, id) === current; }
        catch { return false; }
      };
      const reader = createGmailReadAdapter({ bindings: [{ ownerId: owner, accountId: 'gmail_session', subject: current.subject, address: config.address, label: 'Local Gmail session' }], now, fetchImplementation: options.mailTransport, approveExecution: allowed, resolveCredential: async () => current.credential ?? null });
      try {
        const page = await reader.listMessages({ ownerId: owner, accountId: 'gmail_session' });
        if (!await allowed()) connectionFail('reconnect_required');
        return { address: config.address, expiresAt: current.expiresAt, page };
      } catch { if (lease === current) clear(); return connectionFail('reconnect_required'); }
    },
  };
}
export type GoogleMailSession = ReturnType<typeof createGoogleMailSession>;
