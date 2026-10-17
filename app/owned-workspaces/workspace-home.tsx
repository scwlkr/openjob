'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { validateWorkspaceHome, type WorkspaceHome } from '../../shared/workspace-home';
import type { WorkspaceDestination } from '../../shared/workspace-navigation';
import homeStyles from './workspace-home.module.css';
import styles from '../workspace/workspace.module.css';
type Props = { owner: string; request: (path: string) => Promise<unknown>; busy: boolean; onOpen: (destination: WorkspaceDestination) => void };
export default function WorkspaceHomeView({ owner, request, busy, onOpen }: Props) {
  const [home, setHome] = useState<WorkspaceHome>(); const [message, setMessage] = useState('Loading Home…');
  const generation = useRef(0);
  const load = useCallback(() => {
    const current = ++generation.current;
    return request('/home').then(value => validateWorkspaceHome(value, owner)).then(value => { if (current === generation.current) { setHome(value); setMessage(''); } }).catch(() => { if (current === generation.current) { setHome(undefined); setMessage('Home is unavailable. Check your connection and sign-in, then refresh.'); } });
  }, [owner, request]);
  const refresh = useCallback(() => { setHome(undefined); setMessage('Loading Home…'); void load(); }, [load]);
  useEffect(() => {
    void load();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const focus = () => { void refresh(); };
    const offline = () => { generation.current++; setHome(undefined); setMessage('Home is unavailable offline. Reconnect and refresh.'); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible); window.addEventListener('offline', offline);
    const cancel = () => { generation.current++; };
    return () => { cancel(); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible); window.removeEventListener('offline', offline); };
  }, [load, refresh]);
  const when = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return <section className={homeStyles.home} aria-label="Workspace Home"><h1>Home</h1>
    <p>Open work across your owned Workspaces. Enter a Workspace to make changes.</p>
    <button disabled={busy} onClick={() => void refresh()}>Refresh Home</button>
    {message && <p role="status">{message}</p>}
    {home && <><p className={styles.small}>Loaded {when(home.asOf)} · Calendar blocks through {when(home.until)} · {Intl.DateTimeFormat().resolvedOptions().timeZone} (this browser). Refresh for saved changes.</p>
      {!home.workspaces.length && <p>No owned Workspaces yet. Create one or explicitly open your existing Personal context.</p>}
      {home.workspaces.map(context => <section key={context.workspace.workspaceId} className={styles.panel} aria-label={`Home Workspace ${context.workspace.name}`}>
        <h2 className={styles.sectionHeading}>{context.workspace.name}</h2><div className={styles.inset}><button disabled={busy} onClick={() => onOpen({ workspaceId: context.workspace.workspaceId })}>Enter Workspace: {context.workspace.name}</button></div>
        <div className={homeStyles.columns}><section className={styles.inset} aria-label={`Open Tasks in ${context.workspace.name}`}><h3>Open Tasks</h3><p className={styles.small}>Showing {context.tasks.length} of {context.openTaskCount}. Enter this Workspace for all Tasks.</p>
          {!context.tasks.length && <p>No open Tasks.</p>}
          {context.tasks.map(task => <div className={styles.actions} key={task.id}><button disabled={busy} onClick={() => onOpen({ workspaceId: context.workspace.workspaceId, item: { kind: 'task', id: task.id } })}>Open task: {task.title}</button></div>)}
        </section><section className={styles.inset} aria-label={`Upcoming Calendar in ${context.workspace.name}`}><h3>Upcoming Calendar</h3><p className={styles.small}>Showing {context.blocks.length} of {context.upcomingBlockCount} blocks in the next 7 days, including ongoing blocks.</p>
          {!context.blocks.length && <p>No blocks in this window.</p>}
          {context.blocks.map(block => <div className={styles.actions} key={block.id}><span>{when(block.start)} – {when(block.end)}</span><button disabled={busy} onClick={() => onOpen({ workspaceId: context.workspace.workspaceId, item: { kind: 'block', id: block.id } })}>Open block: {block.title}</button></div>)}
        </section></div>
      </section>)}
    </>}
    <p className={styles.small}>Tasks and OpenJob Calendar blocks only. Mail and unread counts are unavailable. Home grants no additional access.</p>
  </section>;
}
