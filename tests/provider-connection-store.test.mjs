import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirestoreProviderConnectionStore } from '../db/provider-connections.ts';
import { InactiveUserError } from '../db/user-history.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
const ROOT = 'projects/openjob-dev/databases/(default)/documents/';
const key = createPrivateKey(); const OWNER = 'user_alex';
const input = (accountId = 'gmail_fixture') => ({ accountId, subject: `subject_${accountId}`, address: `${accountId}@example.invalid`, label: 'Invented Gmail metadata', credentialRef: `vault_ref_${accountId}`, scopes: ['https://www.googleapis.com/auth/gmail.readonly'], state: 'approved', expiresAt: 1800000000000, mode: 'mock' });
async function fixture(options) {
  const db = createFakeFirestore(); let beforeCommit;
  for (const owner of [OWNER, 'user_sam']) db.documents.set(`${ROOT}v1UserDirectory/${owner}`, { name: `${ROOT}v1UserDirectory/${owner}`, updateTime: '2026-10-17T00:00:00Z', fields: { userId: { stringValue: owner } } });
  const config = { projectId: 'openjob-dev', clientEmail: 'fixture@example.invalid', privateKey: await key };
  const fetcher = async (url, init = {}) => { if (String(url).endsWith('documents:commit')) await beforeCommit?.(); return db.fetch(url, init); };
  const reopen = () => createFirestoreProviderConnectionStore(config, fetcher, options);
  return { db, store: reopen(), reopen, hook: fn => { beforeCommit = fn; } };
}
const name = owner => `${ROOT}v1ProviderConnections/${owner}`;
const code = value => error => error.code === value;

test('mock metadata survives reconstruction, stays owner-private, and never stores tokens', async () => {
  const f = await fixture(); const created = await f.store.putForOwner(OWNER, input(), null);
  assert.equal(created.ownerId, OWNER); assert.ok(created.revision); assert.equal(created.mode, 'mock');
  const reopened = f.reopen(); assert.deepEqual(await reopened.getForOwner(OWNER, created.accountId), created);
  assert.deepEqual(await reopened.listForOwner('user_sam'), []); assert.equal(await reopened.getForOwner('user_sam', created.accountId), null);
  const copy = await reopened.getForOwner(OWNER, created.accountId); copy.scopes.length = 0; assert.equal((await reopened.listForOwner(OWNER))[0].scopes.length, 1);
  assert.deepEqual(Object.keys(f.db.documents.get(name(OWNER)).fields).sort(), ['connectionsJson', 'ownerUserId']);
  assert.equal(JSON.stringify(f.db.documents.get(name(OWNER))).includes('accessToken'), false);
  await assert.rejects(f.store.putForOwner(OWNER, { ...input('other'), accessToken: 'invented-secret' }, null), code('invalid_input'));
  assert.equal(f.db.documents.get(`${ROOT}v1UserDirectory/${OWNER}`).fields.emptyShellEligible.booleanValue, false);
});

test('stale revisions conflict; revoke mints a new revision and defeats concurrent stale approval', async () => {
  const f = await fixture(); const original = await f.store.putForOwner(OWNER, input(), null);
  const revoked = await f.store.revokeForOwner(OWNER, original.accountId, original.revision);
  assert.equal(revoked.state, 'revoked'); assert.notEqual(revoked.revision, original.revision);
  const before = structuredClone(f.db.documents.get(name(OWNER)));
  await assert.rejects(f.store.putForOwner(OWNER, input(), original.revision), code('conflict'));
  await assert.rejects(f.store.revokeForOwner(OWNER, original.accountId, original.revision), code('conflict'));
  assert.deepEqual(f.db.documents.get(name(OWNER)), before);
  assert.deepEqual(await f.store.revokeForOwner(OWNER, original.accountId, revoked.revision), revoked);
  const active = await f.store.putForOwner(OWNER, input('second'), null);
  f.db.synchronizeNextCommits(); const revoke = f.store.revokeForOwner(OWNER, active.accountId, active.revision); await f.db.waitForPendingCommits();
  const stale = f.reopen().putForOwner(OWNER, { ...input('second'), label: 'Stale approval' }, active.revision);
  const results = await Promise.allSettled([revoke, stale]); assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(results[1].reason.code, 'conflict');
  assert.equal((await f.store.getForOwner(OWNER, active.accountId)).state, 'revoked'); assert.ok(f.db.preconditionFailures() >= 1);
});

test('duplicate subject/reference and account creation race are atomically constrained', async () => {
  const f = await fixture(); const first = await f.store.putForOwner(OWNER, input(), null);
  await assert.rejects(f.store.putForOwner(OWNER, input(), null), code('conflict'));
  await assert.rejects(f.store.putForOwner(OWNER, { ...input('second'), subject: first.subject }, null), code('conflict'));
  await assert.rejects(f.store.putForOwner(OWNER, { ...input('second'), credentialRef: first.credentialRef }, null), code('conflict'));
  f.db.synchronizeNextCommits();
  const a = f.store.putForOwner(OWNER, { ...input('race_a'), subject: 'same_upstream_subject' }, null);
  const b = f.reopen().putForOwner(OWNER, { ...input('race_b'), subject: 'same_upstream_subject' }, null);
  const results = await Promise.allSettled([a, b]); assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.code, 'conflict');
  assert.equal((await f.store.listForOwner(OWNER)).length, 2);
});

test('active-owner commit fence denies deletion races and cleanup remains idempotent while pending', async () => {
  const f = await fixture(); const created = await f.store.putForOwner(OWNER, input(), null); await f.store.putForOwner('user_sam', input('sam'), null);
  let once = false; f.hook(() => { if (once) return; once = true; const user = f.db.documents.get(`${ROOT}v1UserDirectory/${OWNER}`); user.updateTime = '2026-10-17T01:00:00Z'; user.fields.deletionState = { stringValue: 'pending' }; });
  await assert.rejects(f.store.putForOwner(OWNER, { ...input(), label: 'Cannot commit' }, created.revision), InactiveUserError);
  await assert.rejects(f.store.listForOwner(OWNER), InactiveUserError);
  assert.equal(await f.store.removeAllForUser(OWNER), 1); assert.equal(await f.store.removeAllForUser(OWNER), 0);
  assert.equal((await f.store.listForOwner('user_sam'))[0].accountId, 'sam');
});

test('deletion beginning during metadata read is checked before returning rows', async () => {
  const f = await fixture(); await f.store.putForOwner(OWNER, input(), null);
  const pause = f.db.pauseNextDocumentRead(`v1ProviderConnections/${OWNER}`); const reading = f.store.listForOwner(OWNER); await pause.waitUntilPaused();
  f.db.documents.get(`${ROOT}v1UserDirectory/${OWNER}`).fields.deletionState = { stringValue: 'pending' }; pause.release(); await assert.rejects(reading, InactiveUserError);
});

test('malformed owner/account/input and corrupt foreign/token-bearing stored state fail closed', async () => {
  const f = await fixture();
  for (const owner of ['', '../user', 'a/b', 'x'.repeat(129)]) await assert.rejects(f.store.listForOwner(owner), code('invalid_input'));
  for (const bad of [{ ...input(), accountId: '../account' }, { ...input(), ownerId: 'user_sam' }, { ...input(), revision: 'caller_revision' }, { ...input(), mode: 'provider' }]) await assert.rejects(f.store.putForOwner(OWNER, bad, null), code('invalid_input'));
  await f.store.putForOwner(OWNER, input(), null); const document = f.db.documents.get(name(OWNER)); const original = structuredClone(document);
  for (const mutate of [row => { row.ownerId = 'user_sam'; }, row => { row.accessToken = 'invented-secret'; }, row => { row.credentialRef = ''; }, row => { row.mode = 'provider'; }]) {
    const records = JSON.parse(original.fields.connectionsJson.stringValue); mutate(records[0]); document.fields.connectionsJson.stringValue = JSON.stringify(records);
    await assert.rejects(f.store.listForOwner(OWNER), code('invalid_state')); await assert.rejects(f.store.putForOwner(OWNER, input('new'), null), code('invalid_state'));
  }
  document.fields = structuredClone(original.fields); document.fields.ownerUserId.stringValue = 'user_sam'; await assert.rejects(f.store.listForOwner(OWNER), code('invalid_state'));
});

test('100-account/encoded byte bounds and injected revision reuse reject before commit', async () => {
  const f = await fixture(); await f.store.putForOwner(OWNER, input(), null); const document = f.db.documents.get(name(OWNER));
  const records = Array.from({ length: 100 }, (_, index) => ({ ...input(`account_${index}`), ownerId: OWNER, revision: `revision_${index}` })); document.fields.connectionsJson.stringValue = JSON.stringify(records);
  const attempts = f.db.commitAttempts(); await assert.rejects(f.store.putForOwner(OWNER, input('overflow'), null), code('connection_capacity')); assert.equal(f.db.commitAttempts(), attempts);
  const reused = await fixture({ revision: () => 'constant_revision' }); const created = await reused.store.putForOwner(OWNER, input(), null); await assert.rejects(reused.store.revokeForOwner(OWNER, created.accountId, created.revision), code('conflict'));
  const big = await fixture(); const scopes = Array.from({ length: 100 }, (_, index) => `${index}_` + 'x'.repeat(230)); let bounded = false;
  for (let index = 0; index < 12; index++) { try { await big.store.putForOwner(OWNER, { ...input(`big_${index}`), scopes }, null); } catch (error) { assert.equal(error.code, 'connection_capacity'); bounded = true; break; } }
  assert.equal(bounded, true);
});
