import assert from 'node:assert/strict';
import test from 'node:test';
import { googleFlowFixture } from './support/google-connection-flow.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';

const route = id => `/${id}/mail/m1`;
test('configured metadata listing and Task creation read no body; explicit exact message read is authorized and transient', async () => {
  const f = await googleFlowFixture(), calls = [], validate = await createOpenApiResponseValidator();
  f.hooks.mail = url => { calls.push(url); };
  const start = await f.begin(); await f.complete(start);
  const summary = await f.call(`/${start.connectionId}/mail?view=metadata`);
  const message = summary.page.messages[0]; assert.equal(message.upstreamId, 'm1'); assert.equal(Object.hasOwn(message, 'body'), false); assert.equal(Object.hasOwn(message, 'snippet'), false);
  const task = await f.flow.createTask(f.owner, start.connectionId, { messageId: 'm1', title: 'Read only when requested' });
  assert.ok(calls.filter(url => url.pathname.endsWith('/messages/m1')).every(url => url.searchParams.get('format') === 'metadata'));
  calls.length = 0;
  const response = await f.request(route(start.connectionId)); assert.equal(response.status, 200);
  await validate(response.clone(), '/api/v1/connections/{connectionId}/mail/{messageId}', 'get');
  const full = (await response.json()).data; assert.equal(full.message.body, 'Invented connected message.'); assert.equal(full.message.id, message.id); assert.equal(full.workspaceId, f.home);
  assert.equal(calls.filter(url => url.searchParams.get('format') === 'full').length, 1);
  assert.equal(JSON.stringify(f.db.exportState()).includes('Invented connected message.'), false);
  assert.equal((await f.flow.taskSource(f.owner, f.home, task.taskId)).message.id, message.id);
  // The existing full response stays exact for current native/client consumers.
  const old = await f.call(`/${start.connectionId}/mail`); assert.equal(old.page.messages[0].body, full.message.body);
  assert.deepEqual(Object.keys(old).sort(), ['mode', 'page', 'workspaceId']);
  calls.length = 0;
  for (const path of [route(start.connectionId) + '?view=metadata', route(start.connectionId) + '?search=x', `/${start.connectionId}/mail?view=full`, `/${start.connectionId}/mail?view=`, `/${start.connectionId}/mail?view=metadata&view=metadata`]) assert.equal((await f.request(path)).status, 400);
  assert.equal((await f.request(route(start.connectionId), undefined, 'sam')).status, 403);
  assert.equal((await f.request(route(start.connectionId), undefined, 'oj_invented')).status, 401);
  assert.equal((await f.request(route('con_' + 'b'.repeat(32)))).status, 403);
  assert.equal((await f.request(`/${start.connectionId}/mail/not.allowed`)).status, 404);
  assert.equal(calls.length, 0);
  f.hooks.response = url => url.pathname.endsWith('/messages/m1') ? new Response('SECRET_PROVIDER_BODY', { status: 404 }) : undefined;
  const missing = await f.request(route(start.connectionId)); assert.equal(missing.status, 404); const error = await missing.json(); assert.equal(error.error.code, 'message_unavailable'); assert.doesNotMatch(JSON.stringify(error), /SECRET_PROVIDER_BODY/);
  assert.equal((await f.owned.snapshot(f.owner, f.home)).work.tasks.find(row => row.id === task.taskId).title, 'Read only when requested');
  await f.flow.act(f.owner, start.connectionId, 'disconnect'); calls.length = 0;
  assert.equal((await f.request(route(start.connectionId))).status, 409); assert.equal(calls.length, 0);
});

test('in-flight disconnect suppresses an explicit full body and returns reconnect rather than content', async () => {
  const f = await googleFlowFixture(), start = await f.begin(); await f.complete(start);
  f.hooks.mail = async url => { if (url.pathname.endsWith('/messages/m1')) await f.flow.act(f.owner, start.connectionId, 'disconnect'); };
  const response = await f.request(route(start.connectionId)); assert.equal(response.status, 409); assert.doesNotMatch(await response.text(), /Invented connected message/);
});
