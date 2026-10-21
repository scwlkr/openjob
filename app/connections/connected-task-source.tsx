'use client';
import { useEffect, useRef, useState } from 'react';
import type { ProviderMessage } from '../../shared/provider-contracts';
import styles from '../workspace/workspace.module.css';
import ConnectedReplyEditor, { type ReplyEditorBuffer, type ReplyBufferUpdate } from './connected-reply-editor';
import replyStyles from './connected-reply.module.css';

export default function ConnectedTaskSource({ workspaceId, taskId, getToken, buffer, onBuffer }: { workspaceId: string; taskId: string; getToken(): Promise<string>; buffer?: ReplyEditorBuffer; onBuffer(buffer: ReplyBufferUpdate): void }) {
  const [source, setSource] = useState<{ address: string; mode: string; message: ProviderMessage }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lease = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { lease.current?.abort(); }, []);
  async function open() {
    lease.current?.abort(); const controller = new AbortController(); lease.current = controller;
    setBusy(true); setSource(undefined); setError('');
    try {
      const token = await getToken(); controller.signal.throwIfAborted();
      const response = await fetch(`/api/v1/connections/task-sources/${workspaceId}/${taskId}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store', redirect: 'error' });
      if (!response.ok) throw new Error();
      const data = (await response.json() as { data: { workspaceId: string; taskId: string; address: string; mode: string; message: ProviderMessage } }).data; controller.signal.throwIfAborted();
      if (data.workspaceId !== workspaceId || data.taskId !== taskId || !data.message || typeof data.message.body !== 'string' || typeof data.message.subject !== 'string' || typeof data.address !== 'string') throw new Error();
      setSource(data);
    } catch { if (!controller.signal.aborted) setError('Source Mail is unavailable. It may be disconnected or this Task has no connected source. Your Task and Calendar are kept.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className={replyStyles.source}><button disabled={busy} onClick={() => void open()}>Open connected source Mail</button>{error && <p role="status">{error}</p>}{source && <section className={styles.panel} aria-label="Connected source Mail"><div className={styles.reader}><h3>{source.message.subject}</h3><p>{source.mode === 'google-fixture' ? 'Invented Mail · ' : ''}{source.address}</p><p className={styles.body}>{source.message.body}</p><button onClick={() => { lease.current?.abort(); setSource(undefined); }}>Close source Mail</button></div><ConnectedReplyEditor fixture={source.mode === 'google-fixture'} workspaceId={workspaceId} taskId={taskId} getToken={getToken} buffer={buffer} onBuffer={onBuffer} onUnavailable={() => { setSource(undefined); setError('Source Mail is unavailable. Your saved Task, Calendar and authored OpenJob draft are kept.'); }} /></section>}{!source && buffer && <><p>Your authored reply is kept in this Workspace. Reopen the source to continue.</p>{buffer.dirty && <button onClick={() => onBuffer(undefined)}>Discard unsaved reply edits</button>}</>}</div>;
}
