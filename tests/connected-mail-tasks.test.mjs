import test from 'node:test';
import assert from 'node:assert/strict';
import { googleFlowFixture } from './support/google-connection-flow.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';

async function fixture() {
  const f = await googleFlowFixture(), start = await f.begin(); await f.complete(start);
  const validate = await createOpenApiResponseValidator();
  const post = (input, user = 'alex') => f.request(`/${start.connectionId}/tasks`, input, user);
  const create = async input => { const response = await post(input); assert.equal(response.status, 200, await response.clone().text()); await validate(response.clone(), '/api/v1/connections/{connectionId}/tasks', 'post'); return (await response.json()).data; };
  const source = (taskId, workspaceId = f.home, user = 'alex') => f.request(`/task-sources/${workspaceId}/${taskId}`, undefined, user);
  return { ...f, start, post, create, source, validate };
}
test('connected Mail -> reviewed Task -> normal planning/completion -> freshly authorized source, without body persistence', async () => {
  const f = await fixture();
  const receipt = await f.create({ messageId: 'm1', title: 'Review the proposal' });
  assert.equal(receipt.workspaceId, f.home); assert.equal(receipt.created, true);
  let snapshot = await f.owned.snapshot(f.owner, f.home);
  assert.equal(snapshot.work.tasks.at(-1).title, 'Review the proposal');
  assert.doesNotMatch(JSON.stringify(snapshot), /sourceMessage|sourceAccount|connectionId|Invented connected message/);
  await f.owned.command(f.owner, f.home, { type: 'task.update', taskId: receipt.taskId, title: 'Reviewed title' });
  const duplicate = await f.create({ messageId: 'm1', title: 'Must not replace reviewed title' });
  assert.deepEqual(duplicate, { ...receipt, created: false });
  const extra = { messageId: 'm1', title: 'An explicit additional Task', requestId: crypto.randomUUID() };
  const another = await f.create(extra); assert.notEqual(another.taskId, receipt.taskId);
  assert.deepEqual(await f.create(extra), { ...another, created: false });
  assert.equal((await f.post({ ...extra, title: 'Different request under the same key' })).status, 409);
  await f.owned.command(f.owner, f.home, { type: 'task.schedule', taskId: receipt.taskId, calendarId: snapshot.workspace.calendarId, start: '2026-10-21T14:00:00Z', end: '2026-10-21T14:30:00Z' });
  await f.owned.command(f.owner, f.home, { type: 'task.complete', taskId: receipt.taskId, completed: true });
  const source = await f.source(receipt.taskId); assert.equal(source.status, 200);
  await f.validate(source.clone(), '/api/v1/connections/task-sources/{workspaceId}/{taskId}', 'get');
  assert.equal((await source.json()).data.message.body, 'Invented connected message.');
  const documents = JSON.stringify(f.db.exportState()); assert.equal(documents.includes('Invented connected message.'), false);
  await f.call(`/${f.start.connectionId}`, { action: 'disconnect' });
  let traffic = 0; f.hooks.mail = () => { traffic++; };
  assert.equal((await f.source(receipt.taskId)).status, 409); assert.equal(traffic, 0);
  snapshot = await f.owned.snapshot(f.owner, f.home);
  assert.equal(snapshot.work.tasks.find(task => task.id === receipt.taskId).completed, true);
  assert.equal(snapshot.work.events[0].taskId, receipt.taskId);
});
test('foreign home/owner, agent, invalid source and revoked in-flight read cannot create or expose Tasks', async () => {
  const f = await fixture(), input = { messageId: 'm1', title: 'Private work' };
  const receipt = await f.create(input), other = await f.owned.create(f.owner, 'Other home');
  let traffic = 0; f.hooks.mail = () => { traffic++; };
  assert.equal((await f.post(input, 'sam')).status, 403);
  assert.equal((await f.post(input, 'oj_agent_invented')).status, 401);
  assert.equal((await f.source(receipt.taskId, other.workspace.workspaceId)).status, 404);
  assert.equal((await f.source(receipt.taskId, f.home, 'sam')).status, 403);
  assert.equal((await f.post({ ...input, workspaceId: other.workspace.workspaceId })).status, 400);
  assert.equal((await f.post({ ...input, messageId: '../m1' })).status, 400); assert.equal(traffic, 0);
  const before = await f.owned.snapshot(f.owner, f.home);
  f.hooks.mail = async url => { if (url.pathname.endsWith('/messages/m1')) await f.flow.act(f.owner, f.start.connectionId, 'disconnect'); };
  assert.notEqual((await f.post({ ...input, requestId: crypto.randomUUID() })).status, 200);
  assert.deepEqual(await f.owned.snapshot(f.owner, f.home), before);
});
test('Task deletion prunes private source metadata and cannot turn an unrelated Task into Mail access', async () => {
  const f = await fixture(), receipt = await f.create({ messageId: 'm1', title: 'Temporary private work' });
  const location = [...f.db.documents.keys()].find(path => path.endsWith(`/v1OwnedWorkspaces/${f.home}`));
  assert.equal(JSON.parse(f.db.documents.get(location).fields.mailSourcesJson.stringValue).length, 1);
  await f.owned.command(f.owner, f.home, { type: 'task.delete', taskId: receipt.taskId });
  assert.deepEqual(JSON.parse(f.db.documents.get(location).fields.mailSourcesJson.stringValue), []);
  let traffic = 0; f.hooks.mail = () => { traffic++; };
  assert.equal((await f.source(receipt.taskId)).status, 404); assert.equal(traffic, 0);
});
test('concurrent creation commits one source-linked Task through the existing compare-and-set', async () => {
  const f = await fixture(), input = { messageId: 'm1', title: 'One Task after two clicks' };
  const receipts = await Promise.all([f.create(input), f.create(input)]);
  assert.equal(receipts[0].taskId, receipts[1].taskId);
  assert.equal(receipts.filter(item => item.created).length, 1);
  assert.equal((await f.owned.snapshot(f.owner, f.home)).work.tasks.length, 1);
});
