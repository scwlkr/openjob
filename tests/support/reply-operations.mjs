import { googleFlowFixture } from './google-connection-flow.mjs';
import { createReplyOperationRepository } from '../../db/reply-operations.ts';
import { createFixtureReplyOperations } from '../../server/reply-operations.ts';
export async function replyOperationFixture() {
  const f = await googleFlowFixture(), start = await f.begin(); await f.complete(start);
  const task = await f.flow.createTask(f.owner, start.connectionId, { messageId: 'm1', title: 'Finish the review' });
  const prepared = await f.flow.reply(f.owner, f.home, task.taskId);
  const saved = await f.flow.saveReply(f.owner, f.home, task.taskId, { mode: 'reply-all', body: 'The reviewed work is complete.', expectedRevision: 0, reviewToken: prepared.reviewToken });
  const input = { action: 'reply.simulate', taskId: task.taskId, requestId: crypto.randomUUID(), draftRevision: saved.draft.revision, reviewToken: prepared.reviewToken };
  let time = Date.now(), calls = [], dispatch = async payload => { calls.push(payload); return { kind: 'confirmed', receiptId: 'sim_' + 'a'.repeat(32) }; };
  const authority = f.flow.fixtureReplyAuthority();
  const repo = (transport = f.db.fetch) => createReplyOperationRepository(f.config, transport, { now: () => time });
  const service = (repository = repo(), override = {}) => createFixtureReplyOperations({ repository, authority, dispatch: (...args) => dispatch(...args), ...override });
  return { ...f, start, task, prepared, saved, input, authority, repo, service, calls, advance(ms) { time += ms; }, dispatch(value) { dispatch = value; } };
}
