import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createV1ProviderPreviewApi } from '../server/v1-provider-preview.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';

async function harness(t) {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-provider-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credential = join(directory, 'human-credential'); await writeFile(credential, 'fixture-a', { mode: 0o600 });
  const now = '2026-07-15T12:00:00.000Z'; const authority = await createTestFirebaseAuthority({ now });
  const tokens = { a: await authority.issue({ uid: 'firebase_a' }), b: await authority.issue({ uid: 'firebase_b' }) };
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', now: () => Date.parse(now), fetchImplementation: authority.fetch });
  const api = createV1ProviderPreviewApi({ verifyIdToken, users: { async resolve(identity) { return { userId: identity.uid === 'firebase_a' ? 'user_a' : 'user_b', username: null }; } } });
  const validate = await createOpenApiResponseValidator(); const calls = [], failures = [];
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      calls.push({ path: req.url, method: req.method, headers: req.headers });
      if (req.url === '/firebase/token?key=fixture') {
        const account = new URLSearchParams(body).get('refresh_token') === 'fixture-b' ? 'b' : 'a';
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id_token: tokens[account], refresh_token: `fixture-${account}` })); return;
      }
      const response = await api.fetch(new Request(`http://fixture.invalid${req.url}`, { method: req.method, headers: req.headers }));
      await validate(response.clone(), '/api/v1/workspace/provider-preview', 'get');
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) { failures.push(error); res.writeHead(500); res.end('Fixture response failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', 'workspace', 'providers', ...args], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
  return { directory, calls, failures, run, async owner(account) { await writeFile(credential, `fixture-${account}`, { mode: 0o600 }); } };
}

test('existing human CLI reads the shared synthetic adapter with scoped account selection and pagination', async t => {
  const f = await harness(t);
  const ok = async args => { const result = await f.run(['--format', 'json', ...args]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).data; };
  const initial = await ok([]);
  assert.equal(initial.mode, 'synthetic'); assert.equal(initial.messages.length, 2); assert.ok(initial.nextCursor);
  assert.equal(initial.accounts.every(account => !account.capabilities.send.available && !account.capabilities.calendarWrite.available), true);
  const next = await ok(['--account', initial.selectedAccountId, '--cursor', initial.nextCursor]);
  assert.equal(next.messages.length, 1); assert.equal(next.nextCursor, null);
  assert.equal(next.messages.some(message => initial.messages.some(previous => previous.id === message.id)), false);
  const secondAccount = initial.accounts.filter(account => account.provider === 'gmail')[1];
  const second = await ok(['--account', secondAccount.id]);
  assert.equal(initial.messages[0].upstreamId, second.messages[0].upstreamId);
  assert.notEqual(initial.messages[0].id, second.messages[0].id);
  assert.equal(initial.messages[0].upstreamThreadId, second.messages[0].upstreamThreadId);
  assert.notEqual(initial.messages[0].threadId, second.messages[0].threadId);
  for (const blocked of initial.accounts.filter(account => account.status !== 'ready')) {
    const data = await ok(['--account', blocked.id]); assert.equal(data.selectedAccountId, blocked.id); assert.deepEqual(data.messages, []); assert.deepEqual(data.events, []);
  }
  const output = join(f.directory, 'providers.json');
  const filed = await f.run(['--format', 'json', '--out', output]); assert.equal(filed.status, 0, filed.stderr); assert.equal(filed.stdout, '');
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).data, initial);
  await f.owner('b');
  const foreign = await f.run(['--account', initial.selectedAccountId, '--format', 'json']);
  assert.notEqual(foreign.status, 0); assert.match(foreign.stderr, /forbidden/); assert.equal(foreign.stdout, ''); assert.equal(foreign.stderr.includes(initial.selectedAccountId), false);
  const b = await ok([]); assert.notEqual(b.selectedAccountId, initial.selectedAccountId);
  assert.equal(f.calls.filter(call => call.path.startsWith('/api/')).every(call => call.method === 'GET' && !call.headers['x-openjob-fixture-owner'] && !call.headers['x-openjob-fixture-agent']), true);
  assert.deepEqual(f.failures, []);
});

test('provider CLI rejects agent credentials and invalid query options before authentication', async t => {
  const f = await harness(t);
  for (const args of [
    ['--agent-token-file', '/absent'], ['--account', ''], ['--account', '../private'],
    ['--account', 'x'.repeat(129)], ['--cursor', 'x'.repeat(513)], ['--cursor', 'private\nvalue'],
    ['--cursor', 'a', '--cursor', 'b'], ['--group', 'grp_fixture'], ['--input', '-'],
  ]) { const result = await f.run(args); assert.equal(result.status, 2, result.stderr); assert.equal(result.stdout, ''); }
  assert.deepEqual(f.calls, []);
});
