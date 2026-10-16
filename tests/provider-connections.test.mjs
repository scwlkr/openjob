import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderConnectionReader, providerConnectionFingerprint } from '../server/providers/provider-connections.ts';

const NOW = Date.parse('2026-10-17T00:00:00Z');
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const REF = 'mock-private-reference';
const TOKEN = 'mock-private-access-token';
const ROW = { ownerId: 'user_owner', accountId: 'gmail_mock', subject: 'mock_google_subject', address: 'alex@example.invalid', label: 'Mock Gmail', credentialRef: REF, scopes: [SCOPE], state: 'approved', expiresAt: NOW + 60000, revision: 'revision_1', mode: 'mock' };
const failure = codes => error => codes.includes(error.code) && !JSON.stringify({ message: error.message, stack: error.stack, ...error }).includes(REF) && !JSON.stringify({ message: error.message, ...error }).includes(TOKEN);
function fixture(options = {}) {
  let row = structuredClone(options.row ?? ROW); let ownerActive = true; let clock = NOW; let beforeStore; let duringBroker; let wireHook;
  let brokers = 0; const calls = [];
  const wire = (url) => {
    if (url.pathname.endsWith('/profile')) return { emailAddress: ROW.address };
    if (url.pathname.endsWith('/labels')) return { labels: [{ id: 'INBOX', name: 'Inbox' }] };
    if (url.pathname.endsWith('/messages')) return { messages: [{ id: 'message1', threadId: 'thread1' }] };
    return { id: 'message1', threadId: 'thread1', labelIds: ['INBOX'], internalDate: String(NOW), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Invented broker workflow' }], body: { data: Buffer.from('Mock HTTP message body.').toString('base64url') } } };
  };
  const store = {
    async listForOwner(owner) { await beforeStore?.('list', owner); return options.rows === undefined ? row && row.ownerId === owner ? [structuredClone(row)] : [] : structuredClone(options.rows); },
    async getForOwner(owner, account) { await beforeStore?.('get', owner, account); return row && row.ownerId === owner && row.accountId === account ? structuredClone(row) : null; },
  };
  const broker = { async resolve(ref, context) { brokers++; assert.equal(ref, REF); assert.deepEqual(context, { ownerId: ROW.ownerId, accountId: ROW.accountId, subject: ROW.subject, revision: ROW.revision }); await duringBroker?.(); if (options.brokerError) throw new Error(`${REF} ${TOKEN}`); return { accessToken: TOKEN, subject: ROW.subject, scopes: [SCOPE], expiresAt: NOW + 60000, ...options.credential }; } };
  const fetchImplementation = async (input, init) => { const url = new URL(input); calls.push({ url, init }); await wireHook?.(url); return Response.json(wire(url)); };
  const reader = createProviderConnectionReader({ store, broker, isOwnerActive: async () => ownerActive, executionMode: options.executionMode ?? 'mock', fetchImplementation, now: () => clock });
  return { reader, calls, brokers: () => brokers, change: fn => { row = fn(structuredClone(row)); }, active: value => { ownerActive = value; }, time: value => { clock = value; }, storeHook: fn => { beforeStore = fn; }, brokerHook: fn => { duringBroker = fn; }, wireHook: fn => { wireHook = fn; }, row: () => structuredClone(row), store, broker, fetchImplementation };
}
const read = reader => reader.listMessages({ ownerId: ROW.ownerId, accountId: ROW.accountId });

test('disabled default never resolves a credential or performs HTTP; mock requires explicit transport', async () => {
  const f = fixture(); const disabled = createProviderConnectionReader({ store: f.store, broker: f.broker, isOwnerActive: async () => true });
  await assert.rejects(read(disabled), failure(['execution_disabled'])); assert.equal(f.brokers(), 0); assert.equal(f.calls.length, 0);
  const rows = await disabled.listAccounts(ROW.ownerId); assert.equal(rows[0].status, 'not_connected'); assert.equal(rows[0].mode, 'mock');
  assert.throws(() => createProviderConnectionReader({ store: f.store, broker: f.broker, isOwnerActive: async () => true, executionMode: 'mock' }), failure(['invalid_input']));
  assert.throws(() => createProviderConnectionReader({ store: f.store, broker: f.broker, isOwnerActive: async () => true, executionMode: 'live', fetchImplementation: f.fetchImplementation }), failure(['invalid_input']));
});

test('approved owned mock connection feeds actual Gmail wire mapper without exposing broker values', async () => {
  const f = fixture(); const accounts = await f.reader.listAccounts(ROW.ownerId);
  assert.equal(accounts[0].mode, 'mock'); assert.equal(accounts[0].status, 'ready'); assert.equal(accounts[0].sync.asOf, null);
  assert.equal('credentialRef' in accounts[0], false); assert.equal('revision' in accounts[0], false);
  const page = await read(f.reader); assert.equal(page.messages[0].subject, 'Invented broker workflow'); assert.equal(page.messages[0].body, 'Mock HTTP message body.');
  assert.equal(page.messages[0].id, 'gmail_mock:message:message1'); assert.equal(page.syncCursor, null); assert.equal(f.brokers(), 1); assert.equal(f.calls.length, 4);
  for (const { url, init } of f.calls) { assert.equal(url.origin, 'https://gmail.googleapis.com'); assert.ok(url.pathname.startsWith('/gmail/v1/users/me/')); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); }
  assert.equal(JSON.stringify({ accounts, page }).includes(TOKEN), false); assert.equal(JSON.stringify({ accounts, page }).includes(REF), false);
  accounts[0].label = 'Client edit'; assert.equal((await f.reader.listAccounts(ROW.ownerId))[0].label, ROW.label);
});

test('unknown and foreign accounts fail before broker or HTTP; malformed or foreign list rows fail closed', async () => {
  const f = fixture();
  for (const [ownerId, accountId] of [['user_other', ROW.accountId], [ROW.ownerId, 'foreign_account']]) await assert.rejects(f.reader.listMessages({ ownerId, accountId }), failure(['forbidden']));
  assert.equal(f.brokers(), 0); assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.reader.listAccounts('user_other'), []);
  for (const rows of [[{ ...ROW, ownerId: 'user_other' }], [{ ...ROW, credentialRef: '' }], [ROW, ROW], [{ ...ROW, mode: 'provider' }], [{ ...ROW, token: TOKEN }]]) {
    const bad = fixture({ rows }); await assert.rejects(bad.reader.listAccounts(ROW.ownerId), failure(['forbidden', 'malformed_response'])); assert.equal(bad.brokers(), 0); assert.equal(bad.calls.length, 0);
  }
});

test('unconsented, revoked, expired and inactive owners cannot resolve credentials or fetch mail', async () => {
  for (const row of [{ ...ROW, state: 'needs_consent' }, { ...ROW, state: 'revoked' }, { ...ROW, scopes: [] }, { ...ROW, expiresAt: NOW }]) {
    const f = fixture({ row }); const accounts = await f.reader.listAccounts(ROW.ownerId);
    assert.ok(['needs_consent', 'revoked'].includes(accounts[0].status)); assert.equal(accounts[0].capabilities.mailRead.available, false);
    await assert.rejects(read(f.reader), failure(['consent_required', 'execution_disabled', 'authentication_required'])); assert.equal(f.brokers(), 0); assert.equal(f.calls.length, 0);
  }
  const inactive = fixture(); inactive.active(false); await assert.rejects(read(inactive.reader), failure(['authentication_required'])); await assert.rejects(inactive.reader.listAccounts(ROW.ownerId), failure(['authentication_required'])); assert.equal(inactive.brokers(), 0);
});

test('revocation, reference/subject/revision changes and deletion during broker resolution discard credential before HTTP', async () => {
  for (const change of [row => ({ ...row, state: 'revoked' }), row => ({ ...row, credentialRef: 'new-private-reference' }), row => ({ ...row, subject: 'different-subject' }), row => ({ ...row, revision: 'revision_2' }), row => ({ ...row, scopes: [] }), row => ({ ...row, expiresAt: NOW })]) {
    const f = fixture(); f.brokerHook(() => f.change(change)); await assert.rejects(read(f.reader), failure(['execution_disabled', 'authentication_required'])); assert.equal(f.brokers(), 1); assert.equal(f.calls.length, 0);
  }
  const deleted = fixture(); deleted.brokerHook(() => deleted.active(false)); await assert.rejects(read(deleted.reader), failure(['authentication_required'])); assert.equal(deleted.calls.length, 0);
});

test('each GET rechecks owner/approval; final response recheck discards content after last provider response', async () => {
  const duringProfile = fixture(); duringProfile.wireHook(url => { if (url.pathname.endsWith('/profile')) duringProfile.change(row => ({ ...row, state: 'revoked', revision: 'revision_2' })); });
  await assert.rejects(read(duringProfile.reader), failure(['execution_disabled'])); assert.equal(duringProfile.calls.length, 1);
  const final = fixture(); final.wireHook(url => { if (url.pathname.endsWith('/messages/message1')) final.change(row => ({ ...row, revision: 'revision_2' })); });
  await assert.rejects(read(final.reader), failure(['execution_disabled'])); assert.equal(final.calls.length, 4);
  const expired = fixture(); expired.wireHook(url => { if (url.pathname.endsWith('/labels')) expired.time(NOW + 60000); });
  await assert.rejects(read(expired.reader), failure(['execution_disabled', 'authentication_required'])); assert.equal(expired.calls.length, 2);
  const deleted = fixture(); deleted.wireHook(url => { if (url.pathname.endsWith('/messages/message1')) deleted.active(false); }); await assert.rejects(read(deleted.reader), failure(['execution_disabled', 'authentication_required']));
});

test('changed record between initial read and approval denies before broker; broker/store failures are sanitized', async () => {
  const f = fixture(); let reads = 0;
  f.storeHook(type => { if (type === 'get' && ++reads === 2) f.change(row => ({ ...row, revision: 'revision_2' })); });
  await assert.rejects(read(f.reader), failure(['execution_disabled'])); assert.equal(f.brokers(), 0); assert.equal(f.calls.length, 0);
  const badBroker = fixture({ brokerError: true }); await assert.rejects(read(badBroker.reader), failure(['authentication_required'])); assert.equal(badBroker.calls.length, 0);
  const badStore = fixture(); badStore.storeHook(() => { throw new Error(`${REF} ${TOKEN}`); }); await assert.rejects(read(badStore.reader), failure(['malformed_response'])); assert.equal(badStore.brokers(), 0);
});

test('broker cannot substitute subject, omit read consent or return an expired credential', async () => {
  for (const credential of [{ subject: 'foreign-subject' }, { scopes: [] }, { expiresAt: NOW }]) {
    const f = fixture({ credential }); await assert.rejects(read(f.reader), failure(['authentication_required', 'consent_required'])); assert.equal(f.brokers(), 1); assert.equal(f.calls.length, 0);
  }
});


test('legacy absent provider and explicit Gmail share fingerprints while Outlook is distinct', () => {
  assert.equal(providerConnectionFingerprint(ROW), providerConnectionFingerprint({ ...ROW, provider: 'gmail' }));
  assert.notEqual(providerConnectionFingerprint(ROW), providerConnectionFingerprint({ ...ROW, provider: 'outlook' }));
});

test('control-bearing connection labels, addresses and opaque fields fail before broker lookup or HTTP', async () => {
  for (const control of ['\u001b', '\u007f', '\u0085', '\u009b']) {
    for (const patch of [{ label: `Unsafe${control}label` }, { address: `unsafe${control}@example.invalid` }, { subject: `subject${control}` }, { credentialRef: `ref${control}` }, { revision: `revision${control}` }, { scopes: [SCOPE, `scope${control}`] }]) {
      const f = fixture({ row: { ...ROW, ...patch } });
      await assert.rejects(f.reader.listAccounts(ROW.ownerId), failure(['malformed_response']));
      await assert.rejects(read(f.reader), failure(['malformed_response']));
      assert.equal(f.brokers(), 0); assert.equal(f.calls.length, 0);
    }
  }
});
