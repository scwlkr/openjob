import { OAuth2Client, CodeChallengeMethod, type Credentials } from 'google-auth-library';
import type { ProviderVaultEntry } from './provider-token-vault.ts';
import { oauthId, oauthOpaque } from './provider-oauth-types.ts';
import { configureGoogleOAuthTransport, GoogleOAuthAdapterError, googleOAuthFail, type GoogleOAuthTransport } from './google-oauth-transport.ts';

export { GoogleOAuthAdapterError } from './google-oauth-transport.ts';
export const GOOGLE_MAIL_SCOPES: readonly string[] = Object.freeze(['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly']);
export const GOOGLE_REVOCATION_IMPACT = 'all_google_oauth_grants_in_project' as const;
export type GoogleOAuthBinding = Pick<ProviderVaultEntry, 'ownerId' | 'accountId' | 'subject' | 'credentialRef' | 'revision'> & { address: string };
/** PRIVATE server-only result; never return through application API/CLI DTOs. */
export type PrivateGoogleGrant = { binding: GoogleOAuthBinding; entry: ProviderVaultEntry; refreshToken: string };
type Options = {
  executionMode?: 'disabled' | 'configured';
  clientId: string; clientSecret: string; callbackUri: string;
  transport?: GoogleOAuthTransport;
  /** Caller must check current owner, consent/home and exact binding/revision. */
  isAuthorized(binding: GoogleOAuthBinding, operation: 'consent' | 'refresh'): Promise<boolean>;
};
const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._~+\/-]{1,8192}={0,2}$/.test(value);
const email = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const verifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
const nonce = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function scopes(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(scope => typeof scope !== 'string')) googleOAuthFail('scope_mismatch');
  const normalized = value.map(scope => scope === 'https://www.googleapis.com/auth/userinfo.email' ? 'email' : scope);
  if (new Set(normalized).size !== 3 || normalized.length !== 3 || normalized.some(scope => !GOOGLE_MAIL_SCOPES.includes(scope))) googleOAuthFail('scope_mismatch');
  return [...GOOGLE_MAIL_SCOPES];
}
function binding(value: GoogleOAuthBinding): GoogleOAuthBinding {
  if (!value || Object.keys(value).sort().join(',') !== 'accountId,address,credentialRef,ownerId,revision,subject' || !oauthId(value.ownerId) || !oauthId(value.accountId) || !oauthOpaque(value.subject, 255) || !oauthOpaque(value.credentialRef, 512) || !oauthOpaque(value.revision, 128) || !email(value.address)) googleOAuthFail('invalid_input');
  return Object.freeze({ ...value });
}
function entryBinding(target: GoogleOAuthBinding) {
  const { ownerId, accountId, subject, credentialRef, revision } = target;
  return { ownerId, accountId, subject, credentialRef, revision };
}
function expiry(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= Date.now() || value > Date.now() + 86_400_000) googleOAuthFail('credential_expired');
  return value;
}

/** Lower-level real protocol adapter. No routes, stores, live composition or revocation. */
export function createGoogleOAuthAdapter(options: Options) {
  const { executionMode = 'disabled', clientId, clientSecret, callbackUri, transport, isAuthorized } = options;
  let uri: URL; try { uri = new URL(callbackUri); } catch { return googleOAuthFail('invalid_configuration'); }
  if (!['disabled', 'configured'].includes(executionMode) || !oauthOpaque(clientId, 256) || !oauthOpaque(clientSecret, 8192) || uri.protocol !== 'https:' || uri.username || uri.password || uri.hash || uri.search || uri.href !== callbackUri || typeof isAuthorized !== 'function' || executionMode === 'configured' && typeof transport !== 'function') googleOAuthFail('invalid_configuration');
  const enabled = () => { if (executionMode !== 'configured') googleOAuthFail('execution_disabled'); };
  async function authorized(value: GoogleOAuthBinding, operation: 'consent' | 'refresh') {
    let result = false; try { result = await isAuthorized(value, operation); } catch { /* deny without exposing caller errors */ }
    if (result !== true) googleOAuthFail('authorization_denied');
  }
  function client() {
    const value = new OAuth2Client({ clientId, clientSecret, redirectUri: callbackUri });
    configureGoogleOAuthTransport(value, transport!);
    return value;
  }
  async function checkedInfo(value: OAuth2Client, credentials: Credentials, target: GoogleOAuthBinding, operation: 'consent' | 'refresh') {
    if (!token(credentials.access_token) || credentials.token_type?.toLowerCase() !== 'bearer') googleOAuthFail('invalid_token_response');
    const expiresAt = expiry(credentials.expiry_date);
    if (credentials.scope !== undefined) scopes(credentials.scope.split(' '));
    await authorized(target, operation);
    const info = await value.getTokenInfo(credentials.access_token);
    scopes(info.scopes);
    if (info.aud !== clientId || info.sub !== target.subject || info.azp !== undefined && info.azp !== clientId || info.email !== undefined && info.email.toLowerCase() !== target.address.toLowerCase()) googleOAuthFail('identity_mismatch');
    return { accessToken: credentials.access_token, subject: target.subject, scopes: [...GOOGLE_MAIL_SCOPES], expiresAt: Math.min(expiresAt, expiry(info.expiry_date)) };
  }
  async function safe<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      // OAuth/library errors may contain code, token, secret, response or request.
      if (error instanceof GoogleOAuthAdapterError) throw error;
      const response = (error as { response?: { data?: { error?: unknown } } })?.response;
      if (response?.data?.error === 'invalid_grant') googleOAuthFail('reauthorization_required');
      return googleOAuthFail('provider_unavailable');
    }
  }
  return {
    /** Caller persists PKCE privately BEFORE sending the separately returned URL. */
    async proofKey() { enabled(); return client().generateCodeVerifierAsync(); },
    async authorizationUrl(input: { binding: GoogleOAuthBinding; state: string; nonce: string; codeChallenge: string }) {
      enabled(); const target = binding(input.binding);
      if (!nonce(input.state) || !nonce(input.nonce) || !nonce(input.codeChallenge)) googleOAuthFail('invalid_input');
      const { state, nonce: expectedNonce, codeChallenge } = input;
      return safe(async () => {
        await authorized(target, 'consent');
        return client().generateAuthUrl({ access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: false, scope: [...GOOGLE_MAIL_SCOPES], state, nonce: expectedNonce, code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256, login_hint: target.address });
      });
    },
    /** Caller MUST atomically consume owner-bound state/callback before this call. */
    async exchange(input: { binding: GoogleOAuthBinding; code: string; codeVerifier: string; nonce: string }): Promise<PrivateGoogleGrant> {
      enabled(); const target = binding(input.binding);
      if (!oauthOpaque(input.code, 4096) || !verifier(input.codeVerifier) || !nonce(input.nonce)) googleOAuthFail('invalid_input');
      const { code, codeVerifier, nonce: expectedNonce } = input;
      return safe(async () => {
        await authorized(target, 'consent'); const value = client();
        const { tokens } = await value.getToken({ code, codeVerifier });
        await authorized(target, 'consent');
        if (!token(tokens.refresh_token) || !oauthOpaque(tokens.id_token, 16384)) googleOAuthFail('invalid_token_response');
        const ticket = await value.verifyIdToken({ idToken: tokens.id_token, audience: clientId, maxExpiry: 3600 });
        const identity = ticket.getPayload();
        if (!identity || identity.nonce !== expectedNonce || identity.sub !== target.subject || identity.email_verified !== true || !email(identity.email) || identity.email.toLowerCase() !== target.address.toLowerCase() || identity.azp !== undefined && identity.azp !== clientId || identity.exp * 1000 <= Date.now() || identity.iat * 1000 > Date.now() + 30_000) googleOAuthFail('identity_mismatch');
        const credential = await checkedInfo(value, tokens, target, 'consent');
        await authorized(target, 'consent'); expiry(credential.expiresAt);
        return { binding: { ...target }, entry: { ...entryBinding(target), provider: 'gmail', credential }, refreshToken: tokens.refresh_token };
      });
    },
    /** Private caller owns CAS persistence/serialization; no automatic network retry. */
    async refresh(grant: PrivateGoogleGrant): Promise<PrivateGoogleGrant> {
      enabled(); const target = binding(grant.binding);
      if (!token(grant.refreshToken) || !grant.entry || grant.entry.provider !== 'gmail' || ['ownerId', 'accountId', 'subject', 'credentialRef', 'revision'].some(key => grant.entry[key as keyof ProviderVaultEntry] !== target[key as keyof GoogleOAuthBinding]) || grant.entry.credential?.subject !== target.subject) googleOAuthFail('invalid_input');
      scopes(grant.entry.credential.scopes);
      const refreshToken = grant.refreshToken;
      return safe(async () => {
        await authorized(target, 'refresh'); const value = client();
        // refreshAccessToken restores the old refresh token even if upstream rotates
        // it. Read the raw token event to retain a rotation for the caller's CAS.
        let rotated: string | undefined;
        value.on('tokens', tokens => { if (tokens.refresh_token !== undefined) { if (!token(tokens.refresh_token)) googleOAuthFail('invalid_token_response'); rotated = tokens.refresh_token; } });
        value.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await value.refreshAccessToken();
        await authorized(target, 'refresh');
        const credential = await checkedInfo(value, credentials, target, 'refresh');
        await authorized(target, 'refresh'); expiry(credential.expiresAt);
        return { binding: { ...target }, entry: { ...entryBinding(target), provider: 'gmail', credential }, refreshToken: rotated ?? refreshToken };
      });
    },
    // Deliberately no revoke method: Google's endpoint impacts ALL project grants.
    revocationImpact: GOOGLE_REVOCATION_IMPACT,
  };
}
