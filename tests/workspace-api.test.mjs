import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceApi } from '../server/workspace-api.ts';
import { createWorkspaceEngine } from '../shared/workspace-engine.ts';
import { GET, POST } from '../app/api/workspace/[...path]/route.ts';

test('web fixture proxy is disabled by default and only forwards bounded loopback requests to the fixed local service', async () => {
  const originalFetch = globalThis.fetch;
  const request = (origin = 'http://localhost:3000', body) => new Request(`${origin}/api/workspace/${body ? 'commands' : 'snapshot'}`, {
    method: body ? 'POST' : 'GET', headers: { 'x-openjob-fixture-owner': 'demo_alex', 'content-type': 'application/json', authorization: 'must-not-forward' }, ...(body ? { body } : {}),
  });
  assert.equal((await GET(request())).status, 503);
  globalThis.__OPENJOB_WORKSPACE_FIXTURE__ = true;
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return Response.json({ data: { fixture: true } }); };
  try {
    assert.equal((await GET(request('https://example.invalid'))).status, 403);
    assert.equal((await POST(request('http://localhost:3000', 'x'.repeat(33000)))).status, 413);
    assert.equal(calls.length, 0);
    const response = await GET(request());
    assert.equal(response.status, 200);
    assert.equal(calls[0][0], 'http://127.0.0.1:4180/api/workspace/snapshot');
    assert.equal(calls[0][1].headers.get('x-openjob-fixture-owner'), 'demo_alex');
    assert.equal(calls[0][1].headers.has('authorization'), false);
    assert.equal(calls[0][1].redirect, 'error');
  } finally { globalThis.fetch = originalFetch; delete globalThis.__OPENJOB_WORKSPACE_FIXTURE__; }
});

test('fixture HTTP boundary requires explicit loopback identity, valid bounded JSON and same origin', async () => {
  const engine = createWorkspaceEngine();
  const api = createWorkspaceApi({ engine, enabled: true });
  const request = (path = '/snapshot', options = {}) => new Request(`http://127.0.0.1:4180/api/workspace${path}`, { headers: { 'x-openjob-fixture-owner': 'demo_alex', 'content-type': 'application/json', ...options.headers }, ...options });
  assert.equal((await createWorkspaceApi({ engine })(request())).status, 503);
  assert.equal((await api(new Request('https://example.invalid/api/workspace/snapshot', { headers: { 'x-openjob-fixture-owner': 'demo_alex' } }))).status, 403);
  assert.equal((await api(new Request('http://127.0.0.1:4180/api/workspace/snapshot'))).status, 401);
  assert.equal((await api(request('/snapshot', { headers: { 'x-openjob-fixture-owner': 'demo_alex', origin: 'https://example.invalid' } }))).status, 403);
  const view = await api(request());
  assert.equal(view.headers.get('cache-control'), 'no-store');
  assert.equal(view.headers.has('access-control-allow-origin'), false);
  const data = (await view.json()).data;
  assert.equal(data.accounts.length, 3);
  assert.equal(JSON.stringify(data).includes('sam_msg_private'), false);
  for (const [body, expected] of [['{', 400], [JSON.stringify({ type: 'task.create', title: 'x'.repeat(33000) }), 413], [JSON.stringify({ type: 'task.create', title: 'private', messageId: 'sam_msg_private' }), 403], [JSON.stringify({ type: 'mail.send', draftId: 'fixture' }), 403]]) {
    const response = await api(request('/commands', { method: 'POST', body }));
    assert.equal(response.status, expected, await response.text());
  }
  assert.equal(engine.exportState().tasks.length, 2, 'denied requests do not create tasks');
  assert.equal((await api(request('/commands', { method: 'POST', headers: { 'x-openjob-fixture-owner': 'demo_alex', 'content-type': 'text/plain' }, body: '{}' }))).status, 415);
});

test('fixture API grants resource-limited simulated access and revocation takes effect immediately', async () => {
  const api = createWorkspaceApi({ engine: createWorkspaceEngine(), enabled: true });
  const call = (command, agent) => api(new Request(`http://localhost/api/workspace/${command ? 'commands' : 'snapshot'}`, {
    method: command ? 'POST' : 'GET', headers: { 'x-openjob-fixture-owner': 'demo_alex', 'content-type': 'application/json', ...(agent ? { 'x-openjob-fixture-agent': agent } : {}) },
    ...(command ? { body: JSON.stringify(command) } : {}),
  }));
  const issued = await call({ type: 'agent.grant', name: 'Inbox reader', scopes: ['mail:read'], resourceIds: ['alex_gmail'] });
  assert.equal(issued.status, 200);
  const agent = (await issued.json()).data;
  const delegated = (await (await call(null, agent.id)).json()).data;
  assert.deepEqual(delegated.accounts.map(item => item.id), ['alex_gmail']);
  assert.equal(delegated.tasks.length, 0);
  assert.equal((await call({ type: 'mail.read', messageId: 'alex_msg_design', read: true }, agent.id)).status, 403);
  assert.equal((await call({ type: 'agent.revoke', agentId: agent.id })).status, 200);
  assert.equal((await call(null, agent.id)).status, 401);
});
