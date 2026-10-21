"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReplyEditorBuffer } from '../connections/connected-reply-editor';
import WorkspaceHome from './workspace-home';
import { parseWorkspaceFragment, workspaceFragment, type WorkspaceDestination } from '../../shared/workspace-navigation';
import { OpenJobBrand } from '../openjob-brand';
import { validateWorkspace, validateOwnedSnapshot, type OwnedWorkspace, type OwnedWorkspaceSnapshot } from '../../shared/owned-workspaces';
import type { WorkspaceCommand, WorkspaceView } from '../../shared/workspace-contracts';
import WorkspaceTasks, { type WorkspaceTasksHandle } from '../workspace/workspace-tasks';
import WorkspaceCalendar, { type WorkspaceCalendarHandle } from '../workspace/workspace-calendar';
import WorkspaceToday from '../workspace/workspace-today';
import styles from '../workspace/workspace.module.css';
import WorkspaceAgents from './workspace-agents';
import WorkspaceMail from './workspace-mail';
import { requestConnections, type ConnectionsRequest } from '../connections/connection-request';
import ConnectedTaskSource from '../connections/connected-task-source';

type Request = (path?: string, input?: unknown, method?: 'DELETE') => Promise<unknown>;
export default function OwnedWorkspacesApp({ ownerUserId, getToken, apiBase = "/api/owned-workspaces", mode = "fixture" }: { ownerUserId: string; getToken: () => Promise<string>; apiBase?: string; mode?: "fixture" | "pilot" }) {
  const [catalog, setCatalog] = useState<OwnedWorkspace[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [opened, setOpened] = useState<string[]>([]);
  const [destination, setDestination] = useState<WorkspaceDestination>({ workspaceId: '' });
  const selected = destination.workspaceId;
  const [eligibility, setEligibility] = useState('Real onboarding unavailable. Identity eligibility policy is pending.');
  const [name, setName] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const lease = useRef(new AbortController());
  const request: Request = useCallback(async (path = '', input, method) => {
    const signal = lease.current.signal; signal.throwIfAborted(); const token = await getToken(); signal.throwIfAborted();
    const response = await fetch(`${apiBase}${path}`, { method: method ?? (input ? 'POST' : 'GET'), headers: { authorization: `Bearer ${token}`, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}), signal, cache: 'no-store', redirect: 'error' });
    const raw = await response.text(); signal.throwIfAborted();
    if (!response.ok || raw.length > 1000000) throw new Error('Workspace unavailable. Refresh to inspect saved work before retrying.');
    const body = JSON.parse(raw); if (!body || !('data' in body)) throw new Error('Workspace unavailable.'); return body.data;
  }, [getToken, apiBase]);
  const connectionRequest: ConnectionsRequest = useCallback((path, input) => requestConnections(getToken, lease.current.signal, path, input), [getToken]);
  const readCatalog = useCallback(async () => {
    const value = await request(); if (!Array.isArray(value) || value.length > 51) throw new Error('Workspace list unavailable.');
    const items = value.map(validateWorkspace); if (items.some(item => item.ownerUserId !== ownerUserId)) throw new Error('Workspace list unavailable.');
    return items;
  }, [request, ownerUserId]);
  async function refresh() { const items = await readCatalog(); setCatalog(items); setCatalogReady(true); return items; }
  function choose(next: WorkspaceDestination) { setDestination(next); if (next.workspaceId) setOpened(previous => previous.includes(next.workspaceId) ? previous : [...previous, next.workspaceId]); window.history.pushState(null, '', workspaceFragment(next)); setError(''); }
  useEffect(() => {
    const controller = new AbortController(); lease.current = controller;
    if (mode === 'fixture') void request('/eligibility').then(value => { const status = value as { state?: string; realOnboardingEnabled?: boolean }; if (controller.signal.aborted) return; setEligibility(status.state === 'policy_pending' && status.realOnboardingEnabled === false ? 'Real onboarding unavailable. Independent sign-in eligibility policy has not been adopted.' : 'Real onboarding unavailable. Eligibility status could not be verified.'); }).catch(() => {});
    void readCatalog().then(items => {
      if (controller.signal.aborted) return;
      setCatalog(items); setCatalogReady(true);
      const next = parseWorkspaceFragment(window.location.hash);
      if (next && (!next.workspaceId || items.some(item => item.workspaceId === next.workspaceId))) { setDestination(next); if (next.workspaceId) setOpened([next.workspaceId]); }
      else setError('Unavailable in this context.');
    }).catch(() => { if (!controller.signal.aborted) setError('Workspace list unavailable. Try Refresh.'); });
    return () => controller.abort();
  }, [readCatalog, request, mode]);
  useEffect(() => {
    const navigate = () => { try { const next = parseWorkspaceFragment(window.location.hash); if (next && (!next.workspaceId || catalog.some(item => item.workspaceId === next.workspaceId))) { setDestination(next); if (next) setOpened(previous => previous.includes(next.workspaceId) ? previous : [...previous, next.workspaceId]); setError(''); } else { setDestination({ workspaceId: '' }); setError('Unavailable in this context.'); } } catch { setDestination({ workspaceId: '' }); setError('Unavailable in this context.'); } };
    window.addEventListener('hashchange', navigate); window.addEventListener('popstate', navigate); return () => { window.removeEventListener('hashchange', navigate); window.removeEventListener('popstate', navigate); };
  }, [catalog]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { const value = validateOwnedSnapshot(await request('', { name })); if (value.workspace.ownerUserId !== ownerUserId) throw new Error(); await refresh(); setName(''); choose({ workspaceId: value.workspace.workspaceId }); }
    catch { if (!lease.current.signal.aborted) setError('Workspace could not be created. Refresh to inspect saved work before retrying.'); }
    finally { if (!lease.current.signal.aborted) setBusy(false); }
  }
  async function openPersonal() {
    if (busy) return; setBusy(true); setError('');
    try { const value = validateOwnedSnapshot(await request('/personal-context', {})); if (value.workspace.ownerUserId !== ownerUserId) throw new Error(); await refresh(); choose({ workspaceId: value.workspace.workspaceId }); }
    catch { if (!lease.current.signal.aborted) setError('Personal context unavailable. Existing saved work was kept.'); }
    finally { if (!lease.current.signal.aborted) setBusy(false); }
  }
  async function openFromHome(next: WorkspaceDestination) {
    if (busy) return; setBusy(true); setError('');
    try { const items = await readCatalog(); if (!items.some(item => item.workspaceId === next.workspaceId)) throw new Error(); setCatalog(items); choose(next); }
    catch { if (!lease.current.signal.aborted) setError('Unavailable in this context.'); }
    finally { if (!lease.current.signal.aborted) setBusy(false); }
  }
  return <div className={styles.workspace}>
    <header className={styles.header}><OpenJobBrand /><strong>{mode === "fixture" ? "Independent Workspaces · fixture pilot" : "Workspaces · owner pilot"}</strong></header>
    <p className={styles.banner}>{mode === "fixture" ? "Synthetic identity and local test database. No real accounts or providers are connected." : "Limited owner pilot using your existing OpenJob identity. Read assigned Mail inside its Workspace; manage account access in Connections."} Each Workspace has its own Tasks and Calendar. Invitations are unavailable. Independent Workspace agent grants cover Tasks and Calendar. Retained Personal work stays in its existing authority.</p>
    <p className={styles.banner} role="status">{mode === "fixture" ? eligibility + " This fixture cannot grant real-account access." : "Limited admission is not a classification of independent personal control or a guarantee of employer isolation."}</p>
    <div className={styles.layout}><aside className={styles.sidebar}>
      <button disabled={busy} aria-current={!selected ? "page" : undefined} onClick={() => choose({ workspaceId: '' })}>Home</button>
      <button disabled={busy} onClick={openPersonal}>Open existing Personal context</button>
      <label className={styles.form}>Workspace<select aria-label="Workspace" disabled={busy} value={selected} onChange={event => choose({ workspaceId: event.target.value })}><option value="">Home — all owned Workspaces</option>{catalog.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</select></label>
      <form className={styles.form} onSubmit={create}><label>New Workspace name<input aria-label="New Workspace name" value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} /></label><button disabled={busy || !name.trim()}>Create Workspace</button></form>
      <button disabled={busy} onClick={() => refresh().then(() => setError('')).catch(() => setError('Workspace list unavailable.'))}>Refresh Workspaces</button>
      <p>Only Workspaces owned by this identity appear. No mailbox is required.</p>
    </aside><main className={styles.main}>{error && <p role="alert" className={styles.error}>{error}</p>}{!catalogReady && !error && <p role="status">Loading Workspaces…</p>}{catalogReady && !selected && <WorkspaceHome owner={ownerUserId} request={request} busy={busy} onOpen={openFromHome} />}
      {opened.map(id => { const item = catalog.find(item => item.workspaceId === id); return item && <WorkspaceSession key={id} workspace={item} active={selected === id} request={request} setBusy={setBusy} onNavigate={choose} navigation={selected === id ? destination : undefined} getToken={mode === 'pilot' ? getToken : undefined} connectionRequest={mode === 'pilot' ? connectionRequest : undefined} />; })}
    </main></div>
  </div>;
}
function WorkspaceSession({ workspace, active, request, setBusy, navigation, onNavigate, getToken, connectionRequest }: { connectionRequest?: ConnectionsRequest; getToken?: () => Promise<string>; onNavigate: (destination: WorkspaceDestination) => void; navigation?: WorkspaceDestination; workspace: OwnedWorkspace; active: boolean; request: Request; setBusy: (value: boolean) => void }) {
  const [replyBuffers, setReplyBuffers] = useState<Record<string, ReplyEditorBuffer>>({});
  useEffect(() => {
    if (!Object.values(replyBuffers).some(buffer => buffer.dirty)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [replyBuffers]);
  const [snapshot, setSnapshot] = useState<OwnedWorkspaceSnapshot>(); const [tab, setTab] = useState('Today');
  const target = navigation?.item;
  const [loadedDestination, setLoadedDestination] = useState<WorkspaceDestination>();
  const ready = loadedDestination === navigation;
  const currentTab = target ? target.kind === 'task' ? 'Tasks' : 'Calendar' : tab;
  const [busy, busyState] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const tasks = useRef<WorkspaceTasksHandle>(null); const calendar = useRef<WorkspaceCalendarHandle>(null); const mounted = useRef(true);
  const accept = useCallback((value: unknown) => { const result = validateOwnedSnapshot(value); if (result.workspace.workspaceId !== workspace.workspaceId || result.workspace.ownerUserId !== workspace.ownerUserId) throw new Error(); return result; }, [workspace.workspaceId, workspace.ownerUserId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!active) return;
    let current = true;
    void request(`/${workspace.workspaceId}`).then(accept).then(value => { if (current) { setSnapshot(value); setLoadedDestination(navigation); setError(''); } }).catch(() => { if (current) setError('Workspace could not be loaded.'); });
    return () => { current = false; };
  }, [workspace.workspaceId, request, accept, active, navigation]);
  useEffect(() => {
    if (!active || !ready || !target || !snapshot) return;
    const exists = target.kind === 'task' ? snapshot.work.tasks.some(item => item.id === target.id) : snapshot.work.events.some(item => item.id === target.id);
    if (!exists) return;
    if (target.kind === 'task') tasks.current?.openTask(target.id); else calendar.current?.openEvent(target.id);
  }, [active, ready, target, snapshot]);
  async function command(input: WorkspaceCommand, success: string, expectedNotes?: string) {
    if (input.type === 'task.delete' && replyBuffers[input.taskId]?.dirty) { setError('Save or explicitly discard this Task’s unfinished reply before deleting the Task.'); return false; }
    if (busy) return false; busyState(true); setBusy(true); setError(''); setNotice('');
    try { const result = accept(await request(`/${workspace.workspaceId}/commands`, expectedNotes === undefined ? input : { ...input, expectedNotes })); if (!mounted.current) return false; setSnapshot(result); if (input.type === 'task.delete') setReplyBuffers(current => { const next = { ...current }; delete next[input.taskId]; return next; }); setNotice(success); return true; }
    catch { if (mounted.current) setError('Change unavailable in this Workspace. Your editor text is kept; refresh before retrying.'); return false; }
    finally { if (mounted.current) { busyState(false); setBusy(false); } }
  }
  async function refreshWork() {
    if (busy) return; busyState(true); setBusy(true); setError('');
    try { const value = accept(await request(`/${workspace.workspaceId}`)); if (mounted.current) { setSnapshot(value); setLoadedDestination(navigation); setNotice('Saved Workspace work refreshed. Unfinished editor text is kept.'); } }
    catch { if (mounted.current) setError('Workspace could not be refreshed. Your editor text is kept.'); }
    finally { if (mounted.current) { busyState(false); setBusy(false); } }
  }
  const view: WorkspaceView | undefined = snapshot && { ...snapshot.work, accounts: [], messages: [], drafts: [], sent: [], agents: [], activity: [] };
  const openTask = (id: string) => { if (tasks.current?.openTask(id)) { onNavigate({ workspaceId: workspace.workspaceId, item: { kind: 'task', id } }); setNotice('Task opened in this Workspace.'); } };
  const openTab = (name: string) => { onNavigate({ workspaceId: workspace.workspaceId }); setTab(name); };
  const missingTarget = ready && !!target && !!snapshot && !(target.kind === 'task' ? snapshot.work.tasks : snapshot.work.events).some(item => item.id === target.id);
  return <section hidden={!active} aria-label={`Workspace ${workspace.name}`}><h1>{workspace.name}</h1><button disabled={busy} onClick={refreshWork}>Refresh work</button><p>Owner-only Workspace · online. Work and unfinished editors stay in this context when switching.</p>
    <nav className={styles.folders} aria-label="Workspace modules">{['Today', ...(connectionRequest ? ['Mail'] : []), 'Tasks', 'Calendar', 'Agents'].map(name => <button key={name} disabled={busy} aria-current={currentTab === name ? 'page' : undefined} onClick={() => openTab(name)}>{name}</button>)}</nav>
    {active && !ready && !error && <p role="status">Loading Workspace…</p>}{missingTarget && <p role="alert" className={styles.error}>Unavailable in this context.</p>}
{error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.success}>{notice}</p>}
    {connectionRequest && <WorkspaceMail workspaceId={workspace.workspaceId} request={connectionRequest} active={active && ready && currentTab === 'Mail'} onOpenTask={id => onNavigate({ workspaceId: workspace.workspaceId, item: { kind: 'task', id } })} onOpenWorkspace={() => openTab('Tasks')} />}
    {active && ready && currentTab === 'Agents' && <WorkspaceAgents key={workspace.workspaceId} workspace={workspace} request={request} onOpenItem={item => onNavigate({ workspaceId: workspace.workspaceId, item })} />}
    {view && <><div hidden={!active || !ready || currentTab !== 'Today'}><WorkspaceToday contextName={workspace.name} view={view} busy={busy} onOpenTask={openTask} onOpenEvent={id => { if (calendar.current?.openEvent(id)) onNavigate({ workspaceId: workspace.workspaceId, item: { kind: 'block', id } }); }} onTasks={() => openTab('Tasks')} onCalendar={() => openTab('Calendar')} /></div>
    <WorkspaceTasks view={view} busy={busy} command={command} onSaveNotes={(taskId, notes, expectedNotes) => command({ type: 'task.notes', taskId, notes }, 'Task notes saved', expectedNotes)} active={active && ready && currentTab === 'Tasks'} ref={tasks} connectedSource={getToken ? taskId => <ConnectedTaskSource key={taskId} workspaceId={workspace.workspaceId} taskId={taskId} getToken={getToken} buffer={replyBuffers[taskId]} onBuffer={buffer => setReplyBuffers(current => { const next = { ...current }; const value = typeof buffer === 'function' ? buffer(current[taskId]) : buffer; if (value) next[taskId] = value; else delete next[taskId]; return next; })} /> : undefined} />
    <WorkspaceCalendar ref={calendar} view={view} busy={busy} command={command} active={active && ready && currentTab === 'Calendar'} onOpenTask={source => openTask(source.taskId)} /></>}
  </section>;
}
