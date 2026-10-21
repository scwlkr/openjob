import type { ReplyOperationRepository } from '../db/reply-operations.ts';
import { operationFail, validateOperationInput, type FrozenReplyPayload, type ReplyOperationInput } from '../shared/reply-operation.ts';

export type FixtureReplyAuthority = {
  freeze(owner: string, workspaceId: string, input: ReplyOperationInput): Promise<{ payload: FrozenReplyPayload; current(): Promise<void> }>;
  current(payload: FrozenReplyPayload): Promise<void>;
};
export type FixtureDispatcher = (payload: Readonly<FrozenReplyPayload>, signal: AbortSignal) => Promise<{ kind: 'confirmed'; receiptId: string } | { kind: 'rejected' }>;
/** Explicit synthetic composition only. No default dispatcher or background timer. */
export function createFixtureReplyOperations({ repository, authority, dispatch, timeoutMs = 5000 }: {
  repository: ReplyOperationRepository; authority: FixtureReplyAuthority; dispatch: FixtureDispatcher; timeoutMs?: number;
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) operationFail();
  return {
    get: repository.get.bind(repository), list: repository.list.bind(repository),
    async enqueue(owner: string, workspaceId: string, raw: unknown) {
      const input = validateOperationInput(raw);
      const existing = await repository.existing(owner, workspaceId, input); if (existing) return existing;
      const { payload, current } = await authority.freeze(owner, workspaceId, input);
      return repository.enqueue(owner, workspaceId, input, payload, current);
    },
    async run(owner: string, workspaceId: string, id: string) {
      const claim = await repository.claim(owner, workspaceId, id);
      if (!claim) return repository.get(owner, workspaceId, id);
      // If this commit has an ambiguous response, begin throws and dispatch is never entered.
      const payload = await repository.begin(owner, workspaceId, id, claim, authority.current);
      if (!payload) return repository.get(owner, workspaceId, id);
      try { await authority.current(payload); }
      catch { await repository.finish(id, claim, 'rejected', 'authority_changed'); return repository.get(owner, workspaceId, id); }
      if (!await repository.dispatchReady(owner, workspaceId, id, claim)) return repository.get(owner, workspaceId, id);
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => dispatch(structuredClone(payload), controller.signal)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Dispatch uncertain.')); }, timeoutMs); }),
        ]);
        if (result?.kind === 'confirmed' && Object.keys(result).sort().join(',') === 'kind,receiptId' && /^sim_[a-f0-9]{32}$/.test(result.receiptId)) await repository.finish(id, claim, 'confirmed', 'simulated_accepted', result.receiptId);
        else if (result?.kind === 'rejected' && Object.keys(result).join(',') === 'kind') await repository.finish(id, claim, 'rejected', 'synthetic_rejected');
        else await repository.finish(id, claim, 'unknown', 'dispatch_unknown');
      } catch { await repository.finish(id, claim, 'unknown', 'dispatch_unknown'); }
      finally { clearTimeout(timer); controller.abort(); }
      return repository.get(owner, workspaceId, id);
    },
  };
}
export type FixtureReplyOperations = ReturnType<typeof createFixtureReplyOperations>;
