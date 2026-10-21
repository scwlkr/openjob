import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceAgentFixture } from './support/owned-workspace-agents.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';
async function harness(t) {
  const f = await workspaceAgentFixture(), directory = await mkdtemp(join(tmpdir(), 'openjob-owned-agent-cli-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const credential = join(directory, 'human-refresh'); await writeFile(credential, 'invented-refresh', { mode: 0o600 });
  const calls = [], failures = [], issued = [], validate = await createOpenApiResponseValidator(); let fault;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk); const body = Buffer.concat(chunks).toString('utf8'); calls.push({ method: incoming.method, path: incoming.url });
      if (incoming.url === '/firebase/token?key=fixture') { outgoing.writeHead(200, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ id_token: f.sessions.alex.token, refresh_token: 'invented-refresh' })); return; }
      const response = await f.api.fetch(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(body ? { body } : {}) }));
      const path = incoming.url.replace(/\/wsp_[a-f0-9]{32}/, '/{workspaceId}').replace(/\/agt_[a-f0-9]{32}$/, '/{agentId}'); await validate(response.clone(), path, incoming.method.toLowerCase());
      if (incoming.method === 'POST' && incoming.url.endsWith('/agent-grants') && response.status === 201) {
        const data = await response.json(); issued.push(data.data);
        if (fault === 'ambiguous') { incoming.socket.destroy(); return; }
        if (fault === 'extra') data.data.agent.unexpectedCredential = data.data.token;
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(JSON.stringify(data)); return;
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text());
    } catch (error) { failures.push(error); outgoing.writeHead(500); outgoing.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })); const base = `http://127.0.0.1:${server.address().port}`;
  const run = (args, input) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', ...args], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; }); child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr })); child.stdin.end(input);
  });
  const grantArgs = path => ['workspace', 'agent', 'grant', '--workspace', f.home, '--name', 'Workspace planner', '--scopes', 'tasks:read,tasks:write,calendar:read,calendar:write', '--resources', `${f.workspace.taskSpaceId},${f.workspace.calendarId}`, '--token-out', path, '--format', 'json'];
  return { ...f, directory, credential, calls, failures, issued, run, grantArgs, fault(value) { fault = value; } };
}

test('actual API and CLI privately issue and use exact Workspace grants, plan work, inspect actions and revoke without human fallback', async t => {
  const f = await harness(t), outputs = [], tokenPath = join(f.directory, 'agent.token');
  const grant = await f.run(f.grantArgs(tokenPath)); outputs.push(grant); assert.equal(grant.status, 0, grant.stderr);
  const agent = JSON.parse(grant.stdout).data, token = (await readFile(tokenPath, 'utf8')).trim(); assert.equal(token, f.issued[0].token); assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
  await rm(f.credential); const refreshBefore = f.calls.filter(row => row.path.startsWith('/firebase')).length;
  const command = async input => { const response = await f.run(['workspace', 'command', '--workspace', f.home, '--agent-token-file', tokenPath, '--input', '-', '--format', 'json'], JSON.stringify(input)); outputs.push(response); assert.equal(response.status, 0, response.stderr); return JSON.parse(response.stdout).data; };
  const created = await command({ type: 'task.create', title: 'Review owner Workspace planning' }); assert.deepEqual(Object.keys(created).sort(), ['itemId', 'operation', 'workspaceId']);
  await command({ type: 'task.notes', taskId: created.itemId, notes: 'Authored by the scoped agent', expectedNotes: '' });
  await command({ type: 'task.schedule', taskId: created.itemId, calendarId: f.workspace.calendarId, start: '2030-02-01T10:00:00Z', end: '2030-02-01T10:30:00Z' });
  const snapshot = await f.run(['workspace', 'snapshot', '--workspace', f.home, '--agent-token-file', tokenPath, '--format', 'json']); outputs.push(snapshot); assert.equal(snapshot.status, 0, snapshot.stderr);
  const view = JSON.parse(snapshot.stdout).data; assert.equal(view.work.tasks[0].id, created.itemId); assert.equal(view.work.events[0].taskId, created.itemId); assert.doesNotMatch(snapshot.stdout, /tokenHash|workspaceAgents|connectedReplies/);
  const tasks = await f.run(['workspace', 'tasks', '--workspace', f.home, '--agent-token-file', tokenPath, '--search', 'owner Workspace', '--format', 'json']); outputs.push(tasks); assert.equal(tasks.status, 0, tasks.stderr); assert.equal(JSON.parse(tasks.stdout).data[0].id, created.itemId);
  const callsBefore = f.calls.length, other = 'wsp_' + 'f'.repeat(32);
  const wrong = await f.run(['workspace', 'snapshot', '--workspace', other, '--agent-token-file', tokenPath]); outputs.push(wrong); assert.notEqual(wrong.status, 0); assert.equal(f.calls.length, callsBefore);
  assert.equal(f.calls.filter(row => row.path.startsWith('/firebase')).length, refreshBefore);
  await writeFile(f.credential, 'invented-refresh', { mode: 0o600 });
  const listed = await f.run(['workspace', 'agent', 'list', '--workspace', f.home, '--format', 'json']); outputs.push(listed); assert.equal(listed.status, 0, listed.stderr); const access = JSON.parse(listed.stdout).data; assert.equal(access.agents[0].id, agent.id); assert.equal(access.actions.length, 3); assert.doesNotMatch(JSON.stringify(access.actions), /Authored|"notes":|"title":/);
  const revoked = await f.run(['workspace', 'agent', 'revoke', agent.id, '--workspace', f.home, '--yes', '--format', 'json']); outputs.push(revoked); assert.equal(revoked.status, 0, revoked.stderr);
  await rm(f.credential); const authCount = f.calls.filter(row => row.path.startsWith('/firebase')).length;
  const denied = await f.run(['workspace', 'snapshot', '--workspace', f.home, '--agent-token-file', tokenPath, '--format', 'json']); outputs.push(denied); assert.notEqual(denied.status, 0); assert.equal(f.calls.filter(row => row.path.startsWith('/firebase')).length, authCount);
  assert.equal(f.failures.length, 0); for (const output of outputs) assert.equal((output.stdout + output.stderr).includes(token), false);
});

test('grant preflight preserves existing files; ambiguous issuance never retries or exposes a credential', async t => {
  const f = await harness(t), existing = join(f.directory, 'preserved'); await writeFile(existing, 'preserve this', { mode: 0o600 });
  const before = f.calls.length, refused = await f.run(f.grantArgs(existing)); assert.notEqual(refused.status, 0); assert.equal(f.calls.length, before); assert.equal(await readFile(existing, 'utf8'), 'preserve this');
  f.fault('ambiguous'); const file = join(f.directory, 'unknown.token'), response = await f.run(f.grantArgs(file)); assert.notEqual(response.status, 0); assert.match(response.stderr, /agent_grant_uncertain|could not be confirmed/); assert.equal(f.issued.length, 1); await assert.rejects(stat(file)); assert.equal((response.stdout + response.stderr).includes(f.issued[0].token), false);
  f.fault('extra'); const extra = await f.run(f.grantArgs(join(f.directory, 'extra.token'))); assert.notEqual(extra.status, 0); assert.equal((extra.stdout + extra.stderr).includes(f.issued[1].token), false); assert.equal(f.issued.length, 2); assert.equal(f.failures.length, 0);
});
