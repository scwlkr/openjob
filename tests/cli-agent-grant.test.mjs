import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, OWNER, GROUP, collection } from './support/agent-grant-fixture.mjs';

async function harness(t) {
  const f = await fixture();
  const directory = await mkdtemp(join(tmpdir(), 'openjob-grant-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credential = join(directory, 'human-credential');
  await writeFile(credential, 'fixture-refresh', { mode: 0o600 });
  const calls = [];
  let fault = null;
  let lastIssued;
  const server = createServer(async (req, res) => {
    calls.push({ method: req.method, path: req.url });
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url === '/firebase/token?key=fixture') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id_token: 'fixture-human', refresh_token: 'fixture-refresh' }));
      return;
    }
    const issuing = req.method === 'POST' && req.url === '/api/v1/agent-grants';
    if (issuing && fault?.kind === 'service') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Fixture outage.', requestId: 'req_fixture' } }));
      return;
    }
    const api = req.url.includes('/tasks') ? f.taskApi : f.admin;
    const response = await api.fetch(new Request(`http://fixture.invalid${req.url}`, { method: req.method, headers: req.headers, ...(body ? { body } : {}) }));
    if (issuing && response.status === 201) {
      const envelope = await response.json();
      lastIssued = envelope.data;
      if (fault?.kind === 'race') await writeFile(fault.path, 'preserve concurrent file', { mode: 0o600 });
      if (fault?.kind === 'ambiguous') { req.socket.destroy(); return; }
      if (fault?.kind === 'malformed') { res.writeHead(201, { 'content-type': 'application/json' }); res.end('invalid JSON'); return; }
      if (fault?.kind === 'invalid') envelope.data.agent.scope = 'tasks:write';
      // Extra server fields must not widen public CLI output.
      envelope.data.agent.unexpectedCredential = envelope.data.token;
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify(envelope));
      return;
    }
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', ...args], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: base + '/api/v1', OPENJOB_GROUP_ID: GROUP, OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
  return { ...f, directory, run, calls, fault: value => { fault = value; }, issued: () => lastIssued,
    grant: (path, extra = []) => run(['agent', 'grant', '--group', GROUP, '--name', 'Fixture planner', '--token-out', path, '--format', 'json', ...extra]) };
}

test('CLI grant privately delivers a usable read credential, exposes only metadata, and completes revocation', async t => {
  const f = await harness(t);
  const path = join(f.directory, 'agent-token');
  const result = await f.grant(path);
  assert.equal(result.status, 0, result.stderr);
  const agent = JSON.parse(result.stdout).data;
  const token = (await readFile(path, 'utf8')).trimEnd();
  assert.equal(token, f.issued().token);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(await readFile(path, 'utf8'), token + '\n');
  assert.deepEqual(agent, (await f.grants.list(OWNER))[0]);
  assert.equal(agent.scope, 'tasks:read'); assert.equal(Date.parse(agent.expiresAt) - Date.parse(agent.createdAt), 86400000);
  for (const secret of [token, 'fixture-refresh', 'tokenHash', 'membershipId', 'unexpectedCredential']) assert.equal(JSON.stringify(result).includes(secret), false, secret);
  const read = await f.run(['task', 'list', '--group', GROUP, '--agent-token-file', path, '--format', 'json']);
  assert.equal(read.status, 0, read.stderr); assert.equal(JSON.parse(read.stdout).data.length, 2);
  assert.equal((await f.request(collection + '/task_one', { token, method: 'PATCH', body: { text: 'Denied' } })).status, 403);
  const revoked = await f.run(['agent', 'revoke', agent.agentId, '--yes']);
  assert.equal(revoked.status, 0, revoked.stderr);
  const denied = await f.run(['task', 'list', '--group', GROUP, '--agent-token-file', path]);
  assert.notEqual(denied.status, 0); assert.match(denied.stderr, /agent_access_denied/);
  const publicPath = join(f.directory, 'public.json');
  const privatePath = join(f.directory, 'second-token');
  const filed = await f.grant(privatePath, ['--out', publicPath]);
  assert.equal(filed.status, 0, filed.stderr); assert.equal(filed.stdout, '');
  assert.equal(JSON.parse(await readFile(publicPath, 'utf8')).data.agentId, f.issued().agent.agentId);
  assert.equal((await readFile(publicPath, 'utf8')).includes(f.issued().token), false);
});

test('grant preflight rejects unsafe destinations and options without authentication or issuance', async t => {
  const f = await harness(t);
  const path = join(f.directory, 'new-token');
  const existing = join(f.directory, 'existing'); await writeFile(existing, 'preserve me');
  const alias = join(f.directory, 'alias'); await symlink(f.directory, alias, 'dir');
  const dangling = join(f.directory, 'dangling'); await symlink(join(f.directory, 'absent-target'), dangling);
  const valid = ['agent', 'grant', '--group', GROUP, '--name', 'Fixture', '--token-out', path];
  const cases = [
    ['agent', 'grant', '--name', 'Fixture', '--token-out', path],
    ['agent', 'grant', '--group', GROUP, '--token-out', path],
    ['agent', 'grant', '--group', GROUP, '--name', 'Fixture'],
    ['agent', 'grant', '--group', '../me', '--name', 'Fixture', '--token-out', path],
    ['agent', 'grant', '--group', GROUP, '--name', 'bad\u0001name', '--token-out', path],
    ['agent', 'grant', '--group', GROUP, '--name', 'Fixture', '--token-out', '-'],
    ['agent', 'grant', '--group', GROUP, '--name', 'Fixture', '--token-out', existing],
    ['agent', 'grant', '--group', GROUP, '--name', 'Fixture', '--token-out', join(f.directory, 'missing', 'token')],
    ['agent', 'grant', '--group', GROUP, '--name', 'Fixture', '--token-out', join(existing, 'token')],
    ['agent', 'grant', '--group', GROUP, '--name', 'Fixture', '--token-out', dangling],
    [...valid, '--out', join(existing, 'public')], [...valid, '--out', dangling],
    [...valid, '--out', path], [...valid, '--out', join(alias, 'new-token')],
    [...valid, '--out', existing], [...valid, '--force'], [...valid, '--agent-token-file', existing],
  ];
  for (const args of cases) { const result = await f.run(args); assert.equal(result.status, 2, JSON.stringify(args) + result.stderr); assert.equal(result.stdout, ''); }
  assert.deepEqual(f.calls, []);
  assert.equal(await readFile(existing, 'utf8'), 'preserve me');
});

test('issuance failures are not replayed and credential-delivery races provide nonsecret recovery', async t => {
  const f = await harness(t);
  for (const kind of ['service', 'ambiguous', 'malformed', 'invalid', 'race']) {
    const path = join(f.directory, kind + '-token');
    f.fault({ kind, path });
    const before = f.calls.filter(c => c.method === 'POST' && c.path === '/api/v1/agent-grants').length;
    const result = await f.grant(path);
    assert.notEqual(result.status, 0, kind); assert.equal(result.stdout, '');
    assert.equal(f.calls.filter(c => c.method === 'POST' && c.path === '/api/v1/agent-grants').length, before + 1, kind + ' does not replay POST');
    if (['service', 'ambiguous', 'malformed'].includes(kind)) {
      assert.match(result.stderr, /agent_grant_uncertain/);
      assert.match(result.stderr, /Inspect openjob agent list/);
    }
    if (kind === 'race') {
      assert.equal(await readFile(path, 'utf8'), 'preserve concurrent file');
      assert.match(result.stderr, /agent_token_delivery_failed/);
      assert.ok(result.stderr.includes(f.issued().agent.agentId));
    } else { await assert.rejects(stat(path), { code: 'ENOENT' }); }
    if (kind !== 'service') {
      assert.equal(result.stderr.includes(f.issued().token), false);
      f.fault(null);
      const revoke = await f.run(['agent', 'revoke', f.issued().agent.agentId, '--yes']);
      assert.equal(revoke.status, 0, revoke.stderr);
      assert.equal(await f.grants.authorize(f.issued().token), null);
    }
  }
});
