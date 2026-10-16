import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderPreview, createSyntheticProviderAdapter, createProviderResourceRef, parseProviderResourceRef } from '../shared/provider-preview.ts';

const ownerId = 'user_provider_owner';
const errorCode = code => error => error.code === code;

test('read adapter keeps two same-provider accounts and every upstream resource identity account-qualified', async () => {
  const adapter = createSyntheticProviderAdapter(); const accounts = await adapter.listAccounts(ownerId);
  const ready = accounts.filter(account => account.status === 'ready');
  assert.equal(ready.length, 2); assert.ok(ready.every(account => account.provider === 'gmail'));
  assert.notEqual(ready[0].upstreamId, ready[1].upstreamId);
  assert.ok(accounts.every(account => account.mode === 'synthetic' && account.address.endsWith('.invalid') && account.sync.asOf === '2026-10-17T09:00:00.000Z'));
  const [one, two] = await Promise.all(ready.map(account => adapter.listMessages({ ownerId, accountId: account.id })));
  assert.equal(one.messages[0].upstreamId, two.messages[0].upstreamId);
  assert.equal(one.messages[0].upstreamThreadId, two.messages[0].upstreamThreadId);
  for (const key of ['messages', 'folders', 'calendars', 'events']) {
    assert.equal(one[key][0].upstreamId, two[key][0].upstreamId);
    assert.notEqual(one[key][0].id, two[key][0].id);
    assert.equal(one[key][0].accountId, ready[0].id);
  }
  assert.notEqual(one.messages[0].threadId, two.messages[0].threadId);
  assert.equal(one.messages[0].threadId, one.messages[1].threadId);
  assert.ok(one.messages[0].folderIds.every(id => one.folders.some(folder => folder.id === id)));
  assert.equal(one.events[0].calendarId, one.calendars[0].id);
  assert.equal(JSON.stringify(accounts).includes(ownerId), false);
});

test('canonical resource references preserve opaque upstream IDs and reject account/kind mismatches', async () => {
  const accounts = await createSyntheticProviderAdapter().listAccounts(ownerId); const account = accounts[0].id;
  const originals = ['folder/child_01', 'folder%2Fchild_01', 'a_b', 'a/b', '日本語 / café', 'thread_shared'];
  const refs = originals.map(upstream => createProviderResourceRef(account, 'thread', upstream));
  assert.equal(new Set(refs).size, originals.length);
  for (let index = 0; index < originals.length; index++) assert.deepEqual(parseProviderResourceRef(refs[index], account, 'thread'), { accountId: account, kind: 'thread', upstreamId: originals[index] });
  assert.throws(() => parseProviderResourceRef(refs[0], accounts[1].id, 'thread'), errorCode('invalid_input'));
  assert.throws(() => parseProviderResourceRef(refs[0], account, 'message'), errorCode('invalid_input'));
  for (const value of [`${account}:thread:%xx`, `${account}:thread:%61`, `${account}:thread:`]) assert.throws(() => parseProviderResourceRef(value, account, 'thread'), errorCode('invalid_input'));
  assert.throws(() => createProviderResourceRef('foreign/account', 'message', '1'), errorCode('invalid_input'));
  assert.throws(() => createProviderResourceRef(account, 'send', '1'), errorCode('invalid_input'));
  assert.throws(() => createProviderResourceRef(account, 'thread', '\ud800'), errorCode('invalid_input'));
  const future = createProviderResourceRef('future_provider_account', 'thread', 'opaque/id_日本語');
  assert.equal(parseProviderResourceRef(future, 'future_provider_account', 'thread').upstreamId, 'opaque/id_日本語');
  assert.notEqual(createProviderResourceRef('a', 'message', 'b_message_c'), createProviderResourceRef('a_message_b', 'message', 'c'));
});

test('synthetic preview pagination is repeatable, detached and reaches all messages without duplicates', async () => {
  const first = await createProviderPreview({ ownerId });
  assert.equal(first.mode, 'synthetic'); assert.equal(first.messages.length, 2); assert.ok(first.nextCursor);
  const second = await createProviderPreview({ ownerId, accountId: first.selectedAccountId, cursor: first.nextCursor });
  assert.equal(second.messages.length, 1); assert.equal(second.nextCursor, null);
  const all = [...first.messages, ...second.messages]; assert.equal(new Set(all.map(message => message.id)).size, 3);
  assert.deepEqual(await createProviderPreview({ ownerId, accountId: first.selectedAccountId, cursor: first.nextCursor }), second);
  const original = structuredClone(first); first.messages[0].subject = 'Mutated'; first.accounts[0].capabilities.send.available = true;
  assert.deepEqual(await createProviderPreview({ ownerId }), original);
});

test('pagination and delta cursors fail closed across owners, accounts, operation modes and malformed encodings', async () => {
  const adapter = createSyntheticProviderAdapter(); const first = await createProviderPreview({ ownerId });
  const otherOwner = await adapter.listAccounts('user_other_owner'); const otherAccount = first.accounts[1].id;
  await assert.rejects(createProviderPreview({ ownerId: 'user_other_owner', accountId: first.selectedAccountId }), errorCode('forbidden'));
  await assert.rejects(createProviderPreview({ ownerId: 'user_other_owner', accountId: otherOwner[0].id, cursor: first.nextCursor }), errorCode('invalid_cursor'));
  await assert.rejects(createProviderPreview({ ownerId, accountId: otherAccount, cursor: first.nextCursor }), errorCode('invalid_cursor'));
  await assert.rejects(createProviderPreview({ ownerId, cursor: first.syncCursor }), errorCode('invalid_cursor'));
  await assert.rejects(adapter.readChanges({ ownerId, accountId: first.selectedAccountId, syncCursor: first.nextCursor }), errorCode('invalid_cursor'));
  for (const cursor of ['', 'garbage', 'pv1.W10', first.nextCursor + '=', 'x'.repeat(513)]) await assert.rejects(createProviderPreview({ ownerId, cursor }), errorCode('invalid_cursor'));
  await assert.rejects(createProviderPreview({ ownerId: '../wrong' }), errorCode('invalid_input'));
  await assert.rejects(createProviderPreview({ ownerId, accountId: '' }), errorCode('forbidden'));
});

test('delta changes and tombstones are deterministic, account-qualified and idempotent at the updated cursor', async () => {
  const adapter = createSyntheticProviderAdapter(); const first = await createProviderPreview({ ownerId });
  const input = { ownerId, accountId: first.selectedAccountId, syncCursor: first.syncCursor };
  const delta = await adapter.readChanges(input);
  assert.equal(delta.mode, 'synthetic'); assert.equal(delta.changes.length, 2); assert.equal(delta.tombstones.length, 2);
  assert.notEqual(delta.syncCursor, first.syncCursor);
  for (const change of delta.changes) assert.equal(change.value.accountId, first.selectedAccountId);
  for (const tombstone of delta.tombstones) {
    assert.equal(tombstone.accountId, first.selectedAccountId);
    assert.equal(parseProviderResourceRef(tombstone.id, first.selectedAccountId, tombstone.kind).accountId, first.selectedAccountId);
  }
  assert.deepEqual(await adapter.readChanges(input), delta);
  const settled = await adapter.readChanges({ ...input, syncCursor: delta.syncCursor });
  assert.deepEqual(settled.changes, []); assert.deepEqual(settled.tombstones, []); assert.equal(settled.syncCursor, delta.syncCursor);
  delta.changes[0].value.subject = 'External edit';
  assert.equal((await adapter.readChanges(input)).changes[0].value.subject, 'Launch checklist updated');
});

test('blocked statuses and unsupported operations describe this adapter honestly and cause no side effects', async () => {
  const adapter = createSyntheticProviderAdapter(); const before = await createProviderPreview({ ownerId });
  assert.deepEqual(new Set(before.accounts.map(account => account.status)), new Set(['ready', 'reconnect_required', 'error', 'unsupported']));
  for (const account of before.accounts) {
    for (const capability of ['draft', 'send', 'calendarWrite', 'reconnect']) { assert.equal(account.capabilities[capability].available, false); assert.ok(account.capabilities[capability].reason); }
    if (account.status === 'ready') continue;
    const blocked = await createProviderPreview({ ownerId, accountId: account.id });
    for (const key of ['messages', 'folders', 'calendars', 'events']) assert.deepEqual(blocked[key], []);
    assert.equal(blocked.nextCursor, null); assert.equal(account.sync.state, 'blocked');
    await assert.rejects(adapter.listMessages({ ownerId, accountId: account.id }), errorCode('provider_unavailable'));
    await assert.rejects(adapter.readChanges({ ownerId, accountId: account.id, syncCursor: blocked.syncCursor }), errorCode('provider_unavailable'));
  }
  assert.deepEqual(Object.keys(adapter).sort(), ['listAccounts', 'listMessages', 'readChanges']);
  assert.deepEqual(await createProviderPreview({ ownerId }), before);
});
