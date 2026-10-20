import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createPrivateGoogleDeletionCleanup } from '../db/private-google-deletion.ts';
import { createFirestorePrivateGoogleConnections } from '../db/private-google-connections.ts';
import { privateGoogleStoreFixture as fixture } from './support/private-google-store.mjs';
import { ACCESS } from './support/google-oauth-transport.mjs';
const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('Unexpected real network'); }; });
after(() => { globalThis.fetch = originalFetch; });
const importKey = (byte, usages = ['encrypt', 'decrypt']) => crypto.subtle.importKey('raw', new Uint8Array(32).fill(byte), 'AES-GCM', false, usages);
function markDeletion(f, requestId = 'del_synthetic') {
  const location = f.client.documentName(`v1UserDirectory/${f.owner}`), doc = structuredClone(f.db.documents.get(location));
  doc.fields.deletionState = { stringValue: 'pending' }; doc.fields.deletionRequestId = { stringValue: requestId }; doc.updateTime += '-pending';
  f.db.documents.set(location, doc); return location;
}

test('injected previous keys decrypt old records; explicit CAS re-encryption preserves exact rows and uses current key only', async () => {
  const f = await fixture(), start = await f.begin(); await f.complete(start);
  const before = await f.store.read(f.owner), nextKey = await importKey(9), previousKeys = { [f.options.keyId]: await importKey(7, ['decrypt']) };
  const options = { ...f.options, key: nextKey, keyId: 'synthetic-v2', previousKeys };
  const rotated = createFirestorePrivateGoogleConnections(options);
  delete previousKeys[f.options.keyId]; // Construction snapshots supplied key routing.
  assert.deepEqual(await rotated.read(f.owner), before);
  await rotated.reencryptForOwner(f.owner);
  assert.equal(f.db.documents.get(f.location).fields.keyId.stringValue, 'synthetic-v2');
  assert.deepEqual(await createFirestorePrivateGoogleConnections({ ...options, previousKeys: {} }).read(f.owner), before);
  await assert.rejects(f.store.read(f.owner));
  const colliding = createFirestorePrivateGoogleConnections({ ...f.options, previousKeys: { [f.options.keyId]: nextKey } });
  await assert.rejects(colliding.read(f.owner), error => error.code === 'not_configured');
});

test('disconnect-all removes current grants/pending material and suppresses an in-flight refresh promotion', async () => {
  const f = await fixture(), start = await f.begin(); await f.complete(start);
  f.protocol.hooks.before = async (_url, form) => {
    if (form.get('grant_type') === 'refresh_token') assert.equal(await f.store.disconnectAllForOwner(f.owner), 1);
  };
  assert.equal((await f.request(`/${start.connectionId}`, { action: 'refresh' })).status, 409);
  const after = (await f.store.read(f.owner))[0];
  assert.equal(after.status, 'cleanup_pending'); assert.equal(after.grant, undefined); assert.equal(after.pending, undefined); assert.equal(after.operation, undefined);
  assert.equal((await f.request(`/${start.connectionId}/mail`)).status, 409);
  await f.store.disconnectAllForOwner(f.owner);
  const again = await f.begin(); assert.equal(again.connectionId, start.connectionId);
  const pending = (await f.store.read(f.owner))[0]; assert.ok(pending.pending);
  await f.store.disconnectAllForOwner(f.owner);
  const cleared = (await f.store.read(f.owner))[0]; assert.equal(cleared.pending, undefined); assert.equal(cleared.subject, after.subject); assert.equal(cleared.workspaceId, after.workspaceId);
});

test('deletion removes only exact pending owner/request ciphertext, even with corrupt data and no decryption key', async () => {
  const f = await fixture(); await f.begin();
  await assert.rejects(f.store.removeForDeletion(f.owner, 'del_synthetic'), error => error.code === 'forbidden');
  markDeletion(f);
  await assert.rejects(f.store.removeForDeletion(f.owner, 'del_wrong'), error => error.code === 'forbidden');
  const corrupted = structuredClone(f.db.documents.get(f.location)); corrupted.fields.ciphertext.stringValue = 'invalid'; f.db.documents.set(f.location, corrupted);
  const lostKey = createFirestorePrivateGoogleConnections({ ...f.options, key: undefined });
  assert.equal(await lostKey.removeForDeletion(f.owner, 'del_synthetic'), true);
  assert.equal(f.db.documents.has(f.location), false);
  assert.equal(await lostKey.removeForDeletion(f.owner, 'del_synthetic'), false);
  await assert.rejects(f.store.change(f.owner, () => []), error => error.code === 'forbidden');
});

test('changed deletion request fences cleanup; uncertain successful delete is not replayed and next inspection reports absence', async () => {
  const f = await fixture(); await f.begin(); const directory = markDeletion(f);
  const racing = { ...f.client, request: async (path, ...rest) => {
    if (path === ':commit') { const doc = structuredClone(f.db.documents.get(directory)); doc.fields.deletionRequestId.stringValue = 'del_replaced'; doc.updateTime += '-changed'; f.db.documents.set(directory, doc); }
    return f.client.request(path, ...rest);
  } };
  await assert.rejects(createFirestorePrivateGoogleConnections({ ...f.options, db: racing }).removeForDeletion(f.owner, 'del_synthetic'), error => error.code === 'forbidden');
  assert.equal(f.db.documents.has(f.location), true);
  let commits = 0;
  const uncertain = { ...f.client, request: async (path, ...rest) => {
    const response = await f.client.request(path, ...rest);
    if (path === ':commit') { commits++; throw new Error('lost response ' + ACCESS); }
    return response;
  } };
  const store = createFirestorePrivateGoogleConnections({ ...f.options, db: uncertain });
  await assert.rejects(store.removeForDeletion(f.owner, 'del_replaced'), error => error.code === 'unavailable' && !error.message.includes(ACCESS));
  assert.equal(commits, 1); assert.equal(f.db.documents.has(f.location), false);
  assert.equal(await store.removeForDeletion(f.owner, 'del_replaced'), false); assert.equal(commits, 1);
});

test('disabled lifecycle methods do not call transport, including deletion without keys', async () => {
  const f = await fixture(); let calls = 0;
  const db = { ...f.client, request: async () => { calls++; throw new Error('must not call'); } };
  const store = createFirestorePrivateGoogleConnections({ ...f.options, executionMode: 'disabled', key: undefined, db });
  for (const operation of [() => store.removeForDeletion(f.owner, 'del_synthetic'), () => store.reencryptForOwner(f.owner), () => store.disconnectAllForOwner(f.owner)]) await assert.rejects(operation(), error => error.code === 'not_configured');
  assert.equal(calls, 0);
});


test('key-free worker cleanup is default-disabled and rejects unknown activation mode', async () => {
  const f = await fixture(); let calls = 0;
  const db = { ...f.client, request: async () => { calls++; throw new Error('must not call'); } };
  await assert.rejects(createPrivateGoogleDeletionCleanup({ db }).removeForDeletion(f.owner, 'del_synthetic'), error => error.code === 'not_configured');
  assert.throws(() => createPrivateGoogleDeletionCleanup({ db, executionMode: 'automatic' }), error => error.code === 'not_configured');
  assert.equal(calls, 0);
});
