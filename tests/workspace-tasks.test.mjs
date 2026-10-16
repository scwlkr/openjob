import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceEngine } from '../shared/workspace-engine.ts';
import { createFixtureWorkspace } from '../shared/workspace-fixtures.ts';

const alex = { kind: 'human', ownerId: 'demo_alex' };
const sam = { kind: 'human', ownerId: 'demo_sam' };
function grant(engine, scopes, resourceIds) {
  const created = engine.command(alex, { type: 'agent.grant', name: 'Fixture task helper', scopes, resourceIds });
  return { kind: 'agent', ownerId: alex.ownerId, agentId: created.id };
}
function fixture() {
  const engine = createWorkspaceEngine();
  const task = engine.command(alex, { type: 'task.create', title: 'Review fixture launch', messageId: 'alex_msg_launch' });
  engine.command(alex, { type: 'task.complete', taskId: task.id, completed: true });
  const scheduled = engine.command(alex, { type: 'task.schedule', taskId: task.id, calendarId: 'alex_work', start: '2026-10-17T10:00:00Z', end: '2026-10-17T10:30:00Z' });
  return { engine, task: scheduled };
}
function denied(engine, actor, input, code = 'forbidden') {
  const before = engine.exportState();
  assert.throws(() => engine.command(actor, input), error => error.code === code);
  assert.deepEqual(engine.exportState(), before);
}
const commands = taskId => [{ type: 'task.update', taskId, title: 'Edited fixture task' }, { type: 'task.unschedule', taskId }, { type: 'task.delete', taskId }];

test('renaming scheduled tasks updates linked block and preserves completion, slot and source mail', () => {
  const { engine, task } = fixture();
  const before = engine.exportState();
  const updated = engine.command(alex, { type: 'task.update', taskId: task.id, title: '  Revised launch review  ' });
  assert.equal(updated.title, 'Revised launch review');
  assert.equal(updated.id, task.id); assert.equal(updated.completed, true);
  assert.equal(updated.sourceMessageId, task.sourceMessageId); assert.equal(updated.sourceAccountId, task.sourceAccountId);
  assert.deepEqual(updated.scheduledSlot, task.scheduledSlot); assert.equal(updated.calendarEventId, task.calendarEventId);
  const view = engine.snapshot(alex);
  assert.equal(view.events.find(event => event.id === task.calendarEventId).title, updated.title);
  assert.deepEqual(engine.exportState().messages, before.messages);
  updated.title = 'Detached mutation'; assert.equal(engine.snapshot(alex).tasks.find(item => item.id === task.id).title, 'Revised launch review');
});

test('unscheduling removes linked event only and can repeat safely; task deletion retains mail', () => {
  const { engine, task } = fixture();
  const before = engine.exportState();
  const updated = engine.command(alex, { type: 'task.unschedule', taskId: task.id });
  assert.equal(updated.calendarEventId, undefined); assert.equal(updated.scheduledSlot, undefined);
  assert.equal(updated.completed, true); assert.equal(updated.sourceMessageId, task.sourceMessageId);
  assert.equal(engine.exportState().events.some(event => event.id === task.calendarEventId), false);
  assert.deepEqual(engine.exportState().events, before.events.filter(event => event.id !== task.calendarEventId));
  assert.deepEqual(engine.command(alex, { type: 'task.unschedule', taskId: task.id }), updated);
  assert.deepEqual(engine.command(alex, { type: 'task.delete', taskId: task.id }), { id: task.id, deleted: true });
  assert.equal(engine.snapshot(alex).tasks.some(item => item.id === task.id), false);
  assert.deepEqual(engine.exportState().messages, before.messages);
  assert.deepEqual(engine.exportState().drafts, before.drafts);
  denied(engine, alex, { type: 'task.delete', taskId: task.id });
});

test('deleting a scheduled task removes its event while preserving unrelated tasks, events and mail', () => {
  const { engine, task } = fixture();
  const before = engine.exportState();
  engine.command(alex, { type: 'task.delete', taskId: task.id });
  const after = engine.exportState();
  assert.deepEqual(after.tasks, before.tasks.filter(item => item.id !== task.id));
  assert.deepEqual(after.events, before.events.filter(item => item.id !== task.calendarEventId));
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.accounts, before.accounts);
});

test('task mutation validates exact input and atomically rejects cross-owner, missing, scoped and revoked access', () => {
  const { engine, task } = fixture();
  for (const command of commands(task.id)) denied(engine, sam, command);
  for (const command of commands('sam_task_private')) denied(engine, alex, command);
  for (const command of commands('missing_task')) denied(engine, alex, command);
  for (const [scopes, resources] of [
    [['tasks:read', 'calendar:write'], ['tasks:personal', 'alex_work']],
    [['tasks:write', 'calendar:write'], ['alex_work']],
    [['tasks:write'], ['tasks:personal', 'alex_work']],
    [['tasks:write', 'calendar:write'], ['tasks:personal', 'alex_personal']],
  ]) {
    const actor = grant(engine, scopes, resources);
    for (const command of commands(task.id)) denied(engine, actor, command);
  }
  const revoked = grant(engine, ['tasks:write', 'calendar:write'], ['tasks:personal', 'alex_work']);
  engine.command(alex, { type: 'agent.revoke', agentId: revoked.agentId });
  for (const command of commands(task.id)) denied(engine, revoked, command, 'unauthorized');
  for (const input of [
    { type: 'task.update', taskId: task.id, title: '' }, { type: 'task.update', taskId: task.id, title: '  ' },
    { type: 'task.update', taskId: task.id, title: 'x'.repeat(501) }, { type: 'task.update', taskId: task.id },
    { type: 'task.update', taskId: task.id, title: 'Changed', completed: false },
    { type: 'task.unschedule', taskId: task.id, calendarId: 'alex_work' },
    { type: 'task.delete', taskId: task.id, messageId: 'alex_msg_launch' }, { type: 'task.unschedule' },
  ]) denied(engine, alex, input, 'invalid_input');
});

test('explicitly scoped agent can edit and unschedule linked tasks, then manage unscheduled tasks without calendar access', () => {
  const { engine, task } = fixture();
  const linkedWriter = grant(engine, ['tasks:write', 'calendar:write'], ['tasks:personal', 'alex_work']);
  const edited = engine.command(linkedWriter, { type: 'task.update', taskId: task.id, title: 'Agent revision' });
  assert.equal(edited.title, 'Agent revision'); assert.equal(edited.sourceMessageId, undefined);
  assert.equal(engine.snapshot(alex).events.find(event => event.id === task.calendarEventId).title, 'Agent revision');
  engine.command(linkedWriter, { type: 'task.unschedule', taskId: task.id });
  const taskOnly = grant(engine, ['tasks:write'], ['tasks:personal']);
  engine.command(taskOnly, { type: 'task.update', taskId: task.id, title: 'Task-only revision' });
  const unscheduled = engine.command(taskOnly, { type: 'task.unschedule', taskId: task.id });
  assert.equal(unscheduled.title, 'Task-only revision'); assert.equal(unscheduled.completed, true);
  assert.deepEqual(engine.command(taskOnly, { type: 'task.delete', taskId: task.id }), { id: task.id, deleted: true });
  assert.equal(engine.snapshot(alex).messages.some(message => message.id === 'alex_msg_launch'), true);
});

test('corrupt cross-owner or unrelated calendar links never authorize collateral mutation', () => {
  for (const eventId of ['sam_event_private', 'alex_event_review']) {
    const state = createFixtureWorkspace();
    state.tasks[0].calendarEventId = eventId;
    state.tasks[0].scheduledSlot = { start: '2026-10-17T10:00:00Z', end: '2026-10-17T10:30:00Z' };
    const engine = createWorkspaceEngine(state);
    for (const command of commands('alex_task_plan')) denied(engine, alex, command);
  }
});
