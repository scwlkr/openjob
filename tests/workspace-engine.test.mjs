import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceEngine } from '../shared/workspace-engine.ts';
import { createFixtureWorkspace } from '../shared/workspace-fixtures.ts';
const alex = { kind: 'human', ownerId: 'demo_alex' };
const sam = { kind: 'human', ownerId: 'demo_sam' };
const start = '2026-10-17T10:00:00Z', end = '2026-10-17T10:30:00Z';
const denied = (fn, code = 'forbidden') => assert.throws(fn, e => e.code === code);
function grant(engine, scopes, resourceIds) {
  const issued = engine.command(alex, { type: 'agent.grant', name: 'Planning assistant', scopes, resourceIds });
  return { kind: 'agent', ownerId: alex.ownerId, agentId: issued.id };
}

test('connected mail/task/calendar/draft flow mutates only isolated state and never sends', () => {
  const engine = createWorkspaceEngine();
  engine.command(alex, { type: 'mail.read', messageId: 'alex_msg_launch', read: true });
  const task = engine.command(alex, { type: 'task.create', messageId: 'alex_msg_launch', title: 'Prepare launch demo' });
  assert.equal(task.sourceAccountId, 'alex_gmail');
  engine.command(alex, { type: 'task.schedule', taskId: task.id, calendarId: 'alex_personal', start, end });
  const first = engine.snapshot(alex).tasks.find(t => t.id === task.id);
  engine.command(alex, { type: 'task.schedule', taskId: task.id, calendarId: 'alex_work', start, end });
  assert.equal(engine.snapshot(alex).events.filter(e => e.taskId === task.id).length, 1);
  assert.equal(engine.snapshot(alex).tasks.find(t => t.id === task.id).calendarEventId, first.calendarEventId);
  engine.command(alex, { type: 'calendar.update', eventId: first.calendarEventId, title: 'Demo focus', start: '2026-10-17T11:00:00Z', end: '2026-10-17T12:00:00Z' });
  assert.equal(engine.snapshot(alex).tasks.find(t => t.id === task.id).scheduledSlot.start, '2026-10-17T11:00:00.000Z');
  engine.command(alex, { type: 'calendar.delete', eventId: first.calendarEventId });
  assert.equal(engine.snapshot(alex).tasks.find(t => t.id === task.id).scheduledSlot, undefined);
  engine.command(alex, { type: 'task.complete', taskId: task.id, completed: true });
  const draft = engine.command(alex, { type: 'mail.draft', messageId: 'alex_msg_launch', body: 'I will review the fixture checklist.' });
  engine.command(alex, { type: 'mail.compose', accountId: 'alex_imap', to: 'lee@team.example.invalid', subject: 'Planning', body: 'A fixture-only new draft.' });
  assert.equal(engine.snapshot(alex).drafts.length, 2);
  const block = engine.command(alex, { type: 'calendar.create', calendarId: 'alex_personal', title: 'Focus block', start, end });
  engine.command(alex, { type: 'calendar.update', eventId: block.id, title: 'Revised focus block', start, end });
  assert.equal(engine.snapshot(alex).events.find(e => e.id === block.id).title, 'Revised focus block');
  engine.command(alex, { type: 'calendar.delete', eventId: block.id });
  assert.equal(engine.snapshot(alex).events.some(e => e.id === block.id), false);
  const before = engine.exportState();
  denied(() => engine.command(alex, { type: 'mail.send', draftId: draft.id }), 'sending_disabled');
  assert.deepEqual(engine.exportState(), before);
  assert.equal(engine.snapshot(alex).tasks.find(t => t.id === task.id).completed, true);
  assert.equal(engine.snapshot(sam).tasks.length, 1);
});

test('every resource denies cross-owner writes and owner views are isolated', () => {
  const engine = createWorkspaceEngine();
  const samGrant = engine.command(sam, { type: 'agent.grant', name: 'Sam helper', scopes: ['tasks:read'], resourceIds: ['tasks:personal'] });
  const commands = [
    { type: 'mail.read', messageId: 'sam_msg_private', read: true },
    { type: 'mail.draft', messageId: 'sam_msg_private', body: 'No' },
    { type: 'mail.compose', accountId: 'sam_gmail', to: 'a@b.invalid', subject: 'No', body: 'No' },
    { type: 'task.create', title: 'No', messageId: 'sam_msg_private' },
    { type: 'task.complete', taskId: 'sam_task_private', completed: true },
    { type: 'task.schedule', taskId: 'alex_task_plan', calendarId: 'sam_personal', start, end },
    { type: 'task.schedule', taskId: 'sam_task_private', calendarId: 'alex_personal', start, end },
    { type: 'calendar.create', calendarId: 'sam_personal', title: 'No', start, end },
    { type: 'calendar.update', eventId: 'sam_event_private', title: 'No', start, end },
    { type: 'calendar.delete', eventId: 'sam_event_private' },
    { type: 'agent.grant', name: 'No', scopes: ['mail:read'], resourceIds: ['sam_gmail'] },
    { type: 'agent.revoke', agentId: samGrant.id },
  ];
  for (const command of commands) { const before = engine.exportState(); denied(() => engine.command(alex, command)); assert.deepEqual(engine.exportState(), before); }
  const view = engine.snapshot(alex);
  assert.equal(JSON.stringify(view).includes('sam_'), false);
  assert.equal(view.accounts.length, 3);
});

test('agent snapshot filters scopes/resources, strips private references and revocation is immediate', () => {
  const engine = createWorkspaceEngine();
  const created = engine.command(alex, { type: 'task.create', title: 'Source task', messageId: 'alex_msg_launch' });
  const agent = grant(engine, ['tasks:read', 'tasks:write'], ['tasks:personal']);
  let view = engine.snapshot(agent);
  assert.deepEqual(view.messages, []); assert.deepEqual(view.calendars, []); assert.deepEqual(view.accounts, []); assert.deepEqual(view.activity, []);
  assert.equal(view.tasks.find(t => t.id === created.id).sourceMessageId, undefined);
  const changed = engine.command(agent, { type: 'task.complete', taskId: created.id, completed: true });
  assert.equal(changed.sourceAccountId, undefined);
  denied(() => engine.command(agent, { type: 'task.create', title: 'Denied source', messageId: 'alex_msg_launch' }));
  denied(() => engine.command(agent, { type: 'agent.grant', name: 'No delegation', scopes: ['tasks:read'], resourceIds: ['tasks:personal'] }));
  denied(() => engine.command(agent, { type: 'agent.revoke', agentId: agent.agentId }));
  denied(() => engine.snapshot({ ...agent, ownerId: sam.ownerId }), 'unauthorized');
  engine.command(alex, { type: 'agent.revoke', agentId: agent.agentId });
  denied(() => engine.snapshot(agent), 'unauthorized');
  denied(() => engine.command(agent, { type: 'task.complete', taskId: created.id, completed: false }), 'unauthorized');
});

test('scoped agents can draft and schedule only explicitly granted resources', () => {
  const engine = createWorkspaceEngine();
  const agent = grant(engine, ['mail:read', 'mail:draft', 'tasks:read', 'tasks:write', 'calendar:read', 'calendar:write'], ['alex_gmail', 'tasks:personal', 'alex_personal']);
  assert.equal(engine.snapshot(agent).messages.length, 1);
  assert.equal(engine.snapshot(agent).calendars.length, 1);
  engine.command(agent, { type: 'mail.draft', messageId: 'alex_msg_launch', body: 'Draft only' });
  engine.command(agent, { type: 'task.schedule', taskId: 'alex_task_plan', calendarId: 'alex_personal', start, end });
  denied(() => engine.command(agent, { type: 'mail.read', messageId: 'alex_msg_design', read: true }));
  denied(() => engine.command(agent, { type: 'task.schedule', taskId: 'alex_task_plan', calendarId: 'alex_work', start, end }));
  const readOnly = grant(engine, ['mail:read', 'tasks:read', 'calendar:read'], ['alex_gmail', 'tasks:personal', 'alex_personal']);
  denied(() => engine.command(readOnly, { type: 'mail.draft', messageId: 'alex_msg_launch', body: 'No' }));
  denied(() => engine.command(readOnly, { type: 'task.complete', taskId: 'alex_task_plan', completed: true }));
  denied(() => engine.command(readOnly, { type: 'calendar.create', calendarId: 'alex_personal', title: 'No', start, end }));
  const calendarOnly = grant(engine, ['calendar:write'], ['alex_personal']);
  const linked = engine.snapshot(alex).events.find(e => e.taskId === 'alex_task_plan');
  denied(() => engine.command(calendarOnly, { type: 'calendar.delete', eventId: linked.id }));
  denied(() => engine.command(calendarOnly, { type: 'calendar.update', eventId: linked.id, title: 'No', start, end }));
});

test('input, state and response are detached; malformed failures never mutate state', () => {
  const fixture = createFixtureWorkspace();
  const engine = createWorkspaceEngine(fixture);
  fixture.tasks.length = 0;
  const snapshot = engine.snapshot(alex); snapshot.tasks.length = 0;
  const exported = engine.exportState(); exported.tasks.length = 0;
  assert.equal(engine.snapshot(alex).tasks.length, 1);
  const grantInput = { type: 'agent.grant', name: 'Helper', scopes: ['tasks:read'], resourceIds: ['tasks:personal'] };
  const issued = engine.command(alex, grantInput); grantInput.scopes.push('tasks:write'); issued.scopes.push('tasks:write');
  assert.deepEqual(engine.snapshot(alex).agents[0].scopes, ['tasks:read']);
  for (const input of [null, [], { type: 'no' }, { type: '__proto__' }, { type: 'task.create', title: '' }, { type: 'task.complete', taskId: 'alex_task_plan', completed: 'true' }, { type: 'task.create', title: 'Hi', ownerId: 'demo_sam' }, { type: 'calendar.create', calendarId: 'alex_personal', title: 'Bad', start: end, end: start }, { type: 'calendar.create', calendarId: 'alex_personal', title: 'Bad', start: 'tomorrow', end }, { type: 'calendar.create', calendarId: 'alex_personal', title: 'Bad', start: '2026-02-30T10:00:00Z', end: '2026-03-02T10:00:00Z' }, { type: 'agent.grant', name: 'Bad', scopes: ['admin'], resourceIds: ['tasks:personal'] }]) {
    const before = engine.exportState(); denied(() => engine.command(alex, input), 'invalid_input'); assert.deepEqual(engine.exportState(), before);
  }
});
