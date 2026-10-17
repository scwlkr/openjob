import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createProviderTokenVaultBroker } from '../server/providers/provider-token-vault.ts';
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('Real network forbidden in adapter proof.'); }; });
after(() => { globalThis.fetch = realFetch; });
import { createGoogleOAuthAdapter, GOOGLE_MAIL_SCOPES, GOOGLE_REVOCATION_IMPACT } from '../server/providers/google-oauth-adapter.ts';
import { fixture, BINDING, CLIENT, CALLBACK, NONCE, STATE, VERIFIER, ACCESS, REFRESH } from './support/google-oauth-transport.mjs';
const denied = code => error => { assert.equal(error.code, code); assert.equal(error.cause, undefined); assert.equal(JSON.stringify(error).includes(ACCESS), false); return true; };

test('official library builds offline narrow PKCE URL and performs signed code exchange, token inspection and private broker output', async () => {
  const f = fixture(), proof = await f.adapter.proofKey();
  assert.match(proof.codeVerifier, /^[A-Za-z0-9._~-]{43,128}$/); assert.match(proof.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(await f.adapter.authorizationUrl({ binding: BINDING, state: STATE, nonce: NONCE, codeChallenge: proof.codeChallenge }));
  assert.equal(url.origin, 'https://accounts.google.com'); assert.equal(url.searchParams.get('client_id'), CLIENT); assert.equal(url.searchParams.get('redirect_uri'), CALLBACK);
  assert.equal(url.searchParams.get('state'), STATE); assert.equal(url.searchParams.get('nonce'), NONCE); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), proof.codeChallenge); assert.equal(url.searchParams.get('access_type'), 'offline'); assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.deepEqual(url.searchParams.get('scope').split(' '), GOOGLE_MAIL_SCOPES); assert.equal(url.href.includes('invented_client_secret'), false); assert.equal(f.calls.length, 0);
  const result = await f.exchange();
  assert.deepEqual(result.binding, BINDING); assert.equal(result.entry.provider, 'gmail'); assert.equal(result.entry.credential.accessToken, ACCESS); assert.equal(result.refreshToken, REFRESH);
  assert.equal(result.entry.credential.subject, BINDING.subject); assert.deepEqual(result.entry.credential.scopes, GOOGLE_MAIL_SCOPES); assert.equal(result.entry.credential.expiresAt > Date.now(), true);
  assert.equal(f.calls.length, 3); assert.equal(f.calls[0].form.get('code_verifier'), VERIFIER); assert.equal(f.calls[0].form.get('redirect_uri'), CALLBACK); assert.equal(f.calls[0].form.get('grant_type'), 'authorization_code');
  assert.equal(f.calls.every(row => row.redirect === 'error'), true); assert.equal(f.calls[2].headers.get('authorization'), `Bearer ${ACCESS}`);
  assert.equal('refreshToken' in result.entry, false); assert.equal('address' in result.entry, false); assert.equal('revoke' in f.adapter, false); assert.equal(f.adapter.revocationImpact, GOOGLE_REVOCATION_IMPACT);
});

test('default-disabled and denied owner modes have no transport or secret/provider effects', async () => {
  const f = fixture({ executionMode: undefined });
  await assert.rejects(f.exchange(), denied('execution_disabled')); await assert.rejects(f.adapter.proofKey(), denied('execution_disabled'));
  await assert.rejects(f.adapter.authorizationUrl({ binding: BINDING, state: STATE, nonce: NONCE, codeChallenge: STATE }), denied('execution_disabled'));
  await assert.rejects(f.adapter.refresh({}), denied('execution_disabled')); assert.equal(f.calls.length, 0); assert.equal(f.guards.length, 0);
  const no = fixture(); no.deny(); await assert.rejects(no.exchange(), denied('authorization_denied')); assert.equal(no.calls.length, 0);
  const deniedOwner = fixture({ isAuthorized: async b => b.ownerId === BINDING.ownerId });
  await assert.rejects(deniedOwner.exchange({ binding: { ...BINDING, ownerId: 'user_sam' } }), denied('authorization_denied')); assert.equal(deniedOwner.calls.length, 0);
  assert.throws(() => createGoogleOAuthAdapter({ clientId: CLIENT, clientSecret: 'invented', callbackUri: CALLBACK, executionMode: 'configured', isAuthorized: async () => true }), denied('invalid_configuration'));
});

test('official signature/audience/issuer verification and explicit nonce/subject/address/expiry checks fail closed', async () => {
  for (const [claims, expected] of [[{ aud: 'wrong' }, 'provider_unavailable'], [{ iss: 'https://evil.example.invalid' }, 'provider_unavailable'], [{ nonce: STATE }, 'identity_mismatch'], [{ sub: 'other' }, 'identity_mismatch'], [{ email: 'sam@example.invalid' }, 'identity_mismatch'], [{ email_verified: false }, 'identity_mismatch'], [{ exp: Math.floor(Date.now() / 1000) - 1 }, 'identity_mismatch'], [{ azp: 'other' }, 'identity_mismatch']]) {
    const f = fixture(); f.hooks.claims = claims; await assert.rejects(f.exchange(), denied(expected)); assert.equal(f.calls.length, 2);
  }
  const bad = fixture(); bad.hooks.badSignature = true; await assert.rejects(bad.exchange(), denied('provider_unavailable')); assert.equal(bad.calls.length, 2);
});

test('actual tokeninfo narrows scope aliases but rejects missing/wider scopes, wrong audience/subject and expired tokens', async () => {
  const alias = fixture(); alias.hooks.info = { scope: GOOGLE_MAIL_SCOPES.map(scope => scope === 'email' ? 'https://www.googleapis.com/auth/userinfo.email' : scope).join(' ') }; assert.equal((await alias.exchange()).entry.credential.scopes.includes('email'), true);
  for (const scope of ['openid email', `${GOOGLE_MAIL_SCOPES.join(' ')} https://www.googleapis.com/auth/gmail.send`]) {
    const f = fixture(); f.hooks.info = { scope }; await assert.rejects(f.exchange(), denied('scope_mismatch'));
  }
  for (const info of [{ aud: 'other_client' }, { sub: 'foreign_subject' }, { email: 'sam@example.invalid' }, { azp: 'other' }]) { const f = fixture(); f.hooks.info = info; await assert.rejects(f.exchange(), denied('identity_mismatch')); }
  const expired = fixture(); expired.hooks.tokens = { expires_in: -1 }; await assert.rejects(expired.exchange(), denied('credential_expired'));
  const missing = fixture(); missing.hooks.tokens = { refresh_token: undefined }; await assert.rejects(missing.exchange(), denied('invalid_token_response'));
});

test('refresh validates broker binding and actual scopes; retains or rotates only the matching private token', async () => {
  const f = fixture(), grant = await f.exchange(); f.calls.length = 0;
  const refreshed = await f.adapter.refresh(grant); assert.equal(refreshed.refreshToken, REFRESH); assert.equal(refreshed.entry.credential.accessToken, ACCESS);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].form.get('grant_type'), 'refresh_token'); assert.equal(f.calls[0].form.get('refresh_token'), REFRESH); assert.equal(f.calls.some(row => row.url.includes('gmail.googleapis.com')), false);
  f.hooks.tokens = { refresh_token: 'invented_rotated_refresh' }; assert.equal((await f.adapter.refresh(refreshed)).refreshToken, 'invented_rotated_refresh'); assert.equal(grant.refreshToken, REFRESH);
  const before = f.calls.length;
  await assert.rejects(f.adapter.refresh({ ...grant, entry: { ...grant.entry, revision: 'stale' } }), denied('invalid_input')); assert.equal(f.calls.length, before);
  f.hooks.info = { sub: 'foreign_subject' }; await assert.rejects(f.adapter.refresh(grant), denied('identity_mismatch'));
});

test('revocation/deletion while exchange or refresh is in flight suppresses credentials and prevents later transport', async () => {
  const f = fixture(); f.hooks.before = async () => { f.deny(); }; await assert.rejects(f.exchange(), denied('authorization_denied')); assert.equal(f.calls.length, 1);
  const r = fixture(), grant = await r.exchange(); r.calls.length = 0; r.hooks.before = async () => { r.deny(); };
  await assert.rejects(r.adapter.refresh(grant), denied('authorization_denied')); assert.equal(r.calls.length, 1);
  const final = fixture(); final.hooks.before = async url => { if (url.endsWith('tokeninfo')) final.deny(); }; await assert.rejects(final.exchange(), denied('authorization_denied')); assert.equal(final.calls.length, 3);
});

test('redacted errors, 503 and redirect responses do not replay token POSTs; oversized responses are bounded', async () => {
  const f = fixture(); f.hooks.error = new Error(`${ACCESS} invented_client_secret request_and_response`); await assert.rejects(f.exchange(), denied('provider_unavailable')); assert.equal(f.calls.length, 1);
  const service = fixture(); service.hooks.response = () => Response.json({ error: 'temporarily_unavailable', error_description: ACCESS }, { status: 503 }); await assert.rejects(service.exchange(), denied('provider_unavailable')); assert.equal(service.calls.length, 1);
  const redirect = fixture(); redirect.hooks.response = () => new Response(null, { status: 302, headers: { location: 'https://evil.example.invalid' } }); await assert.rejects(redirect.exchange(), denied('provider_unavailable')); assert.equal(redirect.calls.length, 1);
  const large = fixture(); large.hooks.response = () => new Response('x'.repeat(128_001)); await assert.rejects(large.exchange(), denied('provider_unavailable')); assert.equal(large.calls.length, 1);
});

test('mutable caller input cannot retarget a checked attempt across an asynchronous guard', async () => {
  const f = fixture(); const input = { binding: { ...BINDING }, code: 'invented_single_use_code', codeVerifier: VERIFIER, nonce: NONCE };
  f.hooks.guard = async () => { input.binding.subject = 'foreign'; input.code = 'foreign_code'; input.nonce = STATE; return true; };
  const result = await f.adapter.exchange(input); assert.equal(result.binding.subject, BINDING.subject); assert.equal(f.calls[0].form.get('code'), 'invented_single_use_code');
});


test('private output fits the existing broker seam with invented metadata; mismatched/revoked binding denies', async () => {
  const f = fixture(), grant = await f.exchange();
  const row = { ...BINDING, label: 'Invented Gmail', provider: 'gmail', scopes: [...GOOGLE_MAIL_SCOPES], expiresAt: grant.entry.credential.expiresAt, state: 'approved', mode: 'mock' };
  const broker = createProviderTokenVaultBroker({ vault: { read: async ref => ref === row.credentialRef ? grant.entry : null }, connections: { getForOwner: async () => ({ ...row }), listForOwner: async () => [{ ...row }] }, isOwnerActive: async () => true, executionMode: 'mock' });
  const { ownerId, accountId, subject, revision } = BINDING;
  assert.equal((await broker.resolve(row.credentialRef, { ownerId, accountId, subject, revision, provider: 'gmail' })).accessToken, ACCESS);
  row.state = 'revoked'; await assert.rejects(broker.resolve(row.credentialRef, { ownerId, accountId, subject, revision, provider: 'gmail' }));
  const reconnect = fixture(); reconnect.hooks.response = () => Response.json({ error: 'invalid_grant', error_description: ACCESS }, { status: 400 });
  await assert.rejects(reconnect.exchange(), denied('reauthorization_required')); assert.equal(reconnect.calls.length, 1);
});
