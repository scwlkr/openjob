import { createFirebaseIdTokenVerifier, type FirebaseTokenIdentity } from '../firebase-id-token.ts';
import { createGoogleMailSession, type GoogleMailSession } from './google-session.ts';
import { googleSessionRequest } from './google-session-http.ts';
import { jsonResponse, errorResponse, defaultRequestId } from '../v1-http.ts';

type Configuration = { projectId: string; apiKey: string; origin: string; address: string; clientId: string };
/** Separate temporary provider session: no OpenJob User, Firestore or agent capability. */
export function createGoogleSelfSession(options: { configuration: Configuration; identityTransport: typeof fetch; googleTransport: typeof fetch; mailTransport: typeof fetch; now?: () => number }) {
  const config = Object.freeze({ ...options.configuration }), now = options.now ?? Date.now;
  const origin = new URL(config.origin);
  if (config.projectId !== 'openjob-nonprod' || !config.apiKey || origin.origin !== config.origin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.address) || !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId)) throw new Error('Local self-session configuration invalid.');
  const verify = createFirebaseIdTokenVerifier({ projectId: config.projectId, now, fetchImplementation: options.identityTransport });
  let selected: { uid: string; subject: string; owner: string; flow: GoogleMailSession } | undefined;
  const fail = (code: string, status: number) => errorResponse(defaultRequestId, { code, status, message: 'Local Mail session unavailable. Sign in with the selected account and reconnect.' });
  async function current(token: string, identity: FirebaseTokenIdentity, signal: AbortSignal) {
    if (signal.aborted || identity.provider !== 'google' || !identity.providerSubject || !identity.expiresAt || identity.expiresAt <= now()) return false;
    const response = await options.identityTransport(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token }), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65536) return false; parts.push(value); } } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; }
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(data.users) || data.users.length !== 1) return false;
    const user = data.users[0], google = Array.isArray(user.providerUserInfo) ? user.providerUserInfo.filter((item: { providerId?: unknown }) => item.providerId === 'google.com') : [];
    const cutoff = typeof user.validSince === 'string' && /^\d+$/.test(user.validSince) ? Number(user.validSince) * 1000 : NaN;
    return !signal.aborted && user.localId === identity.uid && !user.disabled && user.emailVerified === true && typeof user.email === 'string' && user.email.toLowerCase() === config.address.toLowerCase() && google.length === 1 && google[0].rawId === identity.providerSubject && Number.isSafeInteger(cutoff) && identity.authenticatedAt >= cutoff && identity.expiresAt > now();
  }
  return { async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.origin !== config.origin || request.headers.get('origin') !== config.origin || url.search) return fail('forbidden', 403);
    if (!/^\/api\/v1\/connections\/session(?:\/(?:status|begin|connect|mail))?$/.test(url.pathname)) return fail('not_found', 404);
    const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
    if (!token || token.startsWith('oj_')) return fail('authentication_required', 401);
    try {
      const identity = await verify.verifyToken(token);
      if (!identity || !await current(token, identity, request.signal)) { selected?.flow.forget(); return fail('authentication_required', 401); }
      // No admin discovery or configured hidden UID: learn only from the verified self account.
      const owner = 'user_' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(config.projectId + '\0' + identity.uid)))).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
      if (!selected) selected = { uid: identity.uid, subject: identity.providerSubject!, owner, flow: createGoogleMailSession({ configuration: { ...config, ownerUserId: owner, firebaseUid: identity.uid }, googleTransport: options.googleTransport, mailTransport: options.mailTransport, now }) };
      if (selected.uid !== identity.uid || selected.subject !== identity.providerSubject) return fail('forbidden', 403);
      const flow = selected.flow;
      const isCurrent = async () => { try { const valid = await current(token, identity, request.signal); if (!valid) flow.forget(); return valid; } catch { flow.forget(); return false; } };
      const response = await googleSessionRequest(request, owner, identity, flow, isCurrent);
      return await isCurrent() ? response : fail('authentication_required', 401);
    } catch { selected?.flow.forget(); return fail('reconnect_required', 409); }
  }, publicStatus() { return jsonResponse({ mode: 'local_mail_session', configured: true, project: config.projectId, realSending: false }); } };
}
