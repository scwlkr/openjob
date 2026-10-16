import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderTokenVaultBroker } from '../server/providers/provider-token-vault.ts';
import { createProviderConnectionReader } from '../server/providers/provider-connections.ts';
import { createFirestoreProviderConnectionStore } from '../db/provider-connections.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
const NOW = Date.parse('2026-10-17T00:00:00Z'); const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const REF = 'mock_opaque_reference'; const TOKEN = 'invented_mock_access_token';
const ROW = { ownerId: 'user_fixture', accountId: 'gmail_fixture', subject: 'google_fixture_subject', address: 'alex@example.invalid', label: 'Mock Gmail', credentialRef: REF, scopes: [SCOPE], state: 'approved', expiresAt: NOW + 60000, revision: 'revision_1', mode: 'mock' };
const binding = row => ({ ...(row.imap ? { imap: structuredClone(row.imap) } : {}), ...(row.provider ? { provider: row.provider } : {}), ownerId: row.ownerId, accountId: row.accountId, subject: row.subject, revision: row.revision });
const entry = row => ({ credentialRef: row.credentialRef, ...binding(row), credential: { accessToken: TOKEN, subject: row.subject, scopes: [...row.scopes], expiresAt: NOW + 120000 } });
const codes = allowed => error => allowed.includes(error.code) && !JSON.stringify({ ...error, message: error.message, stack: error.stack }).includes(TOKEN) && !error.message.includes(REF);
function fixture(options = {}) {
  let row = structuredClone(options.row ?? ROW); let secret = entry(row); let active = true; let clock = NOW; let duringRead; let reads = 0; let metadataReads = 0;
  const connections = { async listForOwner() { return [structuredClone(row)]; }, async getForOwner() { metadataReads++; if (options.storeError) throw new Error(`${REF} ${TOKEN}`); return structuredClone(row); } };
  const vault = { async read(ref) { reads++; assert.equal(ref, REF); await duringRead?.(); if (options.vaultError) throw new Error(`${REF} ${TOKEN}`); return structuredClone(secret); } };
  const broker = createProviderTokenVaultBroker({ connections, vault, isOwnerActive: async () => active, now: () => clock, executionMode: options.executionMode ?? 'mock' });
  return { broker, connections, vault, resolve: (context = binding(options.row ?? ROW), ref = REF) => broker.resolve(ref, context), reads: () => reads, metadataReads: () => metadataReads, change: fn => { row = fn(row); }, secret: fn => { secret = fn(secret); }, active: value => { active = value; }, time: value => { clock = value; }, hook: fn => { duringRead = fn; } };
}

test('vault broker defaults disabled without metadata/token lookup and has no live mode', async () => {
  const f = fixture(); const disabled = createProviderTokenVaultBroker({ connections: f.connections, vault: f.vault, isOwnerActive: async () => true });
  await assert.rejects(disabled.resolve(REF, binding(ROW)), codes(['execution_disabled'])); assert.equal(f.reads(), 0); assert.equal(f.metadataReads(), 0);
  assert.throws(() => createProviderTokenVaultBroker({ connections: f.connections, vault: f.vault, isOwnerActive: async () => true, executionMode: 'live' }), codes(['invalid_input']));
});

test('exact owner/account/subject/reference/revision binding is required both in metadata and vault', async () => {
  const f = fixture(); const result = await f.resolve(); assert.deepEqual(result, { accessToken: TOKEN, subject: ROW.subject, scopes: [SCOPE], expiresAt: ROW.expiresAt });
  result.scopes.length = 0; assert.deepEqual((await f.resolve()).scopes, [SCOPE]);
  for (const patch of [{ ownerId: 'user_other' }, { accountId: 'gmail_other' }, { subject: 'subject_other' }, { revision: 'revision_2' }]) {
    const denied = fixture(); await assert.rejects(denied.resolve({ ...binding(ROW), ...patch }), codes(['authentication_required', 'execution_disabled'])); assert.equal(denied.reads(), 0);
  }
  const wrongRef = fixture(); await assert.rejects(wrongRef.resolve(binding(ROW), 'different_ref'), codes(['execution_disabled'])); assert.equal(wrongRef.reads(), 0);
  for (const patch of [{ ownerId: 'user_other' }, { accountId: 'gmail_other' }, { subject: 'subject_other' }, { revision: 'revision_0' }, { credentialRef: 'different_ref' }]) {
    const denied = fixture(); denied.secret(value => ({ ...value, ...patch })); await assert.rejects(denied.resolve(), codes(['authentication_required']));
  }
});

test('stale/missing vault provisioning fails closed without changing approved metadata', async () => {
  for (const alter of [() => null, value => ({ ...value, revision: 'old_revision' }), value => ({ ...value, unexpectedToken: TOKEN }), value => ({ ...value, credential: { ...value.credential, refreshToken: TOKEN } })]) {
    const f = fixture(); const before = await f.connections.getForOwner(); f.secret(alter); await assert.rejects(f.resolve(), codes(['authentication_required'])); assert.deepEqual(await f.connections.getForOwner(), before);
  }
});

test('revoke, expiry, changed approval and user deletion during vault read discard the credential', async () => {
  for (const change of [row => ({ ...row, state: 'revoked' }), row => ({ ...row, revision: 'revision_2' }), row => ({ ...row, credentialRef: 'new_ref' }), row => ({ ...row, subject: 'new_subject' }), row => ({ ...row, label: 'Changed without revision' })]) {
    const f = fixture(); f.hook(() => f.change(change)); await assert.rejects(f.resolve(), codes(['execution_disabled', 'authentication_required'])); assert.equal(f.reads(), 1);
  }
  const deleted = fixture(); deleted.hook(() => deleted.active(false)); await assert.rejects(deleted.resolve(), codes(['authentication_required']));
  const expired = fixture(); expired.hook(() => expired.time(NOW + 60000)); await assert.rejects(expired.resolve(), codes(['authentication_required']));
});

test('invalid consent/credential and vault/metadata errors never expose references or token contents', async () => {
  for (const patch of [{ subject: 'foreign_subject' }, { accessToken: 'invalid\ntoken' }, { expiresAt: NOW }, { scopes: [] }]) { const f = fixture(); f.secret(value => ({ ...value, credential: { ...value.credential, ...patch } })); await assert.rejects(f.resolve(), codes(['authentication_required', 'consent_required'])); }
  for (const option of [{ vaultError: true }, { storeError: true }]) { const f = fixture(option); await assert.rejects(f.resolve(), codes(['authentication_required'])); }
  const revoked = fixture(); revoked.change(row => ({ ...row, state: 'revoked' })); await assert.rejects(revoked.resolve(), codes(['execution_disabled'])); assert.equal(revoked.reads(), 0);
  const unconsented = fixture(); unconsented.change(row => ({ ...row, scopes: [] })); await assert.rejects(unconsented.resolve(), codes(['consent_required'])); assert.equal(unconsented.reads(), 0);
});

test('durable metadata + separate vault + Gmail mock HTTP compose across reconstruction and metadata-first revoke', async () => {
  const db = createFakeFirestore(); const root = 'projects/openjob-dev/databases/(default)/documents/';
  db.documents.set(`${root}v1UserDirectory/${ROW.ownerId}`, { name: `${root}v1UserDirectory/${ROW.ownerId}`, updateTime: '2026-10-17T00:00:00Z', fields: { userId: { stringValue: ROW.ownerId } } });
  const config = { projectId: 'openjob-dev', clientEmail: 'fixture@example.invalid', privateKey: await createPrivateKey() };
  const createStore = () => createFirestoreProviderConnectionStore(config, db.fetch);
  let store = createStore(); const { ownerId, revision, ...input } = ROW; const approved = await store.putForOwner(ownerId, input, null); assert.notEqual(approved.revision, revision);
  const secrets = new Map([[REF, entry(approved)]]); let vaultReads = 0; let httpReads = 0;
  const vault = { async read(ref) { vaultReads++; return structuredClone(secrets.get(ref) ?? null); } };
  const isOwnerActive = async owner => { const row = db.documents.get(`${root}v1UserDirectory/${owner}`); return !!row && !row.fields.deletionState; };
  const fetchImplementation = async (input, init) => {
    const url = new URL(input); httpReads++; assert.equal(url.origin, 'https://gmail.googleapis.com'); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${TOKEN}`);
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: ROW.address });
    if (url.pathname.endsWith('/labels')) return Response.json({ labels: [{ id: 'INBOX', name: 'Inbox' }] });
    if (url.pathname.endsWith('/messages')) return Response.json({ messages: [{ id: 'msg1', threadId: 'thread1' }] });
    return Response.json({ id: 'msg1', threadId: 'thread1', labelIds: ['INBOX'], internalDate: String(NOW), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Durable invented mailbox' }], body: { data: Buffer.from('Only invented HTTP content.').toString('base64url') } } });
  };
  const readerFor = connections => createProviderConnectionReader({ store: connections, broker: createProviderTokenVaultBroker({ connections, vault, isOwnerActive, executionMode: 'mock', now: () => NOW }), isOwnerActive, executionMode: 'mock', fetchImplementation, now: () => NOW });
  const first = await readerFor(store).listMessages({ ownerId, accountId: ROW.accountId }); assert.equal(first.messages[0].body, 'Only invented HTTP content.');
  store = createStore(); const reopenedReader = readerFor(store); const second = await reopenedReader.listMessages({ ownerId, accountId: ROW.accountId }); assert.deepEqual(second, first);
  const revoked = await store.revokeForOwner(ownerId, ROW.accountId, approved.revision); assert.notEqual(revoked.revision, approved.revision);
  const counts = { vaultReads, httpReads };
  await assert.rejects(reopenedReader.listMessages({ ownerId, accountId: ROW.accountId }), codes(['execution_disabled'])); assert.deepEqual({ vaultReads, httpReads }, counts);
  assert.ok(secrets.has(REF)); // Cleanup has not happened; metadata revocation already denies reads.
  const staleBroker = createProviderTokenVaultBroker({ connections: store, vault, isOwnerActive, executionMode: 'mock', now: () => NOW });
  await assert.rejects(staleBroker.resolve(REF, binding(approved)), codes(['execution_disabled']));
  const reapproved = await store.putForOwner(ownerId, input, revoked.revision); await assert.rejects(staleBroker.resolve(REF, binding(reapproved)), codes(['authentication_required'])); // Old ref data cannot authorize a new revision.
  db.documents.get(`${root}v1UserDirectory/${ownerId}`).fields.deletionState = { stringValue: 'pending' };
  assert.equal(await store.removeAllForUser(ownerId), 1); assert.equal(await store.removeAllForUser(ownerId), 0); assert.ok(secrets.has(REF));
  await assert.rejects(staleBroker.resolve(REF, binding(reapproved)), codes(['authentication_required']));
  assert.equal(JSON.stringify([...db.documents.values()]).includes(TOKEN), false);
});

test('Outlook vault credentials require exact explicit provider and both delegated read scopes', async () => {
  const outlook = { ...ROW, provider: 'outlook', scopes: ['Mail.Read', 'User.Read'] };
  const f = fixture({ row: outlook }); assert.deepEqual((await f.resolve()).scopes, ['Mail.Read', 'User.Read']);
  const legacy = fixture(); legacy.secret(value => ({ ...value, provider: 'gmail' })); assert.equal((await legacy.resolve()).subject, ROW.subject);
  for (const provider of [undefined, 'gmail']) { const denied = fixture({ row: outlook }); denied.secret(value => { const result = { ...value, provider }; if (provider === undefined) delete result.provider; return result; }); await assert.rejects(denied.resolve(), codes(['authentication_required'])); }
  for (const scopes of [['Mail.Read'], ['User.Read'], [SCOPE]]) { const denied = fixture({ row: outlook }); denied.secret(value => ({ ...value, credential: { ...value.credential, scopes } })); await assert.rejects(denied.resolve(), codes(['consent_required'])); }
  const wrongBinding = fixture({ row: outlook }); await assert.rejects(wrongBinding.resolve(binding(ROW)), codes(['execution_disabled'])); assert.equal(wrongBinding.reads(), 0);
  const foreign = fixture(); foreign.secret(value => ({ ...value, provider: 'outlook' })); await assert.rejects(foreign.resolve(), codes(['authentication_required']));
  const changed = fixture(); changed.hook(() => changed.change(row => ({ ...row, provider: 'outlook', scopes: ['Mail.Read', 'User.Read'] })));
  await assert.rejects(changed.resolve(), codes(['execution_disabled']));
});

test('vault control-bearing opaque bindings and credential scopes fail closed', async () => {
  for (const control of ['\u001b', '\u007f', '\u0085', '\u009b']) {
    for (const patch of [{ subject: `subject${control}` }, { revision: `revision${control}` }]) {
      const f = fixture(); await assert.rejects(f.resolve({ ...binding(ROW), ...patch }), codes(['invalid_input'])); assert.equal(f.reads(), 0);
    }
    const ref = fixture(); await assert.rejects(ref.resolve(binding(ROW), `reference${control}`), codes(['invalid_input'])); assert.equal(ref.reads(), 0);
    const scopes = fixture(); scopes.secret(row => ({ ...row, credential: { ...row.credential, scopes: [SCOPE, `scope${control}`] } })); await assert.rejects(scopes.resolve(), codes(['consent_required']));
  }
});

test('IMAP vault bindings require explicit provider and exact server/username/INBOX configuration', async () => {
  const imap = { ...ROW, provider: 'imap', scopes: ['imap.read'], imap: { serverId: 'mock_server', username: 'fixture_user', mailbox: 'INBOX' } };
  const allowed = fixture({ row: imap }); assert.deepEqual((await allowed.resolve()).scopes, ['imap.read']);
  for (const alter of [value => { delete value.provider; return value; }, value => { delete value.imap; return value; }, value => ({ ...value, imap: { ...value.imap, serverId: 'foreign_server' } }), value => ({ ...value, imap: { ...value.imap, username: 'foreign_user' } }), value => ({ ...value, imap: { ...value.imap, mailbox: 'Archive' } })]) {
    const denied = fixture({ row: imap }); denied.secret(alter); await assert.rejects(denied.resolve(), codes(['authentication_required']));
  }
  const mismatch = fixture({ row: imap }); await assert.rejects(mismatch.resolve({ ...binding(imap), imap: { ...imap.imap, serverId: 'foreign_server' } }), codes(['execution_disabled'])); assert.equal(mismatch.reads(), 0);
  const changed = fixture({ row: imap }); changed.hook(() => changed.change(row => ({ ...row, imap: { ...row.imap, username: 'changed_user' } }))); await assert.rejects(changed.resolve(), codes(['execution_disabled']));
  const missingScope = fixture({ row: imap }); missingScope.secret(row => ({ ...row, credential: { ...row.credential, scopes: [SCOPE] } })); await assert.rejects(missingScope.resolve(), codes(['consent_required']));
});
