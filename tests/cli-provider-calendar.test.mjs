import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calendarPlanningFixture, calendarPlanningSpan } from './support/calendar-planning.mjs';
import { createWorkspacePilotApplication } from '../server/workspace-pilot-application.ts';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';

async function harness(t, options) {
  const f = await calendarPlanningFixture(options), directory = await mkdtemp(join(tmpdir(), 'openjob-calendar-cli-')), credential = join(directory, 'refresh');
  t.after(() => rm(directory, { recursive: true, force: true })); await writeFile(credential, 'invented-refresh', { mode: 0o600 });
  const api = createWorkspacePilotApplication({ store: f.owned, users: f.users, verifyIdToken: f.verifyIdToken, admission: { userId: f.owner, provider: 'google', firebaseUid: 'alex' }, fixtureCalendar: f.service() });
  const validate = await createOpenApiResponseValidator(), requests = [], failures = []; let fault;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk); const body = Buffer.concat(chunks).toString('utf8');
      if (incoming.url === '/firebase/token?key=fixture') { outgoing.writeHead(200, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ id_token: f.sessions.alex.token, refresh_token: 'invented-refresh' })); return; }
      requests.push({ method: incoming.method, path: incoming.url });
      const response = await api.fetch(new Request('http://' + incoming.headers.host + incoming.url, { method: incoming.method, headers: incoming.headers, ...(body ? { body } : {}) }));
      const path = incoming.url.split('?')[0].replace(/\/wsp_[a-f0-9]{32}/, '/{workspaceId}').replace(/\/cop_[a-f0-9]{64}/, '/{operationId}').replace(/\/planning\/[^/]+\/(review|detach)$/, '/planning/{taskId}/$1'); await validate(response.clone(), path, incoming.method.toLowerCase());
      if (response.ok && fault === 'lost' && incoming.method === 'POST' && !incoming.url.endsWith('/run-fixture')) { fault = undefined; incoming.socket.destroy(); return; }
      const value = await response.json(); if (fault === 'extra' && response.ok) { fault = undefined; value.data.privatePayload = 'must-not-print'; }
      if (fault === 'wrong-id' && response.ok) { fault = undefined; value.data.id = 'cop_' + 'e'.repeat(64); }
      if (fault === 'wrong-input' && response.ok) { fault = undefined; value.data.requestId = crypto.randomUUID(); }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(JSON.stringify(value));
    } catch (error) { failures.push(error); outgoing.writeHead(500); outgoing.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', ...args, '--workspace', f.home, '--format', 'json'], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_NO_UPDATE_CHECK: '1', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }));
  });
  let sequence = 0; const input = async value => { const path = join(directory, 'intent-' + ++sequence + '.json'); await writeFile(path, JSON.stringify(value), { mode: 0o600 }); return path; };
  const success = async args => { const result = await run(args); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).data; };
  return { ...f, run, success, inputFile: input, requests, failures, fault(value) { fault = value; } };
}
test('actual CLI reads Calendar, recovers accepted intent, manages one plan and inspects a lost detach receipt through OpenAPI', async t => {
  const f = await harness(t), accounts = await f.success(['calendar', 'accounts']); assert.equal(accounts[0].accountId, f.binding.accountId); assert.equal(accounts[0].available, true);
  const listed = await f.success(['calendar', 'list', '--account', f.binding.accountId]); assert.equal(listed.calendars[0].id, f.input.calendarId);
  const availability = await f.success(['calendar', 'availability', '--account', f.binding.accountId, '--calendar', f.input.calendarId, '--schedule-start', calendarPlanningSpan.start.at, '--schedule-end', calendarPlanningSpan.end.at]); assert.deepEqual(availability.busy, []);
  const input = await f.inputFile({ ...f.input, span: { start: { ...calendarPlanningSpan.start, at: '2026-11-01T01:30:00-05:00' }, end: { ...calendarPlanningSpan.end, at: '2026-11-01T07:30:00Z' } } }); f.fault('lost'); assert.equal((await f.run(['calendar-operation', 'enqueue', '--input', input])).status, 8); assert.equal(f.requests.filter(row => row.method === 'POST').length, 1);
  f.fault('wrong-input'); const wrongInput = await f.run(['calendar-operation', 'enqueue', '--input', input]); assert.equal(wrongInput.status, 8); assert.equal(wrongInput.stdout, '');
  const queued = await f.success(['calendar-operation', 'enqueue', '--input', input]); assert.equal(queued.state, 'queued');
  const confirmed = await f.success(['calendar-operation', 'run-fixture', queued.id]); assert.equal(confirmed.state, 'confirmed'); assert.equal(f.state().attempts.length, 1);
  f.fault('wrong-id'); const wrongId = await f.run(['calendar-operation', 'run-fixture', queued.id]); assert.equal(wrongId.status, 8); assert.equal(wrongId.stdout, ''); assert.equal(f.state().attempts.length, 1);
  assert.equal((await f.success(['calendar-operation', 'show', queued.id])).state, 'confirmed');
  const events = await f.success(['calendar', 'events', '--account', f.binding.accountId, '--calendar', f.input.calendarId, '--schedule-start', calendarPlanningSpan.start.at, '--schedule-end', calendarPlanningSpan.end.at]); assert.equal(events.events.length, 1);
  const [link] = await f.success(['planning', 'list']); const update = await f.inputFile({ action: 'calendar.update', taskId: f.task.taskId, requestId: crypto.randomUUID(), etag: link.confirmed.etag, title: 'Reviewed Unicode plan ✓', span: calendarPlanningSpan });
  const queuedUpdate = await f.success(['calendar-operation', 'enqueue', '--input', update]); await f.success(['calendar-operation', 'run-fixture', queuedUpdate.id]); assert.equal(f.state().attempts.length, 2);
  const [updated] = await f.success(['planning', 'review', f.task.taskId]); assert.equal(updated.confirmed.title, 'Reviewed Unicode plan ✓');
  const detach = await f.inputFile({ operationId: updated.operationId, eventId: updated.eventId, etag: updated.confirmed.etag, acknowledge: 'leave_provider_event' });
  f.fault('lost'); assert.equal((await f.run(['planning', 'detach', f.task.taskId, '--input', detach])).status, 8);
  const receipt = await f.success(['planning', 'detach-receipt', f.task.taskId, updated.operationId]); assert.equal(receipt.detached, true); assert.equal(receipt.providerEventLeft, true);
  assert.deepEqual(await f.success(['planning', 'detach', f.task.taskId, '--input', detach]), receipt); assert.deepEqual(await f.success(['planning', 'list']), []); assert.equal(f.state().attempts.length, 2); assert.equal(f.state().events[0].status, 'confirmed');
  assert.deepEqual(f.failures, []);
});
test('actual CLI reports unknown without replay and rejects hidden response fields before output', async t => {
  const f = await harness(t, { afterAccept: async () => { throw new Error('Lost accepted response'); } }), input = await f.inputFile(f.input), queued = await f.success(['calendar-operation', 'enqueue', '--input', input]);
  const result = await f.run(['calendar-operation', 'run-fixture', queued.id]); assert.equal(result.status, 8, result.stderr); assert.equal(JSON.parse(result.stdout).data.state, 'unknown');
  assert.equal((await f.run(['calendar-operation', 'run-fixture', queued.id])).status, 8); assert.equal(f.state().attempts.length, 1);
  f.fault('extra'); const invalid = await f.run(['calendar-operation', 'show', queued.id]); assert.equal(invalid.status, 8); assert.doesNotMatch(invalid.stdout + invalid.stderr, /must-not-print|privatePayload/); assert.equal(invalid.stdout, '');
  assert.deepEqual(f.failures, []);
});
test('actual CLI deletion and lost review recover their separate receipt without replaying unknown effects', async t => {
  const f = await harness(t, { afterAccept: async () => { throw new Error('Lost provider response'); } }), input = await f.inputFile(f.input), create = await f.success(['calendar-operation', 'enqueue', '--input', input]);
  assert.equal((await f.run(['calendar-operation', 'run-fixture', create.id])).status, 8);
  const [link] = await f.success(['planning', 'review', f.task.taskId]);
  const deletion = await f.inputFile({ action: 'calendar.delete', taskId: f.task.taskId, requestId: crypto.randomUUID(), etag: link.confirmed.etag }), queued = await f.success(['calendar-operation', 'enqueue', '--input', deletion]);
  assert.equal((await f.run(['calendar-operation', 'run-fixture', queued.id])).status, 8);
  f.fault('lost'); assert.equal((await f.run(['planning', 'review', f.task.taskId])).status, 8);
  const receipt = await f.success(['planning', 'review-receipt', f.task.taskId, queued.id]); assert.equal(receipt.relationship, 'removed'); assert.equal(receipt.eventId, queued.eventId);
  assert.deepEqual(await f.success(['planning', 'list']), []); assert.equal((await f.success(['calendar-operation', 'show', queued.id])).state, 'unknown');
  assert.equal((await f.run(['calendar-operation', 'run-fixture', queued.id])).status, 8); assert.equal(f.state().attempts.length, 2);
  const next = await f.inputFile({ ...f.input, requestId: crypto.randomUUID() }); assert.equal((await f.success(['calendar-operation', 'enqueue', '--input', next])).state, 'queued');
  assert.deepEqual(f.failures, []);
});
