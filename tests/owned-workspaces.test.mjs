import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createFirestoreUserStore } from '../db/users.ts';
import { createOwnedWorkspaceStore } from '../db/owned-workspaces.ts';
import { createOwnedWorkspacesApi } from '../server/owned-workspaces-api.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
async function fixture() {
  const db = createFakeFirestore(), now = new Date().toISOString();
  const config = { projectId: 'openjob-dev', clientEmail: 'owned-test@example.invalid', privateKey: await createPrivateKey() };
  const authority = await createTestFirebaseAuthority({ now });
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', fetchImplementation: authority.fetch, now: () => Date.parse(now) });
  const users = createFirestoreUserStore(config, db.fetch), store = createOwnedWorkspaceStore(config, db.fetch), sessions = {};
  for (const name of ['alex', 'sam']) { const token = await authority.issue({ uid: `owned_fixture_${name}` }); const identity = await verifyIdToken(new Request('https://test.invalid', { headers: { authorization: `Bearer ${token}` } })); const { user } = await users.create(identity); sessions[name] = { token, owner: user.userId }; }
  const api = createOwnedWorkspacesApi({ store, users, verifyIdToken });
  const request = (path = '', input, name = 'alex', headers = {}) => api.fetch(new Request(`https://test.invalid/api/owned-workspaces${path}`, { method: input ? 'POST' : 'GET', headers: { authorization: `Bearer ${sessions[name]?.token ?? name}`, ...(input ? { 'content-type': 'application/json' } : {}), ...headers }, ...(input ? { body: JSON.stringify(input) } : {}) }));
  const call = async (...args) => { const response = await request(...args); assert.equal(response.status, 200, await response.clone().text()); assert.equal(response.headers.get('cache-control'), 'no-store'); return (await response.json()).data; };
  return { db, config, users, store, sessions, request, call, verifyIdToken };
}

test('one identity owns independent Workspace resources and atomic Task/Calendar work across persisted reload', async () => {
  const f = await fixture(), owner = f.sessions.alex.owner;
  const [a, b] = await Promise.all([f.store.create(owner, 'Work'), f.store.create(owner, 'Family')]);
  assert.notEqual(a.workspace.workspaceId, owner); assert.notEqual(a.workspace.workspaceId, b.workspace.workspaceId);
  assert.notEqual(a.workspace.calendarId, b.workspace.calendarId); assert.notEqual(a.workspace.taskSpaceId, b.workspace.taskSpaceId);
  assert.equal((await f.call()).length, 2); assert.deepEqual(await f.call('', undefined, 'sam'), []);
  let work = await f.call(`/${a.workspace.workspaceId}/commands`, { type: 'task.create', title: 'Prepare a meeting' });
  const task = work.work.tasks[0];
  work = await f.call(`/${a.workspace.workspaceId}/commands`, { type: 'task.notes', taskId: task.id, notes: 'Only in Work 📝' });
  work = await f.call(`/${a.workspace.workspaceId}/commands`, { type: 'task.schedule', taskId: task.id, calendarId: a.workspace.calendarId, start: '2026-10-18T14:00:00Z', end: '2026-10-18T14:30:00Z' });
  assert.equal(work.work.events[0].taskId, task.id); assert.equal(work.work.tasks[0].calendarEventId, work.work.events[0].id);
  assert.equal((await f.request(`/${b.workspace.workspaceId}/commands`, { type: 'task.complete', taskId: task.id, completed: true })).status, 403);
  assert.equal((await f.request(`/${b.workspace.workspaceId}/commands`, { type: 'task.schedule', taskId: task.id, calendarId: a.workspace.calendarId, start: '2026-10-18T14:00:00Z', end: '2026-10-18T14:30:00Z' })).status, 403);
  assert.deepEqual((await f.call(`/${b.workspace.workspaceId}`)).work.tasks, []);
  for (const [path, input] of [[`/${a.workspace.workspaceId}`, undefined], [`/${a.workspace.workspaceId}/commands`, { type: 'task.delete', taskId: task.id }]]) assert.equal((await f.request(path, input, 'sam')).status, 403);
  for (const input of [{ type: 'mail.examples.add' }, { type: 'task.create', title: 'No source links', messageId: 'secret' }, { type: 'agent.grant' }, { type: 'mail.send', draftId: 'x' }]) assert.equal((await f.request(`/${a.workspace.workspaceId}/commands`, input)).status, 400);
  const persisted = JSON.parse(JSON.stringify(f.db.exportState())); const restored = createFakeFirestore(); restored.restoreState(persisted);
  const reloaded = createOwnedWorkspaceStore(f.config, restored.fetch); assert.deepEqual(await reloaded.snapshot(owner, a.workspace.workspaceId), work);
  const record = [...persisted.documents].find(([name]) => name.endsWith(`/v1OwnedWorkspaces/${a.workspace.workspaceId}`))[1];
  assert.doesNotMatch(record.fields.snapshotJson.stringValue, /accounts|messages|drafts|sent|grants|sourceMessageId/);
  work = await reloaded.command(owner, a.workspace.workspaceId, { type: 'task.complete', taskId: task.id, completed: true }); assert.equal(work.work.tasks[0].completed, true); assert.equal(work.work.events.length, 1);
  work = await reloaded.command(owner, a.workspace.workspaceId, { type: 'task.unschedule', taskId: task.id }); assert.equal(work.work.events.length, 0); assert.equal(work.work.tasks[0].calendarEventId, undefined);
});

test('Workspace API enforces signed human identity and rechecks access; inactive owners cannot write', async () => {
  const f = await fixture();
  assert.equal((await f.request('', undefined, 'oj_personal_fake')).status, 401);
  assert.equal((await f.request('', undefined, 'no-token')).status, 401);
  assert.equal((await f.request('?owner=sam')).status, 400);
  assert.equal((await f.request('', { name: 'Spoof', ownerUserId: f.sessions.sam.owner })).status, 400);
  assert.equal((await f.request('', { name: 'Cross origin' }, 'alex', { origin: 'https://elsewhere.invalid' })).status, 400);
  const a = await f.call('', { name: 'Private' }, 'alex', { 'x-openjob-fixture-owner': f.sessions.sam.owner }); assert.equal(a.workspace.ownerUserId, f.sessions.alex.owner);
  const before = f.db.exportState();
  const resolve = f.users.resolve.bind(f.users); let reads = 0;
  const racing = createOwnedWorkspacesApi({ store: f.store, verifyIdToken: f.verifyIdToken, users: { resolve: async identity => ++reads === 1 ? resolve(identity) : null } });
  const response = await racing.fetch(new Request(`https://test.invalid/api/owned-workspaces/${a.workspace.workspaceId}`, { headers: { authorization: `Bearer ${f.sessions.alex.token}` } })); assert.equal(response.status, 410);
  assert.deepEqual(f.db.exportState(), before);
  const directory = [...f.db.documents.values()].find(doc => doc.fields?.userId?.stringValue === f.sessions.alex.owner && doc.name.includes('/v1UserDirectory/')); directory.fields.deletionState = { stringValue: 'pending' };
  await assert.rejects(f.store.command(f.sessions.alex.owner, a.workspace.workspaceId, { type: 'task.create', title: 'Blocked' }), error => error.name === 'InactiveUserError');
});
