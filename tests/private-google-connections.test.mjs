import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createFirestorePrivateGoogleConnections } from '../db/private-google-connections.ts';
import { privateGoogleStoreFixture as fixture } from './support/private-google-store.mjs';
import { BINDING, ACCESS, REFRESH } from './support/google-oauth-transport.mjs';
const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('Unexpected real network'); }; });
after(() => { globalThis.fetch = originalFetch; });

test('encrypted concrete Firestore flow persists pending and grants across reconstruction, refreshes and disconnects using fake Google', async () => {
  const f = await fixture(), start = await f.begin();
  const pending = (await f.store.read(f.owner))[0];
  let wire = JSON.stringify(f.db.documents.get(f.location));
  for (const secret of [pending.pending.verifier, pending.pending.nonce, BINDING.address, pending.credentialRef]) assert.equal(wire.includes(secret), false);
  const fresh = createFirestorePrivateGoogleConnections(f.options); f.reconstruct({ repository: fresh });
  await f.complete(start); assert.equal((await fresh.read(f.owner))[0].grant.refreshToken, REFRESH);
  wire = JSON.stringify(f.db.documents.get(f.location)); for (const secret of [ACCESS, REFRESH, BINDING.address]) assert.equal(wire.includes(secret), false);
  await f.call(`/${start.connectionId}`, { action: 'refresh' });
  assert.equal((await f.call(`/${start.connectionId}/mail`)).page.messages[0].body, 'Invented connected message.');
  await f.call(`/${start.connectionId}`, { action: 'disconnect' });
  assert.equal((await fresh.read(f.owner))[0].grant, undefined);
  assert.equal((await f.request(`/${start.connectionId}/mail`)).status, 409);
});

test('AES-GCM rejects tampering, wrong key/version, cross-owner and cross-database ciphertext copies', async () => {
  const f = await fixture(); await f.begin(); const original = structuredClone(f.db.documents.get(f.location));
  const sam = f.sessions.sam.user.userId, samLocation = f.client.documentName(`v1PrivateGoogleConnections/${sam}`);
  f.db.documents.set(samLocation, { ...structuredClone(original), name: samLocation });
  await assert.rejects(f.store.read(sam), error => error.code === 'unavailable');
  for (const change of [doc => { doc.fields.ciphertext.stringValue = (doc.fields.ciphertext.stringValue[0] === 'A' ? 'B' : 'A') + doc.fields.ciphertext.stringValue.slice(1); }, doc => { doc.fields.keyId.stringValue = 'other'; }, doc => { doc.fields.version.integerValue = '2'; }, doc => { doc.fields.extra = { stringValue: ACCESS }; }]) {
    const bad = structuredClone(original); change(bad); f.db.documents.set(f.location, bad);
    await assert.rejects(f.store.read(f.owner));
  }
  f.db.documents.set(f.location, original);
  const wrong = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(8), 'AES-GCM', false, ['encrypt', 'decrypt']);
  await assert.rejects(createFirestorePrivateGoogleConnections({ ...f.options, key: wrong }).read(f.owner), error => error.code === 'unavailable');
  const otherDb = { ...f.client, documentName: path => 'other-database/' + path, request: async (path, ...rest) => path.startsWith('v1Private') ? Response.json({ ...original, name: 'other-database/' + path }) : f.client.request(path, ...rest) };
  // Directory names also follow the alternate client; decrypt must bind exact path.
  otherDb.request = async (path, ...rest) => {
    if (path.startsWith('v1Private')) return Response.json({ ...original, name: otherDb.documentName(path) });
    const response = await f.client.request(path, ...rest), doc = await response.json(); return Response.json({ ...doc, name: otherDb.documentName(path) });
  };
  await assert.rejects(createFirestorePrivateGoogleConnections({ ...f.options, db: otherDb }).read(f.owner));
});

test('competing store instances use CAS, without duplicated consent', async () => {
  const f = await fixture(); f.db.synchronizeNextCommits(2);
  const other = createFirestorePrivateGoogleConnections(f.options);
  const mutation = store => store.change(f.owner, rows => { if (rows.length) throw Object.assign(new Error('conflict'), { code: 'conflict' }); return []; });
  // Two empty changes contend on the same missing document; both converge by retry.
  await Promise.all([mutation(f.store), mutation(other)]);
  assert.deepEqual(await other.read(f.owner), []);
  const start = await f.begin();
  const responses = await Promise.all([f.request('/google/callback', { state: start.state, code: 'invented', callbackUri: f.flowOptions.google.callbackUri }), f.request('/google/callback', { state: start.state, code: 'invented', callbackUri: f.flowOptions.google.callbackUri })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.protocol.calls.filter(row => row.form?.get('grant_type') === 'authorization_code').length, 1);
});

test('lost successful commit response never reruns apply; inactive/deletion-racing owners cannot write or read', async () => {
  const f = await fixture(); let commits = 0, applied = 0;
  const uncertain = { ...f.client, request: async (path, ...rest) => {
    const response = await f.client.request(path, ...rest);
    if (path === ':commit') { commits++; throw new Error('lost response ' + ACCESS); }
    return response;
  } };
  const store = createFirestorePrivateGoogleConnections({ ...f.options, db: uncertain });
  await assert.rejects(store.change(f.owner, rows => { applied++; return rows; }), error => error.code === 'unavailable' && !error.message.includes(ACCESS));
  assert.equal(commits, 1); assert.equal(applied, 1); assert.deepEqual(await f.store.read(f.owner), []);
  const directory = f.client.documentName(`v1UserDirectory/${f.owner}`), doc = f.db.documents.get(directory);
  const racing = { ...f.client, request: async (path, ...rest) => {
    if (path === ':commit') { const next = structuredClone(f.db.documents.get(directory)); next.fields.deletionState = { stringValue: 'pending' }; next.updateTime += '-deleted'; f.db.documents.set(directory, next); }
    return f.client.request(path, ...rest);
  } };
  await assert.rejects(createFirestorePrivateGoogleConnections({ ...f.options, db: racing }).change(f.owner, rows => rows), error => error.code === 'forbidden');
  await assert.rejects(f.store.read(f.owner), error => error.code === 'forbidden');
  f.db.documents.set(directory, doc);
});

test('disabled store makes no call; missing/extractable keys rejected; expiration erases pending secrets; oversized envelope rejected', async () => {
  const f = await fixture(); let calls = 0;
  const disabled = createFirestorePrivateGoogleConnections({ ...f.options, executionMode: 'disabled', db: { ...f.client, request: async () => { calls++; throw new Error('must not call'); } } });
  await assert.rejects(disabled.read(f.owner), error => error.code === 'not_configured'); assert.equal(calls, 0);
  await assert.rejects(createFirestorePrivateGoogleConnections({ ...f.options, key: undefined }).read(f.owner), error => error.code === 'not_configured');
  const key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'AES-GCM', true, ['encrypt', 'decrypt']);
  await assert.rejects(createFirestorePrivateGoogleConnections({ ...f.options, key }).read(f.owner), error => error.code === 'not_configured');
  const start = await f.begin(); const before = (await f.store.read(f.owner))[0];
  assert.equal(await f.store.cleanupExpiredForOwner(f.owner, before.pending.expiresAt), 1);
  const row = (await f.store.read(f.owner))[0]; assert.equal(row.pending, undefined); assert.equal(row.status, 'reconnect_required');
  assert.equal((await f.request('/google/callback', { state: start.state, code: 'invented', callbackUri: f.flowOptions.google.callbackUri })).status, 409);
  const original = structuredClone(f.db.documents.get(f.location));
  await assert.rejects(f.store.change(f.owner, rows => [{ ...rows[0], extra: '界'.repeat(210000) }]), error => error.code === 'capacity');
  assert.deepEqual(f.db.documents.get(f.location), original);
});
