import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const root = new URL('..', import.meta.url);
async function run(args, input) {
  const child = spawn(process.execPath, ['cli/workspace.mjs', ...args], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(input);
  const [status] = await once(child, 'close');
  return { status, stdout, stderr };
}
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

test('actual workspace CLI and persistent HTTP service share mail/task/calendar/agent state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-workspace-cli-'));
  const stateFile = join(directory, 'state.json');
  let server;
  try {
    server = await start(stateFile);
    const call = (command, agent) => run([command ? 'command' : 'snapshot', '--url', server.url, '--owner', 'demo_alex', ...(agent ? ['--agent', agent] : []), ...(command ? ['--input', '-'] : [])], command ? JSON.stringify(command) : undefined);
    const ok = async (command, agent) => {
      const result = await call(command, agent);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).data;
    };
    assert.equal((await ok()).accounts.length, 3);
    const task = await ok({ type: 'task.create', title: 'Prepare fixture demo', messageId: 'alex_msg_launch' });
    await ok({ type: 'task.schedule', taskId: task.id, calendarId: 'alex_personal', start: '2026-10-16T12:00:00Z', end: '2026-10-16T12:30:00Z' });
    await ok({ type: 'task.complete', taskId: task.id, completed: true });
    const draft = await ok({ type: 'mail.draft', messageId: 'alex_msg_launch', body: 'Fixture reply only.' });
    const denied = await call({ type: 'mail.send', draftId: draft.id });
    assert.notEqual(denied.status, 0); assert.match(denied.stderr, /sending_disabled/);
    assert.notEqual((await call({ type: 'mail.read', messageId: 'sam_msg_private', read: true })).status, 0);
    const agent = await ok({ type: 'agent.grant', name: 'Fixture reader', scopes: ['mail:read'], resourceIds: ['alex_gmail'] });
    assert.deepEqual((await ok(null, agent.id)).accounts.map(account => account.id), ['alex_gmail']);
    await ok({ type: 'agent.revoke', agentId: agent.id });
    assert.notEqual((await call(null, agent.id)).status, 0);
    assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
    const saved = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(saved.tasks.find(item => item.id === task.id).completed, true);
    await server.stop(); server = await start(stateFile);
    const restored = await ok();
    assert.equal(restored.tasks.find(item => item.id === task.id).scheduledSlot.start, '2026-10-16T12:00:00.000Z');
    assert.equal(restored.events.some(item => item.taskId === task.id), true);
    assert.equal(restored.drafts.find(item => item.id === draft.id).body, 'Fixture reply only.');
    assert.equal(restored.agents.find(item => item.id === agent.id).revoked, true);
  } finally { if (server) await server.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('fixture CLI rejects external destinations and redirects without following them', async () => {
  for (const url of ['https://example.invalid', 'http://127.0.0.1@example.invalid', 'http://127.0.0.1/path']) {
    assert.notEqual((await run(['snapshot', '--url', url, '--owner', 'demo_alex'])).status, 0);
  }
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.writeHead(302, { location: 'https://example.invalid' }); response.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const result = await run(['snapshot', '--url', `http://127.0.0.1:${server.address().port}`, '--owner', 'demo_alex']);
    assert.notEqual(result.status, 0); assert.equal(requests, 1); assert.equal(result.stdout, '');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
