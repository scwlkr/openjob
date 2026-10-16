import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { InactiveUserError } from '../db/user-history.ts';
import { PERSONAL_AGENT_LIFETIME_MS } from '../shared/personal-agent-grants.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
const ROOT = 'projects/openjob-dev/databases/(default)/documents/';
const key = createPrivateKey();
const owner = 'user_alex';
async function fixture() {
  const db = createFakeFirestore(); let clock = Date.parse('2026-10-17T00:00:00Z'); let hook;
  const config = { projectId: 'openjob-dev', clientEmail: 'fixture@example.invalid', privateKey: await key };
  for (const id of [owner, 'user_sam']) db.documents.set(`${ROOT}v1UserDirectory/${id}`, { name: `${ROOT}v1UserDirectory/${id}`, updateTime: '2026-10-17T00:00:00Z', fields: { userId: { stringValue: id } } });
  const fetcher = async (url, init = {}) => { await hook?.(url, init); return db.fetch(url, init); };
  const store = createFirestorePersonalWorkspaceStore(config, fetcher, { now: () => clock });
  const issued = input => store.createAgent(owner, { name: 'Personal planner', scopes: ['tasks:read', 'tasks:write', 'calendar:read', 'calendar:write'], resourceIds: ['tasks:personal', 'calendar:personal'], ...input });
  return { db, store, issued, time: value => { clock = value; }, now: () => clock, hook: fn => { hook = fn; }, reopen: () => createFirestorePersonalWorkspaceStore(config, fetcher, { now: () => clock }) };
}
const doc = f => f.db.documents.get(`${ROOT}v1PersonalWorkspaces/${owner}`);
async function rejectsUnchanged(f, action, code) { const before = structuredClone(doc(f)); await assert.rejects(action(), error => error.code === code); assert.deepEqual(doc(f), before); }
const create = title => ({ type: 'task.create', title });
const schedule = taskId => ({ type: 'task.schedule', taskId, calendarId: 'personal', start: '2026-10-17T10:00:00Z', end: '2026-10-17T10:30:00Z' });

test('personal credential stores hash only, public metadata is detached and grants survive reopen', async () => {
  const f = await fixture(); const issued = await f.issued();
  assert.match(issued.token, /^oj_personal_user_alex\.agt_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(issued.agent.expiresAt) - Date.parse(issued.agent.createdAt), PERSONAL_AGENT_LIFETIME_MS);
  assert.equal(JSON.stringify(doc(f)).includes(issued.token), false);
  const stored = JSON.parse(doc(f).fields.grantJson.stringValue);
  assert.match(stored[0].tokenHash, /^[a-f0-9]{64}$/); assert.deepEqual(JSON.parse(doc(f).fields.stateJson.stringValue).agents, []);
  assert.equal('tokenHash' in issued.agent, false);
  issued.agent.scopes.push('mail:read');
  const listed = await f.reopen().listAgents(owner); assert.equal(listed[0].scopes.includes('mail:read'), false);
  assert.equal(JSON.stringify(listed).includes(stored[0].tokenHash), false);
  assert.deepEqual(await f.store.listAgents('user_sam'), []);
  assert.equal((await f.reopen().snapshotForAgent(issued.token)).calendars.length, 1);
});

test('scoped agent executes linked workflow with distinct audit and no mail or administrative access', async () => {
  const f = await fixture(); const { agent, token } = await f.issued();
  const task = await f.store.commandForAgent(token, create('Agent task'));
  await f.store.commandForAgent(token, schedule(task.id));
  await f.store.commandForAgent(token, { type: 'task.update', taskId: task.id, title: 'Agent revision' });
  const view = await f.store.snapshotForAgent(token);
  assert.equal(view.tasks[0].title, 'Agent revision'); assert.equal(view.events[0].title, 'Agent revision');
  for (const key of ['accounts', 'messages', 'drafts', 'sent', 'agents', 'activity']) assert.deepEqual(view[key], []);
  const durable = JSON.parse(doc(f).fields.stateJson.stringValue);
  assert.ok(durable.activity.every(entry => entry.actor === `Agent ${agent.id}`)); assert.deepEqual(durable.agents, []);
  for (const input of [{ type: 'mail.send', draftId: 'x' }, { type: 'mail.compose' }, { type: 'agent.grant' }, { type: 'task.create', title: 'Mail link', messageId: 'x' }]) await rejectsUnchanged(f, () => f.store.commandForAgent(token, input), 'forbidden');
  const ownTask = await f.store.command('user_sam', create('Private Sam task'));
  await rejectsUnchanged(f, () => f.store.commandForAgent(token, { type: 'task.delete', taskId: ownTask.id }), 'forbidden');
});

test('write-only mutation responses are minimal and scopes/resources do not imply read access', async () => {
  const f = await fixture(); const task = await f.store.command(owner, create('Private existing title'));
  const writer = await f.issued({ scopes: ['tasks:write'], resourceIds: ['tasks:personal'] });
  assert.deepEqual(await f.store.commandForAgent(writer.token, { type: 'task.complete', taskId: task.id, completed: true }), { id: task.id, updated: true });
  assert.deepEqual((await f.store.snapshotForAgent(writer.token)).tasks, []);
  await rejectsUnchanged(f, () => f.store.commandForAgent(writer.token, schedule(task.id)), 'forbidden');
  const reader = await f.issued({ scopes: ['tasks:read'], resourceIds: ['tasks:personal'] });
  await rejectsUnchanged(f, () => f.store.commandForAgent(reader.token, { type: 'task.update', taskId: task.id, title: 'No' }), 'forbidden');
  assert.equal((await f.store.snapshotForAgent(reader.token)).tasks[0].title, 'Private existing title');
  const wrongResource = await f.issued({ scopes: ['tasks:read', 'tasks:write'], resourceIds: ['calendar:personal'] });
  assert.deepEqual((await f.store.snapshotForAgent(wrongResource.token)).tasks, []);
  await rejectsUnchanged(f, () => f.store.commandForAgent(wrongResource.token, create('No')), 'forbidden');
  const calendarWriter = await f.issued({ scopes: ['calendar:write'], resourceIds: ['calendar:personal'] });
  const event = await f.store.commandForAgent(calendarWriter.token, { type: 'calendar.create', calendarId: 'personal', title: 'Fixture block', start: '2026-10-17T10:00:00Z', end: '2026-10-17T10:30:00Z' });
  assert.deepEqual(Object.keys(event).sort(), ['id', 'updated']);
  assert.deepEqual(await f.store.commandForAgent(calendarWriter.token, { type: 'calendar.delete', eventId: event.id }), { id: event.id, deleted: true });
});

test('malformed, tampered, cross-owner, revoked and expired tokens cannot mutate or fall back', async () => {
  const f = await fixture(); const { token, agent } = await f.issued();
  for (const value of ['', 'Bearer human-token', 'oj_agent_agt_' + 'a'.repeat(32) + '.' + 'A'.repeat(43), token.replace('user_alex', 'user_sam'), token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')]) {
    await rejectsUnchanged(f, () => f.store.commandForAgent(value, create('No')), 'authentication_required');
    await assert.rejects(f.store.snapshotForAgent(value), error => error.code === 'authentication_required');
  }
  assert.equal(await f.store.revokeAgent('user_sam', agent.id), false);
  assert.equal(f.db.documents.has(`${ROOT}v1PersonalWorkspaces/user_sam`), false);
  assert.equal(await f.store.revokeAgent(owner, agent.id), true);
  assert.equal((await f.store.listAgents(owner))[0].revoked, true);
  await rejectsUnchanged(f, () => f.store.commandForAgent(token, create('Revoked')), 'authentication_required');
  const expiring = await f.issued(); f.time(Date.parse(expiring.agent.expiresAt));
  await rejectsUnchanged(f, () => f.store.commandForAgent(expiring.token, create('Expired')), 'authentication_required');
  await assert.rejects(f.store.snapshotForAgent(expiring.token), error => error.code === 'authentication_required');
});

test('revoke wins a CAS race with agent write; fresh authorization denies the retry', async () => {
  const f = await fixture(); const { token, agent } = await f.issued();
  f.db.synchronizeNextCommits(); const revoking = f.store.revokeAgent(owner, agent.id);
  await f.db.waitForPendingCommits();
  const writing = f.store.commandForAgent(token, create('Must not survive revoke'));
  const results = await Promise.allSettled([revoking, writing]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(results[1].reason.code, 'authentication_required');
  assert.equal((await f.store.snapshot(owner)).tasks.length, 0); assert.ok(f.db.preconditionFailures() >= 1);
});

test('expiry is checked after async user-fence read immediately before commit dispatch', async () => {
  const f = await fixture(); const { token, agent } = await f.issued();
  let reads = 0; f.hook(url => { if (String(url).endsWith('/v1UserDirectory/user_alex') && ++reads === 2) f.time(Date.parse(agent.expiresAt)); });
  await rejectsUnchanged(f, () => f.store.commandForAgent(token, create('Expired during authorization')), 'authentication_required');
});

test('snapshot rechecks revocation and user deletion; account cleanup removes credential envelope', async () => {
  const f = await fixture(); const { token, agent } = await f.issued();
  const pause = f.db.pauseNextDocumentRead('v1PersonalWorkspaces/user_alex', 1);
  const reading = f.store.snapshotForAgent(token); await pause.waitUntilPaused();
  await f.store.revokeAgent(owner, agent.id); pause.release();
  await assert.rejects(reading, error => error.code === 'authentication_required');
  const second = await f.issued(); let changed = false;
  f.hook(url => { if (String(url).endsWith('documents:commit') && !changed) { changed = true; const user = f.db.documents.get(`${ROOT}v1UserDirectory/${owner}`); user.updateTime = '2026-10-17T01:00:00Z'; user.fields.deletionState = { stringValue: 'pending' }; } });
  await assert.rejects(f.store.commandForAgent(second.token, create('Deletion raced')), InactiveUserError);
  assert.equal(await f.store.removeAllForUser(owner), 1); assert.equal(doc(f), undefined);
  await assert.rejects(f.store.snapshotForAgent(second.token), InactiveUserError);
});

test('strict grant schema, bounded count and corrupt envelopes are rejected', async () => {
  const f = await fixture(); await f.issued();
  for (const input of [{ name: '' }, { name: 'bad\nname' }, { scopes: ['mail:read'] }, { scopes: ['tasks:read', 'tasks:read'] }, { resourceIds: ['personal'] }, { resourceIds: [] }, { expiresAt: '2099-01-01' }]) {
    await rejectsUnchanged(f, () => f.issued(input), 'invalid_input');
  }
  const current = doc(f); const original = current.fields.grantJson.stringValue;
  const grants = JSON.parse(original);
  for (let index = 1; index < 100; index++) grants.push({ ...grants[0], id: `agt_${index.toString(16).padStart(32, '0')}` });
  current.fields.grantJson.stringValue = JSON.stringify(grants);
  await rejectsUnchanged(f, () => f.issued(), 'workspace_capacity');
  current.fields.grantJson.stringValue = original.replace('user_alex', 'user_sam');
  await assert.rejects(f.store.listAgents(owner), error => error.code === 'invalid_state');
});
