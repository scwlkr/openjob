'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceMailCatalog } from '../../shared/workspace-mail-catalog';
import type { ConnectionsRequest } from '../connections/connection-request';
import ConnectedGoogleMail from '../connections/connected-google-mail';
import { useConnectedMailDrafts, type ConnectedMailDrafts } from '../connections/connected-mail-drafts';
import { PendingConnectedMailTasks } from '../connections/connected-mail-task';
import styles from '../workspace/workspace.module.css';
import mailStyles from './workspace-mail.module.css';
type Props = { workspaceId: string; active: boolean; request: ConnectionsRequest; onOpenTask(taskId: string): void; onOpenWorkspace(): void };
const labels = { authorizing: 'Checking read access', consent_required: 'Awaiting consent', connected: 'Read access connected', cancelled: 'Consent cancelled', reconnect_required: 'Reconnect required', cleanup_pending: 'Access denied; cleanup pending', disconnected: 'Disconnected' };
/** Authored requests belong to this retained Workspace session; provider views do not. */
export default function WorkspaceMail(props: Props) {
  const drafts = useConnectedMailDrafts(props.request);
  return props.active ? <WorkspaceMailView {...props} drafts={drafts} /> : null;
}
function WorkspaceMailView({ workspaceId, request, onOpenTask, onOpenWorkspace, drafts }: Props & { drafts: ConnectedMailDrafts }) {
  const [catalog, setCatalog] = useState<ReturnType<typeof workspaceMailCatalog>>();
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState(''); const generation = useRef<object>({});
  const refresh = useCallback(() => {
    const operation = {}; generation.current = operation;
    void request().then(value => workspaceMailCatalog(value, workspaceId)).then(value => {
      if (generation.current === operation) { setCatalog(value); setLoaded(true); }
    }).catch(() => {
      if (generation.current === operation) setError('Mail connections could not be checked. Refresh status or manage Connections. Your authored Task requests are kept.');
    }).finally(() => { if (generation.current === operation) setBusy(false); });
  }, [request, workspaceId]);
  useEffect(() => { void refresh(); return () => { generation.current = {}; }; }, [refresh]);
  function refreshStatus() { setBusy(true); setError(''); setCatalog(undefined); setSelected(''); setLoaded(false); void refresh(); }
  const row = catalog?.bindings.find(item => item.id === selected);
  const readable = row?.status === 'connected' && !row.expired && !row.operation && catalog?.mailAvailable;
  return <section className={mailStyles.mail} aria-label="Workspace Mail">
    <h2>Mail</h2><p>Only Mail assigned to this Workspace appears here. <Link href="/connections">Manage Connections</Link> for consent, reconnect and disconnect.</p>
    <button disabled={busy} onClick={refreshStatus}>Refresh Mail connections</button>
    <PendingConnectedMailTasks drafts={drafts} workspaceId={workspaceId} onOpenTask={onOpenTask} onOpenWorkspace={onOpenWorkspace} />
    {busy && <p role="status">Checking this Workspace’s Mail connections…</p>}{error && <p role="alert">{error}</p>}
    {loaded && !catalog && <p>No configured Mail reader is available for this Workspace.</p>}
    {catalog && <><p>{catalog.mode === 'google-fixture' ? 'Invented Google protocol Mail · no live provider calls.' : 'Read-only Google Mail.'} Tasks and Calendar planning stay in this Workspace. No sending or provider Calendar access.</p>
      {!catalog.bindings.length && <p>No Mail account is assigned to this Workspace. Choose its resource home in Connections.</p>}
      {catalog.bindings.map(item => <div key={item.id} className={`${styles.panel} ${mailStyles.mailbox}`}><h3>{item.address}</h3><p>{labels[item.status]}{item.expired ? ' · read access expired' : ''}{item.operation ? ' · connection operation in progress' : ''}</p><button disabled={!catalog.mailAvailable || item.status !== 'connected' || item.expired || !!item.operation} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>Open read-only Mail for {item.address}</button></div>)}
      {!catalog.mailAvailable && <p>Mail reads are unavailable in this configuration.</p>}
    </>}
    {readable && row && <ConnectedGoogleMail key={row.id} connectionId={row.id} workspaceId={workspaceId} fixture={catalog!.mode === 'google-fixture'} request={request} taskDrafts={drafts} withinWorkspace onOpenTask={onOpenTask} />}
  </section>;
}
