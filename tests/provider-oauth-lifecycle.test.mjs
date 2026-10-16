import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockProviderOAuthLifecycle } from '../server/providers/provider-oauth-lifecycle.ts';
import { createMockProviderOAuthTransactions } from '../server/providers/provider-oauth-transactions.ts';
import { MOCK_OAUTH_SCOPES, oauthHash } from '../server/providers/provider-oauth-types.ts';
import { createFirestoreProviderConnectionStore } from '../db/provider-connections.ts';
import { createProviderTokenVaultBroker } from '../server/providers/provider-token-vault.ts';
import { createProviderConnectionReader } from '../server/providers/provider-connections.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
const NOW = Date.parse('2026-10-17T00:00:00Z'), OWNER = 'user_alex', SUB = 'google_subject_alex';
const CALLBACK = 'https://openjob.example.invalid/mock/callback', CLIENT = 'mock_client_id';
const ACCESS = 'invented_mock_access_token', IDTOKEN = 'invented_mock_identity_token', CODE = 'invented_mock_exchange_code';
const ROOT = 'projects/openjob-dev/databases/(default)/documents/'; const key = createPrivateKey();
const safe = allowed => error => allowed.includes(error.code) && [ACCESS, IDTOKEN, CODE].every(secret => !JSON.stringify({ ...error, message: error.message, stack: error.stack }).includes(secret));
async function fixture(options = {}) {
  const db = createFakeFirestore(); let clock = NOW; const hooks = {}; const entries = new Map(); const captures = []; const counts = { exchange: 0, verify: 0, write: 0, read: 0, delete: 0 };
  for (const owner of [OWNER, 'user_sam']) db.documents.set(`${ROOT}v1UserDirectory/${owner}`, { name: `${ROOT}v1UserDirectory/${owner}`, updateTime: '2026-10-17T00:00:00Z', fields: { userId: { stringValue: owner } } });
  const config = { projectId: 'openjob-dev', clientEmail: 'fixture@example.invalid', privateKey: await key };
  const store = createFirestoreProviderConnectionStore(config, db.fetch);
  const connections = { ...store,
    async putForOwner(...args) { const result = await store.putForOwner(...args); await hooks.reserve?.(result); return result; },
    async approveReservedForOwner(...args) { await hooks.promoteBefore?.(); const result = await store.approveReservedForOwner(...args); await hooks.promoteAfter?.(); return result; },
    async revokeForOwner(...args) { await hooks.revoke?.(); return store.revokeForOwner(...args); },
  };
  const memory = createMockProviderOAuthTransactions({ now: () => clock });
  const transactions = { async create(row) { captures.push(structuredClone(row)); return memory.create(row); }, async consumeForOwner(...args) { const row = await memory.consumeForOwner(...args); if (row) await hooks.consume?.(row); return row; } };
  const vault = {
    async write(entry) { counts.write++; if (entries.has(entry.credentialRef)) throw new Error('No overwrite'); if (!hooks.skipWrite) entries.set(entry.credentialRef, structuredClone(entry)); await hooks.write?.(); },
    async read(ref) { counts.read++; const row = structuredClone(entries.get(ref) ?? null); await hooks.read?.(); return hooks.readback ? hooks.readback(row) : row; },
    async delete(binding) { counts.delete++; await hooks.delete?.(); const entry = entries.get(binding.credentialRef); if (entry && Object.entries(binding).some(([field, value]) => entry[field] !== value)) throw new Error('Wrong delete binding'); entries.delete(binding.credentialRef); },
  };
  const isOwnerActive = async owner => { const user = db.documents.get(`${ROOT}v1UserDirectory/${owner}`); return !!user && !user.fields.deletionState; };
  const flow = createMockProviderOAuthLifecycle({ executionMode: options.executionMode ?? 'mock', cleanupLimit: options.cleanupLimit ?? 1000, clientId: CLIENT, callbackUri: CALLBACK, transactions, connections, vault, isOwnerActive, now: () => clock,
    async exchange(input) { counts.exchange++; assert.equal(input.redirectUri, CALLBACK); assert.equal(input.clientId, CLIENT); assert.deepEqual(input.requestedScopes, [...MOCK_OAUTH_SCOPES]); assert.ok(captures.some(row => row.verifier === input.codeVerifier)); await hooks.exchange?.(); return { accessToken: ACCESS, idToken: IDTOKEN, scopes: [...MOCK_OAUTH_SCOPES], expiresAt: NOW + 3600000, ...hooks.token }; },
    async verifyIdentity(input) { counts.verify++; assert.equal(input.idToken, IDTOKEN); assert.equal(input.clientId, CLIENT); await hooks.verify?.(); return { iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor((NOW + 3600000) / 1000), nonce: input.nonce, sub: SUB, email: 'alex@example.invalid', email_verified: true, ...hooks.identity }; },
  });
  const begin = extra => flow.begin({ ownerId: OWNER, accountId: 'gmail_new', expectedSubject: SUB, label: 'Mock OAuth mailbox', ...extra });
  const callback = (start, extra) => flow.callback({ ownerId: OWNER, state: start.state, callbackUri: CALLBACK, code: CODE, ...extra });
  return { flow, store, connections, vault, db, hooks, counts, entries, captures, begin, callback, now: () => clock, time: value => { clock = value; }, active: value => { const user = db.documents.get(`${ROOT}v1UserDirectory/${OWNER}`); if (value) delete user.fields.deletionState; else user.fields.deletionState = { stringValue: 'pending' }; }, isOwnerActive };
}

test('mock protocol binds PKCE/state/nonce, provisions before approval and composes through broker/Gmail mapper', async () => {
  const f = await fixture(); const start = await f.begin();
  for (const value of [start.state, start.nonce, start.codeChallenge]) assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(start.state, start.nonce); assert.notEqual(start.nonce, f.captures[0].verifier); assert.equal(start.codeChallenge, await oauthHash(f.captures[0].verifier)); assert.equal('verifier' in start, false);
  f.hooks.write = async () => { assert.equal((await f.store.getForOwner(OWNER, 'gmail_new')).state, 'needs_consent'); };
  const result = await f.callback(start); assert.deepEqual(result, { mode: 'mock', status: 'approved', accountId: 'gmail_new' });
  assert.equal([ACCESS, IDTOKEN, CODE].some(secret => JSON.stringify({ start, result }).includes(secret)), false);
  const approved = await f.store.getForOwner(OWNER, 'gmail_new'); const entry = f.entries.get(approved.credentialRef); assert.equal(approved.revision, entry.revision); assert.equal(approved.state, 'approved');
  const broker = createProviderTokenVaultBroker({ vault: f.vault, connections: f.store, isOwnerActive: f.isOwnerActive, executionMode: 'mock', now: f.now });
  const reader = createProviderConnectionReader({ store: f.store, broker, isOwnerActive: f.isOwnerActive, executionMode: 'mock', now: f.now, fetchImplementation: async (input, init) => {
    const url = new URL(input); assert.equal(url.origin, 'https://gmail.googleapis.com'); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: 'alex@example.invalid' });
    if (url.pathname.endsWith('/labels')) return Response.json({ labels: [{ id: 'INBOX', name: 'Inbox' }] });
    if (url.pathname.endsWith('/messages')) return Response.json({ messages: [{ id: 'm1', threadId: 't1' }] });
    return Response.json({ id: 'm1', threadId: 't1', labelIds: ['INBOX'], internalDate: String(NOW), payload: { mimeType: 'text/plain', body: { data: Buffer.from('Invented OAuth-to-Gmail read.').toString('base64url') } } });
  } });
  assert.equal((await reader.listMessages({ ownerId: OWNER, accountId: 'gmail_new' })).messages[0].body, 'Invented OAuth-to-Gmail read.');
  assert.equal(JSON.stringify([...f.db.documents.values()]).includes(ACCESS), false);
});

test('disabled start/callback/cancel cause no exchange/provisioning and frozen requested scopes cannot expand', async () => {
  const f = await fixture({ executionMode: 'disabled' });
  await assert.rejects(f.begin(), safe(['execution_disabled'])); await assert.rejects(f.callback({ state: 'a'.repeat(43) }), safe(['execution_disabled'])); await assert.rejects(f.flow.cancel(OWNER, 'a'.repeat(43)), safe(['execution_disabled']));
  assert.equal(f.counts.exchange, 0); assert.equal(f.counts.write, 0); assert.equal(f.captures.length, 0);
  assert.throws(() => MOCK_OAUTH_SCOPES.push('mail.send'), TypeError);
});

test('foreign owner and wrong exact callback do not consume legitimate state; owned replay/concurrency exchange once', async () => {
  const f = await fixture(); const start = await f.begin();
  await assert.rejects(f.callback(start, { ownerId: 'user_sam' }), safe(['invalid_state']));
  for (const suffix of ['?extra=1', '#fragment', '/']) await assert.rejects(f.callback(start, { callbackUri: CALLBACK + suffix }), safe(['callback_mismatch']));
  const results = await Promise.allSettled([f.callback(start), f.callback(start)]); assert.equal(results.filter(value => value.status === 'fulfilled').length, 1); assert.equal(f.counts.exchange, 1);
  await assert.rejects(f.callback(start), safe(['invalid_state']));
});

test('expiration and explicit cancellation consume owned transaction state without exchanging a code', async () => {
  const expired = await fixture(); const start = await expired.begin(); expired.time(start.expiresAt);
  await assert.rejects(expired.callback(start), safe(['transaction_expired'])); await assert.rejects(expired.callback(start), safe(['invalid_state'])); assert.equal(expired.counts.exchange, 0);
  const cancelled = await fixture(); const own = await cancelled.begin(); assert.equal((await cancelled.flow.cancel(OWNER, own.state)).status, 'cancelled'); await assert.rejects(cancelled.callback(own), safe(['invalid_state']));
  const provider = await fixture(); const request = await provider.begin(); assert.equal((await provider.flow.callback({ ownerId: OWNER, state: request.state, callbackUri: CALLBACK, error: 'access_denied' })).status, 'cancelled'); assert.equal(provider.counts.exchange, 0);
});

test('identity issuer/audience/expiry/nonce/sub/verified-email and exact scopes fail before metadata/vault', async () => {
  for (const identity of [{ iss: 'https://evil.example.invalid' }, { aud: 'other_client' }, { exp: NOW / 1000 }, { nonce: 'other_nonce' }, { sub: 'foreign_subject' }, { email_verified: false }, { email: 'invalid' }]) {
    const f = await fixture(); f.hooks.identity = identity; await assert.rejects(f.callback(await f.begin()), safe(['identity_mismatch'])); assert.equal(f.counts.write, 0); assert.deepEqual(await f.store.listForOwner(OWNER), []);
  }
  for (const scopes of [['openid', 'email'], [...MOCK_OAUTH_SCOPES, 'mail.send']]) { const f = await fixture(); f.hooks.token = { scopes }; await assert.rejects(f.callback(await f.begin()), safe(['exchange_mismatch'])); assert.equal(f.counts.write, 0); }
  const thrown = await fixture(); thrown.hooks.verify = () => { throw new Error(`${ACCESS} ${IDTOKEN}`); }; await assert.rejects(thrown.callback(await thrown.begin()), safe(['identity_mismatch']));
});

test('consumed injected transaction rows are revalidated against callback/client/scopes/owner/nonce/verifier/time', async () => {
  for (const mutate of [row => { row.callbackUri = CALLBACK + '/wrong'; }, row => { row.clientId = 'wrong_client'; }, row => { row.scopes.push('mail.send'); }, row => { row.ownerId = 'user_other'; }, row => { row.nonce = 'bad'; }, row => { row.verifier = 'bad'; }, row => { row.expiresAt += 1; }, row => { row.mode = 'live'; }]) {
    const f = await fixture(); const start = await f.begin(); f.hooks.consume = mutate; await assert.rejects(f.callback(start), safe(['invalid_transaction'])); assert.equal(f.counts.exchange, 0);
  }
});

test('transaction, identity and token expiry are rechecked after async work; expired approval is revoked', async () => {
  for (const stage of ['exchange', 'verify', 'write', 'read', 'promoteAfter']) {
    const f = await fixture(); const start = await f.begin(); f.hooks[stage] = () => f.time(start.expiresAt);
    await assert.rejects(f.callback(start), safe(['transaction_expired']));
    const rows = await f.store.listForOwner(OWNER); if (rows.length) assert.equal(rows[0].state, 'revoked'); assert.equal(f.entries.size, 0);
  }
  for (const expired of ['token', 'identity']) {
    const f = await fixture(); const start = await f.begin(); if (expired === 'token') f.hooks.token = { expiresAt: NOW + 1000 }; else f.hooks.identity = { exp: NOW / 1000 + 1 };
    f.hooks.write = () => f.time(NOW + 1000); await assert.rejects(f.callback(start), safe(['credential_expired'])); assert.equal((await f.store.listForOwner(OWNER))[0].state, 'revoked'); assert.equal(f.entries.size, 0);
  }
});

test('vault readback must exist but accepts exact field reorder and scope-set reorder', async () => {
  const missing = await fixture(); missing.hooks.skipWrite = true; await assert.rejects(missing.callback(await missing.begin()), safe(['invalid_input', 'vault_mismatch'])); assert.equal((await missing.store.listForOwner(OWNER))[0].state, 'revoked');
  const reordered = await fixture(); reordered.hooks.readback = row => ({ credential: { expiresAt: row.credential.expiresAt, scopes: [...row.credential.scopes].reverse(), subject: row.credential.subject, accessToken: row.credential.accessToken }, revision: row.revision, subject: row.subject, accountId: row.accountId, ownerId: row.ownerId, credentialRef: row.credentialRef });
  assert.equal((await reordered.callback(await reordered.begin())).status, 'approved');
});

test('failed vault write/CAS or lost promotion response revokes exact reservation before vault deletion', async () => {
  for (const stage of ['write', 'promoteBefore', 'promoteAfter']) {
    const f = await fixture(); f.hooks[stage] = () => { throw new Error(`${ACCESS} ${CODE}`); };
    f.hooks.delete = async () => { assert.equal((await f.store.listForOwner(OWNER))[0].state, 'revoked'); };
    await assert.rejects(f.callback(await f.begin()), safe(['provisioning_failed'])); assert.equal((await f.store.listForOwner(OWNER))[0].state, 'revoked'); assert.equal(f.entries.size, 0); assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 0, pending: 0 });
  }
});

test('cleanup failure remains retryable and vault deletion waits for metadata denial', async () => {
  const f = await fixture(); f.hooks.promoteBefore = () => { throw new Error('synthetic CAS conflict'); }; f.hooks.revoke = () => { throw new Error('synthetic metadata failure'); };
  await assert.rejects(f.callback(await f.begin()), safe(['cleanup_required'])); assert.equal(f.counts.delete, 0); assert.equal(f.entries.size, 1);
  delete f.hooks.revoke; f.hooks.delete = () => { throw new Error('synthetic vault deletion failure'); };
  assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 0, pending: 1 }); assert.equal((await f.store.listForOwner(OWNER))[0].state, 'revoked');
  delete f.hooks.delete; assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 1, pending: 0 }); assert.equal(f.entries.size, 0); assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 0, pending: 0 });
});

test('lost reservation response recovers and revokes exact metadata without any vault operation', async () => {
  const f = await fixture(); f.hooks.reserve = () => { throw new Error('lost synthetic reservation response'); };
  await assert.rejects(f.callback(await f.begin()), safe(['reservation_uncertain'])); assert.equal((await f.store.listForOwner(OWNER))[0].state, 'revoked'); assert.equal(f.counts.write, 0); assert.equal(f.counts.delete, 0); assert.equal(f.entries.size, 0); assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 0, pending: 0 });
});

test('synchronous in-flight cleanup capacity prevents concurrent oversubscription without burning refused state', async () => {
  const f = await fixture({ cleanupLimit: 1 }); const one = await f.begin(); const two = await f.begin({ accountId: 'gmail_two', expectedSubject: 'other_expected_subject' });
  let entered; const ready = new Promise(resolve => { entered = resolve; }); let release; const paused = new Promise(resolve => { release = resolve; });
  f.hooks.exchange = async () => { entered(); await paused; };
  const first = f.callback(one); await ready;
  await assert.rejects(f.callback(two), safe(['cleanup_capacity'])); release(); await first;
  assert.equal((await f.flow.cancel(OWNER, two.state)).status, 'cancelled'); assert.equal(f.counts.exchange, 1);
});

test('owner deletion during exchange prevents reservation; deletion after vault write stays explicitly retryable', async () => {
  const before = await fixture(); before.hooks.exchange = () => before.active(false); await assert.rejects(before.callback(await before.begin()), safe(['owner_inactive'])); assert.equal(before.counts.write, 0);
  const after = await fixture(); const start = await after.begin(); after.hooks.write = () => after.active(false); await assert.rejects(after.callback(start), safe(['cleanup_required'])); assert.equal(after.counts.delete, 0);
  after.active(true); assert.deepEqual(await after.flow.retryCleanup(OWNER), { completed: 1, pending: 0 }); assert.equal(after.entries.size, 0);
});

test('ambiguous reservation with failed inspection stays queued for exact-reference recovery and ignores unrelated rows', async () => {
  const f = await fixture(); const originalGet = f.connections.getForOwner;
  f.hooks.reserve = () => { f.connections.getForOwner = async () => { throw new Error('synthetic inspection unavailable'); }; throw new Error('synthetic response lost'); };
  await assert.rejects(f.callback(await f.begin()), safe(['cleanup_required'])); assert.equal(f.counts.write, 0); assert.equal(f.counts.delete, 0);
  assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 0, pending: 1 });
  f.connections.getForOwner = originalGet;
  assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 1, pending: 0 }); assert.equal((await f.store.listForOwner(OWNER))[0].state, 'revoked'); assert.equal(f.counts.delete, 0);
  const other = await fixture(); const initialPut = other.connections.putForOwner;
  other.connections.putForOwner = async (owner, candidate) => { await initialPut(owner, { ...candidate, credentialRef: 'unrelated_reference' }, null); throw new Error('synthetic concurrent reservation'); };
  await assert.rejects(other.callback(await other.begin()), safe(['reservation_uncertain'])); assert.equal((await other.store.listForOwner(OWNER))[0].state, 'needs_consent'); assert.equal(other.counts.delete, 0); assert.deepEqual(await other.flow.retryCleanup(OWNER), { completed: 0, pending: 0 });
});

test('real store promotion is exact-tuple CAS and one-use; normal update and revoke still mint revisions', async () => {
  const f = await fixture(); const pending = await f.store.putForOwner(OWNER, { accountId: 'pending_exact', subject: 'pending_subject', address: 'pending@example.invalid', label: 'Pending', credentialRef: 'pending_ref', scopes: [...MOCK_OAUTH_SCOPES], state: 'needs_consent', expiresAt: NOW + 60000, mode: 'mock' }, null);
  for (const patch of [{ subject: 'other_subject' }, { credentialRef: 'other_ref' }, { revision: 'wrong_revision' }, { label: 'changed' }, { ownerId: 'user_sam' }]) await assert.rejects(f.store.approveReservedForOwner(OWNER, { ...pending, ...patch }));
  const approved = await f.store.approveReservedForOwner(OWNER, pending); assert.equal(approved.revision, pending.revision); assert.equal(approved.state, 'approved');
  await assert.rejects(f.store.approveReservedForOwner(OWNER, pending));
  const revoked = await f.store.revokeForOwner(OWNER, approved.accountId, approved.revision); assert.notEqual(revoked.revision, pending.revision); await assert.rejects(f.store.approveReservedForOwner(OWNER, pending));
  const fresh = await f.store.putForOwner(OWNER, { accountId: 'pending_race', subject: 'pending_race_subject', address: 'race@example.invalid', label: 'Pending race', credentialRef: 'pending_race_ref', scopes: [...MOCK_OAUTH_SCOPES], state: 'needs_consent', expiresAt: NOW + 60000, mode: 'mock' }, null);
  f.db.synchronizeNextCommits(); const revoking = f.store.revokeForOwner(OWNER, fresh.accountId, fresh.revision); await f.db.waitForPendingCommits();
  const promoting = f.store.approveReservedForOwner(OWNER, fresh); const results = await Promise.allSettled([revoking, promoting]); assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal((await f.store.getForOwner(OWNER, fresh.accountId)).state, 'revoked');
});

test('mismatched reservation response never revokes or deletes an unrelated owned connection/vault entry', async () => {
  const f = await fixture(); const put = f.connections.putForOwner; let unrelated;
  f.connections.putForOwner = async (owner, candidate) => {
    unrelated = await put(owner, { ...candidate, subject: 'other_subject', credentialRef: 'unrelated_existing_ref', state: 'approved' }, null);
    f.entries.set(unrelated.credentialRef, { ownerId: owner, accountId: candidate.accountId, subject: unrelated.subject, revision: unrelated.revision, credentialRef: unrelated.credentialRef, credential: { accessToken: 'unrelated_mock_token', subject: unrelated.subject, scopes: [...MOCK_OAUTH_SCOPES], expiresAt: unrelated.expiresAt } });
    return unrelated;
  };
  await assert.rejects(f.callback(await f.begin()), safe(['reservation_mismatch']));
  assert.deepEqual(await f.store.getForOwner(OWNER, unrelated.accountId), unrelated); assert.equal(unrelated.state, 'approved'); assert.equal(f.counts.delete, 0); assert.equal(f.counts.write, 0); assert.equal(f.entries.size, 1); assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 0, pending: 0 });
});

test('retryCleanup never drops a still-running reservation write that later commits with a lost response', async () => {
  const f = await fixture(); const put = f.connections.putForOwner; let enter; const entered = new Promise(resolve => { enter = resolve; }); let release; const gate = new Promise(resolve => { release = resolve; });
  f.connections.putForOwner = async (...args) => { if (args[1].state === 'needs_consent') { enter(); await gate; await put(...args); throw new Error('synthetic lost response after delayed commit'); } return put(...args); };
  const callback = f.callback(await f.begin()); await entered;
  assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 0, pending: 1 }); assert.deepEqual(await f.store.listForOwner(OWNER), []);
  release(); await assert.rejects(callback, safe(['reservation_uncertain'])); assert.equal((await f.store.listForOwner(OWNER))[0].state, 'revoked'); assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 0, pending: 0 }); assert.equal(f.counts.write, 0);
});

test('absent ambiguous reservation is cancelled with CAS tombstone before a late creation can commit', async () => {
  const f = await fixture(); const put = f.connections.putForOwner; let release; const gate = new Promise(resolve => { release = resolve; }); let late;
  f.connections.putForOwner = async (...args) => { if (args[1].state === 'needs_consent') { late = (async () => { await gate; return put(...args); })().then(value => ({ value }), error => ({ error })); throw new Error('synthetic response lost before commit visible'); } return put(...args); };
  await assert.rejects(f.callback(await f.begin()), safe(['reservation_uncertain'])); assert.equal((await f.store.listForOwner(OWNER))[0].state, 'revoked');
  release(); assert.equal((await late).error.code, 'conflict'); assert.equal((await f.store.listForOwner(OWNER))[0].state, 'revoked'); assert.equal(f.counts.write, 0); assert.equal(f.counts.delete, 0); assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 0, pending: 0 });
});

test('retryCleanup does not revoke an active vault write in a successful callback', async () => {
  const f = await fixture(); let enter; const entered = new Promise(resolve => { enter = resolve; }); let release; const gate = new Promise(resolve => { release = resolve; });
  f.hooks.write = async () => { enter(); await gate; }; const callback = f.callback(await f.begin()); await entered;
  assert.deepEqual(await f.flow.retryCleanup(OWNER), { completed: 0, pending: 1 }); assert.equal((await f.store.listForOwner(OWNER))[0].state, 'needs_consent'); assert.equal(f.counts.delete, 0);
  release(); assert.equal((await callback).status, 'approved');
});
