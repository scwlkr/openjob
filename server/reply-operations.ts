import type { ReplyOperationRepository } from '../db/reply-operations.ts';
import { validateOperationInput, type FrozenReplyPayload, type ReplyOperationInput, type ReplyOperationView } from '../shared/reply-operation.ts';
import { createDurableOperationRunner } from './durable-operations.ts';

export type FixtureReplyAuthority = {
  freeze(owner: string, workspaceId: string, input: ReplyOperationInput): Promise<{ payload: FrozenReplyPayload; current(): Promise<void> }>;
  current(payload: FrozenReplyPayload): Promise<void>;
};
export type FixtureDispatcher = (payload: Readonly<FrozenReplyPayload>, signal: AbortSignal) => Promise<{ kind: 'confirmed'; receiptId: string } | { kind: 'rejected' }>;
/** Explicit synthetic composition only. No default dispatcher or background timer. */
export function createFixtureReplyOperations({ repository, authority, dispatch, timeoutMs = 5000 }: {
  repository: ReplyOperationRepository; authority: FixtureReplyAuthority; dispatch: FixtureDispatcher; timeoutMs?: number;
}) {
  const run = createDurableOperationRunner<FrozenReplyPayload, ReplyOperationView, string>({ repository, current: authority.current, dispatch, timeoutMs,
    settle(result) {
      if (result && typeof result === 'object' && 'kind' in result) {
        if (result.kind === 'confirmed' && Object.keys(result).sort().join(',') === 'kind,receiptId' && 'receiptId' in result && typeof result.receiptId === 'string' && /^sim_[a-f0-9]{32}$/.test(result.receiptId)) return { state: 'confirmed', outcome: 'simulated_accepted', receipt: result.receiptId };
        if (result.kind === 'rejected' && Object.keys(result).join(',') === 'kind') return { state: 'rejected', outcome: 'synthetic_rejected' };
      }
      return { state: 'unknown', outcome: 'dispatch_unknown' };
    },
  });
  return {
    get: repository.get.bind(repository), list: repository.list.bind(repository),
    async enqueue(owner: string, workspaceId: string, raw: unknown) {
      const input = validateOperationInput(raw);
      const existing = await repository.existing(owner, workspaceId, input); if (existing) return existing;
      const { payload, current } = await authority.freeze(owner, workspaceId, input);
      return repository.enqueue(owner, workspaceId, input, payload, current);
    },
    run,
  };
}
export type FixtureReplyOperations = ReturnType<typeof createFixtureReplyOperations>;
