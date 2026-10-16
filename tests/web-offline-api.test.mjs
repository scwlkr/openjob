import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

test('web sync client verifies current owner, enforces strict private DTOs and preserves safe failures', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-web-sync-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await build({ configFile: false, logLevel: 'silent', build: { ssr: resolve('app/workspace/personal-workspace-api.ts'), outDir: directory, minify: false, rollupOptions: { output: { entryFileNames: 'client.mjs' } } } });
  const { createPersonalWorkspaceClient } = await import(pathToFileURL(join(directory, 'client.mjs')).href);
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const owner = 'user_alex', revision = `tc1_${'a'.repeat(64)}`;
  const projection = { tasks: [], calendars: [{ id: 'personal', ownerId: owner, name: 'Personal', color: '#2454dc' }], events: [] };
  const input = { operationId: '00000000-0000-4000-8000-000000000001', baseRevision: revision, expiresAt: '2026-10-18T00:00:00.000Z', projection };
  const calls = []; let meOwner = owner, reply = { revision, projection }, status = 200;
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify(path === '/api/v1/me' ? { data: { userId: meOwner, username: null, usernameRequired: true } } : status === 200 ? { data: reply } : { error: { code: reply.code, message: 'PRIVATE UPSTREAM ERROR' } }), { status: path === '/api/v1/me' ? 200 : status });
  };
  const client = createPersonalWorkspaceClient(), session = { signInMethod: 'google', getIdToken: async () => 'synthetic-token' }, signal = new AbortController().signal;
  assert.deepEqual(await client.readTaskCalendarSync(session, owner, signal), { revision, projection });
  assert.deepEqual(calls.map(call => call.path), ['/api/v1/me', '/api/v1/workspace/task-calendar-sync']);
  reply = { operationId: input.operationId, revision };
  assert.deepEqual(await client.syncTaskCalendar(session, owner, input, signal), reply);
  assert.equal(calls.at(-1).options.method, 'POST'); assert.deepEqual(JSON.parse(calls.at(-1).options.body), input);
  assert.equal(calls.at(-1).options.cache, 'no-store'); assert.equal(calls.at(-1).options.redirect, 'error');
  meOwner = 'user_sam'; const before = calls.length;
  await assert.rejects(client.syncTaskCalendar(session, owner, input, signal), error => error.status === 401 && error.code === 'authentication_required');
  assert.equal(calls.length, before + 1); meOwner = owner;
  const invalid = { ...input, projection: { ...projection, messages: [{ body: 'never cache' }] } };
  await assert.rejects(client.syncTaskCalendar(session, owner, invalid, signal), error => error.code === 'invalid_input');
  reply = { operationId: 'other', revision }; await assert.rejects(client.syncTaskCalendar(session, owner, input, signal), error => error.code === 'invalid_response');
  reply = { revision, projection: { ...projection, tasks: [{ id: 'task_private', ownerId: owner, title: 'Task', completed: false, sourceMessageId: 'private-mail' }] } };
  await assert.rejects(client.readTaskCalendarSync(session, owner, signal), error => error.code === 'invalid_response');
  for (const [http, code] of [[409, 'conflict'], [409, 'sync_expired'], [413, 'workspace_capacity'], [401, 'authentication_required'], [410, 'account_deletion_pending'], [500, 'sensitive_untrusted_code']]) {
    status = http; reply = { code };
    await assert.rejects(client.syncTaskCalendar(session, owner, input, signal), error => error.status === http && error.code === (http === 500 ? 'request_failed' : code) && !error.message.includes('PRIVATE'));
  }
  status = 200; reply = { operationId: input.operationId, revision };
  const abort = new AbortController(); let tokenRequests = 0;
  const deferredSession = { signInMethod: 'google', async getIdToken() { tokenRequests++; if (tokenRequests === 2) abort.abort(); return 'synthetic'; } };
  const prior = calls.length; await assert.rejects(client.syncTaskCalendar(deferredSession, owner, input, abort.signal), { name: 'AbortError' });
  assert.equal(calls.length, prior + 1, 'aborted identity lease never posts after /me');
  for (const status of [401, 410]) {
    globalThis.fetch = async () => new Response('not a JSON envelope', { status });
    await assert.rejects(client.me(session, signal), error => error.status === status && error.code === (status === 401 ? 'authentication_required' : 'account_deletion_pending'));
  }
});
