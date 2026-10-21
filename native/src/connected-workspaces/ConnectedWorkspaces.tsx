import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import type { PersonalWorkspaceCommand, WorkspaceView } from '../personal-workspace-contracts';
import type { ConnectedCommand, NativeConnectedWorkspaceController, OwnedWorkspace, OwnedWorkspaceSnapshot } from '../connected-workspaces-contracts';
import { Action, Block, Copy, Field, Row } from '../personal-workspace/controls';
import { Tasks } from '../personal-workspace/Tasks';
import { Calendar } from '../personal-workspace/Calendar';
import { Today } from '../personal-workspace/Today';
import { useOpenJobTheme } from '../theme';
import { ConnectedSourceReply, type NativeReplyBuffer } from './ConnectedSource';
import { ConfiguredMail } from './ConfiguredMail';
import { useNativeMailIntents } from './mail-task-intents';
import { ProviderCalendar } from './ProviderCalendar';
import { useNativeCalendarDrafts } from './calendar-drafts';
import { canStartProviderIntent } from '../../../shared/provider-planning-editor';
import type { RemotePlanningLink } from '../../../shared/remote-planning';
import { WorkspaceAgents } from './WorkspaceAgents';

type Props = { controller: NativeConnectedWorkspaceController; owner: string; active: boolean; sessionReady: boolean; onAccessEnded(error: unknown): void };
export function ConnectedWorkspaces(props: Props) {
  const { controller, owner, active, sessionReady, onAccessEnded } = props;
  const [catalog, setCatalog] = useState<OwnedWorkspace[]>([]), [selected, setSelected] = useState(''), [opened, setOpened] = useState<string[]>([]), [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const lease = useRef({ active: true, pending: false });
  useEffect(() => { const state = lease.current; state.active = true; return () => { state.active = false; }; }, []);
  const choose = (id: string) => { setSelected(id); setOpened(current => current.includes(id) ? current : [...current, id]); };
  const refresh = useCallback(async (action?: () => Promise<OwnedWorkspaceSnapshot>) => {
    if (!sessionReady || lease.current.pending || !lease.current.active) return;
    lease.current.pending = true; setBusy(true); setError('');
    try {
      const created = action ? await action() : undefined;
      const items = await controller.list(owner); if (!lease.current.active) return;
      setCatalog(items); setLoaded(true);
      if (created) { const id = created.workspace.workspaceId; setSelected(id); setOpened(current => current.includes(id) ? current : [...current, id]); setName(''); }
    } catch (failure) { if (lease.current.active) { setError('Connected Workspaces unavailable. This account may not be admitted or the service may not be configured. Existing Personal work remains available.'); onAccessEnded(failure); } }
    finally { if (lease.current.active) { lease.current.pending = false; setBusy(false); } }
  }, [controller, owner, sessionReady, onAccessEnded]);
  useEffect(() => { let current = true; queueMicrotask(() => { if (current && active && sessionReady && !loaded) void refresh(); }); return () => { current = false; }; }, [active, sessionReady, loaded, refresh]);
  const { palette } = useOpenJobTheme();
  if (!sessionReady) return <Block><Copy>Restore the online session to open connected Workspaces. Personal saved Tasks and Calendar remain separate.</Copy></Block>;
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: palette.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12 }}>
    <Copy heading>Connected Workspaces</Copy><Copy>Online owner Workspaces. Configure Mail consent using the existing Connections app. Personal offline work remains separate. Sending is off.</Copy>
    <Row><Action label="Workspace Home" selected={!selected} disabled={busy} onPress={() => setSelected('')} /><Action label="Refresh Workspaces" disabled={busy} onPress={() => void refresh()} />{catalog.map(item => <Action key={item.workspaceId} label={`Open Workspace ${item.name}`} selected={selected === item.workspaceId} disabled={busy} onPress={() => choose(item.workspaceId)} />)}</Row>
    {error ? <Copy>{error}</Copy> : null}{busy && <Copy>Loading Workspaces…</Copy>}
    {!selected && <Block><Copy heading>Your owned Workspaces</Copy>{loaded && !catalog.length && <Copy>No Workspace homes yet.</Copy>}<Action label="Open existing Personal context" disabled={busy} onPress={() => void refresh(() => controller.personal(owner))} /><Field label="New Workspace name" value={name} onChange={setName} maxLength={80} editable={!busy} /><Action label="Create Workspace" disabled={busy || !name.trim()} onPress={() => void refresh(() => controller.create(owner, name))} /></Block>}
    {opened.map(id => { const workspace = catalog.find(item => item.workspaceId === id); return workspace && <View key={id} style={{ display: selected === id ? 'flex' : 'none' }} accessibilityElementsHidden={selected !== id} importantForAccessibility={selected === id ? 'auto' : 'no-hide-descendants'}><WorkspacePanel {...props} workspace={workspace} active={active && selected === id} /></View>; })}
  </ScrollView></KeyboardAvoidingView>;
}
function WorkspacePanel({ controller, owner, workspace, active, onAccessEnded }: Props & { workspace: OwnedWorkspace }) {
  const [snapshot, setSnapshot] = useState<OwnedWorkspaceSnapshot>(), [tab, setTab] = useState('Today'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [selectedTask, setSelectedTask] = useState(''), [selectedEvent, setSelectedEvent] = useState('');
  const calendarDrafts = useNativeCalendarDrafts();
  const [providerLinks, setProviderLinks] = useState<RemotePlanningLink[]>();
  const planningLease = useRef<AbortController | undefined>(undefined);
  const [buffers, setBuffers] = useState<Record<string, NativeReplyBuffer>>({});
  const mailIntents = useNativeMailIntents(controller, owner, workspace.workspaceId, onAccessEnded);
  const lease = useRef({ active: true, pending: false });
  const id = workspace.workspaceId;
  useEffect(() => { const state = lease.current; state.active = true; return () => { state.active = false; }; }, []);
  const run = useCallback(async (action?: () => Promise<OwnedWorkspaceSnapshot>) => {
    if (!lease.current.active || lease.current.pending) return false;
    lease.current.pending = true; setBusy(true); setError(''); setNotice('');
    try { const value = action ? await action() : await controller.read(owner, id); if (!lease.current.active) return false; setSnapshot(value); if (action) setNotice('Workspace work saved. No provider writes.'); return value; }
    catch (failure) { if (lease.current.active) { setError('Workspace request unavailable. Editor text is kept; refresh to check current saved work.'); onAccessEnded(failure); } return false; }
    finally { if (lease.current.active) { lease.current.pending = false; setBusy(false); } }
  }, [controller, owner, id, onAccessEnded]);
  useEffect(() => { let current = true; queueMicrotask(() => { if (current && active) void run(); }); return () => { current = false; }; }, [active, run]);
  useEffect(() => {
    if (!active) { planningLease.current?.abort(); return; }
    const abort = new AbortController(); planningLease.current = abort; queueMicrotask(() => { if (!abort.signal.aborted) setProviderLinks(undefined); });
    void controller.planning(owner, id, abort.signal).then(rows => { if (!abort.signal.aborted) setProviderLinks(rows); }).catch(failure => { if (!abort.signal.aborted) { setProviderLinks((failure as { code?: string }).code === 'not_configured' ? [] : undefined); onAccessEnded(failure); } });
    return () => abort.abort();
  }, [active, controller, owner, id, onAccessEnded]);
  const acceptProviderLinks = useCallback((rows: RemotePlanningLink[] | undefined) => { planningLease.current?.abort(); setProviderLinks(rows); }, []);
  const openProviderTask = (taskId: string) => { calendarDrafts.selectTask(taskId); setTab('Calendar'); };
  const openTask = (taskId: string) => { setSelectedTask(taskId); setTab('Tasks'); };
  async function command(input: PersonalWorkspaceCommand, expectedNotes?: string) {
    if (['task.schedule', 'task.schedule-available', 'task.unschedule', 'task.delete'].includes(input.type) && 'taskId' in input) {
      if (!providerLinks || providerLinks.some(row => row.taskId === input.taskId)) { setError('Inspect provider planning, then detach or delete its provider block before changing the local schedule or deleting this Task.'); return false; }
      const intent = calendarDrafts.intents[input.taskId];
      if (calendarDrafts.detaches[input.taskId] || intent && !canStartProviderIntent(intent) || input.type === 'task.delete' && calendarDrafts.editors[input.taskId]?.dirty) { setError('Resolve the pending Calendar request and explicitly discard unfinished provider edits before deleting this Task.'); return false; }
    }
    if (input.type === 'task.delete' && buffers[input.taskId]?.dirty) { setError('Save or explicitly discard this Task’s unfinished reply before deleting.'); return false; }
    const result = await run(() => controller.command(owner, id, { ...input, ...(expectedNotes === undefined ? {} : { expectedNotes }) } as ConnectedCommand));
    if (result && input.type === 'task.delete') setBuffers(current => { const next = { ...current }; delete next[input.taskId]; return next; });
    return !!result;
  }
  const view: WorkspaceView | undefined = snapshot && { ...snapshot.work, accounts: [], messages: [], drafts: [], sent: [], agents: [], activity: [] };
  return <><Copy heading>{workspace.name}</Copy><Row>{['Today', 'Mail', 'Tasks', 'Calendar', 'Agents'].map(value => <Action key={value} label={`Workspace ${value}`} selected={tab === value} disabled={busy || !view} onPress={() => setTab(value)} />)}<Action label="Refresh Workspace work" disabled={busy} onPress={() => void run()} /></Row>
    <Copy>Task and Calendar editors stay in this context while switching modules. Save authored work before closing the app. Provider observations clear when hidden; pending Calendar requests stay in this session.</Copy>
    {error ? <Copy>{error}</Copy> : null}{notice ? <Copy>{notice}</Copy> : null}{busy && <Copy>Working online…</Copy>}
    {view && <>
      <View style={{ display: tab === 'Today' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'Today'} importantForAccessibility={tab === 'Today' ? 'auto' : 'no-hide-descendants'}><Today contextName={workspace.name} view={view} busy={busy} onTask={openTask} onEvent={event => { setSelectedEvent(event); setTab('Calendar'); }} onTasks={() => setTab('Tasks')} onCalendar={() => setTab('Calendar')} /></View>
      {active && tab === 'Mail' && <ConfiguredMail intents={mailIntents} controller={controller} owner={owner} workspaceId={id} onTask={async task => { await run(); if (lease.current.active) openTask(task); }} onAccessEnded={onAccessEnded} />}
      <View style={{ display: tab === 'Tasks' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'Tasks'} importantForAccessibility={tab === 'Tasks' ? 'auto' : 'no-hide-descendants'}><Tasks contextName={workspace.name} view={view} busy={busy} selectedId={selectedTask} command={command} onSource={() => undefined} onSaveNotes={(task, notes, base) => command({ type: 'task.notes', taskId: task, notes }, base)} providerPlanning={providerLinks ? Object.fromEntries(providerLinks.map(row => [row.taskId, row.state])) : undefined} onProviderPlan={openProviderTask} connectedSource={taskId => active && tab === 'Tasks' ? <ConnectedSourceReply controller={controller} owner={owner} workspaceId={id} taskId={taskId} buffer={buffers[taskId]} onBuffer={buffer => setBuffers(current => { const next = { ...current }; if (buffer) next[taskId] = buffer; else delete next[taskId]; return next; })} onAccessEnded={onAccessEnded} /> : null} /></View>
      <View style={{ display: tab === 'Calendar' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'Calendar'} importantForAccessibility={tab === 'Calendar' ? 'auto' : 'no-hide-descendants'}>{active && tab === 'Calendar' && <ProviderCalendar key={`${owner}:${id}`} controller={controller} owner={owner} workspaceId={id} view={view} links={providerLinks} drafts={calendarDrafts} onPlanning={acceptProviderLinks} onAccessEnded={onAccessEnded} onTask={openTask} />}<Calendar contextName={workspace.name} view={view} busy={busy} command={command} selectedId={selectedEvent} onTask={openTask} /></View>
      {active && tab === 'Agents' && <WorkspaceAgents key={`${owner}:${id}`} controller={controller} owner={owner} workspace={workspace} onAccessEnded={onAccessEnded} onOpenItem={async target => {
        const fresh = await run(); if (!fresh || !lease.current.active) return;
        const exists = target.kind === 'task' ? fresh.work.tasks.some(task => task.id === target.id) : fresh.work.events.some(event => event.id === target.id);
        if (!exists) { setError('This agent action’s item is unavailable in the current Workspace. Saved work is unchanged.'); return; }
        if (target.kind === 'task') openTask(target.id); else { setSelectedEvent(target.id); setTab('Calendar'); }
      }} />}
    </>}
  </>;
}
