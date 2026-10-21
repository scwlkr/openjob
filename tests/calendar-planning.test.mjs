import test from 'node:test';
import assert from 'node:assert/strict';
import { replyOperationFixture } from './support/reply-operations.mjs';
import { createFixtureGoogleCalendar } from './support/google-calendar-transport.mjs';
import { createCalendarPlanningRepository } from '../db/calendar-planning.ts';
import { createFixtureCalendarPlanning } from '../server/calendar-planning.ts';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createPersonalWorkspaceContextStore } from '../db/personal-workspace-context.ts';
import { createWorkspaceContextStore } from '../server/workspace-context-store.ts';
import { createWorkspacePilotApplication } from '../server/workspace-pilot-application.ts';

const span = { start: { kind: 'timed', at: '2026-11-01T06:30:00.000Z', timeZone: 'America/Chicago' }, end: { kind: 'timed', at: '2026-11-01T07:30:00.000Z', timeZone: 'America/Chicago' } };
async function fixture(options = {}) {
  const f = await replyOperationFixture(); let time = Date.now(), allowed = true, state;
  const row = f.envelopes.get(f.owner)[0], binding = { ownerId: f.owner, workspaceId: f.home, accountId: row.accountId, connectionId: row.id, subject: row.subject, revision: row.attemptId, calendarIds: ['planning@example.invalid'] };
  const repo = (transport = f.db.fetch) => createCalendarPlanningRepository(f.config, transport, { now: () => time });
  const protocol = () => createFixtureGoogleCalendar({ binding, state, persist: async value => { state = value; }, active: async () => allowed && f.envelopes.get(f.owner)[0]?.status === 'connected', now: () => time, ...options });
  let provider = protocol(); const service = (repository = repo(), extra = {}) => createFixtureCalendarPlanning({ repository, ...provider, now: () => time, ...extra });
  const input = { action: 'calendar.create', taskId: f.task.taskId, requestId: crypto.randomUUID(), accountId: binding.accountId, calendarId: binding.accountId + ':calendar:' + encodeURIComponent(binding.calendarIds[0]), title: 'Finish the review', span };
  return { ...f, binding, repo, service, input, state: () => state, provider: () => provider, editProvider(apply) { state = provider.state(); apply(state); provider = protocol(); }, restart() { const saved = f.db.exportState(); f.db.restoreState(saved); provider = protocol(); }, advance(ms) { time += ms; }, revoke() { allowed = false; } };
}
test('Mail Task → atomic remote reservation → restart → create/update/delete; local completion stays local', async () => {
  const f = await fixture(), ops = f.service(), before = await f.owned.snapshot(f.owner, f.home), queued = await ops.enqueue(f.owner, f.home, f.input);
  assert.equal(queued.state, 'queued'); assert.equal((await ops.planning(f.owner, f.home))[0].state, 'reserved'); assert.deepEqual(await f.owned.snapshot(f.owner, f.home), before);
  await assert.rejects(() => ops.enqueue(f.owner, f.home, { ...f.input, requestId: crypto.randomUUID() }), e => e.code === 'remote_plan_active');
  await assert.rejects(() => f.owned.command(f.owner, f.home, { type: 'task.delete', taskId: f.task.taskId }), e => e.code === 'remote_plan_active');
  await assert.rejects(() => f.owned.command(f.owner, f.home, { type: 'task.schedule', taskId: f.task.taskId, calendarId: before.workspace.calendarId, start: span.start.at, end: span.end.at }), e => e.code === 'remote_plan_active');
  await f.owned.command(f.owner, f.home, { type: 'task.complete', taskId: f.task.taskId, completed: true });
  assert.equal(f.state(), undefined); f.restart(); const service = f.service();
  const confirmed = await service.run(f.owner, f.home, queued.id); assert.equal(confirmed.state, 'confirmed'); assert.equal(f.state().attempts.length, 1);
  for (let i = 0; i < 3; i++) await f.service().run(f.owner, f.home, queued.id); assert.equal(f.state().attempts.length, 1);
  const link = (await service.planning(f.owner, f.home))[0]; assert.equal(link.state, 'linked'); assert.equal(link.confirmed.title, f.input.title);
  const updated = await service.enqueue(f.owner, f.home, { action: 'calendar.update', taskId: f.task.taskId, requestId: crypto.randomUUID(), etag: link.confirmed.etag, title: 'Reviewed change', span });
  assert.equal((await service.run(f.owner, f.home, updated.id)).state, 'confirmed');
  const current = (await service.planning(f.owner, f.home))[0]; const deletion = await service.enqueue(f.owner, f.home, { action: 'calendar.delete', taskId: f.task.taskId, requestId: crypto.randomUUID(), etag: current.confirmed.etag });
  assert.equal((await service.run(f.owner, f.home, deletion.id)).state, 'confirmed'); assert.deepEqual(await service.planning(f.owner, f.home), []); assert.ok(f.state().events.every(event => event.status === 'cancelled')); assert.equal(f.state().attempts.length, 3);
  await f.owned.command(f.owner, f.home, { type: 'task.delete', taskId: f.task.taskId });
});
test('lost accepted DELETE retains a cancelled tombstone and reconciles after restart without another write', async () => {
  const f = await fixture({ afterAccept: async row => { if (row.method === 'DELETE') throw new Error('Lost DELETE response'); } }), service = f.service(), create = await service.enqueue(f.owner, f.home, f.input);
  assert.equal((await service.run(f.owner, f.home, create.id)).state, 'confirmed');
  const link = (await service.planning(f.owner, f.home))[0], deletion = await service.enqueue(f.owner, f.home, { action: 'calendar.delete', taskId: f.task.taskId, requestId: crypto.randomUUID(), etag: link.confirmed.etag });
  assert.equal((await service.run(f.owner, f.home, deletion.id)).state, 'unknown'); assert.equal(f.state().attempts.length, 2);
  f.restart(); assert.equal((await f.service().run(f.owner, f.home, deletion.id)).state, 'unknown');
  assert.deepEqual(await f.service().review(f.owner, f.home, f.task.taskId, new AbortController().signal), []); assert.equal(f.state().attempts.length, 2);
  assert.equal((await f.service().get(f.owner, f.home, deletion.id)).state, 'unknown');
});
test('concurrent identical request IDs recover one reservation and one operation', async () => {
  const f = await fixture(); const [a, b] = await Promise.all([f.service().enqueue(f.owner, f.home, f.input), f.service().enqueue(f.owner, f.home, f.input)]);
  assert.deepEqual(a, b); assert.equal((await f.service().planning(f.owner, f.home)).length, 1); assert.equal((await f.service().list(f.owner, f.home)).items.length, 1); assert.equal(f.state(), undefined);
});
test('an identical enqueue committing during another request authority check recovers its accepted receipt', async () => {
  const f = await fixture(); let resume, ready, checks = 0;
  const entered = new Promise(resolve => { ready = resolve; }), gate = new Promise(resolve => { resume = resolve; });
  const b = f.service(f.repo(), { currentAuthority: async payload => { await f.provider().currentAuthority(payload); if (++checks === 2) { ready(); await gate; } } });
  const pending = b.enqueue(f.owner, f.home, f.input); await entered;
  const accepted = await f.service().enqueue(f.owner, f.home, f.input); resume(); assert.deepEqual(await pending, accepted);
  assert.equal((await f.service().planning(f.owner, f.home)).length, 1); assert.equal((await f.service().list(f.owner, f.home)).items.length, 1);
});
test('lost provider acceptance remains unknown across restart, blocks duplicate planning and reconciles by explicit read', async () => {
  const f = await fixture({ afterAccept: async () => { throw new Error('Lost response'); } }), ops = f.service(), queued = await ops.enqueue(f.owner, f.home, f.input);
  assert.equal((await ops.run(f.owner, f.home, queued.id)).state, 'unknown'); assert.equal(f.state().attempts.length, 1);
  f.restart(); assert.equal((await f.service().run(f.owner, f.home, queued.id)).state, 'unknown'); assert.equal(f.state().attempts.length, 1);
  assert.equal((await f.service().planning(f.owner, f.home))[0].state, 'unknown');
  await assert.rejects(() => f.service().enqueue(f.owner, f.home, { ...f.input, requestId: crypto.randomUUID() }), e => e.code === 'remote_plan_active');
  const reviewed = await f.service().review(f.owner, f.home, f.task.taskId, new AbortController().signal); assert.equal(reviewed[0].state, 'linked'); assert.equal(reviewed[0].confirmed.title, f.input.title); assert.equal(f.state().attempts.length, 1);
  assert.equal((await f.service().get(f.owner, f.home, queued.id)).state, 'unknown');
});
test('revocation after enqueue rejects without HTTP mutation; competing local schedule defeats remote reservation CAS', async () => {
  const f = await fixture(), ops = f.service(), queued = await ops.enqueue(f.owner, f.home, f.input); f.revoke();
  assert.equal((await ops.run(f.owner, f.home, queued.id)).outcome, 'authority_changed'); assert.equal(f.state(), undefined);
  assert.deepEqual(await ops.planning(f.owner, f.home), []); await f.owned.command(f.owner, f.home, { type: 'task.delete', taskId: f.task.taskId });
  await assert.rejects(() => ops.get(f.sessions.sam.user.userId, f.home, queued.id));
  const g = await fixture(), initial = await g.owned.snapshot(g.owner, g.home); let inject = true;
  const transport = async (url, init) => {
    if (inject && String(url).endsWith('/documents:commit') && String(init.body).includes('remotePlanningJson')) {
      inject = false; await g.owned.command(g.owner, g.home, { type: 'task.schedule', taskId: g.task.taskId, calendarId: initial.workspace.calendarId, start: span.start.at, end: span.end.at });
    } return g.db.fetch(url, init);
  };
  await assert.rejects(() => g.service(g.repo(transport)).enqueue(g.owner, g.home, g.input)); assert.equal(inject, false);
  assert.deepEqual(await g.service().planning(g.owner, g.home), []); assert.equal((await g.service().list(g.owner, g.home)).items.length, 0); assert.equal(g.state(), undefined);
});
test('Personal note/grant writes retain remote reservation and whole-projection offline sync cannot remove it', async () => {
  const f = await fixture(), personal = createFirestorePersonalWorkspaceStore(f.config, f.db.fetch), contexts = createPersonalWorkspaceContextStore(f.config, f.db.fetch), store = createWorkspaceContextStore({ owned: f.owned, personal, contexts });
  const home = await store.personalContext(f.owner), taskResult = await personal.command(f.owner, { type: 'task.create', title: 'Personal retained task' });
  const binding = { ...f.binding, workspaceId: home.workspace.workspaceId }, provider = createFixtureGoogleCalendar({ binding }), repo = f.repo(), ops = createFixtureCalendarPlanning({ repository: repo, ...provider });
  const input = { ...f.input, taskId: taskResult.id, title: 'Personal retained task' }, queued = await ops.enqueue(f.owner, binding.workspaceId, input);
  const state = await personal.snapshot(f.owner), task = state.tasks.find(row => row.id === input.taskId);
  await personal.saveTaskNotes(f.owner, { type: 'task.notes', taskId: input.taskId, notes: 'Keep work' }, task.notes ?? '');
  await personal.createAgent(f.owner, { name: 'Local planner', scopes: ['tasks:read'], resourceIds: ['tasks:personal'] });
  assert.equal((await ops.planning(f.owner, binding.workspaceId))[0].operationId, queued.id);
  await assert.rejects(() => personal.command(f.owner, { type: 'task.unschedule', taskId: input.taskId }), e => e.code === 'remote_plan_active');
  const sync = await personal.readTaskCalendarSync(f.owner), projection = structuredClone(sync.projection); projection.tasks = projection.tasks.filter(row => row.id !== input.taskId);
  const now = new Date(), expiresAt = new Date(now.getTime() + 60_000).toISOString();
  await assert.rejects(() => personal.syncTaskCalendar(f.owner, { operationId: crypto.randomUUID(), baseRevision: sync.revision, projection, expiresAt }), e => e.code === 'remote_plan_active');
  assert.equal((await ops.planning(f.owner, binding.workspaceId))[0].operationId, queued.id);
});
test('canonical API exposes owned Calendar reads/planning receipts; unconfigured, other humans and agents cannot execute', async () => {
  const f = await fixture(), options = { store: f.owned, users: f.users, verifyIdToken: f.verifyIdToken, admission: { userId: f.owner, provider: 'google', firebaseUid: 'alex' } }, api = createWorkspacePilotApplication({ ...options, fixtureCalendar: f.service() });
  const request = (path, input, token = f.sessions.alex.token, target = api) => target.fetch(new Request('https://fixture.invalid/api/v1/workspaces/' + f.home + path, { method: input === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(input === undefined ? {} : { body: input === null ? '' : JSON.stringify(input) }) }));
  const query = new URLSearchParams({ accountId: f.binding.accountId }), listed = await request('/provider-calendars?' + query); assert.equal(listed.status, 200); assert.equal((await listed.json()).data.calendars[0].id, f.input.calendarId);
  const selected = new URLSearchParams({ accountId: f.binding.accountId, calendarId: f.input.calendarId, start: span.start.at, end: span.end.at });
  assert.equal((await request('/provider-calendars/availability?' + selected)).status, 200);
  const accepted = await request('/calendar-operations', f.input); assert.equal(accepted.status, 202, await accepted.clone().text()); const queued = (await accepted.json()).data; assert.doesNotMatch(JSON.stringify(queued), /openjobMarker|bindingRevision|Finish the review/);
  assert.equal((await request('/calendar-operations/' + queued.id + '/run-fixture', null)).status, 200); assert.equal(f.state().attempts.length, 1);
  const history = await request('/calendar-operations?taskId=' + f.task.taskId); assert.equal(history.status, 200); assert.equal((await history.json()).data[0].state, 'confirmed');
  assert.equal((await request('/planning')).status, 200); assert.equal((await request('/planning/' + f.task.taskId + '/review', null)).status, 200); assert.equal(f.state().attempts.length, 1);
  assert.equal((await request('/provider-calendars?' + query, undefined, f.sessions.sam.token)).status, 403);
  assert.equal((await request('/calendar-operations', f.input, f.sessions.alex.token, createWorkspacePilotApplication(options))).status, 503);
  const workspace = (await f.owned.snapshot(f.owner, f.home)).workspace, grant = await f.owned.createAgent(f.owner, f.home, { name: 'Local Calendar only', scopes: ['calendar:read', 'calendar:write'], resourceIds: [workspace.calendarId] });
  assert.equal((await request('/calendar-operations', f.input, grant.token)).status, 403); assert.equal(f.state().attempts.length, 1);
});
test('ownership change during a provider read prevents returning Calendar data', async () => {
  const f = await fixture(), provider = f.provider(), original = provider.adapter.list;
  const service = f.service(f.repo(), { adapter: { ...provider.adapter, async list(...args) { const result = await original(...args); const doc = [...f.db.documents.values()].find(row => row.name.endsWith('v1OwnedWorkspaces/' + f.home)); doc.fields.ownerUserId.stringValue = f.sessions.sam.user.userId; doc.updateTime = '2099-01-01T00:00:00.000Z'; return result; } } });
  await assert.rejects(() => service.calendars({ ownerId: f.owner, workspaceId: f.home, accountId: f.binding.accountId }, new AbortController().signal), e => e.code === 'forbidden');
});
test('post-response ownership latency cannot return an expired availability observation', async () => {
  const f = await fixture(), repository = f.repo(); let checks = 0;
  const service = f.service({ ...repository, async assertOwned(...args) { await repository.assertOwned(...args); if (++checks === 2) f.advance(60_001); } });
  await assert.rejects(() => service.availability({ ownerId: f.owner, workspaceId: f.home, accountId: f.binding.accountId, calendarId: f.input.calendarId, window: { start: span.start.at, end: span.end.at } }, new AbortController().signal), e => e.code === 'observation_expired');
});
test('provider edit conflict requires explicit read/review and a new ETag intent; original operation never rebases', async () => {
  const f = await fixture(), first = await f.service().enqueue(f.owner, f.home, f.input); await f.service().run(f.owner, f.home, first.id);
  const original = (await f.service().planning(f.owner, f.home))[0], updateInput = { action: 'calendar.update', taskId: f.task.taskId, requestId: crypto.randomUUID(), etag: original.confirmed.etag, title: 'Reviewed update', span }, queued = await f.service().enqueue(f.owner, f.home, updateInput);
  f.editProvider(state => { state.events[0].etag = '"external_edit"'; state.events[0].summary = 'External title'; });
  const rejected = await f.service().run(f.owner, f.home, queued.id); assert.equal(rejected.outcome, 'provider_conflict'); assert.equal(f.state().attempts.length, 1);
  await assert.rejects(() => f.service().enqueue(f.owner, f.home, { ...updateInput, requestId: crypto.randomUUID() }), e => e.code === 'review_required');
  const reviewed = await f.service().review(f.owner, f.home, f.task.taskId, new AbortController().signal); assert.equal(reviewed[0].confirmed.title, 'External title'); assert.equal(reviewed[0].confirmed.etag, '"external_edit"');
  const fresh = await f.service().enqueue(f.owner, f.home, { ...updateInput, requestId: crypto.randomUUID(), etag: reviewed[0].confirmed.etag }); assert.equal((await f.service().run(f.owner, f.home, fresh.id)).state, 'confirmed');
  assert.equal((await f.service().run(f.owner, f.home, queued.id)).state, 'rejected'); assert.equal(f.state().attempts.length, 2);
});
test('ownership change or lease expiry during Calendar preflight prevents the actual provider mutation', async () => {
  let change = async () => {}; const f = await fixture({ beforeRead: async () => change() });
  const queued = await f.service().enqueue(f.owner, f.home, f.input);
  change = async () => { const doc = [...f.db.documents.values()].find(row => row.name.endsWith('v1OwnedWorkspaces/' + f.home)); doc.fields.ownerUserId.stringValue = f.sessions.sam.user.userId; doc.updateTime = '2099-01-01T00:00:00.000Z'; };
  await assert.rejects(() => f.service().run(f.owner, f.home, queued.id), e => e.code === 'forbidden'); assert.equal(f.state(), undefined); assert.equal(f.provider().calls.filter(row => row.method !== 'GET').length, 0);
  let expire = () => {}; const g = await fixture({ beforeRead: async () => expire() }), op = await g.service().enqueue(g.owner, g.home, g.input);
  expire = () => g.advance(30_001);
  assert.equal((await g.service().run(g.owner, g.home, op.id)).state, 'unknown'); assert.equal(g.state(), undefined); assert.equal(g.provider().calls.filter(row => row.method !== 'GET').length, 0);
});
