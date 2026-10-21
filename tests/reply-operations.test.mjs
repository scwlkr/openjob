import test from 'node:test';
import { replyOperationFixture } from './support/reply-operations.mjs';
import assert from 'node:assert/strict';
import { createWorkspacePilotApplication } from '../server/workspace-pilot-application.ts';
import { createGoogleConnectionsFlow } from '../server/connections/google-flow.ts';

test('frozen enqueue deduplicates, conflicts on changed target and survives reconstruction/later draft edits', async () => {
  const f = await replyOperationFixture(), operations = f.service();
  const first = await operations.enqueue(f.owner, f.home, f.input);
  assert.equal(first.state, 'queued'); assert.equal(first.mode, 'fixture');
  const publicValue = JSON.stringify(first); assert.doesNotMatch(publicValue, /reviewed work|example.invalid|payloadHash|requestHash|ownerUserId/);
  await f.flow.saveReply(f.owner, f.home, f.task.taskId, { mode: 'reply', body: 'Later editor text', expectedRevision: 1, reviewToken: f.prepared.reviewToken });
  assert.deepEqual(await f.service().enqueue(f.owner, f.home, f.input), first);
  await assert.rejects(() => operations.enqueue(f.owner, f.home, { ...f.input, taskId: 'other' }), e => e.code === 'conflict');
  const state = f.db.exportState(); f.db.restoreState(state);
  const result = await f.service().run(f.owner, f.home, first.id);
  assert.equal(result.state, 'confirmed'); assert.equal(result.outcome, 'simulated_accepted'); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].draft, f.saved.draft);
  assert.deepEqual(f.calls[0].draft.plan, f.prepared.plans.replyAll);
  assert.equal((await f.service().run(f.owner, f.home, first.id)).state, 'confirmed'); assert.equal(f.calls.length, 1);
  assert.equal((await f.service().list(f.owner, f.home, f.task.taskId)).items[0].id, first.id);
});
test('competing runners enter durable execution once; queued crashed claims can be reclaimed', async () => {
  const f = await replyOperationFixture(), repository = f.repo(), operations = f.service(repository), op = await operations.enqueue(f.owner, f.home, f.input);
  assert.ok(await repository.claim(f.owner, f.home, op.id)); f.advance(30_001);
  f.dispatch(async payload => {
    const document = [...f.db.documents.values()].find(doc => doc.name.endsWith('v1FixtureOperations/' + op.id));
    assert.equal(JSON.parse(document.fields.operationJson.stringValue).state, 'executing'); f.calls.push(payload);
    await new Promise(resolve => setTimeout(resolve, 5)); return { kind: 'confirmed', receiptId: 'sim_' + 'b'.repeat(32) };
  });
  await Promise.all([operations.run(f.owner, f.home, op.id), f.service().run(f.owner, f.home, op.id)]);
  assert.equal(f.calls.length, 1); assert.equal((await operations.get(f.owner, f.home, op.id)).state, 'confirmed');
});
test('execution crash and timed-out or late dispatch become unknown and never replay', async () => {
  const f = await replyOperationFixture(), repository = f.repo(), operations = f.service(repository), op = await operations.enqueue(f.owner, f.home, f.input);
  const claim = await repository.claim(f.owner, f.home, op.id); assert.ok(await repository.begin(f.owner, f.home, op.id, claim, f.authority.current));
  f.advance(30_001); assert.equal((await f.service().get(f.owner, f.home, op.id)).state, 'unknown');
  await f.service().run(f.owner, f.home, op.id); assert.equal(f.calls.length, 0);
  const second = await operations.enqueue(f.owner, f.home, { ...f.input, requestId: crypto.randomUUID() });
  let complete; f.dispatch(async payload => { f.calls.push(payload); return new Promise(resolve => { complete = resolve; }); });
  const bounded = f.service(repository, { timeoutMs: 5 });
  assert.equal((await bounded.run(f.owner, f.home, second.id)).state, 'unknown');
  complete({ kind: 'confirmed', receiptId: 'sim_' + 'c'.repeat(32) });
  assert.equal((await bounded.run(f.owner, f.home, second.id)).state, 'unknown'); assert.equal(f.calls.length, 1);
});
test('ambiguous executing commit never dispatches and is inspected as unknown after expiry', async () => {
  const f = await replyOperationFixture(); let lose = true;
  const transport = async (url, init) => {
    const response = await f.db.fetch(url, init);
    if (lose && String(url).endsWith('/documents:commit') && String(init?.body).includes('\\"state\\":\\"executing\\"') && response.ok) { lose = false; throw new Error('Lost commit response'); }
    return response;
  };
  const operations = f.service(f.repo(transport)), op = await operations.enqueue(f.owner, f.home, f.input);
  await assert.rejects(() => operations.run(f.owner, f.home, op.id)); assert.equal(f.calls.length, 0); assert.equal(lose, false);
  f.advance(30_001); assert.equal((await operations.run(f.owner, f.home, op.id)).state, 'unknown'); assert.equal(f.calls.length, 0);
});
test('expired intent/slow authority and revoked connection/source cannot dispatch', async () => {
  const f = await replyOperationFixture(), operations = f.service(), op = await operations.enqueue(f.owner, f.home, f.input);
  await f.flow.act(f.owner, f.start.connectionId, 'disconnect');
  assert.equal((await operations.run(f.owner, f.home, op.id)).outcome, 'authority_changed'); assert.equal(f.calls.length, 0);
  const g = await replyOperationFixture(), repository = g.repo(), queued = await g.service(repository).enqueue(g.owner, g.home, g.input);
  const claim = await repository.claim(g.owner, g.home, queued.id);
  assert.equal(await repository.begin(g.owner, g.home, queued.id, claim, async () => { g.advance(30_001); }), null);
  assert.equal(g.calls.length, 0); g.advance(15 * 60_000);
  assert.equal((await g.service().run(g.owner, g.home, queued.id)).outcome, 'intent_expired');
});
test('payload tampering rejects without effect; result survives revocation without disclosure', async () => {
  const f = await replyOperationFixture(), operations = f.service(), op = await operations.enqueue(f.owner, f.home, f.input);
  const doc = [...f.db.documents.values()].find(doc => doc.name.endsWith('v1FixtureOutboundPayloads/' + op.id));
  const value = JSON.parse(doc.fields.payloadJson.stringValue); value.draft.body = 'Changed private payload'; doc.fields.payloadJson.stringValue = JSON.stringify(value);
  assert.equal((await operations.run(f.owner, f.home, op.id)).outcome, 'payload_invalid'); assert.equal(f.calls.length, 0);
  const g = await replyOperationFixture(), op2 = await g.service().enqueue(g.owner, g.home, g.input);
  g.dispatch(async () => {
    const directory = [...g.db.documents.values()].find(doc => doc.name.endsWith('v1UserDirectory/' + g.owner)); directory.fields.deletionState = { stringValue: 'requested' }; directory.updateTime = '2099-01-01T00:00:00.000Z';
    return { kind: 'confirmed', receiptId: 'sim_' + 'd'.repeat(32) };
  });
  await assert.rejects(() => g.service().run(g.owner, g.home, op2.id));
  const stored = [...g.db.documents.values()].find(doc => doc.name.endsWith('v1FixtureOperations/' + op2.id)); assert.equal(JSON.parse(stored.fields.operationJson.stringValue).state, 'confirmed');
});
test('canonical API returns accepted intent, redacted history, current human/home admission; default/live/agents stay denied', async () => {
  const f = await replyOperationFixture(), operations = f.service();
  const options = { store: f.owned, users: f.users, verifyIdToken: f.verifyIdToken, admission: { userId: f.owner, provider: 'google', firebaseUid: 'alex' } };
  const api = createWorkspacePilotApplication({ ...options, fixtureOperations: operations });
  const path = '/api/v1/workspaces/' + f.home + '/operations';
  const request = (suffix = '', input, name = 'alex', target = api) => target.fetch(new Request('https://fixture.invalid' + path + suffix, { method: input === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + (f.sessions[name]?.token ?? name), 'content-type': 'application/json' }, ...(input === undefined ? {} : { body: input === null ? '' : JSON.stringify(input) }) }));
  const accepted = await request('', f.input); assert.equal(accepted.status, 202, await accepted.clone().text()); const op = (await accepted.json()).data;
  assert.equal((await request('/' + op.id + '/run-fixture', null)).status, 200);
  const list = await request('?taskId=' + f.task.taskId); assert.equal(list.status, 200); assert.equal((await list.json()).data[0].state, 'confirmed');
  assert.equal((await request('', undefined, 'sam')).status, 403);
  assert.equal((await request('', f.input, 'oj_agent_synthetic')).status, 401);
  assert.equal((await request('', f.input, 'alex', createWorkspacePilotApplication(options))).status, 503);
  const other = await f.owned.create(f.owner, 'Other'); await assert.rejects(() => operations.get(f.owner, other.workspace.workspaceId, op.id), e => e.code === 'forbidden');
  assert.throws(() => createGoogleConnectionsFlow({ ...f.flowOptions, evidenceMode: 'google' }).fixtureReplyAuthority(), e => e.code === 'not_configured');
  await assert.rejects(() => operations.list(f.owner, f.home, undefined, 'bad'), e => e.code === 'invalid_cursor');
  const workspace = (await f.owned.snapshot(f.owner, f.home)).workspace;
  const grant = await f.owned.createAgent(f.owner, f.home, { name: 'Scoped planner', scopes: ['tasks:read'], resourceIds: [workspace.taskSpaceId] });
  assert.equal((await request('', f.input, grant.token)).status, 403);
});
test('lost result commit is recovered without redispatch; a fresh header change rejects the frozen intent', async () => {
  const f = await replyOperationFixture(); let lose = true;
  const transport = async (url, init) => {
    const response = await f.db.fetch(url, init);
    if (lose && String(url).endsWith('/documents:commit') && String(init?.body).includes('\\"state\\":\\"confirmed\\"') && response.ok) { lose = false; throw new Error('Lost result commit response'); } return response;
  };
  const operations = f.service(f.repo(transport)), op = await operations.enqueue(f.owner, f.home, f.input);
  assert.equal((await operations.run(f.owner, f.home, op.id)).state, 'confirmed'); assert.equal(lose, false);
  await operations.run(f.owner, f.home, op.id); assert.equal(f.calls.length, 1);
  const g = await replyOperationFixture(), op2 = await g.service().enqueue(g.owner, g.home, g.input);
  g.hooks.headers = [{ name: 'From', value: 'changed@example.invalid' }, { name: 'To', value: 'alex@example.invalid' }];
  assert.equal((await g.service().run(g.owner, g.home, op2.id)).outcome, 'authority_changed'); assert.equal(g.calls.length, 0);
});
test('ownership change at execution commit defeats stale authority through Workspace CAS', async () => {
  const f = await replyOperationFixture(); let change = true;
  const transport = async (url, init) => {
    if (change && String(url).endsWith('/documents:commit') && String(init?.body).includes('\\"state\\":\\"executing\\"')) {
      change = false;
      const doc = [...f.db.documents.values()].find(doc => doc.name.endsWith('v1OwnedWorkspaces/' + f.home));
      doc.fields.ownerUserId.stringValue = f.sessions.sam.user.userId; doc.updateTime = '2099-01-01T00:00:00.000Z';
    }
    return f.db.fetch(url, init);
  };
  const operations = f.service(f.repo(transport)), op = await operations.enqueue(f.owner, f.home, f.input);
  await assert.rejects(() => operations.run(f.owner, f.home, op.id), e => e.code === 'forbidden'); assert.equal(change, false); assert.equal(f.calls.length, 0);
});
