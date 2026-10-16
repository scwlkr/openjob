import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createEmptyPersonalWorkspace, applyPersonalWorkspaceCommand } from '../shared/personal-workspace.ts';
import { InactiveUserError } from '../db/user-history.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';

const ROOT = 'projects/openjob-dev/databases/(default)/documents/';
const key = createPrivateKey();
async function fixture() {
  const firestore = createFakeFirestore(); const requests = []; let intercept;
  const config = { projectId: 'openjob-dev', clientEmail: 'fixture@example.invalid', privateKey: await key };
  const seed = owner => firestore.documents.set(`${ROOT}v1UserDirectory/${owner}`, { name: `${ROOT}v1UserDirectory/${owner}`, updateTime: '2026-10-17T00:00:00.000Z', fields: { userId: { stringValue: owner }, emptyShellEligible: { booleanValue: true } } });
  seed('user_alex'); seed('user_sam');
  const fetcher = async (input, init = {}) => { requests.push({ url: String(input), init }); const handled = await intercept?.(input, init); return handled ?? firestore.fetch(input, init); };
  const store = createFirestorePersonalWorkspaceStore(config, fetcher);
  return { firestore, store, reopen: () => createFirestorePersonalWorkspaceStore(config, fetcher), requests, hook: fn => { intercept = fn; } };
}
const create = title => ({ type: 'task.create', title });
const schedule = taskId => ({ type: 'task.schedule', taskId, calendarId: 'personal', start: '2026-10-17T10:00:00Z', end: '2026-10-17T10:30:00Z' });
const workspaceName = owner => `${ROOT}v1PersonalWorkspaces/${owner}`;

test('empty personal state seeds only owned calendar; durable changes reopen and remain owner-private', async () => {
  const f = await fixture();
  const initial = await f.store.snapshot('user_alex');
  assert.deepEqual(initial, createEmptyPersonalWorkspace('user_alex'));
  assert.deepEqual(initial.calendars, [{ id: 'personal', ownerId: 'user_alex', name: 'Personal', color: '#2454dc' }]);
  assert.equal(f.firestore.documents.has(workspaceName('user_alex')), false);
  const task = await f.store.command('user_alex', create('Review personal plan'));
  await f.store.command('user_alex', schedule(task.id));
  await f.store.command('user_alex', { type: 'task.update', taskId: task.id, title: 'Updated plan' });
  const reloaded = await f.reopen().snapshot('user_alex');
  assert.equal(reloaded.tasks[0].title, 'Updated plan'); assert.equal(reloaded.events[0].title, 'Updated plan');
  assert.equal(reloaded.events[0].taskId, task.id);
  reloaded.tasks[0].title = 'External mutation'; assert.equal((await f.store.snapshot('user_alex')).tasks[0].title, 'Updated plan');
  assert.deepEqual(await f.store.snapshot('user_sam'), createEmptyPersonalWorkspace('user_sam'));
  const samTask = await f.store.command('user_sam', create('Sam plan'));
  await assert.rejects(f.store.command('user_alex', { type: 'task.delete', taskId: samTask.id }), error => error.code === 'forbidden');
  assert.equal((await f.store.snapshot('user_sam')).tasks[0].title, 'Sam plan');
  assert.equal(f.firestore.documents.get(`${ROOT}v1UserDirectory/user_alex`).fields.emptyShellEligible.booleanValue, false);
  assert.equal(JSON.stringify(f.firestore.documents.get(workspaceName('user_alex'))).includes('demo_'), false);
});

test('CAS resolves concurrent creation and linked edits without lost changes', async () => {
  const f = await fixture();
  f.firestore.synchronizeNextCommits();
  const [one, two] = await Promise.all([f.store.command('user_alex', create('First')), f.reopen().command('user_alex', create('Second'))]);
  assert.equal((await f.store.snapshot('user_alex')).tasks.length, 2);
  assert.ok(f.firestore.preconditionFailures() >= 1);
  await f.store.command('user_alex', schedule(one.id));
  f.firestore.synchronizeNextCommits();
  await Promise.all([
    f.store.command('user_alex', { type: 'task.update', taskId: one.id, title: 'Renamed concurrently' }),
    f.reopen().command('user_alex', { type: 'task.complete', taskId: one.id, completed: true }),
  ]);
  const view = await f.store.snapshot('user_alex');
  const updated = view.tasks.find(task => task.id === one.id);
  assert.equal(updated.completed, true); assert.equal(updated.title, 'Renamed concurrently');
  assert.equal(view.events.find(event => event.id === updated.calendarEventId).title, updated.title);
  assert.ok(view.tasks.some(task => task.id === two.id));
});

test('deletion fence wins racing commit; pending or missing users cannot read or write, cleanup still works', async () => {
  const f = await fixture(); await f.store.command('user_alex', create('Delete me'));
  await f.store.command('user_sam', create('Keep Sam private'));
  let fenced = false;
  f.hook((input) => {
    if (!String(input).endsWith('documents:commit') || fenced) return;
    fenced = true;
    const user = f.firestore.documents.get(`${ROOT}v1UserDirectory/user_alex`);
    user.updateTime = '2026-10-17T00:01:00Z'; user.fields.deletionState = { stringValue: 'pending' };
  });
  await assert.rejects(f.store.command('user_alex', create('Must not appear')), InactiveUserError);
  assert.equal(JSON.parse(f.firestore.documents.get(workspaceName('user_alex')).fields.stateJson.stringValue).tasks.length, 1);
  await assert.rejects(f.store.snapshot('user_alex'), InactiveUserError);
  await assert.rejects(f.store.command('missing_user', create('No')), InactiveUserError);
  assert.equal(await f.store.removeAllForUser('user_alex'), 1);
  assert.equal(await f.store.removeAllForUser('user_alex'), 0);
  assert.equal(f.firestore.documents.has(workspaceName('user_alex')), false);
  assert.ok(f.firestore.documents.has(`${ROOT}v1UserDirectory/user_alex`));
  assert.equal((await f.store.snapshot('user_sam')).tasks[0].title, 'Keep Sam private');
});

test('a deletion beginning during snapshot is checked before returning private state', async () => {
  const f = await fixture(); await f.store.command('user_alex', create('Private'));
  const pause = f.firestore.pauseNextDocumentRead('v1PersonalWorkspaces/user_alex');
  const reading = f.store.snapshot('user_alex'); await pause.waitUntilPaused();
  f.firestore.documents.get(`${ROOT}v1UserDirectory/user_alex`).fields.deletionState = { stringValue: 'pending' };
  pause.release(); await assert.rejects(reading, InactiveUserError);
});

test('unsupported mail/agents, invalid owners, foreign state and inconsistent links fail without persistence', async () => {
  const f = await fixture();
  for (const owner of ['', '../user_alex', 'a/b', 'x'.repeat(129)]) await assert.rejects(f.store.snapshot(owner), error => error.code === 'invalid_input');
  for (const input of [{ type: 'mail.compose' }, { type: 'mail.send', draftId: 'a' }, { type: 'agent.grant' }, { type: 'task.create', title: 'No private links', messageId: 'mail_id' }]) await assert.rejects(f.store.command('user_alex', input), error => error.code === 'forbidden');
  assert.equal(f.firestore.documents.has(workspaceName('user_alex')), false);
  await f.store.command('user_alex', create('Valid'));
  const document = f.firestore.documents.get(workspaceName('user_alex')); const original = structuredClone(document);
  for (const mutate of [
    state => { state.tasks[0].ownerId = 'user_sam'; },
    state => { state.accounts.push({ id: 'fixture_mailbox' }); },
    state => { state.tasks[0].sourceMessageId = 'private_mail'; },
    state => { state.events.push({ id: 'bad', calendarId: 'foreign', title: 'Bad', start: '2026-10-17T10:00:00.000Z', end: '2026-10-17T11:00:00.000Z' }); },
    state => { state.tasks[0].calendarEventId = 'missing'; },
    state => { state.activity[0].ownerId = 'user_sam'; },
  ]) {
    const state = JSON.parse(original.fields.stateJson.stringValue); mutate(state);
    document.fields.stateJson.stringValue = JSON.stringify(state);
    await assert.rejects(f.store.snapshot('user_alex'), error => error.code === 'invalid_state');
    await assert.rejects(f.store.command('user_alex', create('Must not repair')), error => error.code === 'invalid_state');
  }
  document.fields = structuredClone(original.fields); document.fields.ownerUserId.stringValue = 'user_sam';
  await assert.rejects(f.store.snapshot('user_alex'), error => error.code === 'invalid_state');
});

test('only precondition errors retry three attempts; network/server errors never replay commands', async () => {
  const f = await fixture(); let attempts = 0;
  f.hook((input) => {
    if (String(input).endsWith('documents:commit')) { attempts++; return Response.json({ error: { status: 'FAILED_PRECONDITION' } }, { status: 409 }); }
  });
  await assert.rejects(f.store.command('user_alex', create('Conflict')), error => error.code === 'conflict'); assert.equal(attempts, 3);
  attempts = 0;
  f.hook((input) => { if (String(input).endsWith('documents:commit')) { attempts++; throw new Error('Fixture network failure'); } });
  await assert.rejects(f.store.command('user_alex', create('Network')), /Fixture network failure/); assert.equal(attempts, 1);
  attempts = 0;
  f.hook((input) => { if (String(input).endsWith('documents:commit')) { attempts++; return Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 }); } });
  await assert.rejects(f.store.command('user_alex', create('Server')), /503/); assert.equal(attempts, 1);
});

test('encoded storage bound rejects growing state before any commit', async () => {
  const f = await fixture(); const state = createEmptyPersonalWorkspace('user_alex');
  const name = workspaceName('user_alex');
  const document = { name, updateTime: '2026-10-17T00:00:00Z', fields: { ownerUserId: { stringValue: 'user_alex' }, stateJson: { stringValue: '' } } };
  const encode = () => { document.fields.stateJson.stringValue = JSON.stringify(state); return Buffer.byteLength(JSON.stringify(document)); };
  for (let index = 0; encode() < 899_100; index++) state.tasks.push({ id: `task_${index}`, ownerId: 'user_alex', title: 'x'.repeat(500), completed: false });
  assert.ok(encode() < 900_000);
  f.firestore.documents.set(name, document);
  const attempts = f.firestore.commitAttempts();
  await assert.rejects(f.store.command('user_alex', create('Over limit')), error => error.code === 'workspace_capacity');
  assert.equal(f.firestore.commitAttempts(), attempts);
  assert.throws(() => applyPersonalWorkspaceCommand('user_alex', createEmptyPersonalWorkspace('user_alex'), { type: 'task.create', title: '' }), error => error.code === 'invalid_input');
});
