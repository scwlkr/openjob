'use client';
import Link from 'next/link';
import { useState } from 'react';
import { workspaceFragment } from '../../shared/workspace-navigation';
import { mailTaskDraftKey, type ConnectedMailDrafts, type MailTaskTarget } from './connected-mail-drafts';
import styles from '../workspace/workspace.module.css';

type Props = { onOpenTask?(taskId: string): void; onOpenWorkspace?(): void; target: MailTaskTarget; defaultTitle: string; drafts: ConnectedMailDrafts; retained?: boolean; canUse?(): boolean };
export default function ConnectedMailTask({ target, defaultTitle, drafts, retained = false, canUse = () => true, onOpenTask, onOpenWorkspace }: Props) {
  const [forgetting, setForgetting] = useState(false);
  const draft = drafts.entries[mailTaskDraftKey(target)], title = draft?.title ?? defaultTitle;
  const busy = draft?.phase === 'submitting', additional = draft?.additional, receipt = draft?.receipt;
  if (!retained && (busy || draft?.phase === 'uncertain')) return <p role="status">Your reviewed Task request is kept in Pending Mail Tasks.</p>;
  return <form className={styles.form} onSubmit={event => { event.preventDefault(); if (canUse()) void drafts.submit(target, title); }}>
    <label>Task title<input required maxLength={500} value={title} onChange={event => drafts.edit(target, event.target.value)} disabled={busy || !!additional} /></label>
    <p>{retained ? 'Only your reviewed title and Task request are kept here. Each retry checks current Mail access; no retry is automatic.' : 'Review the title before saving it in this Mail account’s Workspace. Message text stays with Gmail.'}</p>
    {additional && <p>The additional Task is awaiting confirmation. Retry keeps the same title and request.</p>}
    <div className={styles.actions}><button disabled={busy || !title.trim()}>{busy ? 'Confirming Task…' : additional ? 'Confirm additional Task' : 'Create or find linked Task'}</button>{receipt && <>{onOpenTask ? <button type="button" onClick={() => onOpenTask(receipt.taskId)}>Open {receipt.created ? 'created' : 'existing'} Task</button> : <Link href={`/workspaces${workspaceFragment({ workspaceId: target.workspaceId, item: { kind: 'task', id: receipt.taskId } })}`}>Open {receipt.created ? 'created' : 'existing'} Task</Link>}{!retained && <button type="button" disabled={busy || !title.trim() || !!additional} onClick={() => { if (canUse()) void drafts.submit(target, title, true); }}>Create another Task</button>}</>}</div>
    {draft?.error && <p role="alert">{draft.error}</p>}
    {retained && <>{onOpenWorkspace ? <button type="button" onClick={onOpenWorkspace}>Check this Workspace</button> : <Link href={`/workspaces#${target.workspaceId}`} target="_blank" rel="noopener">Check this Workspace in a new tab</Link>}{draft?.phase === 'uncertain' && (forgetting ? <div><p>A Task may already exist. Forgetting this retry does not undo work. Your reviewed title stays.</p><button type="button" onClick={() => drafts.forget(target)}>Forget this retry</button><button type="button" onClick={() => setForgetting(false)}>Keep this request</button></div> : <button type="button" onClick={() => setForgetting(true)}>Stop retrying this request</button>)}</>}
  </form>;
}
export function PendingConnectedMailTasks({ drafts, workspaceId, onOpenTask, onOpenWorkspace }: { drafts: ConnectedMailDrafts; workspaceId?: string; onOpenTask?(taskId: string): void; onOpenWorkspace?(): void }) {
  const pending = Object.values(drafts.entries).filter(row => (!workspaceId || row.workspaceId === workspaceId) && (row.phase === 'submitting' || row.phase === 'uncertain'));
  return !!pending.length && <section className={styles.panel} aria-label="Pending Mail Tasks"><h2>Pending Mail Tasks</h2><p>These authored requests stay while {workspaceId ? 'this Workspace session' : 'Connections'} is open, including through Mail expiry, refresh and disconnect{workspaceId ? ', module and Workspace switches' : ''}. Leaving {workspaceId ? 'Workspaces' : 'Connections'}, reloading or signing out clears them.</p>{pending.map(row => <article key={mailTaskDraftKey(row)}><ConnectedMailTask target={{ connectionId: row.connectionId, workspaceId: row.workspaceId, messageId: row.messageId }} defaultTitle={row.title} drafts={drafts} retained onOpenTask={onOpenTask} onOpenWorkspace={onOpenWorkspace} /></article>)}</section>;
}
