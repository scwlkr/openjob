import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { googleFlowFixture, CALLBACK } from './support/google-connection-flow.mjs';
import { BINDING, ACCESS, REFRESH } from './support/google-oauth-transport.mjs';
import { createConnectionsApi } from '../server/connections/api.ts';
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('Real provider network forbidden.'); }; });
after(() => { globalThis.fetch = realFetch; });

test('signed HTTP first consent binds verified subject, survives flow reconstruction, refreshes, reads fake Mail and reconnects same home', async () => {
  const f = await googleFlowFixture(), start = await f.begin();
  let catalog = await f.call(); assert.equal(catalog.mode, 'google-fixture'); assert.equal(catalog.bindings[0].status, 'consent_required');
  const pending = f.envelopes.get(f.owner)[0]; assert.equal(pending.subject, undefined); assert.equal(pending.pending.verifier.length >= 43, true);
  f.reconstruct(); assert.deepEqual(await f.complete(start), { status: 'connected' });
  const stored = f.envelopes.get(f.owner)[0]; assert.equal(stored.subject, BINDING.subject); assert.equal(stored.pending, undefined); assert.equal(stored.grant.refreshToken, REFRESH);
  catalog = await f.call(); assert.equal(catalog.bindings[0].status, 'connected'); assert.equal([ACCESS, REFRESH, stored.credentialRef, start.state].some(value => JSON.stringify(catalog).includes(value)), false);
  await f.call(`/${start.connectionId}`, { action: 'refresh' }); f.reconstruct();
  assert.equal((await f.call(`/${start.connectionId}/mail`)).page.messages[0].body, 'Invented connected message.');
  await f.call(`/${start.connectionId}`, { action: 'disconnect' }); assert.equal(f.envelopes.get(f.owner)[0].grant, undefined);
  assert.equal((await f.request(`/${start.connectionId}/mail`)).status, 409);
  const reconnect = await f.begin(); assert.equal(reconnect.connectionId, start.connectionId); await f.complete(reconnect);
  assert.equal((await f.call()).bindings[0].workspaceId, f.home);
});

test('foreign identities, agents, origin mismatch and unconfigured roots cannot start, consume state or read Mail', async () => {
  const f = await googleFlowFixture(), start = await f.begin(), callbacks = { state: start.state, code: 'invented', callbackUri: CALLBACK };
  assert.equal((await f.request('/google/callback', callbacks, 'sam')).status, 409);
  assert.equal((await f.request(`/${start.connectionId}/mail`, undefined, 'sam')).status, 403);
  assert.equal((await f.request('', undefined, 'oj_agent_x')).status, 401);
  assert.equal((await f.request('', { address: BINDING.address, workspaceId: f.home }, 'alex', f.googleApi, { origin: 'https://foreign.invalid' })).status, 400);
  const unset = createConnectionsApi({ users: f.users, verifyIdToken: f.verifyIdToken });
  assert.equal((await f.request('/google/callback', callbacks, 'alex', unset)).status, 503);
  const disabled = f.reconstruct({ executionMode: 'disabled' }); assert.equal((await f.request('', undefined, 'alex', disabled.api)).status, 503);
  assert.equal(f.protocol.calls.length, 0);
  f.reconstruct(); await f.complete(start);
});

test('callback exact URI, selected address and sticky subject cannot retarget; consumed state admits one exchange', async () => {
  const f = await googleFlowFixture(), start = await f.begin();
  assert.equal((await f.request('/google/callback', { state: start.state, code: 'invented', callbackUri: CALLBACK + '/' })).status, 400);
  const results = await Promise.all([f.request('/google/callback', { state: start.state, code: 'invented', callbackUri: CALLBACK }), f.request('/google/callback', { state: start.state, code: 'invented', callbackUri: CALLBACK })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(f.protocol.calls.filter(row => row.form.get('grant_type') === 'authorization_code').length, 1);
  await f.call(`/${start.connectionId}`, { action: 'disconnect' }); const again = await f.begin(); f.protocol.hooks.claims.sub = 'different_subject'; f.protocol.hooks.info = { sub: 'different_subject' };
  assert.equal((await f.request('/google/callback', { state: again.state, code: 'invented', callbackUri: CALLBACK })).status, 409);
  assert.equal((await f.call()).bindings[0].status, 'reconnect_required');
  const wrong = await googleFlowFixture(), wrongStart = await wrong.begin(); wrong.protocol.hooks.claims.email = 'sam@example.invalid';
  assert.equal((await wrong.request('/google/callback', { state: wrongStart.state, code: 'invented', callbackUri: CALLBACK })).status, 409);
});

test('provider/user cancellation and expired state do not exchange, cancellation fences in-flight completion', async () => {
  const f = await googleFlowFixture(), start = await f.begin();
  await f.call('/google/callback', { state: start.state, error: 'access_denied', callbackUri: CALLBACK }); assert.equal((await f.call()).bindings[0].status, 'cancelled'); assert.equal(f.protocol.calls.length, 0);
  const second = await f.begin(); await f.call(`/${second.connectionId}`, { action: 'cancel' }); assert.equal((await f.request('/google/callback', { state: second.state, code: 'invented', callbackUri: CALLBACK })).status, 409);
  const expired = await f.begin(); f.envelopes.get(f.owner)[0].pending.expiresAt = Date.now() - 1; await f.complete(expired); assert.equal(f.protocol.calls.length, 0);
  const raced = await f.begin(); f.protocol.hooks.before = async (_url, form) => { if (form.get('grant_type') === 'authorization_code') await f.call(`/${raced.connectionId}`, { action: 'cancel' }); };
  assert.equal((await f.request('/google/callback', { state: raced.state, code: 'invented', callbackUri: CALLBACK })).status, 409);
  assert.equal((await f.call()).bindings[0].status, 'cleanup_pending'); assert.equal(f.envelopes.get(f.owner)[0].grant, undefined);
  await f.call(`/${raced.connectionId}`, { action: 'retry-cleanup' }); assert.equal((await f.call()).bindings[0].status, 'disconnected');
});

test('refresh serializes across instances; disconnect suppresses in-flight Mail; storage error never approves metadata', async () => {
  const f = await googleFlowFixture(), start = await f.begin(); await f.complete(start); const firstApi = f.googleApi, other = f.reconstruct();
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  f.protocol.hooks.before = async (_url, form) => { if (form.get('grant_type') === 'refresh_token') { entered(); await gate; } };
  const first = f.request(`/${start.connectionId}`, { action: 'refresh' }, 'alex', firstApi); await started;
  const second = await f.request(`/${start.connectionId}`, { action: 'refresh' }, 'alex', other.api); release();
  assert.deepEqual([(await first).status, second.status].sort(), [200, 409]); f.protocol.hooks.before = undefined;
  f.hooks.mail = async () => { await f.call(`/${start.connectionId}`, { action: 'disconnect' }); };
  assert.notEqual((await f.request(`/${start.connectionId}/mail`)).status, 200);
  const failure = await googleFlowFixture(), pending = await failure.begin(); failure.failStore(true);
  assert.equal((await failure.request('/google/callback', { state: pending.state, code: 'invented', callbackUri: CALLBACK })).status, 500); assert.equal(failure.protocol.calls.length, 0);
  assert.equal(failure.envelopes.get(failure.owner)[0].status, 'consent_required');
});


test('unsafe actions and inactive owners make no provider request; failed promotion and expiry stay denied', async () => {
  const f = await googleFlowFixture(), start = await f.begin();
  for (const action of ['send', 'grant', 'calendar.write']) assert.notEqual((await f.request(`/${start.connectionId}`, { action })).status, 200);
  assert.equal((await f.request('', { address: BINDING.address, workspaceId: f.home, scopes: ['mail.send'] })).status, 400);
  assert.equal((await f.request('', { address: BINDING.address, workspaceId: f.home }, 'sam')).status, 403);
  const inactive = f.reconstruct({ isOwnerActive: async () => false });
  assert.equal((await f.request('/google/callback', { state: start.state, code: 'invented', callbackUri: CALLBACK }, 'alex', inactive.api)).status, 403); assert.equal(f.protocol.calls.length, 0);
  f.reconstruct();
  f.protocol.hooks.before = async url => { if (url.endsWith('tokeninfo')) f.failStore(true); };
  assert.equal((await f.request('/google/callback', { state: start.state, code: 'invented', callbackUri: CALLBACK })).status, 409);
  assert.equal(f.envelopes.get(f.owner)[0].status, 'authorizing'); assert.equal(f.envelopes.get(f.owner)[0].grant, undefined); assert.equal(f.envelopes.get(f.owner)[0].pending, undefined);
  f.failStore(false); f.reconstruct(); await f.call(`/${start.connectionId}`, { action: 'cancel' }); assert.equal((await f.call()).bindings[0].status, 'cleanup_pending');
  const expired = await googleFlowFixture(), attempt = await expired.begin(); expired.protocol.hooks.before = async url => { if (url.endsWith('tokeninfo')) expired.envelopes.get(expired.owner)[0].consentExpiresAt = Date.now() - 1; };
  assert.equal((await expired.request('/google/callback', { state: attempt.state, code: 'invented', callbackUri: CALLBACK })).status, 409); assert.equal(expired.envelopes.get(expired.owner)[0].grant, undefined);
});
