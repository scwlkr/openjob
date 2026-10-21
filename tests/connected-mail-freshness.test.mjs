import assert from 'node:assert/strict';
import test from 'node:test';
import { mailReadFreshness, mailReadWindow, mailWindowExpired } from '../shared/connected-mail-freshness.ts';
import { googleFlowFixture } from './support/google-connection-flow.mjs';

test('metadata deadlines cap cache/credential lifetime and include transit without trusting client wall time', () => {
  const server = Date.parse('2030-01-01T00:00:00Z');
  const normal = mailReadFreshness(server, server + 3_600_000);
  assert.deepEqual(normal, { observedAt: '2030-01-01T00:00:00.000Z', staleAt: '2030-01-01T00:01:00.000Z', expiresAt: '2030-01-01T00:05:00.000Z' });
  const short = mailReadWindow(mailReadFreshness(server, server + 15_000), 100, 1_000);
  assert.equal(short.expiryDeadline, 15_100); assert.equal(short.staleDeadline, 15_100);
  const delayed = mailReadWindow(normal, 50, 1_000);
  assert.equal(delayed.expiryDeadline, 300_050); assert.equal(delayed.staleDeadline, 60_050);
  // The same duration has the same monotonic limit even when server/client wall clocks disagree.
  const shifted = mailReadWindow(mailReadFreshness(server + 86_400_000, server + 86_400_000 + 3_600_000), 50, 1_000);
  assert.equal(shifted.expiryDeadline, delayed.expiryDeadline);
  assert.equal(mailWindowExpired(delayed, 50, 301_000), true); // OS sleep: monotonic time paused, wall time advanced.
  assert.equal(mailWindowExpired(delayed, 300_050, 500), true); // Wall time moved backward; monotonic bound still expires.
  assert.equal(mailWindowExpired(delayed, 50, 1_000), false);
  assert.throws(() => mailReadWindow({ ...normal, expiresAt: '2030-01-01T01:00:00.000Z' }, 50, 1_000));
  assert.throws(() => mailReadWindow({ ...normal, staleAt: '2029-01-01T00:00:00.000Z' }, 50, 1_000));
  assert.throws(() => mailReadWindow({ ...normal, extra: 'ignored?' }, 50, 1_000));
  assert.throws(() => mailReadFreshness(server, server));
});

test('configured metadata observation is conservative, capped by credential expiry and not persisted; legacy full DTO stays exact', async t => {
  const f = await googleFlowFixture(), start = await f.begin(); await f.complete(start);
  let now = Date.now() + 17_000; t.mock.method(Date, 'now', () => now);
  f.envelopes.get(f.owner)[0].grant.entry.credential.expiresAt = now + 15_000;
  const before = f.db.exportState(), observed = now;
  f.hooks.mail = url => { if (url.pathname.endsWith('/messages/m1')) now += 1000; };
  const metadata = await f.call(`/${start.connectionId}/mail?view=metadata`);
  assert.equal(metadata.freshness.observedAt, new Date(observed).toISOString());
  assert.equal(metadata.freshness.expiresAt, new Date(observed + 15_000).toISOString());
  assert.equal(metadata.freshness.staleAt, metadata.freshness.expiresAt);
  assert.deepEqual(f.db.exportState(), before);
  assert.equal(Object.hasOwn(metadata.page.messages[0], 'body'), false);
  assert.deepEqual(Object.keys(await f.call(`/${start.connectionId}/mail`)).sort(), ['mode', 'page', 'workspaceId']);
  now = observed;
  f.hooks.mail = url => { if (url.pathname.endsWith('/messages/m1')) now = observed + 16_000; };
  const expired = await f.request(`/${start.connectionId}/mail?view=metadata`);
  assert.equal(expired.status, 409); assert.equal((await expired.json()).error.code, 'reconnect_required');
});

test('fixed provider access errors remain blocked categories and a concurrent disconnect overrides provider failure', async () => {
  const f = await googleFlowFixture(), start = await f.begin(); await f.complete(start);
  const signedOut = await f.request(`/${start.connectionId}/mail?view=metadata`, undefined, 'unknown-session');
  assert.equal(signedOut.status, 401); assert.equal((await signedOut.json()).error.code, 'authentication_required');
  for (const [status, reason, code, expected] of [[401, 'authError', 'reconnect_required', 409], [403, 'insufficientPermissions', 'consent_required', 409], [403, 'domainPolicy', 'provider_forbidden', 403]]) {
    let calls = 0;
    f.hooks.response = () => { calls++; return Response.json({ error: { message: 'SECRET_PROVIDER_BODY', errors: [{ reason }] } }, { status }); };
    const response = await f.request(`/${start.connectionId}/mail?view=metadata`);
    assert.equal(response.status, expected); const result = await response.json(); assert.equal(result.error.code, code); assert.doesNotMatch(JSON.stringify(result), /SECRET_PROVIDER_BODY|freshness|messages/); assert.equal(calls, 1);
  }
  f.hooks.response = async url => {
    if (url.pathname.endsWith('/messages/m1')) { await f.flow.act(f.owner, start.connectionId, 'disconnect'); return new Response('SECRET_PROVIDER_BODY', { status: 503 }); }
  };
  const raced = await f.request(`/${start.connectionId}/mail?view=metadata`);
  assert.equal(raced.status, 409); assert.equal((await raced.json()).error.code, 'reconnect_required');
  let calls = 0; f.hooks.mail = () => { calls++; };
  assert.equal((await f.request(`/${start.connectionId}/mail?view=metadata`)).status, 409); assert.equal(calls, 0);
});
