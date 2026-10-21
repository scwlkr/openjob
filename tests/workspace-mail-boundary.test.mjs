import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceMailCatalog } from '../shared/workspace-mail-catalog.ts';
import { requestConnections } from '../app/connections/connection-request.ts';
const a = 'wsp_' + '1'.repeat(32), b = 'wsp_' + '2'.repeat(32);
const connection = (digit, workspaceId) => ({ id: 'con_' + digit.repeat(32), workspaceId, address: digit + '@example.invalid', status: 'connected', expired: false });
const catalog = () => ({ mode: 'google-fixture', homes: [{ workspaceId: a, name: 'Work' }, { workspaceId: b, name: 'Family' }], bindings: [connection('3', a), connection('4', b)], mailAvailable: true });

test('Workspace Mail displays only its fixed-home connections and preserves empty/blocked status without examples', () => {
  const input = catalog(), result = workspaceMailCatalog(input, a);
  assert.deepEqual(result.bindings, [input.bindings[0]]); assert.equal(JSON.stringify(result).includes('4@example.invalid'), false);
  result.bindings[0].status = 'disconnected'; assert.equal(input.bindings[0].status, 'connected');
  input.bindings[0] = { ...input.bindings[0], status: 'reconnect_required', expired: true }; input.mailAvailable = false;
  assert.equal(workspaceMailCatalog(input, a).bindings[0].status, 'reconnect_required'); assert.equal(workspaceMailCatalog(input, a).mailAvailable, false);
  input.bindings = [input.bindings[1]]; assert.equal(workspaceMailCatalog(input, a).bindings.length, 0);
  assert.equal(workspaceMailCatalog({ mode: 'simulated' }, a), undefined);
  assert.throws(() => workspaceMailCatalog(input, 'wsp_' + '5'.repeat(32)));
});

test('malformed, duplicate and private credential-bearing catalog metadata fails closed', () => {
  for (const alter of [value => { value.bindings.push(value.bindings[0]); }, value => { value.bindings[0].id = '../foreign/mail'; }, value => { value.bindings[0].grant = { token: 'private' }; }, value => { value.bindings[0].expired = 'false'; }, value => { value.bindings[0].operation = 'send'; }, value => { value.homes = []; }]) {
    const value = catalog(); alter(value); assert.throws(() => workspaceMailCatalog(value, a));
  }
});

test('shared signed Connections request fences a changed session before dispatch and after response', async t => {
  const saved = globalThis.fetch; t.after(() => { globalThis.fetch = saved; }); let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ data: catalog() }); };
  const first = new AbortController(); await assert.rejects(requestConnections(async () => { first.abort(); return 'invented'; }, first.signal), { name: 'AbortError' }); assert.equal(calls, 0);
  const second = new AbortController(); globalThis.fetch = async () => { calls++; second.abort(); return Response.json({ data: catalog() }); };
  await assert.rejects(requestConnections(async () => 'invented', second.signal), { name: 'AbortError' }); assert.equal(calls, 1);
});

test('Connections request preserves only public failure codes, never provider errors or mutation retries', async t => {
  const saved = globalThis.fetch; t.after(() => { globalThis.fetch = saved; }); let calls = 0;
  globalThis.fetch = async (_url, options) => { calls++; assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); return Response.json({ error: { code: 'provider_forbidden', message: 'SECRET_PROVIDER_DETAIL' } }, { status: 403 }); };
  await assert.rejects(requestConnections(async () => 'invented', new AbortController().signal, '/con_fixture/tasks', { title: 'Reviewed work' }), error => error.code === 'provider_forbidden' && !JSON.stringify(error).includes('SECRET_PROVIDER_DETAIL')); assert.equal(calls, 1);
  globalThis.fetch = async () => Response.json({ error: { code: 'SECRET_UNKNOWN_CODE' } }, { status: 500 });
  await assert.rejects(requestConnections(async () => 'invented', new AbortController().signal), error => error.code === 'connection_unavailable' && !JSON.stringify(error).includes('SECRET_UNKNOWN_CODE'));
  globalThis.fetch = async () => Response.json({ another: 'invalid envelope' }); await assert.rejects(requestConnections(async () => 'invented', new AbortController().signal));
});
