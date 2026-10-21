'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderMessageSummaryPage, ProviderMessageSummary, ProviderMessage } from '../../shared/provider-contracts';
import { MAIL_REFRESH_MS, mailReadWindow, mailWindowExpired, mailWindowStale, type MailReadWindow } from '../../shared/connected-mail-freshness';
import type { ConnectedMailDrafts } from './connected-mail-drafts';
import ConnectedMailTask from './connected-mail-task';
import styles from '../workspace/workspace.module.css';

type Snapshot = { page: ProviderMessageSummaryPage; window: MailReadWindow; cursor?: string; number: number };
type Props = { withinWorkspace?: boolean; onOpenTask?(taskId: string): void; connectionId: string; workspaceId: string; taskDrafts: ConnectedMailDrafts; fixture: boolean; request(path?: string, input?: object): Promise<unknown> };
async function requestPage(request: Props['request'], connectionId: string, workspaceId: string, cursor: string | undefined, number: number, folder: string, search: string): Promise<Snapshot> {
  const requestedAt = performance.now(), wallRequestedAt = Date.now(), params = new URLSearchParams({ view: 'metadata' });
  if (cursor !== undefined) params.set('cursor', cursor); if (folder) params.set('folderId', folder); if (search) params.set('search', search);
  const result = await request(`/${connectionId}/mail?${params}`) as { workspaceId: string; page: ProviderMessageSummaryPage; freshness: unknown };
  if (result.workspaceId !== workspaceId || !Array.isArray(result.page?.messages) || result.page.messages.length > 10 || !Array.isArray(result.page.folders) || !(result.page.nextCursor === null || typeof result.page.nextCursor === 'string') || result.page.messages.some(row => !row || typeof row.id !== 'string' || typeof row.subject !== 'string' || Object.hasOwn(row, 'body') || Object.hasOwn(row, 'snippet'))) throw new Error();
  const window = mailReadWindow(result.freshness, requestedAt, wallRequestedAt);
  if (mailWindowExpired(window, performance.now(), Date.now())) throw new Error('Mail observation expired in transit.');
  return { page: result.page, window, cursor, number };
}
export default function ConnectedGoogleMail({ connectionId, workspaceId, taskDrafts, fixture, request, withinWorkspace = false, onOpenTask }: Props) {
  const [searchInput, setSearchInput] = useState(''), [search, setSearch] = useState(''), [folder, setFolder] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot>(), [lastRead, setLastRead] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(true), [halted, setHalted] = useState(false), [missingFolder, setMissingFolder] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true), [clock, setClock] = useState(() => ({ mono: performance.now(), wall: Date.now() }));
  const [foreground, setForeground] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'visible'), [online, setOnline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine);
  const [opened, setOpened] = useState<{ id: string; body?: string; error?: string }>();
  const sequence = useRef<object>({}), activeLoad = useRef<object | undefined>(undefined), mounted = useRef(false), currentWindow = useRef<MailReadWindow | undefined>(undefined);
  const hasPending = Object.values(taskDrafts.entries).some(row => row.connectionId === connectionId && row.workspaceId === workspaceId && (row.phase === 'submitting' || row.phase === 'uncertain'));
  const { pendingFor } = taskDrafts;
  const bodyOpen = useRef(false), automaticWanted = useRef(true);
  const invalidate = useCallback((message: string) => {
    sequence.current = {}; currentWindow.current = undefined; setSnapshot(undefined); setOpened(undefined); bodyOpen.current = false; setError(message); setHalted(true);
  }, []);
  const expire = useCallback(() => {
    if (currentWindow.current && mailWindowExpired(currentWindow.current, performance.now(), Date.now())) {
      invalidate('This Mail view expired. Message details are hidden. Refresh Mail to check current access; reviewed Task requests are kept.'); return true;
    }
    return false;
  }, [invalidate]);
  const canUse = useCallback(() => !expire() && !!currentWindow.current, [expire]);
  const accept = useCallback((next: Snapshot, operation: object) => {
    if (!mounted.current || operation !== sequence.current) return;
    currentWindow.current = next.window; setClock({ mono: performance.now(), wall: Date.now() }); setSnapshot(next); setLastRead(next.window.observedAt); setHalted(false);
  }, []);
  const reject = useCallback((error: unknown, operation: object) => {
    if (!mounted.current || operation !== sequence.current) return;
    const code = (error as { code?: string })?.code;
    setMissingFolder(code === 'folder_unavailable');
    invalidate(code === 'search_rejected' ? 'This search could not be used. Review your Gmail query or clear search.' : code === 'folder_unavailable' ? 'This folder is no longer available. Choose Read All Mail to keep your search and start again.' : code === 'invalid_cursor' ? 'This Mail page is no longer available. Refresh Mail to start at the first page.' : 'Mail could not be checked. Message details are hidden and automatic refresh has stopped. Check the connection, then refresh Mail.');
  }, [invalidate]);
  const settle = useCallback((operation: object) => {
    if (activeLoad.current === operation) { activeLoad.current = undefined; if (mounted.current) setBusy(false); }
  }, []);
  const read = useCallback(async (cursor?: string, nextNumber = 1, selectedFolder = '', submittedSearch = '', refresh = false, automatic = false, expectedWindow?: MailReadWindow) => {
    if (activeLoad.current !== undefined || !refresh && pendingFor(connectionId, workspaceId)) return;
    if (automatic && (!automaticWanted.current || !currentWindow.current || currentWindow.current !== expectedWindow || mailWindowExpired(currentWindow.current, performance.now(), Date.now()) || pendingFor(connectionId, workspaceId) || bodyOpen.current || document.visibilityState !== 'visible' || !navigator.onLine)) return;
    expire(); const operation = {}; sequence.current = operation; activeLoad.current = operation;
    setBusy(true); setError(''); setMissingFolder(false); setOpened(undefined); bodyOpen.current = false; setFolder(selectedFolder); setSearch(submittedSearch);
    if (!refresh) { currentWindow.current = undefined; setSnapshot(undefined); }
    try { accept(await requestPage(request, connectionId, workspaceId, cursor, nextNumber, selectedFolder, submittedSearch), operation); }
    catch (error) { reject(error, operation); } finally { settle(operation); }
  }, [connectionId, workspaceId, request, expire, accept, reject, settle, pendingFor]);
  useEffect(() => {
    mounted.current = true; const operation = {}; sequence.current = operation; activeLoad.current = operation;
    void requestPage(request, connectionId, workspaceId, undefined, 1, '', '').then(next => accept(next, operation), error => reject(error, operation)).finally(() => settle(operation));
    return () => { mounted.current = false; sequence.current = {}; activeLoad.current = undefined; currentWindow.current = undefined; };
  }, [connectionId, workspaceId, request, accept, reject, settle]);
  useEffect(() => {
    const update = () => { setClock({ mono: performance.now(), wall: Date.now() }); setForeground(document.visibilityState === 'visible'); setOnline(navigator.onLine); expire(); };
    const timer = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [expire]);
  useEffect(() => {
    if (!autoRefresh || halted || busy || !foreground || !online || hasPending || opened || !snapshot || snapshot.number !== 1) return;
    const timer = setTimeout(() => { if (!expire()) void read(snapshot.cursor, snapshot.number, folder, search, true, true, snapshot.window); }, MAIL_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [autoRefresh, halted, busy, foreground, online, hasPending, opened, snapshot, folder, search, read, expire]);
  async function open(message: ProviderMessageSummary) {
    if (activeLoad.current !== undefined || hasPending || !canUse()) return;
    if (opened?.id === message.id) { setOpened(undefined); bodyOpen.current = false; return; }
    const operation = {}; sequence.current = operation; activeLoad.current = operation; setBusy(true); bodyOpen.current = true; setOpened({ id: message.id });
    try {
      const result = await request(`/${connectionId}/mail/${message.upstreamId}`) as { workspaceId: string; message: ProviderMessage };
      if (!mounted.current || operation !== sequence.current || !canUse()) return;
      const full = result.message;
      if (result.workspaceId !== workspaceId || full?.id !== message.id || full.accountId !== message.accountId || full.upstreamId !== message.upstreamId || full.upstreamThreadId !== message.upstreamThreadId || typeof full.body !== 'string') throw new Error();
      setOpened({ id: message.id, body: full.body });
    } catch (error) {
      if (!mounted.current || operation !== sequence.current) return;
      if ((error as { code?: string })?.code === 'message_unavailable' && canUse()) setOpened({ id: message.id, error: 'This message is unavailable. Your Task stays in its Workspace. Close this message or refresh Mail.' });
      else invalidate('Mail access could not be confirmed. Message details are hidden and automatic refresh has stopped. Check the connection, then refresh Mail.');
    } finally { if (activeLoad.current === operation) { activeLoad.current = undefined; if (mounted.current) setBusy(false); } }
  }
  const visible = snapshot && !mailWindowExpired(snapshot.window, clock.mono, clock.wall) ? snapshot : undefined;
  const paused = !foreground || !online || hasPending || !!opened || !!visible && visible.number !== 1;
  return <section className={styles.panel} aria-label="Connected Mail">
    <h2>{fixture ? 'Invented Mail' : 'Read-only Mail'}</h2>
    <p>Browse message details, then choose Read message to load its plain text. Reviewed Task titles and requests stay while {withinWorkspace ? 'this Workspace session' : 'Connections'} is open.</p>
    {lastRead && <p>Last read: <time dateTime={lastRead}>{new Date(lastRead).toLocaleString()}</time>. {visible ? mailWindowStale(visible.window, clock.mono, clock.wall) ? 'These details may be out of date.' : 'Recent observation; access is checked again for each action.' : 'No message details are available.'}</p>}
    <div className={styles.actions}><button disabled={busy} onClick={() => void read(visible?.cursor, visible?.number ?? 1, folder, search, true)}>Refresh Mail</button><label><input type="checkbox" checked={autoRefresh} onChange={event => { automaticWanted.current = event.target.checked; setAutoRefresh(event.target.checked); }} />Keep the first page refreshed</label></div>
    <p>{halted ? 'Automatic refresh stopped. Use Refresh Mail to retry.' : !autoRefresh ? 'Automatic refresh is off.' : paused ? 'Automatic refresh is paused while hidden, offline, reading a message, confirming a Task or viewing a later page.' : 'The visible first page is checked at most once per minute. This is a bounded page read, not a complete mailbox sync.'}</p>
    <form className={styles.form} onSubmit={event => { event.preventDefault(); void read(undefined, 1, folder, searchInput.trim()); }}>
      <label>Search Gmail<input type="search" maxLength={512} value={searchInput} onChange={event => setSearchInput(event.target.value)} disabled={busy || hasPending} placeholder="from:colleague@example.com" /></label>
      <p>Use Gmail search syntax within this account and selected folder. Submit to apply.</p>
      <div className={styles.actions}><button disabled={busy || hasPending}>Search Mail</button><button type="button" disabled={busy || hasPending || !search && !searchInput} onClick={() => { setSearchInput(''); void read(undefined, 1, folder, ''); }}>Clear search</button></div>
    </form>
    <p>{search ? `Applied search: ${search}` : 'No search applied.'}</p>
    <label>Mail folder<select aria-label="Mail folder" disabled={busy || hasPending || !visible} value={folder} onChange={event => void read(undefined, 1, event.target.value, search)}>
      <option value="">All Mail</option>{visible?.page.folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <p>Gmail labels can overlap. All Mail excludes Spam and Trash; select those labels explicitly to read them.</p>
    {error && <p role="alert">{error}</p>}
    {missingFolder && <button disabled={busy} onClick={() => void read(undefined, 1, '', search, true)}>Read All Mail</button>}
    <div className={styles.actions}><button disabled={busy || hasPending || visible?.number === 1} onClick={() => void read(undefined, 1, folder, search)}>First page</button><button disabled={busy || hasPending || !visible?.page.nextCursor} onClick={() => void read(visible?.page.nextCursor ?? undefined, (visible?.number ?? 1) + 1, folder, search)}>Next page</button></div>
    {hasPending && <p>Finish confirming the Task before changing Mail. Refresh Mail remains available and keeps the same Task request.</p>}
    {busy && <p role="status">Checking Mail…</p>}
    {visible && <><p>Mail page {visible.number}</p>{!visible.page.messages.length && <p>This page has no messages.</p>}{visible.page.messages.map(message => <article key={message.id}>
      <h3>{message.subject}</h3><p>From: {message.from || '(Unavailable)'} · To: {message.to || '(Unavailable)'}</p>
      <button disabled={busy || hasPending} aria-expanded={opened?.id === message.id} onClick={() => void open(message)}>{opened?.id === message.id ? 'Close message' : 'Read message'}</button>
      {opened?.id === message.id && <div>{opened.error ? <p role="alert">{opened.error}</p> : opened.body !== undefined ? <><p>Plain text only. HTML, attachments and remote images are not loaded.</p><p className={styles.body}>{opened.body || '(This message has an empty plain-text body.)'}</p></> : <p role="status">Reading message…</p>}</div>}
      <ConnectedMailTask target={{ connectionId, workspaceId, messageId: message.upstreamId }} defaultTitle={message.subject.slice(0, 500)} drafts={taskDrafts} canUse={canUse} onOpenTask={onOpenTask} />
    </article>)}</>}
  </section>;
}
