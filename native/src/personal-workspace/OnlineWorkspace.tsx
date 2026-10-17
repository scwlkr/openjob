import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import type { PersonalAgentGrant, PersonalWorkspaceCommand, WorkspaceView } from '../personal-workspace-contracts';
import { OpenJobBrandmark, OpenJobWordmark } from '../brand-marks';
import { useOpenJobTheme } from '../theme';
import { Action, Block, Copy, Row } from './controls';
import { Mail, type MailHandle } from './Mail';
import { Tasks } from './Tasks';
import { Calendar } from './Calendar';
import { Agents } from './Agents';

import type { PersonalWorkspaceProps as Props } from './NativePersonalWorkspace';

export function ReadyWorkspace({ controller, ownerUserId, onRestoreSession, onSessionRevoked, refreshKey }: Props & { refreshKey?: number }) {
  const { palette, isDark } = useOpenJobTheme();
  const lease = useRef({ active: true, pending: false, ended: false, epoch: 0 });
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [grants, setGrants] = useState<PersonalAgentGrant[]>([]);
  const [checkedAt, setCheckedAt] = useState(0);
  const [tab, setTab] = useState('Mail');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ended, setEnded] = useState(false);
  const [selectedTask, setSelectedTask] = useState('');
  const mailRef = useRef<MailHandle>(null);
  const scrollRef = useRef<ScrollView>(null);
  const openTab = (name: string) => { setTab(name); scrollRef.current?.scrollTo({ y: 0, animated: false }); };
  const run = useCallback(async (action?: () => Promise<void>) => {
    const epoch = lease.current.epoch;
    const current = () => lease.current.active && !lease.current.ended && lease.current.epoch === epoch;
    if (!current() || lease.current.pending) return false;
    lease.current.pending = true; setBusy(true); setError(''); setNotice('');
    try {
      if (action) await action();
      if (!current()) return false;
      const [next, nextGrants] = await Promise.all([controller.readPersonalWorkspace(ownerUserId), controller.listPersonalAgents(ownerUserId)]);
      if (!current()) return false;
      setView(next); setGrants(nextGrants); setCheckedAt(Date.now()); if (action) setNotice('Saved online. No real mail was sent.'); return true;
    } catch (failure) {
      if (!current()) return false;
      const issue = failure as { status?: number; code?: string };
      if (issue?.status === 401 || issue?.status === 410 || issue?.code === 'revoked') {
        lease.current.ended = true; setView(null); setGrants([]); setEnded(true);
        // A core stale/provisional boundary must not revoke a newer identity.
        if (issue.status === 401 || issue.status === 410) onSessionRevoked();
      } else setError('Online request could not be completed. Reconnect and use Refresh to check saved state before making another change.');
      return false;
    } finally { if (current()) { lease.current.pending = false; setBusy(false); } }
  }, [controller, lease, onSessionRevoked, ownerUserId]);
  useEffect(() => {
    const scope = lease.current; scope.active = true; const epoch = scope.epoch;
    queueMicrotask(() => { if (scope.active && scope.epoch === epoch) void run(); });
    return () => { scope.active = false; scope.epoch += 1; scope.pending = false; };
  }, [run, refreshKey]);
  const command = (input: PersonalWorkspaceCommand) => run(() => controller.commandPersonalWorkspace(ownerUserId, input));
  const source = (messageId: string, accountId: string) => { if (lease.current.active && !lease.current.ended && mailRef.current?.openMessage(messageId, accountId)) { openTab('Mail'); setNotice('Opened exact source Mail. Unsaved input was kept.'); } };
  if (ended) return <Block><Copy heading>Session access ended</Copy><Copy>Personal data has been cleared from this screen.</Copy><Action label="Restore session" onPress={onRestoreSession} /></Block>;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: palette.background }}>
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Row><OpenJobBrandmark inverse={isDark} size={32} /><OpenJobWordmark inverse={isDark} width={140} /></Row>
      <Copy heading>Personal workspace</Copy><Copy>Online-only Tasks, Calendar and invented Mail. No personal disk cache, real mailbox connection or actual delivery.</Copy>
      <Row>{['Mail', 'Tasks', 'Calendar', 'Agents'].map(item => <Action key={item} label={item} selected={tab === item} disabled={!view} onPress={() => openTab(item)} />)}<Action label="Refresh workspace" disabled={busy} onPress={() => run()} /></Row>
      {busy && <Copy>Working online…</Copy>}{!view && !error && <Copy>Loading personal workspace…</Copy>}
      {error ? <Text accessibilityRole="alert" style={{ color: palette.ink }}>{error}</Text> : null}{notice ? <Text accessibilityLiveRegion="polite" style={{ color: palette.positive }}>{notice}</Text> : null}
      {view && <>
        <View style={{ display: tab === 'Mail' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'Mail'} importantForAccessibility={tab === 'Mail' ? 'auto' : 'no-hide-descendants'}><Mail view={view} busy={busy} command={command} mailRef={mailRef} onTask={id => { if (lease.current.active && !lease.current.ended && view.tasks.some(task => task.id === id)) { setSelectedTask(id); openTab('Tasks'); } }} /></View>
        <View style={{ display: tab === 'Tasks' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'Tasks'} importantForAccessibility={tab === 'Tasks' ? 'auto' : 'no-hide-descendants'}><Tasks view={view} busy={busy} command={command} selectedId={selectedTask} onSource={source} /></View>
        <View style={{ display: tab === 'Calendar' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'Calendar'} importantForAccessibility={tab === 'Calendar' ? 'auto' : 'no-hide-descendants'}><Calendar view={view} busy={busy} command={command} onTask={id => { if (lease.current.active && view.tasks.some(task => task.id === id)) { setSelectedTask(id); openTab('Tasks'); } }} /></View>
        <View style={{ display: tab === 'Agents' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'Agents'} importantForAccessibility={tab === 'Agents' ? 'auto' : 'no-hide-descendants'}><Agents grants={grants} checkedAt={checkedAt} busy={busy} revoke={id => run(() => controller.revokePersonalAgent(ownerUserId, id))} /></View>
        <Block><Copy heading>Recent activity</Copy>{view.activity.slice(-12).reverse().map(item => <Copy key={item.id}>{item.actor} · {item.action} · {item.createdAt}</Copy>)}</Block>
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
