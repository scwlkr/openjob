import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replyOperationFixture } from './support/reply-operations.mjs';
import { createWorkspacePilotApplication } from '../server/workspace-pilot-application.ts';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';
import { createFixtureGmailReplyDispatch } from './support/gmail-reply-transport.mjs';
import { BINDING } from './support/google-oauth-transport.mjs';
async function harness(t, protocolOptions) {
  const f = await replyOperationFixture(), directory = await mkdtemp(join(tmpdir(), 'openjob-operation-cli-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const credential = join(directory, 'human-refresh'); await writeFile(credential, 'invented-refresh', { mode: 0o600 });
  const input = join(directory, 'input.json'); await writeFile(input, JSON.stringify(f.input));
  let gmail;
  if (protocolOptions) {
    const { payload } = await f.authority.freeze(f.owner, f.home, f.input);
    gmail = createFixtureGmailReplyDispatch({ binding: { ownerId: f.owner, workspaceId: f.home, accountId: payload.source.accountId, subject: BINDING.subject, address: BINDING.address }, ...protocolOptions });
  }
  const api = createWorkspacePilotApplication({ store: f.owned, users: f.users, verifyIdToken: f.verifyIdToken, admission: { userId: f.owner, provider: 'google', firebaseUid: 'alex' }, fixtureOperations: f.service(undefined, { timeoutMs: gmail ? 100 : 5, ...(gmail ? { dispatch: gmail.dispatch } : {}) }) });
  const requests = [], failures = [], validate = await createOpenApiResponseValidator(); let fault;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk); const body = Buffer.concat(chunks).toString('utf8'); requests.push({ method: incoming.method, path: incoming.url });
      if (incoming.url === '/firebase/token?key=fixture') { outgoing.writeHead(200, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ id_token: f.sessions.alex.token, refresh_token: 'invented-refresh' })); return; }
      const response = await api.fetch(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(body ? { body } : {}) }));
      const path = incoming.url.split('?')[0].replace(/\/wsp_[a-f0-9]{32}/, '/{workspaceId}').replace(/\/op_[a-f0-9]{64}/, '/{operationId}'); await validate(response.clone(), path, incoming.method.toLowerCase());
      if (fault === 'lost' && incoming.method === 'POST' && !incoming.url.endsWith('/run-fixture')) { fault = undefined; incoming.socket.destroy(); return; }
      const data = await response.json(); if (fault === 'extra') data.data.privatePayload = 'must not print';
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(JSON.stringify(data));
    } catch (error) { failures.push(error); outgoing.writeHead(500); outgoing.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })); const base = `http://127.0.0.1:${server.address().port}`;
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', 'operation', ...args, '--format', 'json'], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; }); child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }));
  });
  return { ...f, gmail, inputFile: input, run, requests, failures, fault(value) { fault = value; } };
}
test('actual CLI queues accepted intent, inspects durable history, runs once and validates shared API', async t => {
  const f = await harness(t), scope = ['--workspace', f.home];
  f.fault('lost'); const uncertain = await f.run(['enqueue', ...scope, '--input', f.inputFile]); assert.equal(uncertain.status, 8); assert.equal(f.requests.filter(c => c.method === 'POST' && c.path.includes('/operations')).length, 1);
  const accepted = await f.run(['enqueue', ...scope, '--input', f.inputFile]); assert.equal(accepted.status, 0, accepted.stderr); const op = JSON.parse(accepted.stdout).data; assert.equal(op.state, 'queued');
  const list = await f.run(['list', ...scope, '--task', f.task.taskId]); assert.equal(list.status, 0, list.stderr); assert.equal(JSON.parse(list.stdout).data.length, 1);
  const done = await f.run(['run-fixture', op.id, ...scope]); assert.equal(done.status, 0, done.stderr); assert.equal(JSON.parse(done.stdout).data.state, 'confirmed');
  await f.run(['run-fixture', op.id, ...scope]); assert.equal(f.calls.length, 1);
  const shown = await f.run(['show', op.id, ...scope]); assert.equal(shown.status, 0, shown.stderr); assert.doesNotMatch(shown.stdout, /reviewed work|example.invalid|payloadHash/);
  f.fault('extra'); const extra = await f.run(['show', op.id, ...scope]); assert.equal(extra.status, 8); assert.equal(extra.stdout.includes('must not print'), false);
  assert.equal(f.failures.length, 0);
});
test('actual CLI crosses fake Gmail protocol, distinguishes confirmed/unknown and never replays accepted lost response', async t => {
  for (const lost of [false, true]) {
    const f = await harness(t, { afterAccept: async () => { if (lost) throw new Error('Fake provider response lost after acceptance.'); } }), scope = ['--workspace', f.home];
    const queued = await f.run(['enqueue', ...scope, '--input', f.inputFile]); assert.equal(queued.status, 0); const op = JSON.parse(queued.stdout).data;
    const result = await f.run(['run-fixture', op.id, ...scope]); assert.equal(result.status, lost ? 8 : 0, result.stderr);
    const view = JSON.parse(result.stdout).data; assert.equal(view.state, lost ? 'unknown' : 'confirmed'); assert.equal(view.mode, 'fixture');
    if (!lost) { assert.equal(view.outcome, 'simulated_accepted'); assert.match(view.receiptId, /^sim_/); }
    await f.run(['show', op.id, ...scope]); await f.run(['run-fixture', op.id, ...scope]);
    assert.equal(f.gmail.state().attempts.length, 1); assert.equal(f.gmail.observed[0].body, f.saved.draft.body);
    assert.doesNotMatch(result.stdout, /example.invalid|invented_gmail_send|payloadHash|reviewed work/); assert.equal(f.failures.length, 0);
  }
});
test('CLI requires explicit Workspace, rejects agent fallback, and reports unknown as non-success', async t => {
  const f = await harness(t), scope = ['--workspace', f.home];
  const before = f.requests.length; assert.equal((await f.run(['list'])).status, 2); assert.equal(f.requests.length, before);
  assert.equal((await f.run(['list', ...scope, '--agent-token-file', '/unused'])).status, 2); assert.equal(f.requests.length, before);
  const queued = await f.run(['enqueue', ...scope, '--input', f.inputFile]); const op = JSON.parse(queued.stdout).data;
  f.dispatch(async payload => { f.calls.push(payload); return new Promise(() => {}); });
  const unknown = await f.run(['run-fixture', op.id, ...scope]); assert.equal(unknown.status, 8); assert.equal(JSON.parse(unknown.stdout).data.state, 'unknown');
  await f.run(['run-fixture', op.id, ...scope]); assert.equal(f.calls.length, 1); assert.equal(f.failures.length, 0);
});
