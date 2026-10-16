import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreUserStore } from '../db/users.ts';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createV1PersonalAgentGrantsApi } from '../server/v1-personal-agent-grants.ts';
import { createV1TasksApi } from '../server/v1-tasks.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';

async function fixture() {
  const now = '2026-10-16T03:00:00.000Z';
  const authority = await createTestFirebaseAuthority({ now });
  const firestore = createFakeFirestore();
  const config = { projectId: 'openjob-dev', clientEmail: 'personal-actions@example.invalid', privateKey: await createPrivateKey() };
  const users = createFirestoreUserStore(config, firestore.fetch);
  const workspace = createFirestorePersonalWorkspaceStore(config, firestore.fetch);
  let humanChecks = 0;
  const verify = createFirebaseIdTokenVerifier({ projectId: config.projectId, fetchImplementation: authority.fetch, now: () => Date.parse(now) });
  const verifyIdToken = request => { humanChecks++; return verify(request); };
  const tokens = {};
  for (const owner of ['alex', 'sam']) {
    tokens[owner] = await authority.issue({ uid: `personal_actions_${owner}` });
    await users.create(await verify(new Request('https://openjob.test', { headers: { authorization: `Bearer ${tokens[owner]}` } })));
  }
  const api = createV1PersonalWorkspaceApi({ workspace, users, verifyIdToken });
  const grants = createV1PersonalAgentGrantsApi({ workspace, users, verifyIdToken });
  async function call(path, token, method = 'GET', input) {
    const request = new Request(`https://openjob.test/api/v1/workspace/${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
    return (path.startsWith('agent-grants') ? grants : api).fetch(request);
  }
  async function grant(scopes, resourceIds = ['tasks:personal', 'calendar:personal']) {
    const response = await call('agent-grants', tokens.alex, 'POST', { name: 'Synthetic personal planner', scopes, resourceIds });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).data;
  }
  return { api, call, grant, tokens, firestore, workspace, users, verifyIdToken, humanChecks: () => humanChecks };
}

test('a scoped personal agent uses the same persisted HTTP commands, audits itself and revokes immediately', async () => {
  const f = await fixture();
  const { agent, token } = await f.grant(['tasks:read', 'tasks:write', 'calendar:read', 'calendar:write']);
  const checks = f.humanChecks();
  const created = await f.call('commands', token, 'POST', { type: 'task.create', title: 'Agent plans personal work' });
  assert.equal(created.status, 200);
  const task = (await created.json()).data;
  for (const input of [
    { type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-10-17T10:00:00Z', end: '2026-10-17T10:30:00Z' },
    { type: 'task.update', taskId: task.id, title: 'Agent revised plan' },
    { type: 'task.complete', taskId: task.id, completed: true },
  ]) assert.equal((await f.call('commands', token, 'POST', input)).status, 200);
  const read = await f.call('snapshot', token);
  assert.equal(read.status, 200);
  const state = (await read.json()).data;
  assert.equal(state.tasks.find(item => item.id === task.id).completed, true);
  assert.equal(state.events.find(item => item.taskId === task.id).title, 'Agent revised plan');
  assert.equal(state.messages.length, 0); assert.equal(state.agents.length, 0);
  assert.equal(f.humanChecks(), checks, 'personal credentials never use the Firebase/human path');
  const owner = (await (await f.call('snapshot', f.tokens.alex)).json()).data;
  assert.ok(owner.activity.some(entry => entry.actor === `Agent ${agent.id}`));
  assert.equal(JSON.stringify([...f.firestore.documents.values()]).includes(token), false);
  assert.equal((await f.call(`agent-grants/${agent.id}`, f.tokens.sam, 'DELETE')).status, 404);
  assert.equal((await f.call(`agent-grants/${agent.id}`, f.tokens.alex, 'DELETE')).status, 204);
  const before = JSON.stringify([...f.firestore.documents.values()]);
  assert.equal((await f.call('snapshot', token)).status, 401);
  assert.equal((await f.call('commands', token, 'POST', { type: 'task.update', taskId: task.id, title: 'Denied after revoke' })).status, 401);
  assert.equal(JSON.stringify([...f.firestore.documents.values()]), before);
  const other = (await (await f.call('snapshot', f.tokens.sam)).json()).data;
  assert.equal(other.tasks.length, 0); assert.equal(other.events.length, 0);
});

test('write-only agent results are minimal and insufficient scopes deny without mutation', async () => {
  const f = await fixture();
  const writer = await f.grant(['tasks:write'], ['tasks:personal']);
  const created = await f.call('commands', writer.token, 'POST', { type: 'task.create', title: 'Private write-only result' });
  assert.equal(created.status, 200);
  const ack = (await created.json()).data;
  assert.equal(typeof ack.id, 'string'); assert.deepEqual(Object.keys(ack).sort(), ['id', 'updated']);
  const snapshot = (await (await f.call('snapshot', writer.token)).json()).data;
  assert.equal(snapshot.tasks.length, 0); assert.equal(snapshot.calendars.length, 0);
  const reader = await f.grant(['tasks:read'], ['tasks:personal']);
  const before = JSON.stringify([...f.firestore.documents.values()]);
  assert.equal((await f.call('commands', reader.token, 'POST', { type: 'task.delete', taskId: ack.id })).status, 403);
  assert.equal((await f.call('commands', writer.token, 'POST', { type: 'task.schedule', taskId: ack.id, calendarId: 'personal', start: '2026-10-17T10:00:00Z', end: '2026-10-17T10:30:00Z' })).status, 403);
  assert.equal((await f.call('commands', writer.token, 'POST', { type: 'mail.send', draftId: 'nonexistent' })).status, 403);
  assert.equal(JSON.stringify([...f.firestore.documents.values()]), before);
});

test('personal tokens cannot administer grants or authenticate to Group Tasks and malformed tokens never fall back', async () => {
  const f = await fixture();
  const { token } = await f.grant(['tasks:read', 'tasks:write'], ['tasks:personal']);
  const checks = f.humanChecks();
  assert.equal((await f.call('agent-grants', token)).status, 401);
  assert.equal((await f.call('snapshot', 'oj_personal_malformed')).status, 401);
  assert.equal(f.humanChecks(), checks);
  let groupStoreCalls = 0;
  const groups = createV1TasksApi({ tasks: { hasAccess: async () => { groupStoreCalls++; throw new Error('Should not reach Group storage'); } }, users: f.users, verifyIdToken: f.verifyIdToken });
  const response = await groups.fetch(new Request('https://openjob.test/api/v1/groups/grp_synthetic/tasks', { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(response.status, 401); assert.equal(groupStoreCalls, 0);
});
