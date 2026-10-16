import test from 'node:test';
import assert from 'node:assert/strict';
import { findAvailableTaskSlots, assertTaskSlotAvailable } from '../cli/lib/workspace-availability.mjs';
import { createEmptyPersonalWorkspace, applyPersonalWorkspaceCommand } from '../shared/personal-workspace.ts';
const iso = hour => `2027-05-11T${hour}:00.000Z`;
const task = { id: 'task', ownerId: 'alex', title: 'Plan review', completed: false };
const view = () => ({ ...createEmptyPersonalWorkspace('alex'), tasks: [{ ...task }], calendars: [{ id: 'one', ownerId: 'alex' }, { id: 'two', ownerId: 'alex' }, { id: 'foreign', ownerId: 'sam' }] });
const slot = (start, end) => ({ start: iso(start), end: iso(end) });
const input = { taskId: 'task', ...slot('09:00', '12:00'), durationMinutes: 30 };
test('finder merges overlapping saved blocks across calendars, clips midnight and permits adjacent boundaries', () => {
  const state = view();
  state.events = [
    { id: 'overnight', calendarId: 'one', start: '2027-05-10T23:00:00Z', end: iso('09:15') },
    { id: 'first', calendarId: 'two', ...slot('09:45', '10:15') },
    { id: 'overlap', calendarId: 'one', ...slot('10:00', '10:30') },
    { id: 'foreign', calendarId: 'foreign', ...slot('09:00', '12:00') },
    { id: 'outside', calendarId: 'two', ...slot('12:00', '13:00') },
  ];
  const result = findAvailableTaskSlots(state, input);
  assert.deepEqual(result, [slot('09:15', '09:45'), slot('10:30', '11:00'), slot('11:00', '11:30'), slot('11:30', '12:00')]);
  for (const candidate of result) assertTaskSlotAvailable(state, { taskId: 'task', ...candidate });
  assert.throws(() => assertTaskSlotAvailable(state, { taskId: 'task', ...slot('09:30', '10:00') }), { code: 'schedule_conflict' });
});
test('rescheduling excludes only an exact linked block; returned suggestions are bounded, complete and detached', () => {
  const state = view(); state.tasks[0] = { ...task, calendarEventId: 'own', scheduledSlot: slot('09:00', '10:00') };
  state.events = [{ id: 'own', calendarId: 'one', taskId: 'task', ...slot('09:00', '10:00') }];
  assert.deepEqual(findAvailableTaskSlots(state, input)[0], slot('09:00', '09:30'));
  state.events[0].taskId = 'different';
  assert.deepEqual(findAvailableTaskSlots(state, input)[0], slot('10:00', '10:30'));
  state.events = []; const before = structuredClone(state);
  assert.equal(findAvailableTaskSlots(state, { ...input, end: '2027-05-18T09:00:00Z', durationMinutes: 5 }).length, 12);
  assert.deepEqual(state, before);
  assert.deepEqual(findAvailableTaskSlots(state, { ...input, durationMinutes: 480 }), []);
});
test('invalid windows/durations and unavailable Tasks reject rather than guessing availability', () => {
  for (const change of [{ start: '2027-05-11T09:00' }, { start: '2027-02-30T09:00:00Z' }, { end: iso('09:00') }, { end: '2027-06-11T12:00:00Z' }, { durationMinutes: 0 }, { durationMinutes: 481 }, { durationMinutes: 30.5 }, { durationMinutes: NaN }]) {
    assert.throws(() => findAvailableTaskSlots(view(), { ...input, ...change }), { code: 'invalid_input' });
  }
  const state = view(); state.tasks[0].completed = true;
  assert.throws(() => findAvailableTaskSlots(state, input), { code: 'forbidden' });
  assert.throws(() => findAvailableTaskSlots(view(), { ...input, taskId: 'absent' }), { code: 'forbidden' });
});
test('actual domain rejects a stale choice without moving or losing an existing linked Task', () => {
  let state = createEmptyPersonalWorkspace('alex');
  const apply = input => { const next = applyPersonalWorkspaceCommand('alex', state, input); state = next.state; return next.result; };
  const created = apply({ type: 'task.create', title: 'Keep prior plan' });
  apply({ type: 'task.schedule', taskId: created.id, calendarId: 'personal', ...slot('11:00', '11:30') });
  const suggested = findAvailableTaskSlots(state, { ...input, taskId: created.id })[0];
  apply({ type: 'calendar.create', calendarId: 'personal', title: 'Newer work', ...suggested });
  const before = structuredClone(state);
  assert.throws(() => apply({ type: 'task.schedule-available', taskId: created.id, calendarId: 'personal', ...suggested }), { code: 'schedule_conflict' });
  assert.deepEqual(state, before);
  const moved = apply({ type: 'task.schedule-available', taskId: created.id, calendarId: 'personal', ...slot('10:00', '10:30') });
  assert.equal(moved.calendarEventId, created.calendarEventId ?? before.tasks[0].calendarEventId);
  assert.equal(state.events.filter(e => e.taskId === created.id).length, 1);
});
