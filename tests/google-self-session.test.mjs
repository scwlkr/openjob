import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoogleSelfSession } from '../server/connections/google-self-session.ts';
import { fixture as googleFixture, idToken } from './support/google-oauth-transport.mjs';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
const NOW = Date.now(), ORIGIN = 'http://127.0.0.1:5202', CLIENT = 'invented.apps.googleusercontent.com', ADDRESS = 'alex@example.invalid', ACCESS = 'invented_access';
async function fixture() {
  const authority = await createTestFirebaseAuthority({ projectId: 'openjob-nonprod', now: new Date(NOW).toISOString() });
  const token = await authority.issue({ uid: 'alex', claims: { email: undefined } });
  const signedGoogle = googleFixture();
  const googleProof = idToken({ aud: CLIENT, sub: 'alex-provider-subject', email: ADDRESS });
  const account = { localId: 'alex', validSince: String(Math.floor(NOW / 1000) - 100), providerUserInfo: [{ providerId: 'google.com', rawId: 'alex-provider-subject', email: ADDRESS }] };
  const hooks = {}, calls = [];
  const identityTransport = async (url, init) => {
    if (String(url).includes('/jwk/')) return authority.fetch(url, init);
    assert.equal(String(url), 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=invented-public-key');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.deepEqual(Object.keys(JSON.parse(init.body)), ['idToken']); assert.equal(new Headers(init.headers).has('authorization'), false);
    calls.push('self'); await hooks.self?.();
    return Response.json({ users: [account], ...hooks.lookup }, { status: hooks.status ?? 200 });
  };
  const googleTransport = async (url, init) => {
    if (String(url) === 'https://www.googleapis.com/oauth2/v1/certs') return signedGoogle.transport(url, init);
    assert.equal(String(url), 'https://oauth2.googleapis.com/tokeninfo'); assert.equal(init.method, 'POST');
    calls.push('tokeninfo'); return Response.json({ aud: CLIENT, sub: 'alex-provider-subject', email: ADDRESS, email_verified: true, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly', expires_in: 3600 });
  };
  const mailTransport = async (url, init) => {
    assert.equal(new URL(url).origin, 'https://gmail.googleapis.com'); assert.equal(init.method, 'GET'); calls.push('mail'); await hooks.mail?.();
    if (String(url).endsWith('/profile')) return Response.json({ emailAddress: ADDRESS });
    if (String(url).endsWith('/labels')) return Response.json({ labels: [] });
    assert.equal(new URL(url).searchParams.get('maxResults'), '10'); return Response.json({ messages: [] });
  };
  const configuration = { projectId: 'openjob-nonprod', apiKey: 'invented-public-key', origin: ORIGIN, address: ADDRESS, clientId: CLIENT };
  const runtime = createGoogleSelfSession({ configuration, identityTransport, googleTransport, mailTransport, now: () => hooks.now ?? NOW });
  const request = (path, { proof = token, origin = ORIGIN, googleIdentity = googleProof, id, body = {}, method = 'POST' } = {}) => runtime.fetch(new Request(ORIGIN + path, { method, headers: { authorization: `Bearer ${proof}`, origin, 'content-type': 'application/json', ...(googleIdentity ? { 'x-openjob-google-identity': googleIdentity } : {}), ...(id ? { 'x-openjob-mail-session': id } : {}) }, ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }) }));
  const call = async (path, options) => { const r = await request('/api/v1/connections/session' + path, options); assert.equal(r.status, 200, await r.clone().text()); const text = await r.text(); assert.equal(text.includes(token), false); assert.equal(text.includes(ACCESS), false); return JSON.parse(text).data; };
  return { authority, token, account, configuration, identityTransport, googleTransport, mailTransport, hooks, calls, runtime, request, call };
}
test('self-authenticated session reads without any database/operator request and disconnects', async () => {
  const f = await fixture(); assert.equal((await f.call('/status')).address, ADDRESS);
  const { sessionId: id } = await f.call('/begin');
  await f.call('/connect', { id, body: { accessToken: ACCESS } });
  assert.equal((await f.call('/mail', { id })).page.messages.length, 0);
  await f.call('', { id, method: 'DELETE' });
  assert.equal((await f.request('/api/v1/connections/session/mail', { id })).status, 409);
  assert.ok(f.calls.includes('mail')); assert.ok(f.calls.includes('self'));
});
test('wrong project, forged token, agents, origin and saved-work routes deny', async () => {
  const f = await fixture();
  for (const proof of ['oj_agent', await f.authority.issue({ uid: 'alex', signer: 'rogue' }), await f.authority.issue({ uid: 'alex', claims: { aud: 'openjob-dev' } })]) assert.notEqual((await f.request('/api/v1/connections/session/status', { proof })).status, 200);
  assert.equal((await f.request('/api/v1/connections/session/status', { origin: 'null' })).status, 403);
  for (const path of ['/api/v1/me', '/api/v1/workspaces', '/api/v1/workspace/tasks', '/api/v1/connections/session/send', '/api/v1/connections/session/refresh', '/api/v1/connections/session/calendar']) assert.equal((await f.request(path)).status, 404);
  assert.equal(f.calls.length, 0);
});
test('self lookup fails closed on removed, disabled, unverified, mismatched or revoked identity', async () => {
  for (const changes of [{ disabled: true }, { localId: 'foreign' }, { providerUserInfo: [{ providerId: 'google.com', rawId: 'alex-provider-subject', email: 'foreign@example.invalid' }] }, { providerUserInfo: [] }, { providerUserInfo: [{ providerId: 'google.com', rawId: 'foreign' }] }, { validSince: String(Math.ceil(NOW / 1000)) }, { validSince: undefined }]) {
    const f = await fixture(); Object.assign(f.account, changes); assert.equal((await f.request('/api/v1/connections/session/status')).status, 401); assert.equal(f.calls.includes('tokeninfo'), false);
  }
  const f = await fixture(); f.hooks.lookup = { users: [] }; assert.equal((await f.request('/api/v1/connections/session/status')).status, 401);
  f.hooks.status = 503; assert.equal((await f.request('/api/v1/connections/session/status')).status, 503);
});
test('learned UID and original authentication event remain pinned; revocation during read discards result', async () => {
  const f = await fixture(), { sessionId: id } = await f.call('/begin'); await f.call('/connect', { id, body: { accessToken: ACCESS } });
  const fresh = await f.authority.issue({ uid: 'alex', claims: { auth_time: Math.floor(NOW / 1000) - 10 } });
  assert.equal((await f.request('/api/v1/connections/session/mail', { id, proof: fresh })).status, 409);
  f.hooks.mail = async () => { f.account.validSince = String(Math.ceil(NOW / 1000)); };
  assert.notEqual((await f.request('/api/v1/connections/session/mail', { id })).status, 200);
  f.account.validSince = String(Math.floor(NOW / 1000) - 100); f.account.localId = 'replacement'; f.account.providerUserInfo = [{ providerId: 'google.com', rawId: 'replacement-provider-subject' }];
  const replacement = await f.authority.issue({ uid: 'replacement' });
  assert.equal((await f.request('/api/v1/connections/session/status', { proof: replacement, googleIdentity: idToken({ aud: CLIENT, sub: 'replacement-provider-subject', email: ADDRESS }) })).status, 403);
});
test('configuration cannot admit production or non-loopback', async () => {
  const f = await fixture();
  for (const changes of [{ projectId: 'openjob-dev' }, { origin: 'https://example.invalid' }, { address: '' }]) assert.throws(() => createGoogleSelfSession({ configuration: { ...f.configuration, ...changes }, identityTransport: f.identityTransport, googleTransport: f.googleTransport, mailTransport: f.mailTransport }));
});

test('realistic provider-only Firebase account verifies with signed Google email, not optional primary fields', async () => {
  const f = await fixture();
  assert.equal(f.account.email, undefined); assert.equal(f.account.emailVerified, undefined);
  assert.equal((await f.call('/status')).address, ADDRESS);
  const status = await f.runtime.publicStatus().json();
  assert.deepEqual(status.accountShape, { primaryEmail: false, googleProvider: true, providerEmail: true });
  assert.equal(status.lastAccountCheck, 'ready'); assert.equal(status.mailReads, 0);
  // A separate top-level address cannot override Google's signed provider identity.
  f.account.email = 'other@example.invalid'; f.account.emailVerified = false;
  assert.equal((await f.call('/status')).address, ADDRESS);
  assert.equal(f.calls.includes('tokeninfo'), false); assert.equal(f.calls.includes('mail'), false);
});

test('provider metadata alone never authorizes email; signed Google proof must match Firebase subject and client', async () => {
  for (const googleIdentity of ['', idToken({}, true), idToken({ aud: 'other-client' }), idToken({ aud: CLIENT, sub: 'other' }), idToken({ aud: CLIENT, sub: 'alex-provider-subject', email: ADDRESS, email_verified: false }), idToken({ aud: CLIENT, sub: 'alex-provider-subject', email: ADDRESS, exp: Math.floor(NOW / 1000) - 600 }), idToken({ aud: CLIENT, sub: 'alex-provider-subject', email: ADDRESS, iss: 'https://evil.example.invalid' }), idToken({ aud: CLIENT, sub: 'alex-provider-subject', email: ADDRESS, azp: 'other' })]) {
    const f = await fixture(); const response = await f.request('/api/v1/connections/session/status', { googleIdentity });
    assert.equal(response.status, 401); assert.equal((await response.json()).error.code, 'identity_proof_required');
    assert.equal(f.calls.includes('tokeninfo'), false); assert.equal(f.calls.includes('mail'), false);
  }
  const f = await fixture();
  assert.equal((await f.request('/api/v1/connections/session/status', { googleIdentity: idToken({ aud: CLIENT, sub: 'alex-provider-subject', email: 'other@example.invalid' }) })).status, 401);
});

test('Google identity expiry during a delayed Mail read discards the result', async () => {
  const f = await fixture();
  const googleIdentity = idToken({ aud: CLIENT, sub: 'alex-provider-subject', email: ADDRESS, exp: Math.floor(NOW / 1000) + 30 });
  const { sessionId: id } = await f.call('/begin', { googleIdentity });
  await f.call('/connect', { id, googleIdentity, body: { accessToken: ACCESS } });
  f.hooks.mail = async () => { f.hooks.now = NOW + 31000; };
  const response = await f.request('/api/v1/connections/session/mail', { id, googleIdentity });
  assert.notEqual(response.status, 200);
  assert.equal((await f.runtime.publicStatus().json()).mailReads, 0);
});
