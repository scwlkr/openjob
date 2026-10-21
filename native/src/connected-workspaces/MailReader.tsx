import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';
import type { ConnectedMail, NativeConnectedWorkspaceController, ProviderMessageSummary } from '../connected-workspaces-contracts';
import { MAIL_REFRESH_MS, mailReadWindow, mailWindowExpired, mailWindowStale, type MailReadWindow } from '../../../shared/connected-mail-freshness';
import { Action, Block, Copy, Field, Row } from '../personal-workspace/controls';
import { MailTask } from './MailTask';
import type { NativeMailIntents } from './mail-task-intents';

type Snapshot = ConnectedMail & { window: MailReadWindow; cursor?: string; number: number };
type Props = { controller: NativeConnectedWorkspaceController; owner: string; workspaceId: string; connectionId: string; intents: NativeMailIntents; onTask(taskId: string): Promise<void>; onAccessEnded(error: unknown): void };
const reachable = (value: NetworkState) => value.isInternetReachable ?? value.isConnected ?? true;
export function MailReader({ controller, owner, workspaceId, connectionId, intents, onTask, onAccessEnded }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot>(), [opened, setOpened] = useState<{ id: string; body?: string; error?: string }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [halted, setHalted] = useState(false), [lastRead, setLastRead] = useState('');
  const [folder, setFolder] = useState(''), [search, setSearch] = useState(''), [searchInput, setSearchInput] = useState(''), [missingFolder, setMissingFolder] = useState(false), [chooseFolder, setChooseFolder] = useState(false), [folderSearch, setFolderSearch] = useState(''), [folderLimit, setFolderLimit] = useState(20);
  const [autoRefresh, setAutoRefresh] = useState(true), [foreground, setForeground] = useState(AppState.currentState === 'active'), [online, setOnline] = useState(true), [clock, setClock] = useState(() => ({ mono: performance.now(), wall: Date.now() }));
  const automaticWanted = useRef(true);
  const lease = useRef<{ mounted: boolean; generation: object; request?: object; window?: MailReadWindow; foreground: boolean; online: boolean; bodyOpen: boolean }>({ mounted: false, generation: {}, foreground: AppState.currentState === 'active', online: true, bodyOpen: false });
  const { pendingFor } = intents;
  const pending = Object.values(intents.entries).some(row => row.connectionId === connectionId && ['submitting', 'uncertain'].includes(row.phase));
  const invalidate = useCallback((notice: string) => {
    const current = lease.current; current.generation = {}; current.request = undefined; current.window = undefined; current.bodyOpen = false;
    if (!current.mounted) return;
    setSnapshot(undefined); setOpened(undefined); setBusy(false); setChooseFolder(false); setError(notice); setHalted(true);
  }, []);
  const canUse = useCallback(() => { const value = lease.current; return value.mounted && value.foreground && value.online && !!value.window && !mailWindowExpired(value.window, performance.now(), Date.now()); }, []);
  const read = useCallback(async (cursor?: string, number = 1, selectedFolder = '', query = '', refresh = false, automatic = false, expected?: MailReadWindow) => {
    const current = lease.current;
    if (!current.mounted || current.request || !current.foreground || !current.online || !refresh && pendingFor(connectionId)) return;
    if (automatic && (!automaticWanted.current || current.window !== expected || !current.window || mailWindowExpired(current.window, performance.now(), Date.now()) || pendingFor(connectionId) || current.bodyOpen)) return;
    const operation = {}; current.generation = operation; current.request = operation; current.bodyOpen = false;
    setBusy(true); setError(''); setMissingFolder(false); setOpened(undefined); setChooseFolder(false); setFolder(selectedFolder); setSearch(query);
    if (!refresh) { current.window = undefined; setSnapshot(undefined); }
    const requestedAt = performance.now(), wallRequestedAt = Date.now();
    try {
      const value = await controller.mail(owner, workspaceId, connectionId, { cursor, folderId: selectedFolder || undefined, search: query || undefined });
      if (!current.mounted || current.generation !== operation || !current.foreground || !current.online) return;
      const window = mailReadWindow(value.freshness, requestedAt, wallRequestedAt);
      if (mailWindowExpired(window, performance.now(), Date.now())) throw new Error('Expired in transit.');
      current.window = window; setSnapshot({ ...value, window, cursor, number }); setLastRead(window.observedAt); setClock({ mono: performance.now(), wall: Date.now() }); setHalted(false);
    } catch (failure) {
      if (!current.mounted || current.generation !== operation) return;
      const code = (failure as { code?: string })?.code; setMissingFolder(code === 'folder_unavailable');
      invalidate(code === 'search_rejected' ? 'Search unavailable. Review your Gmail query or clear search.' : code === 'folder_unavailable' ? 'This folder is unavailable. Read All Mail to keep the search and recover.' : code === 'invalid_cursor' ? 'This page is unavailable. Read the first page to recover.' : 'Mail access could not be checked. Details are hidden. Check Connections, then refresh Mail.'); onAccessEnded(failure);
    } finally { if (current.request === operation) { current.request = undefined; if (current.mounted) setBusy(false); } }
  }, [controller, owner, workspaceId, connectionId, pendingFor, invalidate, onAccessEnded]);
  useEffect(() => {
    const current = lease.current; current.mounted = true; current.foreground = AppState.currentState === 'active';
    const lifecycle = AppState.addEventListener('change', state => { current.foreground = state === 'active'; setForeground(current.foreground); if (!current.foreground) invalidate('Mail paused while the app is inactive. Refresh Mail when you return; reviewed Tasks are kept.'); });
    let networkEvent = false;
    const updateNetwork = (state: NetworkState) => { if (!current.mounted) return; current.online = reachable(state); setOnline(current.online); if (!current.online) invalidate('Mail is offline. Details are hidden. Reconnect, then refresh Mail; reviewed Tasks are kept.'); };
    const network = addNetworkStateListener(state => { networkEvent = true; updateNetwork(state); });
    void getNetworkStateAsync().then(state => { if (!networkEvent) updateNetwork(state); }, () => undefined);
    const timer = setInterval(() => {
      if (!current.window) return;
      const next = { mono: performance.now(), wall: Date.now() };
      if (mailWindowExpired(current.window, next.mono, next.wall)) invalidate('This Mail view expired. Details are hidden. Refresh Mail to check access; reviewed Tasks are kept.');
      else setClock(next);
    }, 1000);
    queueMicrotask(() => { if (current.mounted) void read(); });
    return () => { current.mounted = false; current.generation = {}; current.request = undefined; current.window = undefined; clearInterval(timer); lifecycle.remove(); network.remove(); };
  }, [read, invalidate]);
  useEffect(() => {
    if (!autoRefresh || halted || busy || !foreground || !online || pending || opened || !snapshot || snapshot.number !== 1) return;
    const timer = setTimeout(() => { void read(snapshot.cursor, snapshot.number, folder, search, true, true, snapshot.window); }, MAIL_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [autoRefresh, halted, busy, foreground, online, pending, opened, snapshot, folder, search, read]);
  function close() { lease.current.generation = {}; lease.current.request = undefined; lease.current.bodyOpen = false; setOpened(undefined); setBusy(false); }
  async function open(message: ProviderMessageSummary) {
    if (!canUse() || lease.current.request || pendingFor(connectionId)) return;
    const current = lease.current, operation = {}; current.generation = operation; current.request = operation; current.bodyOpen = true; setOpened({ id: message.id }); setBusy(true);
    try {
      const value = await controller.message(owner, workspaceId, connectionId, message.upstreamId);
      if (!current.mounted || current.generation !== operation || !canUse()) return;
      const full = value.message;
      if (value.workspaceId !== workspaceId || full.id !== message.id || full.accountId !== message.accountId || full.upstreamThreadId !== message.upstreamThreadId) throw new Error('Source changed.');
      setOpened({ id: message.id, body: full.body });
    } catch (failure) {
      if (!current.mounted || current.generation !== operation) return;
      if ((failure as { code?: string })?.code === 'message_unavailable' && canUse()) setOpened({ id: message.id, error: 'This message is unavailable. Its Task stays in this Workspace. Close it or refresh Mail.' });
      else { invalidate('Mail access could not be checked. Details are hidden. Check Connections, then refresh Mail.'); onAccessEnded(failure); }
    } finally { if (current.request === operation) { current.request = undefined; if (current.mounted) setBusy(false); } }
  }
  const visible = snapshot && !mailWindowExpired(snapshot.window, clock.mono, clock.wall) ? snapshot : undefined;
  const folders = visible?.page.folders.filter(row => row.name.toLowerCase().includes(folderSearch.trim().toLowerCase())) ?? [];
  const retained = Object.values(intents.entries).filter(row => row.connectionId === connectionId && !visible?.page.messages.some(message => message.upstreamId === row.messageId));
  return <Block><Copy heading>{visible?.mode === 'google-fixture' ? 'Invented Mail' : 'Read-only Mail'}</Copy><Copy>Browse details, then choose Read message for its plain text. No body cache, HTML, attachments or remote images.</Copy>
    {lastRead ? <Copy>Last read: {new Date(lastRead).toLocaleString()}. {visible ? mailWindowStale(visible.window, clock.mono, clock.wall) ? 'These details may be out of date.' : 'Recent observation. Access is checked for each action.' : 'Message details are hidden.'}</Copy> : null}
    <Row><Action label="Refresh Mail" disabled={busy || !foreground || !online} onPress={() => void read(visible?.cursor, visible?.number ?? 1, folder, search, true)} /><Action label={autoRefresh ? 'Pause Mail auto refresh' : 'Enable Mail auto refresh'} selected={autoRefresh} onPress={() => { automaticWanted.current = !automaticWanted.current; setAutoRefresh(automaticWanted.current); }} /></Row>
    <Copy>{halted ? 'Automatic refresh stopped. Refresh Mail to recover.' : !autoRefresh ? 'Automatic refresh is off.' : !foreground || !online || pending || opened || visible?.number !== 1 ? 'Automatic refresh paused while inactive, offline, reading, confirming Tasks or viewing a later page.' : 'The visible first page is checked at most once per minute. This is a bounded page read.'}</Copy>
    <Field label="Search Gmail" value={searchInput} maxLength={512} editable={!busy && !pending} onChange={setSearchInput} /><Copy>Use Gmail search syntax within this account and folder. Submit to apply.</Copy>
    <Row><Action label="Search Mail" disabled={busy || pending || !foreground || !online} onPress={() => void read(undefined, 1, folder, searchInput.trim())} /><Action label="Clear Mail search" disabled={busy || pending || !foreground || !online || !search && !searchInput} onPress={() => { setSearchInput(''); void read(undefined, 1, folder, ''); }} /></Row>
    <Copy>{search ? `Applied search: ${search}` : 'No search applied.'}</Copy>
    <Action label={`Mail folder: ${visible?.page.folders.find(row => row.id === folder)?.name ?? (folder ? 'Selected folder' : 'All Mail')}`} disabled={busy || pending || !visible} onPress={() => { setChooseFolder(value => !value); setFolderSearch(''); setFolderLimit(20); }} />
    {chooseFolder && visible && <Block><Field label="Find Mail folder" value={folderSearch} onChange={value => { setFolderSearch(value); setFolderLimit(20); }} maxLength={128} /><Action label="Folder All Mail" onPress={() => void read(undefined, 1, '', search)} />{folders.slice(0, folderLimit).map(row => <Action key={row.id} label={`Folder ${row.name}`} selected={folder === row.id} onPress={() => void read(undefined, 1, row.id, search)} />)}{folders.length > folderLimit && <Action label="Show more Mail folders" onPress={() => setFolderLimit(value => value + 20)} />}</Block>}
    <Copy>Gmail labels overlap. All Mail excludes Spam and Trash; select those folders explicitly.</Copy>
    {error ? <Copy>{error}</Copy> : null}{missingFolder && <Action label="Read All Mail" disabled={busy || !foreground || !online} onPress={() => void read(undefined, 1, '', search, true)} />}
    <Row><Action label="First Mail page" disabled={busy || pending || !foreground || !online || visible?.number === 1} onPress={() => void read(undefined, 1, folder, search)} /><Action label="Next Mail page" disabled={busy || pending || !foreground || !online || !visible?.page.nextCursor} onPress={() => void read(visible?.page.nextCursor ?? undefined, (visible?.number ?? 1) + 1, folder, search)} /></Row>
    {pending && <Copy>Confirm the pending Task before changing Mail. Refresh Mail keeps the same reviewed request.</Copy>}{busy && <Copy>Checking Mail…</Copy>}
    {visible && <><Copy>Mail page {visible.number}</Copy>{!visible.page.messages.length && <Copy>This page has no messages.</Copy>}{visible.page.messages.map(message => <Block key={message.id}><Copy heading>{message.subject}</Copy><Copy>From: {message.from} · To: {message.to}</Copy><Action label={`${opened?.id === message.id ? 'Close' : 'Read'} message ${message.subject}`} disabled={opened?.id === message.id ? false : busy || pending} onPress={() => opened?.id === message.id ? close() : void open(message)} />{opened?.id === message.id && <Copy>{opened.error ?? (opened.body === undefined ? 'Reading message…' : opened.body || '(This message has an empty plain-text body.)')}</Copy>}<MailTask connectionId={connectionId} messageId={message.upstreamId} suggestion={message.subject} intents={intents} available={!!visible && foreground && online && !busy} canUse={canUse} onTask={onTask} /></Block>)}</>}
    {retained.length > 0 && <Block><Copy heading>Reviewed Task requests</Copy><Copy>Your authored titles and results are kept separately from Mail details.</Copy>{retained.map(row => <MailTask key={row.messageId} connectionId={connectionId} messageId={row.messageId} suggestion={row.title} intents={intents} available={!!visible && foreground && online && !busy} canUse={canUse} onTask={onTask} />)}</Block>}
  </Block>;
}
