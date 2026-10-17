import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';
import { onboardingFixture } from './support/onboarding-app-fixture.mjs';
test('existing CLI completes the simulated Connections journey through signed API', async t => {
  const f = await onboardingFixture(), directory = await mkdtemp(join(tmpdir(), 'openjob-331-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credential = join(directory, 'fixture-credential'); await writeFile(credential, 'invented-refresh', { mode: 0o600 });
  const calls = [], failures = [], validate = await createOpenApiResponseValidator();
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      if (req.url === '/firebase/token?key=fixture') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id_token: f.sessions.alex.token, refresh_token: 'invented-refresh' })); return; }
      calls.push({ method: req.method, path: req.url });
      const response = await f.api.fetch(new Request('http://fixture.invalid' + req.url, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body } : {}) }));
      await validate(response.clone(), req.url.endsWith('/mail') ? '/api/v1/connections/{connectionId}/mail' : req.url === '/api/v1/connections' ? '/api/v1/connections' : '/api/v1/connections/{connectionId}', req.method.toLowerCase());
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) { failures.push(error); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function run(args, input) {
    const file = join(directory, 'input.json'); if (input) await writeFile(file, JSON.stringify(input));
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['cli/openjob.mjs', 'connections', ...args, '--format', 'json', ...(input ? ['--input', file] : [])], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_NO_UPDATE_CHECK: '1', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
    });
    assert.equal(result.status, 0, result.stderr + failures.map(error => error.message).join('\n')); return JSON.parse(result.stdout).data;
  }
  assert.equal((await run(['list'])).mode, 'simulated');
  const { connectionId: id } = await run(['begin'], { choiceId: 'invented_gmail', workspaceId: f.home });
  await run(['action', id], { action: 'cancel' }); assert.equal((await run(['list'])).bindings[0].status, 'cancelled');
  assert.equal((await run(['begin'], { choiceId: 'invented_gmail', workspaceId: f.home })).connectionId, id);
  await run(['action', id], { action: 'approve' });
  const mail = await run(['mail', id]); assert.equal(mail.mode, 'simulated'); assert.equal(mail.workspaceId, f.home); assert.equal(mail.page.messages.length, 1);
  await run(['action', id], { action: 'disconnect' }); assert.equal((await run(['list'])).bindings[0].status, 'disconnected');
  assert.equal(failures.length, 0); assert.ok(calls.every(call => call.path.startsWith('/api/v1/connections')));
  assert.equal(calls.filter(call => call.path.endsWith('/mail')).length, 1);
});
