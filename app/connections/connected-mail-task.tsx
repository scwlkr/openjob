'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ProviderMessageSummary } from '../../shared/provider-contracts';
import type { MailTaskResult } from '../../shared/mail-task-source';
import { workspaceFragment } from '../../shared/workspace-navigation';
import styles from '../workspace/workspace.module.css';

export default function ConnectedMailTask({ message, workspaceId, connectionId, request, title, onTitleChange, onPendingChange }: { title: string; onTitleChange(title: string): void; onPendingChange(id: string, pending: boolean): void; message: ProviderMessageSummary; workspaceId: string; connectionId: string; request(path?: string, input?: object): Promise<unknown> }) {
  const [receipt, setReceipt] = useState<MailTaskResult>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [additional, setAdditional] = useState<{ requestId: string; title: string }>();
  useEffect(() => { onPendingChange(message.id, busy || !!additional); }, [onPendingChange, message.id, busy, additional]);
  useEffect(() => () => onPendingChange(message.id, false), [onPendingChange, message.id]);
  async function create(another = false) {
    if (busy) return;
    const intent = additional ?? (another ? { requestId: crypto.randomUUID(), title } : undefined);
    if (intent) setAdditional(intent);
    setBusy(true); setError('');
    try {
      const result = await request(`/${connectionId}/tasks`, { messageId: message.upstreamId, title: intent?.title ?? title, ...(intent ? { requestId: intent.requestId } : {}) }) as MailTaskResult;
      if (result.workspaceId !== workspaceId || typeof result.taskId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.taskId) || typeof result.created !== 'boolean') throw new Error();
      setReceipt(result); setAdditional(undefined);
    } catch { setError('Task could not be confirmed. Your title is kept. Retry to find or create the same Task.'); }
    finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={event => { event.preventDefault(); void create(); }}>
    <label>Task title<input required maxLength={500} value={title} onChange={event => onTitleChange(event.target.value)} disabled={busy || !!additional} /></label>
    <p>Review the title before saving it in this Mail account’s Workspace. Message text stays with Gmail.</p>
    {additional && <p>The additional Task is awaiting confirmation. Retry keeps the same title and request.</p>}
    <div className={styles.actions}><button disabled={busy || !title.trim()}>{additional ? 'Confirm additional Task' : 'Create or find linked Task'}</button>{receipt && <><Link href={`/workspaces${workspaceFragment({ workspaceId, item: { kind: 'task', id: receipt.taskId } })}`}>Open {receipt.created ? 'created' : 'existing'} Task</Link><button type="button" disabled={busy || !title.trim() || !!additional} onClick={() => void create(true)}>Create another Task</button></>}</div>
    {error && <p role="alert">{error}</p>}
  </form>;
}
