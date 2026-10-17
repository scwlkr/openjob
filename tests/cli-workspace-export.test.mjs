import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createEmptyPersonalWorkspace, applyPersonalWorkspaceCommand } from '../shared/personal-workspace.ts';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-export-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credential = join(directory, 'human-credential');
  await writeFile(credential, 'fixture-export-refresh', { mode: 0o600 });
  const now = '2026-07-15T12:00:00.000Z';
  const authority = await createTestFirebaseAuthority({ now });
  const token = await authority.issue({ uid: 'firebase_export' });
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', now: () => Date.parse(now), fetchImplementation: authority.fetch });
  const owner = 'usr_export';
  let state = createEmptyPersonalWorkspace(owner);
  const command = input => { const next = applyPersonalWorkspaceCommand(owner, state, input); state = next.state; return next.result; };
  const api = createV1PersonalWorkspaceApi({
    workspace: { async snapshot(id) { assert.equal(id, owner); return structuredClone(state); } },
    verifyIdToken, users: { async resolve() { return { userId: owner, username: null }; } },
  });
  const calls = [], failures = [];
  let alter = value => value;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/firebase/token?key=fixture') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id_token: token, refresh_token: 'fixture-export-refresh' })); return;
      }
      calls.push({ url: req.url, method: req.method });
      const response = await api.fetch(new Request(`http://fixture.invalid${req.url}`, { method: req.method, headers: req.headers }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(JSON.stringify(alter(await response.json())));
    } catch (error) { failures.push(error); res.writeHead(500); res.end('Isolated fixture failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', ...args], {
      env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: `${base}/api/v1`, OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
  return { directory, calls, failures, command, run, alter(value) { alter = value; } };
}

test('human CLI exports explicit saved sections to private files without leaking authored contents', async t => {
  const f = await fixture(t);
  f.command({ type: 'mail.examples.add' });
  const task = f.command({ type: 'task.create', title: 'Private export task', messageId: 'example-message-1' });
  f.command({ type: 'task.notes', taskId: task.id, notes: '  Authored export context 📝\n' });
  f.command({ type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-10-17T10:00:00Z', end: '2026-10-17T10:30:00Z' });
  f.command({ type: 'mail.draft', messageId: 'example-message-1', body: 'Private exported reply' });
  const file = join(f.directory, 'selected.json');
  const args = ['workspace', 'export', '--sections', 'calendar,tasks', '--file', file, '--format', 'json'];
  const result = await f.run(args); assert.equal(result.status, 0, result.stderr + f.failures.map(e => e.stack).join('\n'));
  const bytes = await readFile(file, 'utf8'), exported = JSON.parse(bytes);
  assert.deepEqual(exported.sections, ['tasks', 'calendar']);
  assert.equal(exported.tasks[0].notes, '  Authored export context 📝\n');
  assert.equal(exported.events[0].taskId, exported.tasks[0].id); assert.deepEqual(exported.drafts, []);
  assert.equal(bytes, JSON.stringify(exported, null, 2) + '\n'); assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(result.stdout).data, { file, sections: ['tasks', 'calendar'] });
  assert.doesNotMatch(result.stdout + result.stderr, /Private export|Authored export|Private exported|fixture-export-refresh|sourceMessageId/);
  assert.equal(f.calls.at(-1).url, '/api/v1/workspace/export?section=tasks&section=calendar');
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.doesNotMatch(bytes, /sourceMessageId|sourceAccountId|example-message-1|refresh_token/);
  const count = f.calls.length; assert.equal((await f.run(args)).status, 2); assert.equal(f.calls.length, count); assert.equal(await readFile(file, 'utf8'), bytes);
  const drafts = join(f.directory, 'drafts.json');
  const reply = await f.run(['workspace', 'export', '--sections', 'drafts', '--file', drafts, '--format', 'json']); assert.equal(reply.status, 0, reply.stderr);
  const saved = JSON.parse(await readFile(drafts, 'utf8')); assert.deepEqual(saved.tasks, []); assert.deepEqual(saved.events, []); assert.equal(saved.drafts[0].body, 'Private exported reply');
  assert.doesNotMatch(reply.stdout + reply.stderr, /Private exported reply/);
});

test('CLI rejects agent credentials, ambiguous selections, stdout and invalid export responses without files', async t => {
  const f = await fixture(t), file = join(f.directory, 'rejected.json');
  const base = ['workspace', 'export', '--sections', 'tasks', '--file', file];
  for (const args of [
    [...base, '--agent-token-file', 'unused'], [...base, '--force'], [...base, '--out', '-'],
    ['workspace', 'export', '--sections', 'tasks,tasks', '--file', file],
    ['workspace', 'export', '--sections', 'tasks,unknown', '--file', file],
    ['workspace', 'export', '--sections', '', '--file', file],
    ['workspace', 'export', '--sections', 'tasks', '--file', '-'],
  ]) assert.equal((await f.run(args)).status, 2);
  assert.equal(f.calls.length, 0);
  f.alter(value => ({ data: { ...value.data, sections: ['calendar'] } }));
  const wrongSections = await f.run(base); assert.equal(wrongSections.status, 8, wrongSections.stderr);
  await assert.rejects(access(file));
  f.alter(value => ({ data: { ...value.data, unexpectedSecret: 'must-not-print' } }));
  const malformed = await f.run(base); assert.equal(malformed.status, 8, malformed.stderr); assert.doesNotMatch(malformed.stdout + malformed.stderr, /must-not-print/);
  await assert.rejects(access(file)); assert.deepEqual(f.failures, []);
});
