import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirestoreProviderOAuthTransactions } from '../db/provider-oauth-transactions.ts';
import { createFirestoreProviderConnectionStore } from '../db/provider-connections.ts';
import { createMockProviderOAuthLifecycle } from '../server/providers/provider-oauth-lifecycle.ts';
import { MOCK_OAUTH_SCOPES, oauthHash } from '../server/providers/provider-oauth-types.ts';
import { InactiveUserError } from '../db/user-history.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
const NOW = Date.parse('2026-10-17T00:00:00Z'), OWNER = 'user_alex', OTHER = 'user_sam';
const ROOT = 'projects/openjob-dev/databases/(default)/documents/';
const key = createPrivateKey(); const rawState = 'private_mock_state_'.padEnd(43, 's'); const HASH = await oauthHash(rawState);
const row = (stateHash = HASH) => ({ stateHash, ownerId: OWNER, accountId: 'gmail_new', expectedSubject: 'google_fixture_sub', label: 'Mock OAuth', callbackUri: 'https://openjob.example.invalid/mock/callback', clientId: 'mock_client', scopes: [...MOCK_OAUTH_SCOPES], nonce: 'n'.repeat(43), verifier: 'v'.repeat(43), createdAt: NOW, expiresAt: NOW + 600000, mode: 'mock' });
const hasCode = code => error => error.code === code && !error.message.includes(rawState) && !error.message.includes('v'.repeat(43));
async function fixture() {
  const db = createFakeFirestore(); let clock = NOW; let hook; const requests = [];
  for (const owner of [OWNER, OTHER]) db.documents.set(`${ROOT}v1UserDirectory/${owner}`, { name: `${ROOT}v1UserDirectory/${owner}`, updateTime: '2026-10-17T00:00:00Z', fields: { userId: { stringValue: owner } } });
  const config = { projectId: 'openjob-dev', clientEmail: 'fixture@example.invalid', privateKey: await key };
  const fetcher = async (url, init = {}) => { requests.push(String(url)); const response = await hook?.(String(url), init); return response ?? db.fetch(url, init); };
  const reopen = () => createFirestoreProviderOAuthTransactions(config, fetcher, { now: () => clock });
  return { db, config, fetcher, store: reopen(), reopen, requests, time: value => { clock = value; }, now: () => clock, hook: fn => { hook = fn; } };
}
const name = owner => `${ROOT}v1ProviderOAuthTransactions/${owner}`;
const envelope = f => JSON.parse(f.db.documents.get(name(OWNER)).fields.transactionsJson.stringValue);

test('durable private hash binding reconstructs; foreign owner cannot burn state; consume erases PKCE secrets', async () => {
  const f = await fixture(); const input = row(); await f.store.create(input); input.verifier = 'x'.repeat(43);
  const persisted = f.db.documents.get(name(OWNER)); assert.equal(persisted.fields.ownerUserId.stringValue, OWNER); assert.equal(JSON.stringify(persisted).includes(rawState), false); assert.equal(JSON.stringify(persisted).includes('accessToken'), false);
  const before = structuredClone(persisted); assert.equal(await f.reopen().consumeForOwner(OTHER, HASH), null); assert.deepEqual(f.db.documents.get(name(OWNER)), before);
  assert.deepEqual(await f.reopen().consumeForOwner(OWNER, HASH), row());
  assert.deepEqual(envelope(f), { pending: [], spent: [{ stateHash: HASH, createdAt: NOW, expiresAt: NOW + 600000 }] });
  assert.equal(JSON.stringify(f.db.documents.get(name(OWNER))).includes('verifier'), false); assert.equal(JSON.stringify(f.db.documents.get(name(OWNER))).includes('nonce'), false);
  assert.equal(await f.reopen().consumeForOwner(OWNER, HASH), null); await assert.rejects(f.store.create(row()), hasCode('invalid_state'));
  assert.equal(f.requests.some(url => url.includes('runQuery') || url.includes('pageSize')), false);
});

test('independent instances consume exactly once and concurrent starts merge without lost state', async () => {
  const f = await fixture(); await f.store.create(row());
  f.db.synchronizeNextCommits(); const results = await Promise.all([f.store.consumeForOwner(OWNER, HASH), f.reopen().consumeForOwner(OWNER, HASH)]);
  assert.equal(results.filter(Boolean).length, 1); assert.equal(envelope(f).spent.length, 1); assert.ok(f.db.preconditionFailures() >= 1);
  const [a, b] = [await oauthHash('second mock state'), await oauthHash('third mock state')];
  f.db.synchronizeNextCommits(); await Promise.all([f.store.create(row(a)), f.reopen().create(row(b))]);
  assert.deepEqual(new Set(envelope(f).pending.map(record => record.stateHash)), new Set([a, b]));
});

test('expiration prunes only owned pending/spent records and cleanup works without scans', async () => {
  const f = await fixture(); await f.store.create(row()); await f.store.create({ ...row(await oauthHash('other owner state')), ownerId: OTHER });
  f.time(NOW + 600000); assert.equal(await f.store.consumeForOwner(OWNER, HASH), null); assert.deepEqual(envelope(f), { pending: [], spent: [] });
  assert.equal(f.db.documents.has(name(OTHER)), true); assert.equal(JSON.parse(f.db.documents.get(name(OTHER)).fields.transactionsJson.stringValue).pending.length, 1);
  assert.equal(await f.store.cleanupExpiredForOwner(OTHER), 1); assert.equal(await f.store.cleanupExpiredForOwner(OTHER), 0);
  f.time(NOW); await f.store.create(row()); await f.store.consumeForOwner(OWNER, HASH); f.time(NOW + 600000); assert.equal(await f.store.cleanupExpiredForOwner(OWNER), 1); assert.deepEqual(envelope(f), { pending: [], spent: [] });
  assert.equal(f.requests.some(url => url.includes('runQuery') || url.includes('pageSize')), false);
});

test('owner deletion commit race prevents create/consume and pending deletion cleanup is idempotent', async () => {
  for (const operation of ['create', 'consume']) {
    const f = await fixture(); if (operation === 'consume') await f.store.create(row()); let changed = false;
    f.hook(url => { if (url.endsWith('documents:commit') && !changed) { changed = true; const user = f.db.documents.get(`${ROOT}v1UserDirectory/${OWNER}`); user.updateTime = '2026-10-17T01:00:00Z'; user.fields.deletionState = { stringValue: 'pending' }; } });
    await assert.rejects(operation === 'create' ? f.store.create(row()) : f.store.consumeForOwner(OWNER, HASH), InactiveUserError);
    if (operation === 'consume') assert.equal(envelope(f).pending.length, 1); else assert.equal(f.db.documents.has(name(OWNER)), false);
    assert.equal(await f.store.removeAllForUser(OWNER), operation === 'consume' ? 1 : 0); assert.equal(await f.store.removeAllForUser(OWNER), 0);
  }
});

test('schema/owner/hash corruption and malformed create input fail closed without private error values', async () => {
  const f = await fixture();
  for (const bad of [{ ...row(), ownerId: '../owner' }, { ...row(), state: rawState }, { ...row(), callbackUri: row().callbackUri + '?x=1' }, { ...row(), scopes: ['mail.send'] }, { ...row(), verifier: 'bad' }, { ...row(), expiresAt: NOW + 600001 }, { ...row(), createdAt: NOW + 1, expiresAt: NOW + 600001 }]) await assert.rejects(f.store.create(bad), hasCode('invalid_transaction'));
  for (const owner of ['', 'a/b']) await assert.rejects(f.store.consumeForOwner(owner, HASH), hasCode('invalid_input'));
  await assert.rejects(f.store.consumeForOwner(OWNER, 'not_hash'), hasCode('invalid_input'));
  await f.store.create(row()); const document = f.db.documents.get(name(OWNER)); const original = structuredClone(document);
  for (const alter of [state => { state.pending[0].ownerId = OTHER; }, state => { state.pending[0].state = rawState; }, state => { state.pending[0].nonce = 'bad'; }, state => { state.spent.push({ stateHash: HASH, createdAt: NOW, expiresAt: NOW + 600000 }); }, state => { state.pending[0].mode = 'live'; }]) {
    const state = JSON.parse(original.fields.transactionsJson.stringValue); alter(state); document.fields.transactionsJson.stringValue = JSON.stringify(state);
    await assert.rejects(f.store.consumeForOwner(OWNER, HASH), hasCode('invalid_state'));
  }
  document.fields = structuredClone(original.fields); document.fields.ownerUserId.stringValue = OTHER; await assert.rejects(f.store.consumeForOwner(OWNER, HASH), hasCode('invalid_state'));
});

test('pending plus spent count and encoded byte capacity remain bounded', async () => {
  const f = await fixture(); await f.store.create(row()); const document = f.db.documents.get(name(OWNER));
  const spent = Array.from({ length: 99 }, (_, index) => ({ stateHash: index.toString(36).padStart(43, '_'), createdAt: NOW, expiresAt: NOW + 600000 }));
  document.fields.transactionsJson.stringValue = JSON.stringify({ pending: [row()], spent });
  const count = f.db.commitAttempts(); await assert.rejects(f.store.create(row(await oauthHash('over count'))), hasCode('transaction_capacity')); assert.equal(f.db.commitAttempts(), count);
  const big = await fixture(); let blocked = false;
  for (let index = 0; index < 100; index++) { try { await big.store.create({ ...row(await oauthHash(`large ${index}`)), callbackUri: 'https://openjob.example.invalid/' + 'x'.repeat(1800) }); } catch (error) { assert.equal(error.code, 'transaction_capacity'); blocked = true; break; } }
  assert.equal(blocked, true); assert.ok(Buffer.byteLength(JSON.stringify(big.db.documents.get(name(OWNER)))) < 200000);
});

test('only CAS conflicts retry; ambiguous/network consume is never replayed', async () => {
  const f = await fixture(); await f.store.create(row()); let count = 0;
  f.hook(url => { if (url.endsWith('documents:commit')) { count++; return Response.json({ error: { status: 'FAILED_PRECONDITION' } }, { status: 409 }); } });
  await assert.rejects(f.store.consumeForOwner(OWNER, HASH), hasCode('conflict')); assert.equal(count, 3);
  count = 0; f.hook(url => { if (url.endsWith('documents:commit')) { count++; throw new Error('synthetic transport unavailable ' + row().verifier); } });
  await assert.rejects(f.store.consumeForOwner(OWNER, HASH), hasCode('transaction_unavailable'));  assert.equal(count, 1); assert.equal(envelope(f).pending.length, 1);
});

test('existing mock OAuth lifecycle reconstructs durable state then atomically consumes/provisions only once', async () => {
  const f = await fixture(); const connections = createFirestoreProviderConnectionStore(f.config, f.fetcher); const secrets = new Map(); let nonce; let exchanges = 0;
  const vault = { async write(value) { assert.equal(secrets.has(value.credentialRef), false); secrets.set(value.credentialRef, structuredClone(value)); }, async read(ref) { return structuredClone(secrets.get(ref) ?? null); }, async delete(binding) { secrets.delete(binding.credentialRef); } };
  const makeFlow = transactions => createMockProviderOAuthLifecycle({ executionMode: 'mock', clientId: 'mock_client', callbackUri: row().callbackUri, transactions, connections, vault, now: f.now,
    isOwnerActive: async owner => !f.db.documents.get(`${ROOT}v1UserDirectory/${owner}`)?.fields.deletionState,
    async exchange() { exchanges++; return { accessToken: 'invented_mock_access', idToken: 'invented_mock_identity', scopes: [...MOCK_OAUTH_SCOPES], expiresAt: NOW + 3600000 }; },
    async verifyIdentity(input) { nonce = input.nonce; return { iss: 'https://accounts.google.com', aud: 'mock_client', exp: NOW / 1000 + 3600, nonce, sub: 'google_fixture_sub', email: 'alex@example.invalid', email_verified: true }; },
  });
  const started = await makeFlow(f.store).begin({ ownerId: OWNER, accountId: 'gmail_durable', expectedSubject: 'google_fixture_sub', label: 'Mock durable handoff' });
  const request = { ownerId: OWNER, state: started.state, callbackUri: row().callbackUri, code: 'invented_mock_code' };
  const results = await Promise.allSettled([makeFlow(f.reopen()).callback(request), makeFlow(f.reopen()).callback(request)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(exchanges, 1); assert.equal(nonce, started.nonce);
  const approved = await connections.getForOwner(OWNER, 'gmail_durable'); assert.equal(approved.state, 'approved'); assert.equal(secrets.get(approved.credentialRef).revision, approved.revision);
  assert.equal(envelope(f).pending.length, 0); assert.equal(envelope(f).spent.length, 1); assert.equal(JSON.stringify(f.db.documents.get(name(OWNER))).includes(started.state), false); assert.equal(JSON.stringify(f.db.documents.get(name(OWNER))).includes('invented_mock_code'), false); assert.equal(JSON.stringify([...f.db.documents.values()]).includes('invented_mock_access'), false);
});
