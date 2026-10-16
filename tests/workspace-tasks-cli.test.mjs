import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
async function start(stateFile) {
  const child = spawn(process.execPath, ['scripts/workspace-fixture-server.mjs', '--state-file', stateFile, '--port', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Fixture startup timeout: ' + stderr)); }, 10000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${stderr}`)); });
  });
  return { url, async stop() { const exited = once(child, 'close'); child.kill('SIGTERM'); await exited; } };
}
async function run(url, command, { owner = 'demo_alex', agent } = {}) {
  const args = ['cli/workspace.mjs', command ? 'command' : 'snapshot', '--url', url, '--owner', owner, ...(agent ? ['--agent', agent] : []), ...(command ? ['--input', '-'] : [])];
  const child = spawn(process.execPath, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(command ? JSON.stringify(command) : undefined);
  const [status] = await once(child, 'close');
  return { status, stdout, stderr };
}

test('CLI task edit, unschedule and delete preserve linked calendars, authorization and persisted source mail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-task-lifecycle-'));
  const stateFile = join(directory, 'state.json');
  let service;
  try {
    service = await start(stateFile);
    const call = (command, identity) => run(service.url, command, identity);
    const ok = async (command, identity) => {
      const result = await call(command, identity);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).data;
    };
    const denyAtomic = async (command, identity, code = /forbidden/) => {
      const before = await readFile(stateFile, 'utf8');
      const result = await call(command, identity);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, code);
      assert.equal(result.stdout, '');
      assert.equal(await readFile(stateFile, 'utf8'), before, 'denied mutation preserves all persisted task, event, mail and audit state');
    };
    const before = await ok();
    const source = before.messages.find(item => item.id === 'alex_msg_launch');
    const task = await ok({ type: 'task.create', title: 'Review fixture launch', messageId: source.id });
    const schedule = taskId => ({ type: 'task.schedule', taskId, calendarId: 'alex_work', start: '2026-10-18T14:00:00Z', end: '2026-10-18T14:30:00Z' });
    const scheduled = await ok(schedule(task.id));
    const tasksOnly = await ok({ type: 'agent.grant', name: 'Task-only fixture agent', scopes: ['tasks:read', 'tasks:write'], resourceIds: ['tasks:personal'] });
    const commands = [
      { type: 'task.update', taskId: task.id, title: 'Unauthorized title' },
      { type: 'task.unschedule', taskId: task.id },
      { type: 'task.delete', taskId: task.id },
    ];
    for (const command of commands) {
      await denyAtomic(command, { agent: tasksOnly.id });
      await denyAtomic(command, { owner: 'demo_sam' });
    }
    const grantCalendar = name => ok({ type: 'agent.grant', name, scopes: ['tasks:read', 'tasks:write', 'calendar:write'], resourceIds: ['tasks:personal', 'alex_work'] });
    const calendarAgent = await grantCalendar('Task and calendar fixture agent');
    await ok({ type: 'task.update', taskId: task.id, title: 'Renamed fixture launch' }, { agent: calendarAgent.id });
    let view = await ok();
    let updated = view.tasks.find(item => item.id === task.id);
    assert.equal(updated.title, 'Renamed fixture launch');
    assert.equal(updated.calendarEventId, scheduled.calendarEventId, 'rename updates the existing linked event');
    assert.equal(view.events.find(item => item.id === scheduled.calendarEventId).title, updated.title);
    assert.equal(view.events.find(item => item.id === scheduled.calendarEventId).taskId, task.id);
    assert.deepEqual(updated.scheduledSlot, scheduled.scheduledSlot);
    await ok({ type: 'task.unschedule', taskId: task.id }, { agent: calendarAgent.id });
    view = await ok();
    updated = view.tasks.find(item => item.id === task.id);
    assert.equal(updated.scheduledSlot, undefined);
    assert.equal(updated.calendarEventId, undefined);
    assert.equal(view.events.some(item => item.id === scheduled.calendarEventId || item.taskId === task.id), false);
    assert.equal(updated.sourceMessageId, source.id, 'unscheduling retains private task provenance');

    await ok({ type: 'task.update', taskId: task.id, title: 'Task-only edit while unscheduled' }, { agent: tasksOnly.id });
    const rescheduled = await ok(schedule(task.id));
    await ok({ type: 'agent.revoke', agentId: calendarAgent.id });
    for (const command of commands) await denyAtomic(command, { agent: calendarAgent.id }, /unauthorized/);
    const replacementAgent = await grantCalendar('Replacement fixture agent');
    await ok({ type: 'task.delete', taskId: task.id }, { agent: replacementAgent.id });
    view = await ok();
    assert.equal(view.tasks.some(item => item.id === task.id), false);
    assert.equal(view.events.some(item => item.id === rescheduled.calendarEventId || item.taskId === task.id), false);
    assert.deepEqual(view.messages.find(item => item.id === source.id), source, 'deleting a source-derived task never deletes or rewrites its mail');

    const survivor = await ok({ type: 'task.create', title: 'Surviving fixture task' });
    const survivorScheduled = await ok(schedule(survivor.id));
    await ok({ type: 'task.update', taskId: survivor.id, title: 'Persisted linked title' }, { agent: replacementAgent.id });
    const persisted = await ok();
    await service.stop(); service = await start(stateFile);
    const restored = await ok();
    assert.deepEqual(restored.tasks, persisted.tasks);
    assert.deepEqual(restored.events, persisted.events);
    assert.equal(restored.tasks.some(item => item.id === task.id), false);
    assert.equal(restored.events.find(item => item.id === survivorScheduled.calendarEventId).title, 'Persisted linked title');
    assert.deepEqual(restored.messages.find(item => item.id === source.id), source);
    await denyAtomic({ type: 'task.delete', taskId: survivor.id }, { agent: calendarAgent.id }, /unauthorized/);
    const sam = await ok(null, { owner: 'demo_sam' });
    assert.equal(sam.tasks.some(item => item.id === survivor.id), false);
    assert.equal(sam.events.some(item => item.id === survivorScheduled.calendarEventId), false);
  } finally {
    if (service) await service.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
