import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createEmptyPersonalWorkspace, applyPersonalWorkspaceCommand } from '../shared/personal-workspace.ts';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';

async function harness(t) {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-personal-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credential = join(directory, 'human-credential');
  await writeFile(credential, 'fixture-refresh-a', { mode: 0o600 });
  const now = '2026-07-15T12:00:00.000Z';
  const authority = await createTestFirebaseAuthority({ now });
  const tokens = { a: await authority.issue({ uid: 'firebase_a' }), b: await authority.issue({ uid: 'firebase_b' }) };
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', now: () => Date.parse(now), fetchImplementation: authority.fetch });
  const records = new Map();
  const workspace = {
    async snapshot(owner) { return records.has(owner) ? JSON.parse(records.get(owner)) : createEmptyPersonalWorkspace(owner); },
    async command(owner, input) {
      const next = applyPersonalWorkspaceCommand(owner, await this.snapshot(owner), input);
      records.set(owner, JSON.stringify(next.state)); return next.result;
    },
    async removeAllForUser(owner) { return Number(records.delete(owner)); },
  };
  const options = { workspace, verifyIdToken, users: { async resolve(identity) { return { userId: identity.uid === 'firebase_a' ? 'usr_a' : 'usr_b', username: null }; } } };
  let api = createV1PersonalWorkspaceApi(options);
  const validate = await createOpenApiResponseValidator();
  const calls = [], failures = [];
  let outage = false;
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      if (req.url === '/firebase/token?key=fixture') {
        const account = new URLSearchParams(body).get('refresh_token') === 'fixture-refresh-b' ? 'b' : 'a';
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id_token: tokens[account], refresh_token: `fixture-refresh-${account}` })); return;
      }
      calls.push({ method: req.method, path: req.url, headers: req.headers });
      if (outage && req.method === 'POST') {
        res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'fixture_outage', message: 'Isolated outage.', requestId: 'req_outage' } })); return;
      }
      const request = new Request(`http://fixture.invalid${req.url}`, { method: req.method, headers: req.headers, ...(body ? { body } : {}) });
      const response = await api.fetch(request);
      await validate(response.clone(), req.url, req.method.toLowerCase());
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) { failures.push(error); res.writeHead(500); res.end('Fixture failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = (args, input) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', ...args], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr })); child.stdin.end(input);
  });
  return { directory, run, calls, failures, records, reload() { api = createV1PersonalWorkspaceApi(options); }, outage(value) { outage = value; }, async owner(account) { await writeFile(credential, `fixture-refresh-${account}`, { mode: 0o600 }); } };
}

test('existing human CLI shares authenticated personal Task/Calendar workflow and output contracts', async t => {
  const f = await harness(t);
  const command = async input => {
    const result = await f.run(['workspace', 'command', '--input', '-', '--format', 'json'], JSON.stringify(input));
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).data;
  };
  const task = await command({ type: 'task.create', title: 'Existing CLI personal task' });
  assert.equal(task.ownerId, 'usr_a');
  const scheduled = await command({ type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-07-15T15:00:00Z', end: '2026-07-15T15:30:00Z' });
  const input = join(f.directory, 'edit.json');
  await writeFile(input, JSON.stringify({ type: 'task.update', taskId: task.id, title: 'Shared edited title' }));
  const edited = await f.run(['workspace', 'command', '--input', input, '--format', 'json']);
  assert.equal(edited.status, 0, edited.stderr);
  await command({ type: 'task.complete', taskId: task.id, completed: true });
  const event = await command({ type: 'calendar.create', calendarId: 'personal', title: 'Standalone block', start: '2026-07-15T16:00:00Z', end: '2026-07-15T16:30:00Z' });
  await command({ type: 'calendar.update', eventId: event.id, title: 'Edited block', start: '2026-07-15T17:00:00Z', end: '2026-07-15T17:30:00Z' });
  await command({ type: 'calendar.delete', eventId: event.id });
  f.reload();
  const output = join(f.directory, 'snapshot.json');
  const snapshot = await f.run(['workspace', 'snapshot', '--format', 'json', '--out', output]);
  assert.equal(snapshot.status, 0, snapshot.stderr); assert.equal(snapshot.stdout, '');
  const saved = JSON.parse(await readFile(output, 'utf8')).data;
  assert.equal(saved.tasks[0].title, 'Shared edited title'); assert.equal(saved.tasks[0].completed, true);
  assert.equal(saved.events[0].id, scheduled.calendarEventId); assert.equal(saved.events[0].title, 'Shared edited title');
  assert.deepEqual(saved.messages, []); assert.deepEqual(saved.agents, []);
  await f.owner('b');
  const b = await f.run(['workspace', 'snapshot', '--format', 'json']);
  assert.equal(b.status, 0, b.stderr); assert.deepEqual(JSON.parse(b.stdout).data.tasks, []);
  const foreign = await f.run(['workspace', 'command', '--input', '-'], JSON.stringify({ type: 'task.delete', taskId: task.id }));
  assert.notEqual(foreign.status, 0); assert.match(foreign.stderr, /forbidden/);
  await f.owner('a');
  await command({ type: 'task.unschedule', taskId: task.id });
  await command({ type: 'task.delete', taskId: task.id });
  assert.equal(JSON.parse(f.records.get('usr_a')).tasks.length, 0);
  assert.equal(JSON.parse(f.records.get('usr_a')).events.length, 0);
  for (const call of f.calls) {
    assert.equal(call.headers['x-openjob-fixture-owner'], undefined);
    assert.equal(call.headers['x-openjob-fixture-agent'], undefined);
    assert.match(call.headers.authorization, /^Bearer ey/);
  }
  assert.deepEqual(f.failures, []);
});

test('personal CLI fails closed on fixture/agent inputs and does not retry uncertain mutations', async t => {
  const f = await harness(t);
  for (const args of [
    ['workspace', 'snapshot', '--agent-token-file', '/absent'], ['workspace', 'snapshot', '--group', 'grp_fixture'],
    ['workspace', 'command'], ['workspace', 'snapshot', '--url', 'http://127.0.0.1:4180'],
  ]) { const result = await f.run(args); assert.equal(result.status, 2, result.stderr); }
  for (const input of [
    { type: 'task.create', title: 'No owner override', ownerId: 'usr_b' },
    { type: 'task.create', title: 'No arbitrary source field', sourceMessageId: 'alex_msg_launch' },
    { type: 'task.complete', taskId: 'x', completed: 'true' }, { type: 'task.create', title: '' },
    { type: 'mail.compose', accountId: 'x', to: 'x@example.invalid', subject: 'No credential field', body: 'Local only', credential: 'private' }, { type: 'agent.grant', name: 'No secret' },
  ]) {
    const result = await f.run(['workspace', 'command', '--input', '-'], JSON.stringify(input));
    assert.equal(result.status, 2, result.stderr);
  }
  assert.equal(f.calls.length, 0);
  f.outage(true);
  const failed = await f.run(['workspace', 'command', '--input', '-'], JSON.stringify({ type: 'task.create', title: 'Uncertain fixture task' }));
  assert.notEqual(failed.status, 0); assert.equal(failed.stdout, ''); assert.match(failed.stderr, /fixture_outage/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.deepEqual(f.failures, []);
});

test('existing CLI performs the invented Mail to Task to Calendar and Simulated Sent workflow', async t => {
  const f = await harness(t);
  const call = input => f.run(['workspace', 'command', '--input', '-', '--format', 'json'], JSON.stringify(input));
  const ok = async input => { const response = await call(input); assert.equal(response.status, 0, response.stderr); return JSON.parse(response.stdout).data; };
  const seeded = await ok({ type: 'mail.examples.add' }); assert.equal(seeded.added, true);
  const messageId = seeded.messageIds[0];
  await ok({ type: 'mail.read', messageId, read: true });
  const task = await ok({ type: 'task.create', title: 'CLI invented mail follow-up', messageId });
  await ok({ type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-07-15T15:00:00Z', end: '2026-07-15T15:30:00Z' });
  await ok({ type: 'task.complete', taskId: task.id, completed: true });
  const reply = await ok({ type: 'mail.draft', messageId, body: 'Reply through existing CLI, local only.' });
  const edited = await ok({ type: 'mail.draft.update', draftId: reply.id, to: 'reader@example.com', subject: 'CLI edited reply', body: 'Updated draft.' });
  assert.equal(edited.id, reply.id); assert.equal(edited.accountId, seeded.accountIds[0]);
  assert.equal((await ok({ type: 'mail.examples.add' })).added, false);
  const persistedBefore = f.records.get('usr_a');
  const denied = await call({ type: 'mail.send', draftId: reply.id }); assert.notEqual(denied.status, 0); assert.match(denied.stderr, /sending_disabled/);
  assert.equal(f.records.get('usr_a'), persistedBefore);
  const sent = await ok({ type: 'mail.simulate-send', draftId: reply.id });
  assert.equal(sent.mode, 'fixture'); assert.equal(sent.from, 'alex.personal@example.invalid'); assert.equal(sent.to, edited.to);
  const composed = await ok({ type: 'mail.compose', accountId: seeded.accountIds[2], to: 'review@example.invalid', subject: 'CLI compose', body: 'Invented only.' });
  assert.equal(composed.accountId, seeded.accountIds[2]);
  f.reload();
  const read = await f.run(['workspace', 'snapshot', '--format', 'json']); assert.equal(read.status, 0, read.stderr);
  const view = JSON.parse(read.stdout).data;
  assert.equal(view.tasks.find(item => item.id === task.id).completed, true); assert.equal(view.events.some(item => item.taskId === task.id), true);
  assert.equal(view.messages.find(item => item.id === messageId).read, true); assert.equal(view.sent[0].id, sent.id); assert.equal(view.drafts[0].id, composed.id);
  await f.owner('b'); const foreign = await call({ type: 'mail.simulate-send', draftId: composed.id }); assert.notEqual(foreign.status, 0); assert.match(foreign.stderr, /forbidden/);
  assert.deepEqual(f.failures, []);
});
