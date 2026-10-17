import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceExport, validateWorkspaceExport } from '../cli/lib/workspace-export.mjs';
import { createEmptyPersonalWorkspace, applyPersonalWorkspaceCommand } from '../shared/personal-workspace.ts';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';

function example(owner = 'usr_alex') {
  let state = createEmptyPersonalWorkspace(owner);
  function command(input) { const next = applyPersonalWorkspaceCommand(owner, state, input); state = next.state; return next.result; }
  command({ type: 'mail.examples.add' });
  const task = command({ type: 'task.create', title: 'Prepare launch', messageId: 'example-message-1' });
  command({ type: 'task.notes', taskId: task.id, notes: 'Authored notes\n🛶' });
  command({ type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-10-18T14:00:00Z', end: '2026-10-18T14:30:00Z' });
  command({ type: 'mail.draft', messageId: 'example-message-1', body: 'My authored reply' });
  return state;
}

test('selected versioned export retains authored work and only selected relationships, without incoming Mail or authority', () => {
  const state = example();
  state.tasks[0].unexpectedSecret = 'MUST_NOT_EXPORT';
  const file = createWorkspaceExport('usr_alex', state, ['drafts', 'calendar', 'tasks']);
  assert.deepEqual(file.sections, ['tasks', 'calendar', 'drafts']);
  assert.equal(file.tasks[0].notes, 'Authored notes\n🛶');
  assert.equal(file.events[0].taskId, file.tasks[0].id);
  assert.equal(file.tasks[0].calendarEventId, file.events[0].id);
  assert.equal(file.drafts[0].body, 'My authored reply');
  assert.equal(file.drafts[0].mode, 'fixture');
  const raw = JSON.stringify(file);
  for (const hidden of ['MUST_NOT_EXPORT', 'sourceMessageId', 'sourceAccountId', 'messageId', 'colleague1@example.invalid\",\"body\":\"Please', 'Please review the invented launch checklist', 'activity', 'agents', 'sent', 'token']) assert.ok(!raw.includes(hidden), hidden);
  assert.ok(!JSON.stringify(createWorkspaceExport('usr_alex', state, ['tasks'])).includes('calendarEventId'));
  const calendar = createWorkspaceExport('usr_alex', state, ['calendar']);
  assert.equal(calendar.events[0].taskId, undefined); assert.deepEqual(calendar.tasks, []); assert.deepEqual(calendar.drafts, []);
  assert.equal(createWorkspaceExport('usr_alex', createEmptyPersonalWorkspace('usr_alex'), ['tasks']).tasks.length, 0);
  assert.throws(() => createWorkspaceExport('usr_sam', state, ['tasks']), { code: 'forbidden' });
  assert.throws(() => validateWorkspaceExport({ ...file, providerToken: 'secret' }));
  assert.throws(() => validateWorkspaceExport({ ...file, tasks: [{ ...file.tasks[0], sourceMessageId: 'hidden' }] }));
  const large = createEmptyPersonalWorkspace('usr_alex');
  large.tasks = Array.from({ length: 60 }, (_, index) => ({ id: `task_${index}`, ownerId: 'usr_alex', title: 'Task', completed: false, notes: 'a'.repeat(20000) }));
  assert.throws(() => createWorkspaceExport('usr_alex', large, ['tasks']), { code: 'workspace_capacity' });
});

test('human export API selects only signed ownership, denies agents and inactive identities, and never writes', async () => {
  const state = example(); const calls = []; let active = true, invalidate = false;
  const user = { userId: 'usr_alex', username: 'alex' };
  const api = createV1PersonalWorkspaceApi({
    verifyIdToken: async request => request.headers.get('authorization') === 'Bearer synthetic-human' ? { uid: 'alex' } : null,
    users: { resolve: async () => active ? user : null },
    workspace: { snapshot: async owner => { calls.push(owner); if (invalidate) active = false; return owner === 'usr_alex' ? state : createEmptyPersonalWorkspace(owner); } },
  });
  const request = (query, headers = {}, method = 'GET') => api.fetch(new Request(`https://fixture.invalid/api/v1/workspace/export${query}`, { method, headers: { authorization: 'Bearer synthetic-human', ...headers } }));
  const validate = await createOpenApiResponseValidator();
  const response = await request('?section=tasks&section=calendar');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  await validate(response.clone(), '/api/v1/workspace/export', 'get');
  assert.equal((await response.json()).data.context.ownerUserId, 'usr_alex'); assert.deepEqual(calls, ['usr_alex']);
  for (const query of ['', '?section=tasks&section=tasks', '?section=all', '?section=tasks&owner=usr_sam']) assert.equal((await request(query)).status, 400);
  assert.equal((await request('?section=tasks', { authorization: '' })).status, 401);
  const readCount = calls.length;
  assert.equal((await request('?section=tasks', { authorization: 'Bearer oj_personal_synthetic' })).status, 403);
  assert.equal(calls.length, readCount);
  assert.equal((await request('?section=tasks', { origin: 'https://elsewhere.invalid' })).status, 403);
  assert.equal((await request('?section=tasks', {}, 'POST')).status, 404);
  const spoofed = await request('?section=tasks', { 'x-openjob-fixture-owner': 'usr_sam' });
  assert.equal((await spoofed.json()).data.context.ownerUserId, 'usr_alex');
  invalidate = true; assert.equal((await request('?section=tasks')).status, 410);
  assert.ok(calls.every(owner => owner === 'usr_alex'));
});
