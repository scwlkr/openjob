import test from 'node:test';
import assert from 'node:assert/strict';
import { filterWorkspaceTasks, normalizeWorkspaceTaskQuery } from '../shared/workspace-task-query.mjs';

test('task query defaults, literal title search and status compose without changing input order or fields', () => {
  assert.deepEqual(normalizeWorkspaceTaskQuery(), { status: 'all', search: '' });
  assert.deepEqual(normalizeWorkspaceTaskQuery({ search: '  [Plan].*  ', scheduledOn: '' }), { status: 'all', search: '[Plan].*' });
  const tasks = [
    { id: 'a', title: '[Plan].* Launch', completed: false, sourceMessageId: 'private-original' },
    { id: 'b', title: '[plan].* Review', completed: true },
    { id: 'c', title: 'Plan without literal punctuation', completed: false },
  ];
  const original = structuredClone(tasks);
  assert.deepEqual(filterWorkspaceTasks(tasks).map(task => task.id), ['a', 'b', 'c']);
  assert.deepEqual(filterWorkspaceTasks(tasks, { search: ' [PLAN].* ' }).map(task => task.id), ['a', 'b']);
  assert.deepEqual(filterWorkspaceTasks(tasks, { search: '[plan].*', status: 'completed' }).map(task => task.id), ['b']);
  assert.deepEqual(filterWorkspaceTasks(tasks, { status: 'open' }).map(task => task.id), ['a', 'c']);
  assert.equal(filterWorkspaceTasks(tasks)[0], tasks[0]);
  assert.deepEqual(tasks, original);
});

test('scheduled day uses strict UTC overlap with exclusive boundaries, offsets and unscheduled exclusion', () => {
  const slot = (id, start, end) => ({ id, title: id, completed: false, scheduledSlot: { start, end } });
  const tasks = [
    slot('ends-at-start', '2026-10-16T23:00:00Z', '2026-10-17T00:00:00Z'),
    slot('crosses-start', '2026-10-16T23:30:00Z', '2026-10-17T00:00:00.001Z'),
    slot('starts-at-end', '2026-10-18T00:00:00Z', '2026-10-18T00:30:00Z'),
    slot('crosses-end', '2026-10-17T23:59:59.999Z', '2026-10-18T01:00:00Z'),
    slot('offsets', '2026-10-16T22:00:00-03:00', '2026-10-16T22:30:00-03:00'),
    slot('invalid', 'not-a-date', '2026-10-17T12:00:00Z'),
    slot('zero', '2026-10-17T12:00:00Z', '2026-10-17T12:00:00Z'),
    { id: 'unscheduled', title: 'Unscheduled', completed: false },
  ];
  assert.deepEqual(filterWorkspaceTasks(tasks, { scheduledOn: '2026-10-17' }).map(task => task.id), ['crosses-start', 'crosses-end', 'offsets']);
  assert.equal(filterWorkspaceTasks(tasks, { scheduledOn: '' }).length, tasks.length);
  assert.equal(normalizeWorkspaceTaskQuery({ scheduledOn: '2024-02-29' }).scheduledOn, '2024-02-29');
});

test('invalid task criteria fail with a fixed non-reflecting error', () => {
  for (const input of [null, [], new Date(), 'private', { ownerId: 'private' }, { status: 'done' }, { status: '' }, { search: 1 }, { search: 'x'.repeat(201) }, { scheduledOn: null }, ...['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '0000-01-01', '2026-1-01', '2026-10-17T00:00:00Z', ' 2026-10-17 '].map(scheduledOn => ({ scheduledOn }))]) {
    assert.throws(() => normalizeWorkspaceTaskQuery(input), error => error.code === 'invalid_input' && error.message === 'Invalid workspace task filters.');
  }
  assert.equal(normalizeWorkspaceTaskQuery({ search: ' '.repeat(10) + 'x'.repeat(200) }).search.length, 200);
});
