import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createFirestoreUserStore } from '../db/users.ts';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createWorkspacePilotRuntime } from '../server/workspace-pilot-runtime.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { readWorkspaceHome } from '../server/workspace-home.ts';
import { validateWorkspaceHome } from '../shared/workspace-home.ts';
import { parseWorkspaceFragment, workspaceFragment } from '../shared/workspace-navigation.ts';
async function fixture() {
  const db = createFakeFirestore(), now = new Date().toISOString();
  const config = { projectId: 'openjob-dev', clientEmail: 'home@example.invalid', privateKey: await createPrivateKey() };
  const authority = await createTestFirebaseAuthority({ now });
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: config.projectId, fetchImplementation: authority.fetch, now: () => Date.parse(now) });
  const users = createFirestoreUserStore(config, db.fetch), personal = createFirestorePersonalWorkspaceStore(config, db.fetch), sessions = {};
  for (const name of ['alex', 'sam']) {
    const token = await authority.issue({ uid: `home_${name}` }); const identity = await verifyIdToken(new Request('https://home.invalid', { headers: { authorization: `Bearer ${token}` } })); const { user } = await users.create(identity);
    const admission = { userId: user.userId, provider: 'google', firebaseUid: identity.uid };
    const compose = (overrides = {}) => createWorkspacePilotRuntime({ config, personal, users, verifyIdToken, admission, transport: db.fetch, ...overrides });
    sessions[name] = { token, user, compose, api: compose() };
  }
  const request = (path, input, name = 'alex', api = sessions[name].api) => api.fetch(new Request('https://home.invalid/api/v1/workspaces' + path, { method: input === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${sessions[name]?.token ?? name}`, ...(input === undefined ? {} : { 'content-type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }));
  const call = async (...args) => { const response = await request(...args); assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).data; };
  return { db, sessions, personal, users, request, call, now: Date.parse(now) };
}
test('Home composes owned and retained Personal minimal summaries, bounds rows/window and preserves existing authority', async () => {
  const f = await fixture(), owner = f.sessions.alex.user.userId;
  assert.deepEqual((await f.call('/home')).workspaces, []); // No automatic Personal mapping.
  await f.personal.command(owner, { type: 'mail.examples.add' });
  const task = await f.personal.command(owner, { type: 'task.create', title: 'Retained task', messageId: 'example-message-1' });
  await f.personal.command(owner, { type: 'task.notes', taskId: task.id, notes: 'PRIVATE NOTES NEVER ON HOME' });
  const retained = await f.call('/personal-context', {}), work = await f.call('', { name: 'Work' }), family = await f.call('', { name: 'Family' });
  const command = input => f.call(`/${work.workspace.workspaceId}/commands`, input);
  for (let i = 0; i < 7; i++) await command({ type: 'task.create', title: `Open ${i}` });
  let current = await command({ type: 'task.create', title: 'Completed excluded' });
  await command({ type: 'task.complete', taskId: current.work.tasks.find(row => row.title === 'Completed excluded').id, completed: true });
  const slot = (start, end) => ({ start: new Date(f.now + start * 3600000).toISOString(), end: new Date(f.now + end * 3600000).toISOString() });
  for (let i = 0; i < 7; i++) await command({ type: 'calendar.create', calendarId: work.workspace.calendarId, title: `Upcoming ${i}`, ...slot(i + 1, i + 1.5) });
  await command({ type: 'calendar.create', calendarId: work.workspace.calendarId, title: 'Already ended excluded', ...slot(-2, -1) });
  await command({ type: 'calendar.create', calendarId: work.workspace.calendarId, title: 'Too far excluded', ...slot(9 * 24, 9 * 24 + 1) });
  const before = structuredClone(f.db.exportState()), home = await f.call('/home');
  assert.equal(home.workspaces.length, 3); assert.equal(home.workspaces[0].workspace.workspaceId, retained.workspace.workspaceId);
  const w = home.workspaces.find(item => item.workspace.workspaceId === work.workspace.workspaceId);
  assert.equal(w.openTaskCount, 7); assert.equal(w.tasks.length, 5); assert.equal(w.upcomingBlockCount, 7); assert.equal(w.blocks.length, 5);
  assert.equal(home.workspaces.find(item => item.workspace.workspaceId === family.workspace.workspaceId).openTaskCount, 0);
  assert.equal(home.workspaces[0].tasks[0].id, task.id);
  const raw = JSON.stringify(home); for (const forbidden of ['PRIVATE NOTES', 'sourceMessageId', 'sourceAccountId', 'mailbox', 'drafts', 'Completed excluded', 'Already ended excluded', 'Too far excluded']) assert.equal(raw.includes(forbidden), false);
  assert.deepEqual(f.db.exportState(), before); assert.equal(validateWorkspaceHome(home, owner), home);
  const dirty = structuredClone(home); dirty.workspaces[0].tasks[0].notes = 'Unexpected'; assert.throws(() => validateWorkspaceHome(dirty, owner));
});
test('Home enforces actual owner/admission and final revocation; fails all rather than disclosing a partial or foreign projection', async () => {
  const f = await fixture(), work = await f.call('', { name: 'Alex private' });
  await f.call(`/${work.workspace.workspaceId}/commands`, { type: 'task.create', title: 'Private title' });
  assert.deepEqual((await f.call('/home', undefined, 'sam')).workspaces, []);
  for (const name of ['sam', 'oj_agent_fake']) assert.equal((await f.request('/home', undefined, name, f.sessions.alex.api)).status, name === 'sam' ? 403 : 401);
  assert.equal((await f.request('/home', { type: 'task.complete' })).status, 404); assert.equal((await f.request('/home?owner=alex')).status, 400);
  const unconfigured = f.sessions.alex.compose({ admission: undefined }); assert.equal((await f.request('/home', undefined, 'alex', unconfigured)).status, 503);
  let calls = 0; const revoked = f.sessions.alex.compose({ users: { resolve: async identity => ++calls < 3 ? f.users.resolve(identity) : null } });
  const denied = await f.request('/home', undefined, 'alex', revoked); assert.equal(denied.status, 410); assert.equal((await denied.text()).includes('Private title'), false);
  await assert.rejects(readWorkspaceHome(f.sessions.sam.user.userId, { list: async () => [work.workspace], snapshot: async () => work }), error => error.code === 'forbidden');
  await assert.rejects(readWorkspaceHome(f.sessions.alex.user.userId, { list: async () => [work.workspace], snapshot: async () => { throw new Error('Context unavailable'); } }));
  const directory = [...f.db.documents.values()].find(doc => doc.name.endsWith(`/v1UserDirectory/${f.sessions.alex.user.userId}`)); directory.fields.deletionState = { stringValue: 'pending' };
  assert.equal((await f.request('/home')).status, 410);
});
test('Home destinations retain exact opaque context/item in history and reject malformed cross-context routes', () => {
  const workspaceId = 'wsp_' + 'a'.repeat(32), id = 'offline_opaque/id with space';
  for (const item of [undefined, { kind: 'task', id }, { kind: 'block', id }]) { const target = { workspaceId, ...(item ? { item } : {}) }; assert.deepEqual(parseWorkspaceFragment(workspaceFragment(target)), target); }
  assert.deepEqual(parseWorkspaceFragment(''), { workspaceId: '' }); assert.deepEqual(parseWorkspaceFragment('#home'), { workspaceId: '' });
  for (const hash of ['#someone', `#${workspaceId}/mail/id`, `#${workspaceId}/task/`, `#${workspaceId}/task/%`, `#${workspaceId}/task/%00`, `#${workspaceId}/task/id/extra`]) assert.equal(parseWorkspaceFragment(hash), null);
});
