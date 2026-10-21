import { operationFail } from '../shared/reply-operation.ts';
type Finish<R> = { state: 'confirmed' | 'rejected' | 'unknown'; outcome: string; receipt?: R };
type RunnerRepository<P, V, R> = {
  get(owner: string, workspace: string, id: string): Promise<V>;
  claim(owner: string, workspace: string, id: string): Promise<string | null>;
  begin(owner: string, workspace: string, id: string, claim: string, current: (payload: P) => Promise<void>): Promise<P | null>;
  dispatchReady(owner: string, workspace: string, id: string, claim: string): Promise<boolean>;
  finish(id: string, claim: string, state: Finish<R>['state'], outcome: string, receipt?: R): Promise<unknown>;
};
/** One persisted execution attempt for every connector action; no background retry. */
export function createDurableOperationRunner<P, V, R>({ repository, current, dispatch, settle, timeoutMs = 5000 }: {
  repository: RunnerRepository<P, V, R>; current(payload: P): Promise<void>;
  dispatch(payload: Readonly<P>, signal: AbortSignal, beforeEffect: () => Promise<void>): Promise<unknown>; settle(result: unknown): Finish<R>;
  timeoutMs?: number;
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) operationFail();
  return async (owner: string, workspace: string, id: string): Promise<V> => {
    const claim = await repository.claim(owner, workspace, id);
    if (!claim) return repository.get(owner, workspace, id);
    // An ambiguous executing commit throws before dispatch can be entered.
    const payload = await repository.begin(owner, workspace, id, claim, current);
    if (!payload) return repository.get(owner, workspace, id);
    try { await current(payload); }
    catch { await repository.finish(id, claim, 'rejected', 'authority_changed'); return repository.get(owner, workspace, id); }
    if (!await repository.dispatchReady(owner, workspace, id, claim)) return repository.get(owner, workspace, id);
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => dispatch(structuredClone(payload), controller.signal, async () => {
          await current(payload);
          if (!await repository.dispatchReady(owner, workspace, id, claim)) operationFail('dispatch_not_ready');
        })),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Dispatch uncertain.')); }, timeoutMs); }),
      ]);
      const finished = settle(result);
      await repository.finish(id, claim, finished.state, finished.outcome, finished.receipt);
    } catch { await repository.finish(id, claim, 'unknown', 'dispatch_unknown'); }
    finally { clearTimeout(timer); controller.abort(); }
    return repository.get(owner, workspace, id);
  };
}
