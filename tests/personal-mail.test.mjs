import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createEmptyPersonalWorkspace, validatePersonalWorkspace } from '../shared/personal-workspace.ts';
import { PERSONAL_MAIL_RESOURCES } from '../shared/personal-mail-examples.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
const ROOT = 'projects/openjob-dev/databases/(default)/documents/';
const key = createPrivateKey();
const owner = 'user_alex';
async function fixture() {
  const db = createFakeFirestore();
  for (const id of [owner, 'user_sam']) db.documents.set(`${ROOT}v1UserDirectory/${id}`, { name: `${ROOT}v1UserDirectory/${id}`, updateTime: '2026-10-17T00:00:00Z', fields: { userId: { stringValue: id } } });
  const config = { projectId: 'openjob-dev', clientEmail: 'fixture@example.invalid', privateKey: await key };
  const reopen = () => createFirestorePersonalWorkspaceStore(config, db.fetch);
  const store = reopen();
  const grant = (scopes, resourceIds = [PERSONAL_MAIL_RESOURCES[0]]) => store.createAgent(owner, { name: 'Example mail assistant', scopes, resourceIds });
  return { db, store, reopen, grant };
}
const seed = { type: 'mail.examples.add' };
const compose = { type: 'mail.compose', accountId: PERSONAL_MAIL_RESOURCES[0], to: 'recipient@example.invalid', subject: 'Invented message', body: 'This is a fixture draft.' };
async function deniedUnchanged(f, action, code) { const before = await f.store.snapshot(owner); await assert.rejects(action(), error => error.code === code); assert.deepEqual(await f.store.snapshot(owner), before); }

test('human opt-in seed is idempotent and preserves private tasks/calendar/grants across reload', async () => {
  const f = await fixture(); assert.deepEqual((await f.store.snapshot(owner)).accounts, []);
  const task = await f.store.command(owner, { type: 'task.create', title: 'Existing task' });
  await f.store.command(owner, { type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-10-17T10:00:00Z', end: '2026-10-17T11:00:00Z' });
  const agent = await f.grant(['mail:read']);
  const ack = await f.store.command(owner, seed);
  assert.deepEqual(ack, { mode: 'fixture', added: true, accountIds: [...PERSONAL_MAIL_RESOURCES], messageIds: Array.from({ length: 6 }, (_, i) => `example-message-${i + 1}`) });
  await f.store.command(owner, { type: 'mail.read', messageId: 'example-message-1', read: true });
  const reply = await f.store.command(owner, { type: 'mail.draft', messageId: 'example-message-1', body: 'First reply' });
  const again = await f.store.command(owner, { type: 'mail.draft', messageId: 'example-message-1', body: 'Saved reply' }); assert.equal(reply.id, again.id);
  const before = await f.store.snapshot(owner); assert.equal((await f.store.command(owner, seed)).added, false);
  assert.deepEqual(await f.reopen().snapshot(owner), before); assert.equal((await f.store.listAgents(owner))[0].id, agent.agent.id);
  assert.equal(before.events[0].taskId, task.id); assert.equal(before.messages[0].read, true); assert.equal(before.drafts.length, 1);
  assert.deepEqual(await f.store.snapshot('user_sam'), createEmptyPersonalWorkspace('user_sam'));
  await deniedUnchanged(f, () => f.store.command(owner, { ...seed, extra: true }), 'invalid_input');
});

test('private message→task→schedule and draft edit→simulated Sent persist; real sends always reject', async () => {
  const f = await fixture(); await f.store.command(owner, seed);
  const task = await f.store.command(owner, { type: 'task.create', title: 'Follow up', messageId: 'example-message-3' });
  assert.equal(task.sourceAccountId, PERSONAL_MAIL_RESOURCES[1]);
  await f.store.command(owner, { type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-10-17T10:00:00Z', end: '2026-10-17T11:00:00Z' });
  const draft = await f.store.command(owner, compose);
  await f.store.command(owner, { type: 'mail.draft.update', draftId: draft.id, to: 'edited@example.invalid', subject: 'Edited', body: 'Edited body' });
  await deniedUnchanged(f, () => f.store.command(owner, { type: 'mail.send', draftId: draft.id }), 'sending_disabled');
  const sent = await f.store.command(owner, { type: 'mail.simulate-send', draftId: draft.id }); assert.equal(sent.mode, 'fixture'); assert.equal(sent.subject, 'Edited');
  await deniedUnchanged(f, () => f.store.command(owner, { type: 'mail.simulate-send', draftId: draft.id }), 'forbidden');
  const view = await f.reopen().snapshot(owner); assert.equal(view.sent.length, 1); assert.equal(view.drafts.length, 0); assert.equal(view.tasks[0].sourceMessageId, 'example-message-3'); assert.equal(view.events[0].taskId, task.id);
});

test('named mailbox scopes isolate reads/provenance and grant draft/simulation without implicit reading', async () => {
  const f = await fixture(); await f.store.command(owner, seed);
  const full = await f.grant(['mail:read', 'mail:draft', 'mail:simulate-send', 'tasks:read', 'tasks:write', 'calendar:read', 'calendar:write'], ['tasks:personal', 'calendar:personal', ...PERSONAL_MAIL_RESOURCES]);
  const task = await f.store.commandForAgent(full.token, { type: 'task.create', title: 'Private source', messageId: 'example-message-1' });
  const reader = await f.grant(['mail:read']); const view = await f.store.snapshotForAgent(reader.token); assert.equal(view.messages.length, 2); assert.deepEqual(view.sent, []);
  await deniedUnchanged(f, () => f.store.commandForAgent(reader.token, { type: 'mail.read', messageId: 'example-message-3', read: true }), 'forbidden');
  await deniedUnchanged(f, () => f.store.commandForAgent(full.token, seed), 'forbidden');
  const tasksOnly = await f.grant(['tasks:read'], ['tasks:personal']); const privateTask = (await f.store.snapshotForAgent(tasksOnly.token)).tasks[0]; assert.equal(privateTask.id, task.id); assert.equal('sourceMessageId' in privateTask, false); assert.equal('sourceAccountId' in privateTask, false);
  const writer = await f.grant(['mail:draft', 'mail:simulate-send']);
  const draft = await f.store.commandForAgent(writer.token, compose); assert.deepEqual(Object.keys(draft).sort(), ['id', 'updated']);
  const sent = await f.store.commandForAgent(writer.token, { type: 'mail.simulate-send', draftId: draft.id }); assert.deepEqual(Object.keys(sent).sort(), ['id', 'updated']); assert.deepEqual((await f.store.snapshotForAgent(writer.token)).sent, []);
  const draftOnly = await f.grant(['mail:draft']); const pending = await f.store.commandForAgent(draftOnly.token, compose);
  const draftOnlyView = await f.store.snapshotForAgent(draftOnly.token); assert.deepEqual(draftOnlyView.drafts, []); assert.deepEqual(draftOnlyView.messages, []);
  const draftReader = await f.grant(['mail:read', 'mail:draft']); assert.ok((await f.store.snapshotForAgent(draftReader.token)).drafts.some(draft => draft.id === pending.id));
  await deniedUnchanged(f, () => f.store.commandForAgent(draftOnly.token, { type: 'mail.simulate-send', draftId: pending.id }), 'forbidden');
  await deniedUnchanged(f, () => f.store.commandForAgent(full.token, { type: 'mail.send', draftId: pending.id }), 'sending_disabled');
  await f.store.revokeAgent(owner, full.agent.id); await deniedUnchanged(f, () => f.reopen().commandForAgent(full.token, compose), 'authentication_required');
});

test('strict state rejects provider imports, forged identity, foreign draft references and unpaired provenance', async () => {
  const f = await fixture(); await f.store.command(owner, seed); const original = await f.store.snapshot(owner);
  for (const mutate of [
    state => { state.accounts[0].mode = 'provider'; }, state => { state.accounts[0].ownerId = 'user_sam'; },
    state => { state.messages[0].body = 'Imported provider content'; }, state => { state.messages[0].accountId = PERSONAL_MAIL_RESOURCES[1]; },
    state => { state.messages.pop(); }, state => { state.accounts[0] = null; }, state => { state.drafts.push(null); },
    state => { state.sent.push({ id: 'bad', accountId: PERSONAL_MAIL_RESOURCES[0], to: 'a@example.invalid', subject: 'Bad', body: 'Bad', status: 'draft' }); }, state => { state.accounts.push({ ...state.accounts[0], id: 'raw-provider-ref' }); },
    state => { state.tasks.push({ id: 'bad', ownerId: owner, title: 'Bad', completed: false, sourceMessageId: 'example-message-1' }); },
    state => { state.drafts.push({ id: 'bad', accountId: PERSONAL_MAIL_RESOURCES[0], messageId: 'example-message-3', to: 'a@example.invalid', subject: 'Bad', body: 'Bad', status: 'draft' }); },
  ]) { const changed = structuredClone(original); mutate(changed); assert.throws(() => validatePersonalWorkspace(owner, changed), error => error.code === 'invalid_state'); }
});

test('concurrent example activation has one catalog and keeps simultaneous personal edits', async () => {
  const f = await fixture(); f.db.synchronizeNextCommits();
  const results = await Promise.all([f.store.command(owner, seed), f.reopen().command(owner, seed)]);
  assert.equal(results.filter(result => result.added).length, 1);
  f.db.synchronizeNextCommits();
  await Promise.all([f.store.command(owner, { type: 'mail.read', messageId: 'example-message-1', read: true }), f.reopen().command(owner, { type: 'task.create', title: 'Concurrent private task' })]);
  const view = await f.store.snapshot(owner); assert.equal(view.accounts.length, 3); assert.equal(view.messages.length, 6); assert.equal(view.messages[0].read, true); assert.equal(view.tasks[0].title, 'Concurrent private task');
  assert.ok(f.db.preconditionFailures() >= 2);
});
