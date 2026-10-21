'use client';
import { useEffect, useRef, useState } from 'react';
import { validateOperationView, type ReplyOperationInput, type ReplyOperationView } from '../../shared/reply-operation';
import type { ReplyEditorBuffer, ReplyBufferUpdate } from './connected-reply-editor';
import styles from '../workspace/workspace.module.css';
import replyStyles from './connected-reply.module.css';

type Props = { workspaceId: string; taskId: string; getToken(): Promise<string>; buffer?: ReplyEditorBuffer; ready: boolean; onBuffer(buffer: ReplyBufferUpdate): void };
const outcomes = { simulated_accepted: 'Simulation confirmed', synthetic_rejected: 'Simulation rejected', authority_changed: 'Access or source changed', payload_invalid: 'Frozen reply unavailable', intent_expired: 'Queue window expired', dispatch_unknown: 'Result uncertain' };
export default function ReplyOperations({ workspaceId, taskId, getToken, buffer, ready, onBuffer }: Props) {
  const [items, setItems] = useState<ReplyOperationView[]>([]), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const lease = useRef<AbortController | undefined>(undefined), path = `/api/v1/workspaces/${workspaceId}/operations`;
  async function request(target: string, controller: AbortController, input?: object | null) {
    const token = await getToken(); controller.signal.throwIfAborted();
    const response = await fetch(target, { method: input === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}), signal: controller.signal, cache: 'no-store', redirect: 'error' });
    const raw = await response.text(); controller.signal.throwIfAborted();
    if (!response.ok || raw.length > 100000) throw new Error();
    return JSON.parse(raw) as { data: unknown; nextCursor?: string | null };
  }
  useEffect(() => () => lease.current?.abort(), []);
  function accept(value: unknown) { const op = validateOperationView(value); if (op.workspaceId !== workspaceId || op.taskId !== taskId) throw new Error(); return op; }
  async function history() {
    lease.current?.abort(); const controller = new AbortController(); lease.current = controller; setBusy(true); setLoaded(false); setNotice('');
    try {
      const rows: ReplyOperationView[] = []; let cursor: string | null = null;
      do {
        const value = await request(path + '?taskId=' + encodeURIComponent(taskId) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), controller);
        if (!Array.isArray(value.data) || value.data.length > 50 || value.nextCursor !== null && typeof value.nextCursor !== 'string' || rows.length && value.nextCursor) throw new Error();
        rows.push(...value.data.map(accept)); cursor = value.nextCursor;
      } while (cursor);
      setItems(rows); setLoaded(true);
      onBuffer(current => {
        if (!current?.operationRequest || !rows.some(op => op.requestId === current.operationRequest!.requestId && op.draftRevision === current.operationRequest!.draftRevision)) return current;
        const next = { ...current }; delete next.operationRequest; return next;
      });
    } catch { if (!controller.signal.aborted) { setItems([]); setNotice('Operation history unavailable. Refresh before queuing or retrying.'); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function mutate(id?: string) {
    if (busy || !loaded || !id && (!buffer || !ready || blocked)) return;
    const input: ReplyOperationInput | undefined = id ? undefined : buffer!.operationRequest ?? { action: 'reply.simulate', taskId, requestId: crypto.randomUUID(), draftRevision: buffer!.revision, reviewToken: buffer!.reviewToken };
    if (!id) onBuffer(current => current ? { ...current, operationRequest: input } : current);
    lease.current?.abort(); const controller = new AbortController(); lease.current = controller; setBusy(true); setNotice('');
    try {
      const value = await request(id ? path + '/' + id + '/run-fixture' : path, controller, id ? null : input);
      const op = accept(value.data); setItems(current => [op, ...current.filter(item => item.id !== op.id)]);
      if (!id) onBuffer(current => { if (!current || current.operationRequest?.requestId !== input!.requestId) return current; const next = { ...current }; delete next.operationRequest; return next; });
      setNotice(op.state === 'queued' ? 'Saved revision queued. Run the simulation when ready.' : `Simulation ${op.state}. Nothing was sent.`);
    } catch { if (!controller.signal.aborted) { setNotice(id ? 'Result unavailable. Refresh history before another action. Execution may be unknown.' : 'Queue result unavailable. Your request is kept. Refresh history, then retry the same request if absent.'); setLoaded(false); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const blocked = items.some(op => ['queued', 'executing', 'unknown'].includes(op.state));
  return <section className={replyStyles.operations} aria-label="Reply simulation operations">
    <h3>Reply simulation</h3><p>Invented Mail only. Queue a frozen copy of the saved reply, then run it once. Real sending stays off.</p>
    {!loaded && <p>Refresh operation history before queuing or running an operation.</p>}
    <button disabled={busy} onClick={() => void history()}>Refresh operation history</button>
    <button className={styles.primary} disabled={busy || !loaded || !ready || blocked} onClick={() => void mutate()}>{buffer?.operationRequest ? 'Retry same queue request' : 'Queue saved reply simulation'}</button>
    {notice && <p role="status">{notice}</p>}
    {items.map(op => <article key={op.id}><p><strong>{op.state}</strong> · saved revision {op.draftRevision} · {op.outcome ? outcomes[op.outcome] : 'Awaiting simulation'}</p><p className={styles.small}>Operation {op.id} · {op.createdAt}{op.receiptExpired ? ' · Receipt expired' : ''}</p>{op.state === 'queued' && <button disabled={busy || !loaded} onClick={() => void mutate(op.id)}>Run simulated operation</button>}{op.state === 'unknown' && <p>Execution is uncertain. This operation cannot run again.</p>}</article>)}
  </section>;
}
