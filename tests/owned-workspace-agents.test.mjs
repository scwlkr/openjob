import { googleFlowFixture } from './support/google-connection-flow.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceAgentFixture } from './support/owned-workspace-agents.mjs';
import { createOwnedWorkspaceStore } from '../db/owned-workspaces.ts';
import { createWorkspacePilotApplication } from '../server/workspace-pilot-application.ts';
import { createOwnedWorkspacesApi } from '../server/owned-workspaces-api.ts';
import { createFakeFirestore } from './support/fake-firestore.mjs';

test('owned agent has exact resource authority, private hashed delivery, opaque write receipts and no human/Connections capabilities', async () => {
  const f = await workspaceAgentFixture(), g = await f.grant(['tasks:write'], [f.workspace.taskSpaceId]);
  assert.match(g.token, /^oj_workspace_wsp_[a-f0-9]{32}\.agt_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(g.agent.expiresAt) - Date.parse(g.agent.createdAt), 86400000);
  const receipt = await f.call(`/${f.home}/commands`, { token: g.token, input: { type: 'task.create', title: 'Private newly authored Task' } });
  assert.deepEqual(Object.keys(receipt).sort(), ['itemId', 'operation', 'workspaceId']); assert.equal(receipt.operation, 'task.create');
  assert.doesNotMatch(JSON.stringify(receipt), /title|notes|Private|"work":|"owner/);
  assert.equal((await f.request(`/${f.home}`, { token: g.token })).status, 403);
  for (const path of ['', '/home', '/session', '/personal-context', `/${f.home}/agent-grants`, `/${f.home}/agent-grants/${g.agent.id}`]) {
    assert.equal((await f.request(path, { token: g.token, ...(path === '/personal-context' ? { input: {} } : {}) })).status, 403);
  }
  assert.equal((await f.request(`/${f.home}/commands`, { token: g.token, input: { type: 'mail.send', draftId: 'x' } })).status, 403);
  const connection = await f.connectionsApi.fetch(new Request('https://fixture.invalid/api/v1/connections', { headers: { authorization: `Bearer ${g.token}` } })); assert.equal(connection.status, 401);
  const stored = JSON.stringify(f.db.exportState()); assert.equal(stored.includes(g.token), false); assert.match(stored, /tokenHash/);
  const access = await f.call(`/${f.home}/agent-grants`); assert.equal(JSON.stringify(access).includes('tokenHash'), false); assert.equal(access.actions[0].agentId, g.agent.id); assert.doesNotMatch(JSON.stringify(access.actions), /Private|title|notes/);
  const human = await f.call(`/${f.home}`); assert.equal(human.work.tasks[0].title, 'Private newly authored Task'); assert.doesNotMatch(JSON.stringify(human), /workspaceAgents|tokenHash|agentId/);
  let verifies = 0;
  const direct = createOwnedWorkspacesApi({ store: f.store, users: f.users, verifyIdToken: async () => { verifies++; throw new Error('Agent must not impersonate a human'); } });
  const r = await direct.fetch(new Request(`https://fixture.invalid/api/owned-workspaces/${f.home}/commands`, { method: 'POST', headers: { authorization: `Bearer ${g.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'task.complete', taskId: receipt.itemId, completed: true }) })); assert.equal(r.status, 200); assert.equal(verifies, 0);
});

test('permission-filtered reads remove cross-family links; linked changes require both write grants', async () => {
  const f = await workspaceAgentFixture();
  let work = await f.store.command(f.owner, f.home, { type: 'task.create', title: 'Review linked planning' }), taskId = work.work.tasks[0].id;
  await f.store.command(f.owner, f.home, { type: 'task.notes', taskId, notes: 'Secret Task notes' });
  work = await f.store.command(f.owner, f.home, { type: 'task.schedule', taskId, calendarId: f.workspace.calendarId, start: '2030-01-01T14:00:00Z', end: '2030-01-01T14:30:00Z' }); const eventId = work.work.events[0].id;
  const t = await f.grant(['tasks:read', 'tasks:write'], [f.workspace.taskSpaceId]);
  const c = await f.grant(['calendar:read', 'calendar:write'], [f.workspace.calendarId]);
  const full = await f.grant(['tasks:read', 'tasks:write', 'calendar:read', 'calendar:write'], [f.workspace.taskSpaceId, f.workspace.calendarId]);
  const tasks = await f.call(`/${f.home}`, { token: t.token }); assert.deepEqual(tasks.work.calendars, []); assert.deepEqual(tasks.work.events, []); assert.equal(tasks.work.tasks[0].notes, 'Secret Task notes'); assert.equal(tasks.work.tasks[0].scheduledSlot, undefined); assert.equal(tasks.work.tasks[0].calendarEventId, undefined);
  const calendar = await f.call(`/${f.home}`, { token: c.token }); assert.deepEqual(calendar.work.tasks, []); assert.equal(calendar.work.events[0].taskId, undefined); assert.doesNotMatch(JSON.stringify(calendar), /Secret Task notes/);
  for (const input of [{ type: 'task.update', taskId, title: 'Denied rename' }, { type: 'task.delete', taskId }, { type: 'task.unschedule', taskId }, { type: 'task.schedule', taskId, calendarId: f.workspace.calendarId, start: '2030-01-02T14:00:00Z', end: '2030-01-02T14:30:00Z' }]) assert.equal((await f.request(`/${f.home}/commands`, { token: t.token, input })).status, 403);
  const independent = await f.call(`/${f.home}/commands`, { token: c.token, input: { type: 'calendar.create', calendarId: f.workspace.calendarId, title: 'Calendar-only planning', start: '2030-01-03T14:00:00Z', end: '2030-01-03T14:30:00Z' } });
  assert.deepEqual(Object.keys(independent).sort(), ['itemId', 'operation', 'workspaceId']);
  await f.call(`/${f.home}/commands`, { token: c.token, input: { type: 'calendar.update', eventId: independent.itemId, title: 'Calendar-only revision', start: '2030-01-03T15:00:00Z', end: '2030-01-03T15:30:00Z' } });
  await f.call(`/${f.home}/commands`, { token: c.token, input: { type: 'calendar.delete', eventId: independent.itemId } });
  for (const input of [{ type: 'calendar.update', eventId, title: 'Denied', start: '2030-01-02T14:00:00Z', end: '2030-01-02T14:30:00Z' }, { type: 'calendar.delete', eventId }]) assert.equal((await f.request(`/${f.home}/commands`, { token: c.token, input })).status, 403);
  assert.equal((await f.request(`/${f.home}/commands`, { token: t.token, input: { type: 'task.notes', taskId, notes: 'Ungarded' } })).status, 400);
  await f.call(`/${f.home}/commands`, { token: t.token, input: { type: 'task.notes', taskId, notes: 'Updated by named agent', expectedNotes: 'Secret Task notes' } });
  assert.equal((await f.request(`/${f.home}/commands`, { token: t.token, input: { type: 'task.notes', taskId, notes: 'Stale', expectedNotes: 'Secret Task notes' } })).status, 409);
  await f.call(`/${f.home}/commands`, { token: full.token, input: { type: 'task.update', taskId, title: 'Reviewed rename' } });
  await f.call(`/${f.home}/commands`, { token: full.token, input: { type: 'calendar.delete', eventId } });
  const updated = await f.call(`/${f.home}`, { token: full.token }); assert.equal(updated.work.tasks[0].calendarEventId, undefined); assert.equal(updated.work.tasks[0].title, 'Reviewed rename'); assert.equal(updated.work.events.length, 0);
});

test('foreign resources, owners, contexts and old tokens fail closed; persistence and A revoke leave B usable', async () => {
  const f = await workspaceAgentFixture(), b = await f.store.create(f.owner, 'Family');
  const aGrant = await f.grant(['tasks:read', 'tasks:write'], [f.workspace.taskSpaceId]);
  const bGrant = await f.grant(['tasks:read'], [b.workspace.taskSpaceId], 'Independent B', b.workspace.workspaceId);
  const badInput = [{ name: 'Other resource', scopes: ['tasks:read'], resourceIds: [b.workspace.taskSpaceId] }, { name: 'Wrong family', scopes: ['tasks:read'], resourceIds: [f.workspace.calendarId] }, { name: 'Mail', scopes: ['mail:read'], resourceIds: [f.workspace.taskSpaceId] }];
  for (const input of badInput) assert.equal((await f.request(`/${f.home}/agent-grants`, { input })).status, 400);
  assert.equal((await f.request(`/${f.home}/agent-grants`, { token: f.sessions.sam.token })).status, 403);
  assert.equal((await f.request(`/${b.workspace.workspaceId}`, { token: aGrant.token })).status, 401);
  for (const token of ['oj_personal_fake', 'oj_agent_fake', `${aGrant.token} trailing`]) assert.equal((await f.request(`/${f.home}`, { token })).status, 401);
  const personal = await f.homes.personalContext(f.owner);
  assert.equal((await f.request(`/${personal.workspace.workspaceId}/agent-grants`, { input: { name: 'No adaptation', scopes: ['tasks:read'], resourceIds: [personal.workspace.taskSpaceId] } })).status, 403);
  await f.call(`/${f.home}/agent-grants/${aGrant.agent.id}`, { method: 'DELETE' });
  assert.equal((await f.request(`/${f.home}`, { token: aGrant.token })).status, 401);
  await f.call(`/${b.workspace.workspaceId}`, { token: bGrant.token });
  const restored = createFakeFirestore(); restored.restoreState(f.db.exportState()); const reloaded = createOwnedWorkspaceStore(f.config, restored.fetch);
  assert.equal((await reloaded.listAgents(f.owner, f.home)).agents[0].revoked, true); await reloaded.snapshotForAgent(bGrant.token, b.workspace.workspaceId, f.owner);
  f.advance(86400000); assert.equal((await f.request(`/${b.workspace.workspaceId}`, { token: bGrant.token })).status, 401);
});

test('a concurrent revoke wins the work CAS; an in-flight read also rechecks revocation', async () => {
  const f = await workspaceAgentFixture(), g = await f.grant(['tasks:read', 'tasks:write'], [f.workspace.taskSpaceId]);
  let release, notify, intercepted = false; const started = new Promise(resolve => { notify = resolve; }), resumed = new Promise(resolve => { release = resolve; });
  const store = createOwnedWorkspaceStore(f.config, async (input, init) => {
    if (!intercepted && new URL(input).pathname.endsWith(':commit') && JSON.parse(init.body).writes.some(write => write.update?.fields?.workspaceAgentActionsJson)) { intercepted = true; notify(); await resumed; }
    return f.db.fetch(input, init);
  });
  const writing = store.commandForAgent(g.token, f.home, { type: 'task.create', title: 'Must not commit after revoke' }, f.owner);
  await started; await f.store.revokeAgent(f.owner, f.home, g.agent.id); release();
  await assert.rejects(writing, error => error.code === 'authentication_required'); assert.deepEqual((await f.store.snapshot(f.owner, f.home)).work.tasks, []);
  const readGrant = await f.grant(['tasks:read'], [f.workspace.taskSpaceId]);
  const paused = f.db.pauseNextDocumentRead(`v1OwnedWorkspaces/${f.home}`, 1), reading = f.store.snapshotForAgent(readGrant.token, f.home, f.owner);
  await paused.waitUntilPaused(); await f.store.revokeAgent(f.owner, f.home, readGrant.agent.id); paused.release();
  await assert.rejects(reading, error => error.code === 'authentication_required');
});

test('unconfigured admission, changed sponsor and inactive owner cannot use grants', async () => {
  const f = await workspaceAgentFixture(), g = await f.grant(['tasks:read'], [f.workspace.taskSpaceId]);
  const unconfigured = createWorkspacePilotApplication({ ...f.options, admission: undefined }); assert.equal((await f.request(`/${f.home}`, { token: g.token, target: unconfigured })).status, 503);
  const changed = createWorkspacePilotApplication({ ...f.options, admission: { ...f.options.admission, userId: f.sessions.sam.user.userId } }); assert.equal((await f.request(`/${f.home}`, { token: g.token, target: changed })).status, 403);
  const before = f.db.exportState(); const denied = await f.request(`/${f.home}?owner=other`, { token: g.token }); assert.equal(denied.status, 400); assert.deepEqual(f.db.exportState(), before);
  const directory = [...f.db.documents.values()].find(doc => doc.fields?.userId?.stringValue === f.owner && doc.name.includes('/v1UserDirectory/')); directory.fields.deletionState = { stringValue: 'pending' };
  assert.equal((await f.request(`/${f.home}`, { token: g.token })).status, 410);
});

test('Workspace grants/actions and protected Mail source/reply work survive each other without agent disclosure', async () => {
  const f = await googleFlowFixture(), begin = await f.begin(); await f.complete(begin);
  const snapshot = await f.owned.snapshot(f.owner, f.home), resourceIds = [snapshot.workspace.taskSpaceId];
  const g = await f.owned.createAgent(f.owner, f.home, { name: 'Task assistant', scopes: ['tasks:read', 'tasks:write'], resourceIds });
  const response = await f.request(`/${begin.connectionId}/tasks`, { messageId: 'm1', title: 'Source-linked work' }); assert.equal(response.status, 200); const task = (await response.json()).data;
  const path = `/task-sources/${f.home}/${task.taskId}/reply`;
  const prepared = (await (await f.request(path)).json()).data;
  const savedResponse = await f.request(path, { mode: 'reply', body: 'Protected authored reply', expectedRevision: 0, reviewToken: prepared.reviewToken }); assert.equal(savedResponse.status, 200); const saved = (await savedResponse.json()).data;
  await f.owned.commandForAgent(g.token, f.home, { type: 'task.complete', taskId: task.taskId, completed: true }, f.owner);
  await f.owned.command(f.owner, f.home, { type: 'task.notes', taskId: task.taskId, notes: 'Human-owned notes' });
  await f.owned.createAgent(f.owner, f.home, { name: 'Second task reader', scopes: ['tasks:read'], resourceIds });
  const access = await f.owned.listAgents(f.owner, f.home); assert.equal(access.agents.length, 2); assert.equal(access.actions.length, 1);
  assert.deepEqual((await (await f.request(path)).json()).data.draft, saved.draft);
  const agent = await f.owned.snapshotForAgent(g.token, f.home, f.owner); assert.equal(agent.work.tasks[0].completed, true); assert.doesNotMatch(JSON.stringify(agent), /Protected authored reply|replies@example|sourceMessageId|sourceAccountId|mailSources|connectedReplies|workspaceAgents/);
  await f.owned.revokeAgent(f.owner, f.home, g.agent.id); assert.deepEqual((await (await f.request(path)).json()).data.draft, saved.draft);
});
