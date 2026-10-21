import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replyOperationFixture } from './support/reply-operations.mjs';
import { createFixtureGmailReplyDispatch } from './support/gmail-reply-transport.mjs';
import { createFakeFirestore } from './support/fake-firestore.mjs';
import { BINDING } from './support/google-oauth-transport.mjs';

async function protocol(f, extra = {}) {
  const { payload } = await f.authority.freeze(f.owner, f.home, f.input);
  return createFixtureGmailReplyDispatch({ binding: { ownerId: f.owner, workspaceId: f.home, accountId: payload.source.accountId, subject: BINDING.subject, address: BINDING.address }, ...extra });
}
test('durable runner crosses Gmail MIME protocol with frozen revision; real receipts never enter synthetic operations', async () => {
  const f = await replyOperationFixture(), gmail = await protocol(f), operations = f.service(undefined, { dispatch: gmail.dispatch });
  const op = await operations.enqueue(f.owner, f.home, f.input);
  await f.flow.saveReply(f.owner, f.home, f.task.taskId, { mode: 'reply', body: 'Different later revision', expectedRevision: 1, reviewToken: f.prepared.reviewToken });
  const done = await operations.run(f.owner, f.home, op.id); assert.equal(done.state, 'confirmed'); assert.equal(done.outcome, 'simulated_accepted'); assert.match(done.receiptId, /^sim_/);
  assert.equal(gmail.observed.length, 1); assert.equal(gmail.observed[0].body, f.saved.draft.body); assert.equal(gmail.observed[0].threadId, 't1'); assert.equal(gmail.observed[0].headers.from, f.saved.draft.plan.from);
  assert.equal(gmail.observed[0].headers.to, f.saved.draft.plan.to.join(', ')); assert.equal(gmail.observed[0].headers.cc, f.saved.draft.plan.cc.join(', '));
  await operations.run(f.owner, f.home, op.id); assert.equal(gmail.state().attempts.length, 1);
  const liveShaped = f.service(undefined, { dispatch: async () => ({ kind: 'confirmed', receiptId: 'gmail_real_receipt' }) });
  const second = await liveShaped.enqueue(f.owner, f.home, { ...f.input, requestId: crypto.randomUUID(), draftRevision: 2 });
  assert.equal((await liveShaped.run(f.owner, f.home, second.id)).state, 'unknown');
});
test('fake provider accepts then loses response: persisted unknown survives reconstruction with no second POST', async t => {
  const f = await replyOperationFixture(), directory = await mkdtemp(join(tmpdir(), 'openjob-gmail-protocol-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json'); let provider = { attempts: [] };
  const save = async () => writeFile(path, JSON.stringify({ firestore: f.db.exportState(), provider }), { mode: 0o600 });
  const gmail = await protocol(f, { persist: async value => { provider = value; await save(); }, afterAccept: async () => { throw new Error('Fake accepted response lost.'); } });
  const operations = f.service(undefined, { dispatch: gmail.dispatch }), op = await operations.enqueue(f.owner, f.home, f.input);
  const result = await operations.run(f.owner, f.home, op.id); assert.equal(result.state, 'unknown'); await save();
  const restored = JSON.parse(await readFile(path, 'utf8')), db = createFakeFirestore(); db.restoreState(restored.firestore);
  const again = await protocol(f, { state: restored.provider, persist: async () => { assert.fail('No second provider call permitted'); } });
  const restarted = f.service(f.repo(db.fetch), { dispatch: again.dispatch });
  assert.equal((await restarted.get(f.owner, f.home, op.id)).state, 'unknown');
  for (let i = 0; i < 3; i++) assert.equal((await restarted.run(f.owner, f.home, op.id)).state, 'unknown');
  assert.equal(again.state().attempts.length, 1); assert.equal(again.observed.length, 0); assert.equal(gmail.observed.length, 1);
});
test('fresh connection revocation prevents the fake provider POST', async () => {
  const f = await replyOperationFixture(), gmail = await protocol(f), operations = f.service(undefined, { dispatch: gmail.dispatch }), op = await operations.enqueue(f.owner, f.home, f.input);
  await f.flow.act(f.owner, f.start.connectionId, 'disconnect');
  assert.equal((await operations.run(f.owner, f.home, op.id)).outcome, 'authority_changed'); assert.equal(gmail.state().attempts.length, 0);
});
