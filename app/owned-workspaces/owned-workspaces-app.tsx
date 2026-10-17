"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { OpenJobBrand } from '../openjob-brand';
import { validateWorkspace, validateOwnedSnapshot, type OwnedWorkspace, type OwnedWorkspaceSnapshot } from '../../shared/owned-workspaces';
import type { WorkspaceCommand, WorkspaceView } from '../../shared/workspace-contracts';
import WorkspaceTasks, { type WorkspaceTasksHandle } from '../workspace/workspace-tasks';
import WorkspaceCalendar, { type WorkspaceCalendarHandle } from '../workspace/workspace-calendar';
import WorkspaceToday from '../workspace/workspace-today';
import styles from '../workspace/workspace.module.css';

type Request = (path?: string, input?: unknown) => Promise<unknown>;
export default function OwnedWorkspacesApp({ ownerUserId, getToken }: { ownerUserId: string; getToken: () => Promise<string> }) {
  const [catalog, setCatalog] = useState<OwnedWorkspace[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const lease = useRef(new AbortController());
  const request: Request = useCallback(async (path = '', input) => {
    const signal = lease.current.signal; signal.throwIfAborted(); const token = await getToken(); signal.throwIfAborted();
    const response = await fetch(`/api/owned-workspaces${path}`, { method: input ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}), signal, cache: 'no-store', redirect: 'error' });
    const raw = await response.text(); signal.throwIfAborted();
    if (!response.ok || raw.length > 1000000) throw new Error('Workspace unavailable. Refresh to inspect saved work before retrying.');
    const body = JSON.parse(raw); if (!body || !('data' in body)) throw new Error('Workspace unavailable.'); return body.data;
  }, [getToken]);
  const readCatalog = useCallback(async () => {
    const value = await request(); if (!Array.isArray(value) || value.length > 50) throw new Error('Workspace list unavailable.');
    const items = value.map(validateWorkspace); if (items.some(item => item.ownerUserId !== ownerUserId)) throw new Error('Workspace list unavailable.');
    return items;
  }, [request, ownerUserId]);
  async function refresh() { const items = await readCatalog(); setCatalog(items); return items; }
  function choose(id: string) { setSelected(id); setOpened(previous => previous.includes(id) ? previous : [...previous, id]); window.history.pushState(null, '', id ? `#${id}` : window.location.pathname); setError(''); }
  useEffect(() => {
    const controller = new AbortController(); lease.current = controller;
    void readCatalog().then(items => {
      if (controller.signal.aborted) return;
      setCatalog(items);
      const id = window.location.hash.slice(1);
      if (id && items.some(item => item.workspaceId === id)) { setSelected(id); setOpened([id]); }
      else if (id) setError('That Workspace is unavailable for this identity.');
    }).catch(() => { if (!controller.signal.aborted) setError('Workspace list unavailable. Try Refresh.'); });
    return () => controller.abort();
  }, [readCatalog]);
  useEffect(() => {
    const navigate = () => { const id = window.location.hash.slice(1); if (catalog.some(item => item.workspaceId === id)) { setSelected(id); setOpened(previous => previous.includes(id) ? previous : [...previous, id]); setError(''); } else { setSelected(''); if (id) setError('That Workspace is unavailable for this identity.'); } };
    window.addEventListener('hashchange', navigate); window.addEventListener('popstate', navigate); return () => { window.removeEventListener('hashchange', navigate); window.removeEventListener('popstate', navigate); };
  }, [catalog]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { const value = validateOwnedSnapshot(await request('', { name })); if (value.workspace.ownerUserId !== ownerUserId) throw new Error(); await refresh(); setName(''); choose(value.workspace.workspaceId); }
    catch { if (!lease.current.signal.aborted) setError('Workspace could not be created. Refresh to inspect saved work before retrying.'); }
    finally { if (!lease.current.signal.aborted) setBusy(false); }
  }
  return <div className={styles.workspace}>
    <header className={styles.header}><OpenJobBrand /><strong>Independent Workspaces · fixture pilot</strong></header>
    <p className={styles.banner}>Synthetic identity and local test database. Each Workspace has one human owner and its own Tasks and Calendar. No real accounts, Mail, invitations, grants or providers are connected. Existing Personal work is separate.</p>
    <div className={styles.layout}><aside className={styles.sidebar}>
      <label className={styles.form}>Workspace<select aria-label="Workspace" disabled={busy} value={selected} onChange={event => choose(event.target.value)}><option value="">Choose a Workspace</option>{catalog.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</select></label>
      <form className={styles.form} onSubmit={create}><label>New Workspace name<input aria-label="New Workspace name" value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} /></label><button disabled={busy || !name.trim()}>Create Workspace</button></form>
      <button disabled={busy} onClick={() => refresh().then(() => setError('')).catch(() => setError('Workspace list unavailable.'))}>Refresh Workspaces</button>
      <p>Only Workspaces owned by this identity appear. No mailbox is required.</p>
    </aside><main className={styles.main}>{error && <p role="alert" className={styles.error}>{error}</p>}{!catalog.length && !error && <p>Create a Workspace to start with Tasks and Calendar.</p>}{catalog.length > 0 && !selected && <p>Choose a Workspace to enter its work.</p>}
      {opened.map(id => { const item = catalog.find(item => item.workspaceId === id); return item && <WorkspaceSession key={id} workspace={item} active={selected === id} request={request} setBusy={setBusy} />; })}
    </main></div>
  </div>;
}
function WorkspaceSession({ workspace, active, request, setBusy }: { workspace: OwnedWorkspace; active: boolean; request: Request; setBusy: (value: boolean) => void }) {
  const [snapshot, setSnapshot] = useState<OwnedWorkspaceSnapshot>(); const [tab, setTab] = useState('Today');
  const [busy, busyState] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const tasks = useRef<WorkspaceTasksHandle>(null); const calendar = useRef<WorkspaceCalendarHandle>(null); const mounted = useRef(true);
  const accept = useCallback((value: unknown) => { const result = validateOwnedSnapshot(value); if (result.workspace.workspaceId !== workspace.workspaceId || result.workspace.ownerUserId !== workspace.ownerUserId) throw new Error(); return result; }, [workspace.workspaceId, workspace.ownerUserId]);
  useEffect(() => { mounted.current = true; void request(`/${workspace.workspaceId}`).then(accept).then(value => { if (mounted.current) { setSnapshot(value); setError(''); } }).catch(() => { if (mounted.current) setError('Workspace could not be loaded.'); }); return () => { mounted.current = false; }; }, [workspace.workspaceId, request, accept]);
  async function command(input: WorkspaceCommand, success: string) {
    if (busy) return false; busyState(true); setBusy(true); setError(''); setNotice('');
    try { const result = accept(await request(`/${workspace.workspaceId}/commands`, input)); if (!mounted.current) return false; setSnapshot(result); setNotice(success); return true; }
    catch { if (mounted.current) setError('Change unavailable in this Workspace. Your editor text is kept; refresh before retrying.'); return false; }
    finally { if (mounted.current) { busyState(false); setBusy(false); } }
  }
  async function refreshWork() {
    if (busy) return; busyState(true); setBusy(true); setError('');
    try { const value = accept(await request(`/${workspace.workspaceId}`)); if (mounted.current) { setSnapshot(value); setNotice('Saved Workspace work refreshed. Unfinished editor text is kept.'); } }
    catch { if (mounted.current) setError('Workspace could not be refreshed. Your editor text is kept.'); }
    finally { if (mounted.current) { busyState(false); setBusy(false); } }
  }
  const view: WorkspaceView | undefined = snapshot && { ...snapshot.work, accounts: [], messages: [], drafts: [], sent: [], agents: [], activity: [] };
  const openTask = (id: string) => { if (tasks.current?.openTask(id)) { setTab('Tasks'); setNotice('Task opened in this Workspace.'); } };
  return <section hidden={!active} aria-label={`Workspace ${workspace.name}`}><h1>{workspace.name}</h1><button disabled={busy} onClick={refreshWork}>Refresh work</button><p>Owner-only Workspace · online fixture. Work and unfinished editors stay in this context when switching.</p>
    <nav className={styles.folders} aria-label="Workspace modules">{['Today', 'Tasks', 'Calendar'].map(name => <button key={name} disabled={busy} aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)}>{name}</button>)}</nav>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.success}>{notice}</p>}
    {view && <><div hidden={tab !== 'Today'}><WorkspaceToday contextName={workspace.name} view={view} busy={busy} onOpenTask={openTask} onOpenEvent={id => { if (calendar.current?.openEvent(id)) setTab('Calendar'); }} onTasks={() => setTab('Tasks')} onCalendar={() => setTab('Calendar')} /></div>
    <WorkspaceTasks view={view} busy={busy} command={command} active={active && tab === 'Tasks'} ref={tasks} />
    <WorkspaceCalendar ref={calendar} view={view} busy={busy} command={command} active={active && tab === 'Calendar'} onOpenTask={source => openTask(source.taskId)} /></>}
  </section>;
}
