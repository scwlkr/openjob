import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rm, stat, symlink, access, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPersonalWorkspaceState } from '../scripts/personal-workspace-state.mjs';
import { validateLocalSnapshot } from '../scripts/personal-workspace-state-schema.mjs';
import { createFirestoreUserStore } from '../db/users.ts';
import { createPrivateKey } from './support/fake-firestore.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'openjob-304-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
async function seed(state) {
  const users = createFirestoreUserStore({ projectId: 'openjob-dev', clientEmail: 'local@example.invalid', privateKey: await createPrivateKey() }, state.firestore.fetch);
  for (const owner of ['alex', 'sam']) await users.create({ uid: `personal_browser_${owner}`, provider: 'google' });
}
async function start(path) {
  const installed = process.env.OPENJOB_STATE_TEST_BIN;
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(accept => reservation.close(accept));
  const command = installed ?? process.execPath;
  const args = installed ? ['app', '--port', String(port), '--state-file', path] : ['scripts/personal-workspace-test-server.mjs', '--test-only', '--port', '0', '--state-file', path];
  const child = spawn(command, args, { cwd: installed ? tmpdir() : root, env: { ...process.env, OPENJOB_NO_UPDATE_CHECK: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = once(child, 'exit'); let errors = ''; child.stderr.on('data', value => { errors += value; });
  const ready = await new Promise((accept, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Local fixture startup timed out.')); }, 15000);
    child.once('message', message => { clearTimeout(timer); accept(message); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(errors || 'Local fixture exited.')); });
    child.once('error', reject);
  });
  const url = `http://127.0.0.1:${ready.port}`;
  return { url, async stop() { child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); const [code] = await exited; clearTimeout(timer); assert.equal(code, 0); },
    async session(owner) { return (await (await fetch(`${url}/__test/session/${owner}`)).json()); },
    async call(token, path = 'snapshot', input, { method = input ? 'POST' : 'GET', status = 200 } = {}) {
      const response = await fetch(`${url}/api/v1/workspace/${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) });
      assert.equal(response.status, status); return status === 204 ? null : (await response.json()).data;
    } };
}
test('real synthetic API restores linked Mail/Task/Calendar/draft and separate owners; revoked agents stay revoked', async t => {
  const path = join(await directory(t), 'workspace.json');
  let app = await start(path); t.after(() => app?.stop());
  const alex = await app.session('alex'), sam = await app.session('sam');
  const examples = await app.call(alex.token, 'commands', { type: 'mail.examples.add' });
  const task = await app.call(alex.token, 'commands', { type: 'task.create', title: 'Keep linked work', messageId: examples.messageIds[0] });
  await app.call(alex.token, 'commands', { type: 'task.schedule-available', taskId: task.id, calendarId: 'personal', start: '2027-04-06T09:00:00Z', end: '2027-04-06T09:30:00Z' });
  await app.call(alex.token, 'commands', { type: 'task.complete', taskId: task.id, completed: true });
  const draft = await app.call(alex.token, 'commands', { type: 'mail.draft', messageId: examples.messageIds[0], body: 'Saved invented reply' });
  await app.call(sam.token, 'commands', { type: 'task.create', title: 'Sam private task' });
  const grant = await app.call(alex.token, 'agent-grants', { name: 'Synthetic read-only agent', scopes: ['tasks:read'], resourceIds: ['tasks:personal'] }, { status: 201 });
  const before = await app.call(alex.token); const samBefore = await app.call(sam.token);
  const encoded = await readFile(path, 'utf8');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  for (const token of [alex.token, sam.token, grant.token]) assert.equal(encoded.includes(token), false);
  assert.doesNotMatch(encoded, /PRIVATE KEY|accessToken|refreshToken|privateKey/);
  await app.stop(); app = null;
  await assert.rejects(access(`${path}.lock`));
  app = await start(path);
  const restored = await app.session('alex'), restoredSam = await app.session('sam');
  assert.equal(restored.userId, alex.userId); assert.notEqual(restored.token, alex.token);
  const after = await app.call(restored.token);
  assert.deepEqual(after, before); assert.deepEqual(await app.call(restoredSam.token), samBefore);
  assert.ok(after.tasks.some(item => item.id === task.id && item.completed && item.calendarEventId && item.sourceMessageId));
  assert.ok(after.drafts.some(item => item.id === draft.id && item.body === 'Saved invented reply'));
  assert.ok((await app.call(grant.token)).tasks.some(item => item.id === task.id));
  await app.call(grant.token, 'commands', { type: 'task.create', title: 'Forbidden' }, { status: 403 });
  await app.call(restored.token, `agent-grants/${grant.agent.id}`, undefined, { method: 'DELETE', status: 204 });
  await app.call(restored.token, 'commands', { type: 'mail.send', draftId: draft.id }, { status: 403 });
  await app.stop(); app = null; app = await start(path);
  await app.call(grant.token, 'snapshot', undefined, { status: 401 });
});
test('single-writer lock, corrupt/unsupported files and symlinks fail without resetting saved bytes', async t => {
  const path = join(await directory(t), 'workspace.json');
  const state = await openPersonalWorkspaceState(path); await seed(state); await state.persist();
  const original = await readFile(path, 'utf8');
  await assert.rejects(openPersonalWorkspaceState(path), /locked/);
  await state.close();
  for (const bytes of ['{broken', JSON.stringify({ version: 99 })]) {
    await writeFile(path, bytes); await assert.rejects(openPersonalWorkspaceState(path), /original file preserved/);
    assert.equal(await readFile(path, 'utf8'), bytes); await assert.rejects(access(`${path}.lock`));
  }
  await writeFile(path, original);
  const alias = path + '.alias'; await symlink(path, alias);
  await assert.rejects(openPersonalWorkspaceState(alias), /original file preserved/);
  assert.equal(await readFile(path, 'utf8'), original);
});
test('failed durable save rolls back document/revision and queues reads until the result is known', async t => {
  const path = join(await directory(t), 'workspace.json');
  let saving = false, release, began;
  const begun = new Promise(accept => { began = accept; });
  const initial = await openPersonalWorkspaceState(path); await seed(initial); await initial.persist(); await initial.close();
  const originalBytes = await readFile(path, 'utf8');
  const state = await openPersonalWorkspaceState(path, { writeSnapshot: async () => { if (!saving) return; began(); await new Promise(accept => { release = accept; }); throw new Error('write failed'); } });
  const before = state.firestore.exportState(); saving = true;
  const write = state.execute(async () => { state.firestore.documents.delete(before.documents[0][0]); return Response.json({}); }, true);
  // Use a valid mutation so snapshot validation reaches the injected write failure.
  await assert.rejects(write);
  const record = before.documents[0][0];
  saving = true;
  const pending = state.execute(async () => { const doc = state.firestore.documents.get(record); doc.fields.createdAt = { timestampValue: '2026-10-16T12:00:00Z' }; return Response.json({}); }, true);
  await begun;
  let observed = false; const read = state.execute(async () => { observed = true; return Response.json({}); });
  await new Promise(accept => setImmediate(accept)); assert.equal(observed, false); release();
  await assert.rejects(pending, /write failed/); await read;
  assert.deepEqual(state.firestore.exportState(), before); assert.equal(await readFile(path, 'utf8'), originalBytes); await state.close();
});
test('uncertain post-rename durability pauses reads/writes instead of pretending to roll back disk', async t => {
  const path = join(await directory(t), 'workspace.json');
  const state = await openPersonalWorkspaceState(path, { writeSnapshot: async () => { throw Object.assign(new Error('uncertain'), { uncertain: true }); } });
  await seed(state); await assert.rejects(state.execute(async () => Response.json({}), true), /uncertain/);
  await assert.rejects(state.execute(async () => Response.json({})), /unavailable/); await state.close();
});
test('schema rejects unrelated identities, secret-bearing fields, paths and extra state', async t => {
  const state = await openPersonalWorkspaceState(join(await directory(t), 'workspace.json')); await seed(state); await state.persist();
  const valid = JSON.parse(await readFile(state.filePath, 'utf8'));
  for (const mutate of [value => { value.secret = 'not allowed'; }, value => { value.documents[0][1].fields.privateKey = { stringValue: 'not allowed' }; }, value => { value.documents[0][0] += '/extra'; }, value => { value.revision = -1; }]) {
    const next = structuredClone(valid); mutate(next); assert.throws(() => validateLocalSnapshot(next));
  }
  await state.close();
});

test('stale lock recovery copies valid work without removing the original lock or data', async t => {
  const path = join(await directory(t), 'workspace.json');
  const state = await openPersonalWorkspaceState(path); await seed(state); await state.persist(); await state.close();
  const bytes = await readFile(path, 'utf8'); await writeFile(`${path}.lock`, 'stale synthetic test lock');
  await assert.rejects(openPersonalWorkspaceState(path), /copy the state to a fresh path/);
  const copy = path + '.recovered'; await copyFile(path, copy); const recovered = await openPersonalWorkspaceState(copy); await recovered.close();
  assert.equal(await readFile(path, 'utf8'), bytes); assert.equal(await readFile(`${path}.lock`, 'utf8'), 'stale synthetic test lock');
});

test('cancellation after state lock acquisition drains startup and releases the owned lock', async t => {
  const path = join(await directory(t), 'cancelled.json');
  const installed = process.env.OPENJOB_STATE_TEST_BIN;
  const child = spawn(installed ?? process.execPath, installed
    ? ['app', '--port', '5199', '--state-file', path]
    : ['scripts/personal-workspace-test-server.mjs', '--test-only', '--port', '0', '--state-file', path],
    { cwd: installed ? tmpdir() : root, env: { ...process.env, OPENJOB_NO_UPDATE_CHECK: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = once(child, 'exit'); let ready = false, errors = '';
  child.on('message', () => { ready = true; }); child.stderr.on('data', data => { errors += data; });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const deadline = Date.now() + 10000;
  while (true) {
    try { await access(`${path}.lock`); break; } catch {}
    assert.equal(child.exitCode, null, errors); assert.ok(Date.now() < deadline, 'lock acquisition timed out');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.equal(ready, false, 'cancel while initialization is still in progress');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  const [code, signal] = await exited; clearTimeout(timer);
  assert.equal(code, 0, errors); assert.equal(signal, null);
  await assert.rejects(access(`${path}.lock`));
  const app = await start(path); await app.stop();
});
