import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, stat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createFirestoreUserStore } from '../db/users.ts';
import { previewCalendarIcalImport, parseCalendarIcal } from '../shared/calendar-ical.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';
const execFileAsync = promisify(execFile);
const calendarFile = (uid = 'calendar-fixture-1', title = 'Imported planning') => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fixture//EN', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261017T090000Z', 'DTSTART:20261017T140000Z', 'DTEND:20261017T143000Z', `SUMMARY:${title}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
async function harness(t) {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-calendar-cli-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const now = new Date().toISOString();
  const authority = await createTestFirebaseAuthority({ now });
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', now: () => Date.parse(now), fetchImplementation: authority.fetch });
  const db = createFakeFirestore(), config = { projectId: 'openjob-dev', clientEmail: 'calendar-fixture@example.invalid', privateKey: await createPrivateKey() };
  const users = createFirestoreUserStore(config, db.fetch), workspace = createFirestorePersonalWorkspaceStore(config, db.fetch);
  const owners = {}, tokens = {};
  for (const account of ['alex', 'sam']) {
    tokens[account] = await authority.issue({ uid: `calendar_${account}` });
    const identity = await verifyIdToken(new Request('https://fixture.invalid', { headers: { authorization: `Bearer ${tokens[account]}` } }));
    owners[account] = (await users.create(identity)).user.userId;
  }
  const api = createV1PersonalWorkspaceApi({ workspace, users, verifyIdToken });
  const validate = await createOpenApiResponseValidator(); const calls = [], failures = [];
  let lostImport = false, raceImport = false;
  const request = async (path, { token = tokens.alex, input } = {}) => {
    const response = await api.fetch(new Request(`http://fixture.invalid/api/v1/workspace/${path}`, { method: input ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) }));
    return response;
  };
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const part of req) body += part;
      if (req.url === '/firebase/token?key=fixture') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id_token: tokens.alex, refresh_token: 'fixture-calendar-refresh' })); return; }
      calls.push({ path: req.url, method: req.method, body });
      if (raceImport && req.method === 'POST') { raceImport = false; await workspace.command(owners.alex, { type: 'calendar.create', calendarId: 'personal', title: 'Concurrent server edit', start: '2026-10-18T10:00:00Z', end: '2026-10-18T10:30:00Z' }); }
      const response = await api.fetch(new Request(`http://fixture.invalid${req.url}`, { method: req.method, headers: req.headers, ...(body ? { body } : {}) }));
      await validate(response.clone(), new URL(req.url, 'http://fixture.invalid').pathname, req.method.toLowerCase());
      if (lostImport && req.method === 'POST' && body.includes('calendar.import') && response.ok) { lostImport = false; res.destroy(); return; }
      const result = await response.text(); calls.at(-1).response = result;
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(result);
    } catch (error) { failures.push(error); res.writeHead(500); res.end('Isolated fixture failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, credential = join(directory, 'human-credential'); await writeFile(credential, 'fixture-calendar-refresh', { mode: 0o600 });
  const run = (args, input, entry = 'cli/openjob.mjs') => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: `${base}/api/v1`, OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; }); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr })); child.stdin.end(input);
  });
  return { directory, workspace, owners, tokens, request, run, calls, failures, loseImport() { lostImport = true; }, raceImport() { raceImport = true; } };
}

test('calendar export API uses signed ownership, read scope, redaction and immediate agent revocation', async t => {
  const f = await harness(t), owner = f.owners.alex;
  await f.workspace.command(owner, { type: 'mail.examples.add' });
  const task = await f.workspace.command(owner, { type: 'task.create', title: 'Private linked task', messageId: 'example-message-1' });
  await f.workspace.command(owner, { type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-10-17T15:00:00Z', end: '2026-10-17T15:30:00Z' });
  const read = await f.workspace.createAgent(owner, { name: 'Calendar reader', scopes: ['calendar:read'], resourceIds: ['calendar:personal'] });
  const response = await f.request('calendar-export?calendarId=personal', { token: read.token }); assert.equal(response.status, 200, await response.clone().text());
  const exported = (await response.json()).data; assert.equal(exported.contentType, 'text/calendar; charset=utf-8'); assert.equal(parseCalendarIcal(exported.ical)[0].title, 'Private linked task');
  for (const secret of ['example-message-1', 'mail:example', task.id, owner, 'sourceMessageId', 'ATTENDEE', 'DESCRIPTION', 'URL:']) assert.ok(!exported.ical.includes(secret), secret);
  const taskOnly = await f.workspace.createAgent(owner, { name: 'Task only', scopes: ['tasks:read'], resourceIds: ['tasks:personal'] });
  assert.equal((await f.request('calendar-export?calendarId=personal', { token: taskOnly.token })).status, 403);
  assert.equal((await f.request('calendar-export?calendarId=foreign')).status, 403);
  for (const query of ['', '?calendarId=personal&calendarId=personal', '?calendarId=personal&owner=other']) assert.equal((await f.request(`calendar-export${query}`)).status, 400);
  assert.equal(parseCalendarIcal((await (await f.request('calendar-export?calendarId=personal', { token: f.tokens.sam })).json()).data.ical).length, 0);
  const preview = await previewCalendarIcalImport(await f.workspace.snapshot(owner), 'personal', calendarFile());
  const input = { type: 'calendar.import', calendarId: 'personal', ical: calendarFile(), expectedRevision: preview.expectedRevision };
  assert.equal((await f.request('commands', { token: read.token, input })).status, 403);
  const writeOnly = await f.workspace.createAgent(owner, { name: 'Write only', scopes: ['calendar:write'], resourceIds: ['calendar:personal'] });
  assert.equal((await f.request('commands', { token: writeOnly.token, input })).status, 403);
  assert.equal((await f.request('commands', { token: f.tokens.sam, input })).status, 409);
  assert.equal((await f.workspace.snapshot(f.owners.sam)).events.length, 0);
  const writer = await f.workspace.createAgent(owner, { name: 'Calendar writer', scopes: ['calendar:read', 'calendar:write'], resourceIds: ['calendar:personal'] });
  assert.equal((await f.request('commands', { token: writer.token, input })).status, 200);
  const saved = await f.workspace.snapshot(owner);
  const revision = (await previewCalendarIcalImport(saved, 'personal', calendarFile())).expectedRevision;
  for (const [command, status, code] of [
    [{ ...input, ical: calendarFile().replace('DTSTART:', 'DTSTART;TZID=Europe/London:') }, 400, 'calendar_ical_unsupported'],
    [{ ...input, ownerUserId: f.owners.sam }, 400, 'invalid_request'],
    [{ ...input, ical: calendarFile('calendar-fixture-1', 'Changed UID content'), expectedRevision: revision }, 409, 'calendar_import_conflict'],
    [{ ...input, ical: calendarFile('calendar-fixture-new') }, 409, 'conflict'],
  ]) {
    const rejected = await f.request('commands', { input: command }); assert.equal(rejected.status, status); assert.equal((await rejected.json()).error.code, code);
    assert.deepEqual(await f.workspace.snapshot(owner), saved, 'rejected API import is atomic');
  }
  await f.workspace.revokeAgent(owner, read.agent.id);
  assert.equal((await f.request('calendar-export?calendarId=personal', { token: read.token })).status, 401);
  await f.workspace.revokeAgent(owner, writer.agent.id);
  assert.equal((await f.request('commands', { token: writer.token, input })).status, 401);
});

test('existing and packed CLI preview/import/export exact private files without retries or unsupported mutations', async t => {
  const f = await harness(t), path = join(f.directory, 'calendar.ics'); await writeFile(path, calendarFile());
  const base = ['workspace', 'calendar', 'import', '--calendar', 'personal', '--file', path, '--format', 'json'];
  const preview = await f.run([...base, '--dry-run']); assert.equal(preview.status, 0, preview.stderr + f.failures.map(error => error.stack).join('\n')); assert.equal(JSON.parse(preview.stdout).data.events[0].title, 'Imported planning');
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  const noConfirmation = await f.run(base); assert.equal(noConfirmation.status, 2); assert.match(noConfirmation.stderr, /confirmation|--yes/); assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  const imported = await f.run([...base, '--yes']); assert.equal(imported.status, 0, imported.stderr); assert.equal(JSON.parse(imported.stdout).data.imported, 1);
  const duplicate = await f.run([...base, '--yes']); assert.equal(duplicate.status, 0, duplicate.stderr); assert.deepEqual([JSON.parse(duplicate.stdout).data.imported, JSON.parse(duplicate.stdout).data.skipped], [0, 1]);
  const output = join(f.directory, 'private-calendar.ics'); const exported = await f.run(['workspace', 'calendar', 'export', '--calendar', 'personal', '--file', output, '--format', 'json']); assert.equal(exported.status, 0, exported.stderr);
  const bytes = await readFile(output, 'utf8'); assert.equal(bytes.endsWith('\r\n'), true); assert.equal(parseCalendarIcal(bytes)[0].title, 'Imported planning'); assert.equal((await stat(output)).mode & 0o777, 0o600); assert.ok(!exported.stdout.includes('BEGIN:VCALENDAR'));
  assert.equal(bytes, JSON.parse(f.calls.findLast(call => call.path.includes('/calendar-export')).response).data.ical, 'export delivers the exact server UTF-8 file bytes');
  assert.equal((await f.run(['workspace', 'calendar', 'export', '--calendar', 'personal', '--file', output])).status, 2); assert.equal(await readFile(output, 'utf8'), bytes);
  assert.equal((await readdir(f.directory)).some(name => name.endsWith('.tmp')), false);
  for (const ical of [calendarFile().replace('DTSTART:', 'DTSTART;TZID=Europe/London:'), calendarFile().replace('SUMMARY:', 'RRULE:FREQ=DAILY\r\nSUMMARY:'), 'x'.repeat(16385), calendarFile().replace('20261017T140000Z', '20260230T140000Z')]) {
    await writeFile(path, ical); const before = f.calls.length; assert.equal((await f.run([...base, '--yes'])).status, 2); assert.equal(f.calls.length, before, 'malformed file rejected before HTTP');
  }
  await writeFile(path, calendarFile('calendar-fixture-1', 'Changed conflicting title')); assert.notEqual((await f.run([...base, '--yes'])).status, 0);
  await writeFile(path, calendarFile('calendar-fixture-2')); f.raceImport(); const raced = await f.run([...base, '--yes']); assert.notEqual(raced.status, 0); assert.match(raced.stderr, /conflict|changed/i);
  f.loseImport(); const before = f.calls.filter(call => call.method === 'POST').length; assert.notEqual((await f.run([...base, '--yes'])).status, 0); assert.equal(f.calls.filter(call => call.method === 'POST').length, before + 1, 'uncertain import never automatically retries');
  const retry = await f.run([...base, '--yes']); assert.equal(retry.status, 0, retry.stderr); assert.equal(JSON.parse(retry.stdout).data.skipped, 1);
  const { stdout } = await execFileAsync('npm', ['pack', './cli', '--cache', join(f.directory, 'npm-cache'), '--pack-destination', f.directory, '--json'], { cwd: process.cwd() }); const packed = JSON.parse(stdout)[0];
  await execFileAsync('tar', ['-xzf', join(f.directory, packed.filename), '-C', f.directory]);
  const packedRun = await f.run([...base, '--dry-run'], undefined, join(f.directory, 'package/openjob.mjs')); assert.equal(packedRun.status, 0, packedRun.stderr); assert.equal(JSON.parse(packedRun.stdout).data.events.length, 1);
  assert.deepEqual(f.failures, []);
});
