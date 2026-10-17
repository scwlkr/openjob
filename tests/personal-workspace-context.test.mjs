import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createFirestoreUserStore } from '../db/users.ts';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createOwnedWorkspaceStore } from '../db/owned-workspaces.ts';
import { createPersonalWorkspaceContextStore } from '../db/personal-workspace-context.ts';
import { createWorkspaceContextStore } from '../server/workspace-context-store.ts';
import { createOwnedWorkspacesApi } from '../server/owned-workspaces-api.ts';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
async function fixture() {
  const db = createFakeFirestore(), now = new Date().toISOString();
  const config = { projectId: 'openjob-dev', clientEmail: 'context-test@example.invalid', privateKey: await createPrivateKey() };
  const authority = await createTestFirebaseAuthority({ now }); const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', fetchImplementation: authority.fetch, now: () => Date.parse(now) });
  const users = createFirestoreUserStore(config, db.fetch), sessions = {};
  for (const name of ['alex', 'sam']) { const token = await authority.issue({ uid: `owned_fixture_${name}` }); const identity = await verifyIdToken(new Request('https://test.invalid', { headers: { authorization: `Bearer ${token}` } })); const { user } = await users.create(identity); sessions[name] = { token, owner: user.userId }; }
  const personal = createFirestorePersonalWorkspaceStore(config, db.fetch), contexts = createPersonalWorkspaceContextStore(config, db.fetch), owned = createOwnedWorkspaceStore(config, db.fetch);
  const store = createWorkspaceContextStore({ owned, personal, contexts }); const api = createOwnedWorkspacesApi({ store, users, verifyIdToken }), legacy = createV1PersonalWorkspaceApi({ workspace: personal, users, verifyIdToken });
  const request = (path, input, name = 'alex') => { const isLegacy = path.startsWith('/api/v1/'); return (isLegacy ? legacy : api).fetch(new Request(`https://test.invalid${isLegacy ? path : '/api/owned-workspaces' + path}`, { method: input ? 'POST' : 'GET', headers: { authorization: `Bearer ${sessions[name]?.token ?? name}`, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) })); };
  const call = async (...args) => { const response = await request(...args); assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).data; };
  return { db, config, personal, contexts, owned, store, sessions, call, request };
}

test('stable Personal mapping retains User, source data and IDs; both API paths use one authority', async () => {
  const f = await fixture(), owner = f.sessions.alex.owner;
  const command = input => f.call('/api/v1/workspace/commands', input);
  await command({ type: 'mail.examples.add' }); const task = await command({ type: 'task.create', title: 'Retained Personal task', messageId: 'example-message-1' });
  await command({ type: 'task.notes', taskId: task.id, notes: 'Keep exact Personal notes 🛶' });
  await command({ type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-10-18T14:00:00Z', end: '2026-10-18T14:30:00Z' });
  await command({ type: 'mail.draft', messageId: 'example-message-1', body: 'Retained private reply' });
  const existing = await f.personal.snapshot(owner), personalDoc = structuredClone([...f.db.documents.values()].find(doc => doc.name.endsWith(`/v1PersonalWorkspaces/${owner}`)));
  const signIns = () => [...f.db.documents].filter(([name]) => name.includes('/v1SignInMethods/') || name.includes('/v1UserSignInMethods/'));
  const bindings = structuredClone(signIns()); const independent = await f.call('', { name: 'Work' });
  const [first, second] = await Promise.all([f.call('/personal-context', {}), f.call('/personal-context', {})]);
  assert.deepEqual(first, second); assert.notEqual(first.workspace.workspaceId, owner); assert.notEqual(first.workspace.workspaceId, independent.workspace.workspaceId);
  assert.equal(first.work.tasks[0].id, task.id); assert.equal(first.work.events[0].id, existing.events[0].id); assert.equal(first.work.events[0].calendarId, first.workspace.calendarId);
  assert.equal(first.work.tasks[0].sourceMessageId, undefined); assert.equal(first.work.tasks[0].sourceAccountId, undefined); assert.equal(first.work.tasks[0].notes, existing.tasks[0].notes);
  assert.deepEqual(await f.personal.snapshot(owner), existing); assert.deepEqual(signIns(), bindings);
  assert.deepEqual([...f.db.documents.values()].find(doc => doc.name.endsWith(`/v1PersonalWorkspaces/${owner}`)), personalDoc);
  assert.equal((await f.call('')).length, 2); assert.equal((await f.call('/personal-context', {})).workspace.workspaceId, first.workspace.workspaceId);
  const path = `/${first.workspace.workspaceId}/commands`;
  await f.call(path, { type: 'task.update', taskId: task.id, title: 'Edited through mapped context' });
  await f.call(path, { type: 'task.schedule', taskId: task.id, calendarId: first.workspace.calendarId, start: '2026-10-18T15:00:00Z', end: '2026-10-18T15:30:00Z' });
  const retained = await f.call('/api/v1/workspace/snapshot'); assert.equal(retained.tasks[0].title, 'Edited through mapped context'); assert.equal(retained.tasks[0].id, task.id); assert.equal(retained.events[0].calendarId, 'personal'); assert.deepEqual(retained.drafts, existing.drafts); assert.deepEqual(retained.messages, existing.messages);
  await command({ type: 'task.notes', taskId: task.id, notes: 'Changed through existing Personal API' });
  assert.equal((await f.call(`/${first.workspace.workspaceId}`)).work.tasks[0].notes, 'Changed through existing Personal API');
  const restored = createFakeFirestore(); restored.restoreState(JSON.parse(JSON.stringify(f.db.exportState())));
  const reload = createWorkspaceContextStore({ personal: createFirestorePersonalWorkspaceStore(f.config, restored.fetch), contexts: createPersonalWorkspaceContextStore(f.config, restored.fetch), owned: createOwnedWorkspaceStore(f.config, restored.fetch) });
  assert.equal((await reload.personalContext(owner)).workspace.workspaceId, first.workspace.workspaceId); assert.equal((await reload.snapshot(owner, first.workspace.workspaceId)).work.tasks[0].id, task.id);
});

test('eligibility remains policy-pending; mapping cannot be selected or expanded by claims, agents or foreign context IDs', async () => {
  const f = await fixture();
  assert.deepEqual(await f.call('/eligibility'), { state: 'policy_pending', realOnboardingEnabled: false, reason: 'independent_anchor_policy_not_adopted' });
  assert.equal((await f.request('/eligibility?independent=true')).status, 400);
  for (const input of [{ ownerUserId: f.sessions.sam.owner }, { eligible: true }, { provider: 'google', email: 'same@example.invalid' }]) assert.equal((await f.request('/personal-context', input)).status, 400);
  assert.equal((await f.request('/personal-context', {}, 'oj_personal_fake')).status, 401);
  const personal = await f.call('/personal-context', {}), owned = await f.call('', { name: 'Work' });
  const added = await f.call(`/${personal.workspace.workspaceId}/commands`, { type: 'task.create', title: 'Only Personal' }); const taskId = added.work.tasks[0].id;
  assert.equal((await f.request(`/${owned.workspace.workspaceId}/commands`, { type: 'task.complete', taskId, completed: true })).status, 403);
  assert.equal((await f.request(`/${personal.workspace.workspaceId}`, undefined, 'sam')).status, 403);
  assert.deepEqual(await f.call('', undefined, 'sam'), []);
  assert.equal((await f.request(`/${personal.workspace.workspaceId}/commands`, { type: 'task.schedule', taskId, calendarId: owned.workspace.calendarId, start: '2026-10-18T15:00:00Z', end: '2026-10-18T15:30:00Z' })).status, 403);
  for (const input of [{ type: 'mail.send', draftId: 'x' }, { type: 'task.create', title: 'No Mail source', messageId: 'x' }, { type: 'agent.grant' }]) assert.equal((await f.request(`/${personal.workspace.workspaceId}/commands`, input)).status, 400);
  const directory = [...f.db.documents.values()].find(doc => doc.name.endsWith(`/v1UserDirectory/${f.sessions.alex.owner}`)); directory.fields.deletionState = { stringValue: 'pending' };
  await assert.rejects(f.contexts.ensure(f.sessions.alex.owner), error => error.name === 'InactiveUserError');
});
