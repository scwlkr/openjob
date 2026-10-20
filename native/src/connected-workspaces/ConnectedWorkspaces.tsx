import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import type { PersonalWorkspaceCommand, WorkspaceView } from '../personal-workspace-contracts';
import type { ConnectedCommand, ConnectedMail, GoogleConnectionCatalog, NativeConnectedWorkspaceController, OwnedWorkspace, OwnedWorkspaceSnapshot, ProviderMessage } from '../connected-workspaces-contracts';
import { Action, Block, Copy, Field, Row } from '../personal-workspace/controls';
import { Tasks } from '../personal-workspace/Tasks';
import { Calendar } from '../personal-workspace/Calendar';
import { Today } from '../personal-workspace/Today';
import { useOpenJobTheme } from '../theme';
import { ConnectedSourceReply, type NativeReplyBuffer } from './ConnectedSource';

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
    <Copy heading>Connected Workspaces</Copy><Copy>Online owner Workspaces. Configure Mail consent using the existing Connections app. No offline Mail, provider Calendar or sending.</Copy>
    <Row><Action label="Workspace Home" selected={!selected} disabled={busy} onPress={() => setSelected('')} /><Action label="Refresh Workspaces" disabled={busy} onPress={() => void refresh()} />{catalog.map(item => <Action key={item.workspaceId} label={`Open Workspace ${item.name}`} selected={selected === item.workspaceId} disabled={busy} onPress={() => choose(item.workspaceId)} />)}</Row>
    {error ? <Copy>{error}</Copy> : null}{busy && <Copy>Loading Workspaces…</Copy>}
    {!selected && <Block><Copy heading>Your owned Workspaces</Copy>{loaded && !catalog.length && <Copy>No Workspace homes yet.</Copy>}<Action label="Open existing Personal context" disabled={busy} onPress={() => void refresh(() => controller.personal(owner))} /><Field label="New Workspace name" value={name} onChange={setName} maxLength={80} editable={!busy} /><Action label="Create Workspace" disabled={busy || !name.trim()} onPress={() => void refresh(() => controller.create(owner, name))} /></Block>}
    {opened.map(id => { const workspace = catalog.find(item => item.workspaceId === id); return workspace && <View key={id} style={{ display: selected === id ? 'flex' : 'none' }} accessibilityElementsHidden={selected !== id} importantForAccessibility={selected === id ? 'auto' : 'no-hide-descendants'}><WorkspacePanel {...props} workspace={workspace} active={active && selected === id} /></View>; })}
  </ScrollView></KeyboardAvoidingView>;
}
function WorkspacePanel({ controller, owner, workspace, active, onAccessEnded }: Props & { workspace: OwnedWorkspace }) {
  const [snapshot, setSnapshot] = useState<OwnedWorkspaceSnapshot>(), [tab, setTab] = useState('Today'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [selectedTask, setSelectedTask] = useState(''), [selectedEvent, setSelectedEvent] = useState('');
  const [buffers, setBuffers] = useState<Record<string, NativeReplyBuffer>>({});
  const [mailTitles, setMailTitles] = useState<Record<string, string>>({});
  const lease = useRef({ active: true, pending: false });
  const id = workspace.workspaceId;
  useEffect(() => { const state = lease.current; state.active = true; return () => { state.active = false; }; }, []);
  const run = useCallback(async (action?: () => Promise<OwnedWorkspaceSnapshot>) => {
    if (!lease.current.active || lease.current.pending) return false;
    lease.current.pending = true; setBusy(true); setError(''); setNotice('');
    try { const value = action ? await action() : await controller.read(owner, id); if (!lease.current.active) return false; setSnapshot(value); if (action) setNotice('Workspace work saved. No provider writes.'); return true; }
    catch (failure) { if (lease.current.active) { setError('Workspace request unavailable. Editor text is kept; refresh to check current saved work.'); onAccessEnded(failure); } return false; }
    finally { if (lease.current.active) { lease.current.pending = false; setBusy(false); } }
  }, [controller, owner, id, onAccessEnded]);
  useEffect(() => { let current = true; queueMicrotask(() => { if (current && active) void run(); }); return () => { current = false; }; }, [active, run]);
  const openTask = (taskId: string) => { setSelectedTask(taskId); setTab('Tasks'); };
  async function command(input: PersonalWorkspaceCommand, expectedNotes?: string) {
    if (input.type === 'task.delete' && buffers[input.taskId]?.dirty) { setError('Save or explicitly discard this Task’s unfinished reply before deleting.'); return false; }
    const result = await run(() => controller.command(owner, id, { ...input, ...(expectedNotes === undefined ? {} : { expectedNotes }) } as ConnectedCommand));
    if (result && input.type === 'task.delete') setBuffers(current => { const next = { ...current }; delete next[input.taskId]; return next; });
    return result;
  }
  const view: WorkspaceView | undefined = snapshot && { ...snapshot.work, accounts: [], messages: [], drafts: [], sent: [], agents: [], activity: [] };
  return <><Copy heading>{workspace.name}</Copy><Row>{['Today', 'Mail', 'Tasks', 'Calendar'].map(value => <Action key={value} label={`Workspace ${value}`} selected={tab === value} disabled={busy || !view} onPress={() => setTab(value)} />)}<Action label="Refresh Workspace work" disabled={busy} onPress={() => void run()} /></Row>
    <Copy>Task and Calendar editors stay in this context while switching modules. Save reply edits before leaving the app.</Copy>
    {error ? <Copy>{error}</Copy> : null}{notice ? <Copy>{notice}</Copy> : null}{busy && <Copy>Working online…</Copy>}
    {view && <>
      <View style={{ display: tab === 'Today' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'Today'} importantForAccessibility={tab === 'Today' ? 'auto' : 'no-hide-descendants'}><Today contextName={workspace.name} view={view} busy={busy} onTask={openTask} onEvent={event => { setSelectedEvent(event); setTab('Calendar'); }} onTasks={() => setTab('Tasks')} onCalendar={() => setTab('Calendar')} /></View>
      {active && tab === 'Mail' && <ConnectedMailList titles={mailTitles} onTitle={(key, title) => setMailTitles(current => ({ ...current, [key]: title }))} controller={controller} owner={owner} workspaceId={id} onTask={async task => { await run(); if (lease.current.active) openTask(task); }} onAccessEnded={onAccessEnded} />}
      <View style={{ display: tab === 'Tasks' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'Tasks'} importantForAccessibility={tab === 'Tasks' ? 'auto' : 'no-hide-descendants'}><Tasks contextName={workspace.name} view={view} busy={busy} selectedId={selectedTask} command={command} onSource={() => undefined} onSaveNotes={(task, notes, base) => command({ type: 'task.notes', taskId: task, notes }, base)} connectedSource={taskId => active && tab === 'Tasks' ? <ConnectedSourceReply controller={controller} owner={owner} workspaceId={id} taskId={taskId} buffer={buffers[taskId]} onBuffer={buffer => setBuffers(current => { const next = { ...current }; if (buffer) next[taskId] = buffer; else delete next[taskId]; return next; })} onAccessEnded={onAccessEnded} /> : null} /></View>
      <View style={{ display: tab === 'Calendar' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'Calendar'} importantForAccessibility={tab === 'Calendar' ? 'auto' : 'no-hide-descendants'}><Calendar contextName={workspace.name} view={view} busy={busy} command={command} selectedId={selectedEvent} onTask={openTask} /></View>
    </>}
  </>;
}
function ConnectedMailList({ titles, onTitle, controller, owner, workspaceId, onTask, onAccessEnded }: { titles: Record<string, string>; onTitle(key: string, title: string): void; controller: NativeConnectedWorkspaceController; owner: string; workspaceId: string; onTask(taskId: string): Promise<void>; onAccessEnded(error: unknown): void }) {
  const [catalog, setCatalog] = useState<GoogleConnectionCatalog>(), [mail, setMail] = useState<ConnectedMail>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [selected, setSelected] = useState('');
  const lease = useRef({ active: true, pending: false });
  useEffect(() => { const state = lease.current; state.active = true; return () => { state.active = false; }; }, []);
  const run = useCallback(async (action?: () => Promise<void>) => {
    if (!lease.current.active || lease.current.pending) return;
    lease.current.pending = true; setBusy(true); setError('');
    try { if (action) await action(); else { const value = await controller.connections(owner); if (lease.current.active) setCatalog(value); } }
    catch (failure) { if (lease.current.active) { setMail(undefined); setError('Mail or Task request unavailable. Your reviewed title is kept. Refresh to check the connection and saved work before retrying.'); onAccessEnded(failure); } }
    finally { if (lease.current.active) { lease.current.pending = false; setBusy(false); } }
  }, [controller, owner, onAccessEnded]);
  useEffect(() => { let current = true; queueMicrotask(() => { if (current) void run(); }); return () => { current = false; }; }, [run]);
  return <Block><Copy heading>Configured Mail</Copy><Copy>Source messages are fetched on demand. No examples are substituted for an empty or unavailable account.</Copy><Action label="Refresh configured Mail accounts" disabled={busy} onPress={() => { setMail(undefined); void run(); }} />{error ? <Copy>{error}</Copy> : null}
    {catalog?.bindings.filter(row => row.workspaceId === workspaceId).map(row => <Block key={row.id}><Copy>{row.address} · {row.status}{row.expired ? ' · expired' : ''}</Copy><Action label={`Read Mail ${row.address}`} disabled={busy || row.status !== 'connected' || row.expired || !catalog.mailAvailable} onPress={() => { setMail(undefined); void run(async () => { const value = await controller.mail(owner, workspaceId, row.id); if (lease.current.active) { setSelected(row.id); setMail(value); } }); }} /></Block>)}
    {catalog && !catalog.bindings.some(row => row.workspaceId === workspaceId) && <Copy>No Mail connection belongs to this Workspace.</Copy>}
    {mail && <><Copy>{mail.mode === 'google-fixture' ? 'Invented protocol Mail' : 'Connected read-only Mail'}</Copy>{!mail.page.messages.length && <Copy>No messages in this bounded Mail page.</Copy>}{mail.page.messages.map(message => <MailTask key={`${selected}:${message.id}`} title={titles[`${selected}:${message.id}`] ?? message.subject.slice(0, 500)} onTitle={title => onTitle(`${selected}:${message.id}`, title)} message={message} busy={busy} create={title => run(async () => { const result = await controller.createMailTask(owner, workspaceId, selected, { messageId: message.upstreamId, title }); if (lease.current.active) await onTask(result.taskId); })} />)}</>}
  </Block>;
}
function MailTask({ message, title, onTitle, busy, create }: { message: ProviderMessage; title: string; onTitle(title: string): void; busy: boolean; create(title: string): Promise<void> }) {
  return <Block><Copy heading>{message.subject}</Copy><Copy>From: {message.from}</Copy><Copy>{message.body}</Copy><Field label="Connected Task title" value={title} onChange={onTitle} editable={!busy} maxLength={500} /><Action label={`Create or find Task from ${message.subject}`} disabled={busy || !title.trim()} onPress={() => void create(title)} /></Block>;
}
