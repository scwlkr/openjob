import test from 'node:test';
import assert from 'node:assert/strict';
import { googleFlowFixture } from './support/google-connection-flow.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';
import { replyPlans } from '../server/connections/reply-plan.ts';
import { replyHeaders } from '../server/providers/gmail-wire.ts';

async function fixture() {
  const f = await googleFlowFixture(), start = await f.begin(); await f.complete(start);
  const response = await f.request(`/${start.connectionId}/tasks`, { messageId: 'm1', title: 'Complete the proposal review' }); assert.equal(response.status, 200);
  const task = (await response.json()).data, path = `/task-sources/${f.home}/${task.taskId}/reply`, contract = '/api/v1/connections/task-sources/{workspaceId}/{taskId}/reply';
  const validate = await createOpenApiResponseValidator();
  const call = async input => { const response = await f.request(path, input); assert.equal(response.status, 200, await response.clone().text()); await validate(response.clone(), contract, input === undefined ? 'get' : 'post'); return (await response.json()).data; };
  return { ...f, start, task, path, call };
}
test('authored connected reply honors Reply-To/reply-all/thread headers and survives work writes/reconstruction/deletion/reconnect', async () => {
  const f = await fixture(), prepared = await f.call();
  assert.equal(prepared.storageKind, 'openjob'); assert.equal(prepared.draft, null);
  const plan = prepared.plans.reply;
  assert.equal(plan.from, (await f.flow.catalog(f.owner)).bindings[0].address);
  assert.deepEqual(plan.to, ['replies@example.invalid']); assert.deepEqual(plan.cc, []);
  assert.equal(plan.subject, 'Re: Review this proposal'); assert.equal(plan.inReplyTo, '<proposal@example.invalid>'); assert.deepEqual(plan.references, ['<root@example.invalid>', '<proposal@example.invalid>']);
  assert.deepEqual(prepared.plans.replyAll.to, ['replies@example.invalid', 'teammate@example.invalid']); assert.deepEqual(prepared.plans.replyAll.cc, ['observer@example.invalid']);
  const input = { mode: 'reply-all', body: 'I reviewed and completed the work.\nThe plan is ready.', expectedRevision: 0, reviewToken: prepared.reviewToken };
  const saved = await f.call(input); assert.equal(saved.draft.revision, 1); assert.deepEqual(saved.draft.plan, prepared.plans.replyAll);
  assert.deepEqual(await f.call(input), saved); // Lost-response retry cannot create another draft/revision.
  await f.owned.command(f.owner, f.home, { type: 'task.notes', taskId: f.task.taskId, notes: 'Authored task notes' });
  const snapshot = await f.owned.snapshot(f.owner, f.home);
  await f.owned.command(f.owner, f.home, { type: 'task.schedule', taskId: f.task.taskId, calendarId: snapshot.workspace.calendarId, start: '2026-10-21T14:00:00Z', end: '2026-10-21T14:30:00Z' });
  await f.owned.command(f.owner, f.home, { type: 'task.complete', taskId: f.task.taskId, completed: true });
  f.reconstruct(); assert.deepEqual((await f.call()).draft, saved.draft);
  const publicWork = JSON.stringify(await f.owned.snapshot(f.owner, f.home)); assert.doesNotMatch(publicWork, /replies@example|I reviewed|proposal@example|connectedReplies/);
  const privateWork = JSON.stringify(f.db.exportState()); assert.equal(privateWork.includes('Invented connected message.'), false); assert.equal(privateWork.includes('I reviewed and completed'), true);
  await f.flow.act(f.owner, f.start.connectionId, 'disconnect');
  assert.equal((await f.request(f.path)).status, 409); assert.equal((await f.request(f.path, input)).status, 409);
  const again = await f.begin(); await f.complete(again); assert.deepEqual((await f.call()).draft, saved.draft);
  await f.owned.command(f.owner, f.home, { type: 'task.delete', taskId: f.task.taskId });
  assert.equal((await f.request(f.path)).status, 404);
  const receipt = await f.request(`/${f.start.connectionId}/tasks`, { messageId: 'm1', title: 'Reopen the original work' });
  const newTask = (await receipt.json()).data;
  assert.notEqual(newTask.taskId, f.task.taskId);
  assert.deepEqual((await (await f.request(`/task-sources/${f.home}/${newTask.taskId}/reply`)).json()).data.draft, saved.draft);
});
test('stale addressing and concurrent edits conflict without replacing saved text', async () => {
  const f = await fixture(), prepared = await f.call();
  const input = { mode: 'reply', body: 'First editor', expectedRevision: 0, reviewToken: prepared.reviewToken };
  const results = await Promise.all([f.request(f.path, input), f.request(f.path, { ...input, body: 'Second editor' })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const current = await f.call(); assert.equal(current.draft.revision, 1);
  f.hooks.headers = [{ name: 'From', value: 'other@example.invalid' }, { name: 'To', value: current.plans.reply.from }, { name: 'Subject', value: 'Changed subject' }, { name: 'Message-ID', value: '<changed@example.invalid>' }];
  const stale = await f.request(f.path, { ...input, expectedRevision: 1 }); assert.equal(stale.status, 409); assert.equal((await stale.json()).error.code, 'reply_review_required');
  const fresh = await f.call(); assert.notEqual(fresh.reviewToken, prepared.reviewToken); assert.deepEqual(fresh.draft, current.draft); assert.equal(fresh.plans.reply.to[0], 'other@example.invalid');
  assert.equal((await f.call({ ...input, expectedRevision: 1, reviewToken: fresh.reviewToken })).draft.revision, 2);
});
test('foreign owners/homes, agents, client-selected addressing, revocation and oversized input cannot read/save drafts', async () => {
  const f = await fixture(), prepared = await f.call(), input = { mode: 'reply', body: 'Private authored reply', expectedRevision: 0, reviewToken: prepared.reviewToken };
  let traffic = 0; f.hooks.mail = () => { traffic++; };
  assert.equal((await f.request(f.path, undefined, 'sam')).status, 403);
  assert.equal((await f.request(f.path, input, 'oj_agent_synthetic')).status, 401);
  const other = await f.owned.create(f.owner, 'Other Workspace');
  assert.equal((await f.request(f.path.replace(f.home, other.workspace.workspaceId))).status, 404);
  assert.equal((await f.request(f.path, { ...input, from: 'intruder@example.invalid' })).status, 400);
  assert.equal((await f.request(f.path, { ...input, body: 'x'.repeat(20001) })).status, 400);
  assert.equal(traffic, 0);
  f.hooks.mail = async url => { if (url.pathname.endsWith('/messages/m1')) await f.flow.act(f.owner, f.start.connectionId, 'disconnect'); };
  assert.notEqual((await f.request(f.path, input)).status, 200);
  assert.equal(JSON.stringify(f.db.exportState()).includes('Private authored reply'), false);
});
test('reply addressing handles sent Mail, groups and quoted local parts; malformed present headers never silently fall back', () => {
  const self = 'owner@example.invalid';
  const sent = replyPlans(self, { from: self, to: 'Friend <friend@example.invalid>', cc: `${self}, other@example.invalid`, subject: 'Re: Existing' });
  assert.deepEqual(sent.reply.to, ['friend@example.invalid']); assert.deepEqual(sent.replyAll.cc, ['other@example.invalid']); assert.equal(sent.reply.subject, 'Re: Existing'); assert.equal(sent.reply.inReplyTo, undefined); assert.deepEqual(sent.reply.references, []);
  const quoted = replyPlans(self, { from: 'Sender <sender@example.invalid>', replyTo: 'Desk: "odd local"@example.invalid, reply@example.invalid;', inReplyTo: '<prior@example.invalid>', messageId: '<parent@example.invalid>' });
  assert.deepEqual(quoted.reply.to, ['"odd local"@example.invalid', 'reply@example.invalid']); assert.deepEqual(quoted.reply.references, ['<prior@example.invalid>', '<parent@example.invalid>']);
  assert.deepEqual(replyPlans(self, { from: 'sender@example.invalid', to: 'Undisclosed recipients:;' }).reply.to, ['sender@example.invalid']);
  for (const replyTo of ['', 'not an address', self, 'good@example.invalid, broken']) assert.throws(() => replyPlans(self, { from: 'sender@example.invalid', replyTo }), error => error.code === 'reply_unavailable');
  assert.throws(() => replyPlans(self, { from: self, to: self }), error => error.code === 'reply_unavailable');
  assert.throws(() => replyPlans(self, { from: 'a@example.invalid', messageId: '<a@example.invalid> <b@example.invalid>' }), error => error.code === 'reply_unavailable');
  assert.throws(() => replyHeaders({ payload: { headers: [{ name: 'Reply-To', value: 'a@example.invalid' }, { name: 'reply-to', value: 'b@example.invalid' }] } }), error => error.code === 'malformed_response');
});
