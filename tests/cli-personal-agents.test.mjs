import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createV1PersonalAgentGrantsApi } from '../server/v1-personal-agent-grants.ts';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';

async function harness(t) {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-personal-agents-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credential = join(directory, 'human-credential');
  await writeFile(credential, 'fixture-refresh', { mode: 0o600 });
  const now = Date.parse('2026-07-15T12:00:00.000Z');
  const authority = await createTestFirebaseAuthority({ now: new Date(now).toISOString() });
  const humanToken = await authority.issue({ uid: 'user_fixture' });
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', now: () => now, fetchImplementation: authority.fetch });
  const firestore = createFakeFirestore();
  const root = 'projects/openjob-dev/databases/(default)/documents/';
  const userPath = root + 'v1UserDirectory/user_fixture';
  firestore.documents.set(userPath, { name: userPath, updateTime: new Date(now).toISOString(), fields: { userId: { stringValue: 'user_fixture' } } });
  const config = { projectId: 'openjob-dev', clientEmail: 'fixture@example.invalid', privateKey: await createPrivateKey() };
  const users = { async resolve(identity) { return identity.uid === 'user_fixture' ? { userId: identity.uid, username: 'fixture' } : null; } };
  let workspace, api, grants;
  const reload = () => {
    workspace = createFirestorePersonalWorkspaceStore(config, firestore.fetch, { now: () => now });
    api = createV1PersonalWorkspaceApi({ workspace, users, verifyIdToken });
    grants = createV1PersonalAgentGrantsApi({ workspace, users, verifyIdToken });
  };
  reload();
  const validate = await createOpenApiResponseValidator();
  const calls = [], failures = [], issued = [];
  let fault;
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      calls.push({ method: req.method, path: req.url });
      if (req.url === '/firebase/token?key=fixture') {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id_token: humanToken, refresh_token: 'fixture-refresh' })); return;
      }
      const issuing = req.url === '/api/v1/workspace/agent-grants' && req.method === 'POST';
      if (issuing && fault?.kind === 'service') {
        res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Fixture unavailable.', requestId: 'req_fixture' } })); return;
      }
      const response = await (req.url.includes('agent-grants') ? grants : api).fetch(new Request(`http://fixture.invalid${req.url}`, { method: req.method, headers: req.headers, ...(body ? { body } : {}) }));
      const schemaPath = req.url.replace(/\/agt_[a-f0-9]{32}$/, '/{agentId}');
      await validate(response.clone(), schemaPath, req.method.toLowerCase());
      if (issuing && response.status === 201) {
        const envelope = await response.json(); issued.push(envelope.data);
        if (fault?.kind === 'race') await writeFile(fault.path, 'preserve concurrent file', { mode: 0o600 });
        if (fault?.kind === 'ambiguous') { req.socket.destroy(); return; }
        if (fault?.kind === 'malformed') { res.writeHead(201, { 'content-type': 'application/json' }); res.end('invalid JSON'); return; }
        envelope.data.agent.unexpectedCredential = envelope.data.token;
        res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify(envelope)); return;
      }
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) { failures.push(error); res.writeHead(500); res.end('Isolated fixture error'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = (args, input) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', ...args], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr })); child.stdin.end(input);
  });
  const grantArgs = path => ['workspace', 'agent', 'grant', '--name', 'Personal fixture planner', '--scopes', 'tasks:read,tasks:write,calendar:read,calendar:write', '--resources', 'tasks:personal,calendar:personal', '--token-out', path, '--format', 'json'];
  return { directory, credential, firestore, root, run, calls, issued, failures, reload, grantArgs, fault(value) { fault = value; } };
}

test('existing CLI privately issues durable personal grants and executes scoped commands without human fallback', async t => {
  const f = await harness(t); const outputs = [];
  const privatePath = join(f.directory, 'personal-token');
  const grant = await f.run(f.grantArgs(privatePath)); outputs.push(grant);
  assert.equal(grant.status, 0, grant.stderr);
  const agent = JSON.parse(grant.stdout).data;
  const token = (await readFile(privatePath, 'utf8')).trim();
  assert.equal(token, f.issued[0].token); assert.equal((await stat(privatePath)).mode & 0o777, 0o600);
  assert.equal('unexpectedCredential' in agent, false);
  f.reload();
  const command = async input => {
    const result = await f.run(['workspace', 'command', '--agent-token-file', privatePath, '--input', '-', '--format', 'json'], JSON.stringify(input)); outputs.push(result);
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).data;
  };
  await rm(f.credential);
  const refreshCount = f.calls.filter(call => call.path.startsWith('/firebase/')).length;
  const task = await command({ type: 'task.create', title: 'Personal credential task' });
  await command({ type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-07-15T15:00:00Z', end: '2026-07-15T15:30:00Z' });
  const read = await f.run(['workspace', 'snapshot', '--agent-token-file', privatePath, '--format', 'json']); outputs.push(read);
  assert.equal(read.status, 0, read.stderr); assert.equal(JSON.parse(read.stdout).data.tasks[0].id, task.id);
  assert.equal(JSON.parse(read.stdout).data.events.length, 1);
  assert.equal(f.calls.filter(call => call.path.startsWith('/firebase/')).length, refreshCount);
  await writeFile(f.credential, 'fixture-refresh', { mode: 0o600 });
  const listed = await f.run(['workspace', 'agent', 'list', '--format', 'json']); outputs.push(listed);
  assert.equal(listed.status, 0, listed.stderr); assert.deepEqual(JSON.parse(listed.stdout).data, [agent]);
  const writerPath = join(f.directory, 'writer-token');
  const writerArgs = f.grantArgs(writerPath); writerArgs[writerArgs.indexOf('--scopes') + 1] = 'tasks:write'; writerArgs[writerArgs.indexOf('--resources') + 1] = 'tasks:personal';
  const writer = await f.run(writerArgs); outputs.push(writer); assert.equal(writer.status, 0, writer.stderr);
  const written = await f.run(['workspace', 'command', '--agent-token-file', writerPath, '--input', '-', '--format', 'json'], JSON.stringify({ type: 'task.create', title: 'Write-only private task' })); outputs.push(written);
  assert.equal(written.status, 0, written.stderr); assert.deepEqual(Object.keys(JSON.parse(written.stdout).data).sort(), ['id', 'updated']);
  assert.equal(written.stdout.includes('Write-only private task'), false);
  const writerRead = await f.run(['workspace', 'snapshot', '--agent-token-file', writerPath, '--format', 'json']); outputs.push(writerRead);
  assert.equal(writerRead.status, 0, writerRead.stderr); assert.deepEqual(JSON.parse(writerRead.stdout).data.tasks, []);
  const forbidden = await f.run(['workspace', 'command', '--agent-token-file', writerPath, '--input', '-', '--format', 'json'], JSON.stringify({ type: 'calendar.create', calendarId: 'personal', title: 'Denied calendar', start: '2026-07-15T15:00:00Z', end: '2026-07-15T15:30:00Z' })); outputs.push(forbidden);
  assert.notEqual(forbidden.status, 0); assert.match(forbidden.stderr, /forbidden/);
  const revoked = await f.run(['workspace', 'agent', 'revoke', agent.id, '--yes', '--format', 'json']); outputs.push(revoked);
  assert.equal(revoked.status, 0, revoked.stderr); assert.deepEqual(JSON.parse(revoked.stdout).data, { id: agent.id, revoked: true });
  await rm(f.credential); f.reload();
  const before = f.calls.filter(call => call.path.startsWith('/firebase/')).length;
  const denied = await f.run(['workspace', 'snapshot', '--agent-token-file', privatePath, '--format', 'json']); outputs.push(denied);
  assert.notEqual(denied.status, 0); assert.match(denied.stderr, /authentication_required/);
  assert.equal(f.calls.filter(call => call.path.startsWith('/firebase/')).length, before);
  for (const secret of [...f.issued.map(item => item.token), 'fixture-refresh', 'tokenHash', 'unexpectedCredential']) assert.equal(JSON.stringify(outputs).includes(secret), false, secret);
  assert.equal(JSON.stringify([...f.firestore.documents.values()]).includes(token), false);
  assert.deepEqual(f.failures, []);
});

test('personal CLI grant preflight rejects unsafe output and credential options without issuing requests', async t => {
  const f = await harness(t); const path = join(f.directory, 'new-token');
  const existing = join(f.directory, 'existing'); await writeFile(existing, 'preserve me', { mode: 0o600 });
  const dangling = join(f.directory, 'dangling'); await symlink(join(f.directory, 'absent'), dangling);
  for (const args of [
    f.grantArgs(existing), f.grantArgs(dangling), f.grantArgs('-'),
    [...f.grantArgs(path), '--force'], [...f.grantArgs(path), '--out', path],
    [...f.grantArgs(path), '--agent-token-file', existing],
    ['workspace', 'agent', 'grant', '--name', 'Missing fields', '--token-out', path],
    ['workspace', 'agent', 'revoke', 'agt_' + 'a'.repeat(32)],
    ['workspace', 'command', '--agent-token-file', '-', '--input', '-'],
  ]) { const result = await f.run(args); assert.equal(result.status, 2, result.stderr); }
  assert.deepEqual(f.calls, []); assert.equal(await readFile(existing, 'utf8'), 'preserve me');
  const groupToken = join(f.directory, 'group-token'); await writeFile(groupToken, 'oj_agent_agt_' + 'a'.repeat(32) + '.' + 'A'.repeat(43), { mode: 0o600 });
  assert.equal((await f.run(['workspace', 'snapshot', '--agent-token-file', groupToken])).status, 2);
  assert.deepEqual(f.calls, []);
});

test('uncertain personal issuance is never replayed and private delivery races give nonsecret recovery', async t => {
  const f = await harness(t);
  for (const kind of ['service', 'ambiguous', 'malformed', 'race']) {
    const path = join(f.directory, kind); f.fault({ kind, path });
    const before = f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/agent-grants')).length;
    const result = await f.run(f.grantArgs(path));
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/agent-grants')).length, before + 1);
    assert.match(result.stderr, kind === 'race' ? /agent_token_delivery_failed/ : /agent_grant_uncertain/);
    if (kind === 'race') { assert.equal(await readFile(path, 'utf8'), 'preserve concurrent file'); assert.match(result.stderr, /workspace agent revoke/); }
    else await assert.rejects(stat(path), { code: 'ENOENT' });
    for (const issued of f.issued) assert.equal(result.stderr.includes(issued.token), false);
  }
  assert.deepEqual(f.failures, []);
});
