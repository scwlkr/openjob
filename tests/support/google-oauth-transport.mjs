import { generateKeyPairSync, sign } from 'node:crypto';
import { createGoogleOAuthAdapter, GOOGLE_MAIL_SCOPES } from '../../server/providers/google-oauth-adapter.ts';

export const CLIENT = 'invented_web_client.apps.googleusercontent.com';
export const CALLBACK = 'https://chosen-host.example.invalid/api/v1/connections/google/callback';
export const BINDING = Object.freeze({ ownerId: 'user_alex', accountId: 'gmail_alex', subject: 'google_subject_alex', address: 'alex@example.invalid', credentialRef: 'private_ref_alex', revision: 'r1' });
export const NONCE = 'n'.repeat(43);
export const STATE = 's'.repeat(43);
export const VERIFIER = 'v'.repeat(43);
export const ACCESS = 'invented_access_token';
export const REFRESH = 'invented_refresh_token';
const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
export function idToken(claims = {}, badSignature = false) {
  const now = Math.floor(Date.now() / 1000);
  const parts = [{ alg: 'RS256', kid: 'invented_google_key', typ: 'JWT' }, { iss: 'https://accounts.google.com', aud: CLIENT, sub: BINDING.subject, email: BINDING.address, email_verified: true, nonce: NONCE, iat: now - 10, exp: now + 3600, ...claims }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url'));
  const content = parts.join('.');
  return `${content}.${sign('sha256', Buffer.from(content), badSignature ? other.privateKey : key.privateKey).toString('base64url')}`;
}
export function fixture(options = {}) {
  const calls = [], guards = [], hooks = {};
  let allowed = true;
  const transport = async (input, init) => {
    const url = String(input), headers = new Headers(init.headers);
    const form = new URLSearchParams(init.body);
    calls.push({ url, method: init.method, form, headers, redirect: init.redirect });
    if (hooks.before) await hooks.before(url, form);
    if (hooks.error) throw hooks.error;
    if (hooks.response) return hooks.response(url, form);
    if (url === 'https://www.googleapis.com/oauth2/v1/certs') return Response.json({ invented_google_key: key.publicKey.export({ type: 'spki', format: 'pem' }) });
    if (url === 'https://oauth2.googleapis.com/tokeninfo') return Response.json({ aud: CLIENT, sub: BINDING.subject, email: BINDING.address, scope: GOOGLE_MAIL_SCOPES.join(' '), expires_in: 3600, ...hooks.info });
    if (url !== 'https://oauth2.googleapis.com/token') throw new Error('Unexpected endpoint; no real fetch allowed.');
    return Response.json({ access_token: ACCESS, token_type: 'Bearer', expires_in: 3600, scope: GOOGLE_MAIL_SCOPES.join(' '), ...(form.get('grant_type') === 'authorization_code' ? { id_token: idToken(hooks.claims, hooks.badSignature), refresh_token: REFRESH } : {}), ...hooks.tokens });
  };
  const adapter = createGoogleOAuthAdapter({ clientId: CLIENT, clientSecret: 'invented_client_secret', callbackUri: CALLBACK, executionMode: 'configured', transport, isAuthorized: async (binding, operation) => { guards.push({ binding, operation }); if (hooks.guard) return hooks.guard(binding, operation); return allowed; }, ...options });
  return { adapter, hooks, calls, guards, deny() { allowed = false; }, exchange: (input = {}) => adapter.exchange({ binding: BINDING, code: 'invented_single_use_code', codeVerifier: VERIFIER, nonce: NONCE, ...input }) };
}
