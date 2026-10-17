import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { NativePersonalWorkspaceController, PersonalWorkspaceCommand, WorkspaceView } from '../personal-workspace-contracts';
import type { PersonalWorkspaceProps } from './NativePersonalWorkspace';
import { ReadyWorkspace } from './OnlineWorkspace';
import { Tasks } from './Tasks';
import { Calendar } from './Calendar';
import { Action, Block, Confirm, Copy, Row } from './controls';
import { useOpenJobTheme } from '../theme';
import { OpenJobBrandmark, OpenJobWordmark } from '../brand-marks';

type Offline = NonNullable<NativePersonalWorkspaceController['offline']>;
type State = Awaited<ReturnType<Offline['load']>>;
type Props = PersonalWorkspaceProps & { offline: Offline };
export function OfflineWorkspace({ offline, ownerUserId, sessionReady, onSessionRevoked, ...props }: Props) {
  const { palette, isDark } = useOpenJobTheme();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState('');
  const [error, setError] = useState('');
  const [ended, setEnded] = useState(false);
  const [tab, setTab] = useState('Tasks');
  const [onlineRefresh, setOnlineRefresh] = useState(0);
  const [selectedTask, setSelectedTask] = useState('');
  const [choice, setChoice] = useState<{ strategy: 'server' | 'local'; review: string } | null>(null);
  const lease = useRef({ active: true, pending: false, epoch: 0 });
  const scroll = useRef<ScrollView>(null);
  const revokeOnline = useCallback(() => { lease.current.epoch += 1; setState(null); setEnded(true); onSessionRevoked(); }, [onSessionRevoked]);
  const run = useCallback(async (action: () => Promise<State>, label = 'Saving on device…') => {
    const epoch = lease.current.epoch;
    const current = () => lease.current.active && lease.current.epoch === epoch;
    if (!current() || lease.current.pending) return false;
    lease.current.pending = true; setOperation(label); setBusy(true); setError('');
    try { const next = await action(); if (!current()) return false; setState(next); setChoice(null); return !next.error; }
    catch (failure) {
      if (!current()) return false;
      const issue = failure as { status?: number; code?: string };
      if (issue?.status === 401 || issue?.status === 410 || issue?.code === 'revoked') {
        setState(null); setEnded(true);
        if (issue.status === 401 || issue.status === 410) onSessionRevoked();
      } else setError('Request could not be completed. Saved changes remain on this device. Restore connectivity and review before syncing.');
      return false;
    } finally { if (current()) { lease.current.pending = false; setBusy(false); } }
  }, [onSessionRevoked]);
  useEffect(() => {
    const scope = lease.current; scope.active = true; const epoch = scope.epoch;
    queueMicrotask(() => { if (scope.active && scope.epoch === epoch) void run(() => offline.load(ownerUserId), 'Loading saved workspace…'); });
    return () => { scope.active = false; scope.pending = false; scope.epoch += 1; };
  }, [offline, ownerUserId, sessionReady, run]);
  const open = (name: string) => {
    setTab(name); scroll.current?.scrollTo({ y: 0, animated: false });
    if (name === 'Online') setOnlineRefresh(value => value + 1);
    else if (sessionReady && !busy) void run(() => offline.refresh(ownerUserId), 'Refreshing…');
  };
  const visibleTab = !sessionReady && tab === 'Online' ? 'Tasks' : tab;
  const projection = state?.projection;
  const view: WorkspaceView | null = projection ? { ...projection, accounts: [], messages: [], drafts: [], sent: [], agents: [], activity: [] } : null;
  const command = (input: PersonalWorkspaceCommand) => {
    if (!input.type.startsWith('task.') && !input.type.startsWith('calendar.')) return Promise.resolve(false);
    return run(() => offline.edit(ownerUserId, input as Parameters<Offline['edit']>[1]));
  };
  const stateError = state?.error === 'workspace_capacity' ? 'Server capacity was reached. Saved work is kept on this device. Reduce pending work or wait for capacity before syncing.' : state?.error === 'body_too_large' ? 'This batch is too large to sync. Saved work is kept on this device. Reduce pending work before syncing.' : state?.error === 'invalid_input' ? 'This change was not accepted. Review titles and UTC times. Previously saved work and unsaved editor input are kept.' : state?.error === 'storage' ? 'This change could not be saved on this device. Your editor input has been kept.' : state?.error === 'retry_sync_before_edit' ? 'A previous sync needs confirmation. Reconnect and sync saved changes before editing again.' : 'Offline · server access is unavailable. Previously saved changes remain on this device; reconnect before syncing.';
  const review = JSON.stringify({ local: state?.projection, server: state?.currentServer });
  if (ended) return <Block><Copy heading>Session access ended</Copy><Copy>Personal data has been cleared from this screen.</Copy><Action label="Restore session" onPress={props.onRestoreSession} /></Block>;
  return <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" style={{ backgroundColor: palette.background }} contentContainerStyle={{ padding: 16, gap: 12 }}>
    <Row><OpenJobBrandmark inverse={isDark} size={32} /><OpenJobWordmark inverse={isDark} width={140} /></Row><Copy heading>Personal workspace</Copy>
    <Copy>Tasks and Calendar can be saved on this device. Mail, source messages and agent credentials are never included in this cache. Signing out or switching users removes this device’s saved work, including pending changes.</Copy>
    <Block><Copy heading>{busy ? operation : state?.status === 'pending' ? 'Pending · saved on device' : state?.status === 'conflict' ? 'Conflict · review required' : state?.status === 'synced' ? 'Synced at last check' : state?.status === 'syncing' ? 'Sync outcome needs confirmation' : 'No saved workspace yet'}</Copy>
      <Copy>{state?.pendingCount || 0} pending changes</Copy>
      {!sessionReady && <><Copy>Offline access · restore your session to reconnect and sync. Cached Tasks and Calendar remain editable.</Copy><Action label="Restore session" onPress={props.onRestoreSession} /></>}
      <Row><Action label="Refresh from server" disabled={busy || !sessionReady || state?.status === 'conflict'} onPress={() => run(() => offline.refresh(ownerUserId), 'Refreshing…')} /><Action label="Sync saved changes" disabled={busy || !sessionReady || !state?.pendingCount || state?.status === 'conflict'} onPress={() => run(() => offline.sync(ownerUserId), 'Syncing saved changes…')} /></Row>
      {(error || state?.error) && <Copy>{error || stateError}</Copy>}
      {state?.status === 'pending' && <Action label="Discard pending changes" disabled={busy || !sessionReady} onPress={() => setChoice({ strategy: 'server', review })} />}
    </Block>
    {visibleTab !== 'Online' ? <Row>{['Tasks', 'Calendar'].map(name => <Action key={name} label={name} selected={tab === name} onPress={() => open(name)} />)}<Action label="Online Mail and linked work" disabled={!sessionReady || busy} onPress={() => open('Online')} /></Row> : <Action label="Back to saved Tasks and Calendar" onPress={() => open('Tasks')} />}
    <Copy>Mail, source navigation and Agents are available in Online Mail and linked work. Saved Tasks and Calendar contain no source Mail references.</Copy>
    {state?.status === 'conflict' && <Block><Copy heading>Review local and server work</Copy><Copy>Neither version is silently replaced. Compare task titles, completion and UTC calendar slots before choosing.</Copy>
      <ProjectionSummary title="Saved on this device" projection={state.projection} /><ProjectionSummary title="Current server" projection={state.currentServer?.projection} />
      <Row><Action label="Use server version" disabled={busy || !sessionReady} onPress={() => setChoice({ strategy: 'server', review })} /><Action label="Apply reviewed local version" disabled={busy || !sessionReady} onPress={() => setChoice({ strategy: 'local', review })} /></Row>

    </Block>}
      {choice && <Confirm busy={busy || !sessionReady} label={choice.strategy === 'server' ? 'Confirm discard local changes' : 'Confirm apply reviewed local changes'} message={choice.strategy === 'server' ? 'Discard all pending local Tasks and Calendar changes and fetch the latest server version? Pending local work will be lost. Server work will not be overwritten.' : 'Replace the current server Tasks and Calendar with the reviewed local version? This can remove newer server tasks and calendar blocks shown above. A changed server revision will require review again.'} onCancel={() => setChoice(null)} onConfirm={() => { if (choice.review !== review) { setChoice(null); setError('Work changed after review. Compare the versions again.'); return; } void run(() => offline.resolve(ownerUserId, choice.strategy), 'Applying reviewed choice…'); }} />}
    {!view && <Copy>No cached Tasks or Calendar. Restore a session and refresh from the server once to start.</Copy>}
    {view && <><View style={{ display: visibleTab === 'Tasks' ? 'flex' : 'none' }} accessibilityElementsHidden={visibleTab !== 'Tasks'} importantForAccessibility={visibleTab === 'Tasks' ? 'auto' : 'no-hide-descendants'}><Tasks view={view} busy={busy || state?.status === 'syncing'} command={command} selectedId={selectedTask} onSource={() => undefined} /></View>
      <View style={{ display: visibleTab === 'Calendar' ? 'flex' : 'none' }} accessibilityElementsHidden={visibleTab !== 'Calendar'} importantForAccessibility={visibleTab === 'Calendar' ? 'auto' : 'no-hide-descendants'}><Calendar view={view} busy={busy || state?.status === 'syncing'} command={command} onTask={id => { if (view.tasks.some(task => task.id === id)) { setSelectedTask(id); open('Tasks'); } }} /></View></>}
    {sessionReady && <View style={{ display: visibleTab === 'Online' ? 'flex' : 'none' }} accessibilityElementsHidden={visibleTab !== 'Online'} importantForAccessibility={visibleTab === 'Online' ? 'auto' : 'no-hide-descendants'}><ReadyWorkspace {...props} ownerUserId={ownerUserId} sessionReady={sessionReady} onSessionRevoked={revokeOnline} refreshKey={onlineRefresh} /></View>}
  </ScrollView>;
}
function ProjectionSummary({ title, projection }: { title: string; projection: State['projection'] }) {
  return <Block><Copy heading>{title}</Copy>{!projection && <Copy>No available version.</Copy>}{projection?.tasks.map(task => <Copy key={task.id}>{task.title}{task.notes ? `\nNotes: ${task.notes}` : ''} · {task.completed ? 'Completed' : 'Open'} · {task.scheduledSlot ? `${task.scheduledSlot.start} – ${task.scheduledSlot.end}` : 'Unscheduled'}</Copy>)}{projection?.events.map(event => <Copy key={event.id}>{event.title} · {event.start} – {event.end}</Copy>)}{projection && !projection.tasks.length && !projection.events.length && <Copy>No tasks or calendar blocks.</Copy>}</Block>;
}
