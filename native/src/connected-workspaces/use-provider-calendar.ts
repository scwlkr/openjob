import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';
import { randomUUID } from 'expo-crypto';
import type { NativeConnectedWorkspaceController } from '../connected-workspaces-contracts';
import type { WorkspaceView } from '../personal-workspace-contracts';
import type { CalendarAvailability, ProviderCalendarAccount, RemoteCalendarPage, RemoteEventPage } from '../../../shared/provider-calendar';
import type { CalendarOperationView, CalendarPlanInput, RemotePlanningLink, PlanningDetachInput } from '../../../shared/remote-planning';
import { calendarPlanInput } from '../../../shared/calendar-client';
import { initialProviderEditor, canStartProviderIntent, providerUtc, type ProviderEditor, type ProviderIntent } from '../../../shared/provider-planning-editor';
import type { NativeCalendarDrafts } from './calendar-drafts';

type Props = { controller: NativeConnectedWorkspaceController; owner: string; workspaceId: string; view: WorkspaceView; links: RemotePlanningLink[] | undefined; drafts: NativeCalendarDrafts; onPlanning(links: RemotePlanningLink[] | undefined): void; onAccessEnded(error: unknown): void };
const day = () => new Date().toISOString().slice(0, 10);
/** Observations die with this reader. Authored fields and frozen requests live in WorkspacePanel. */
export function useNativeProviderCalendar({ controller: api, owner, workspaceId: id, view, links, drafts, onPlanning, onAccessEnded }: Props) {
  const initialLink = links?.find(row => row.taskId === drafts.taskId);
  const [accounts, setAccounts] = useState<ProviderCalendarAccount[]>([]), [accountId, setAccountId] = useState(initialLink?.calendarId.split(':calendar:')[0] ?? ''), [calendarId, setCalendarId] = useState(initialLink?.calendarId ?? '');
  const [calendars, setCalendars] = useState<RemoteCalendarPage>(), [events, setEvents] = useState<RemoteEventPage>(), [availability, setAvailability] = useState<CalendarAvailability>();
  const [operations, setOperations] = useState<CalendarOperationView[]>([]), [historyCursor, setHistoryCursor] = useState<string | null>(null), [historyReady, setHistoryReady] = useState(false);
  const [windowStart, writeWindowStart] = useState(() => day() + 'T00:00'), [windowEnd, writeWindowEnd] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T00:00');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [clock, setClock] = useState(Date.now), [ready, setReady] = useState(false);
  const lease = useRef({ mounted: false, foreground: AppState.currentState === 'active', online: false, abort: new AbortController(), selection: 0, history: 0, lock: false });
  const taskId = drafts.taskId, task = view.tasks.find(row => row.id === taskId), link = links?.find(row => row.taskId === taskId), intent = drafts.intents[taskId];
  const editor = task ? drafts.editors[taskId]?.dirty ? drafts.editors[taskId] : initialProviderEditor(task, link) : undefined;
  const account = accounts.find(row => row.accountId === accountId), selectedCalendar = calendars && Date.parse(calendars.expiresAt) > clock ? calendars.calendars.find(row => row.id === calendarId) : undefined;
  const writable = ready && !!account?.available && !!selectedCalendar && ['owner', 'writer'].includes(selectedCalendar.access);
  const clearViews = useCallback(() => { setCalendars(undefined); setEvents(undefined); setAvailability(undefined); setOperations([]); setHistoryReady(false); setHistoryCursor(null); }, []);
  const usable = () => { const current = lease.current; if (!current.mounted || !current.foreground || !current.online || current.abort.signal.aborted) throw new Error('Calendar paused'); return current.abort.signal; };
  async function observe<T>(action: (signal: AbortSignal) => Promise<T>) { const signal = usable(), value = await action(signal); signal.throwIfAborted(); usable(); return value; }
  async function refreshPlanning() { const rows = await observe(signal => api.planning(owner, id, signal)); onPlanning(rows); return rows; }
  async function refreshHistory(selected = taskId, cursor?: string) {
    if (!selected) return;
    const generation = lease.current.selection, revision = ++lease.current.history;
    const page = await observe(signal => api.calendarHistory(owner, id, selected, cursor, signal));
    if (generation !== lease.current.selection || revision !== lease.current.history) return;
    const pending = drafts.intent(selected), match = pending && page.items.find(row => row.requestId === pending.input.requestId);
    if (pending && match) {
      if (match.action !== pending.input.action || match.calendarId !== pending.calendarId || pending.eventId && match.eventId !== pending.eventId) throw new Error('Receipt target changed');
      drafts.put('intents', selected, { ...pending, operation: match, rejected: false });
    }
    setOperations(page.items); setHistoryCursor(page.nextCursor); setHistoryReady(true);
  }
  async function status() {
    clearViews(); setAccounts([]); onPlanning(undefined);
    try {
      const rows = await observe(signal => api.calendarAccounts(owner, id, signal)); setAccounts(rows);
      setAccountId(previous => previous || rows.find(row => row.available)?.accountId || ''); await refreshPlanning();
    } catch (failure) { if ((failure as { code?: string }).code === 'not_configured' && !lease.current.abort.signal.aborted) onPlanning([]); throw failure; }
  }
  async function perform(action: () => Promise<void>) {
    const current = lease.current; if (current.lock || !current.mounted || !current.foreground || !current.online) return;
    const signal = usable(); current.lock = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (failure) {
      if (!signal.aborted) { setEvents(undefined); setAvailability(undefined); setError((failure as { code?: string }).code === 'not_configured' ? 'No Calendar service is configured here. Local Calendar work remains available.' : 'Calendar action or refresh unavailable. Your fields and exact pending request are kept. Inspect status before retrying.'); onAccessEnded(failure); }
    } finally { if (!signal.aborted && current.mounted) { current.lock = false; setBusy(false); } }
  }
  useEffect(() => {
    const current = lease.current; current.mounted = true; current.abort = new AbortController(); current.foreground = AppState.currentState === 'active';
    let initial = true, networkEvent = false;
    const invalidate = () => { current.abort.abort(); current.abort = new AbortController(); current.selection++; current.history++; current.lock = false; clearViews(); setAccounts([]); onPlanning(undefined); setBusy(false); setReady(false); setError('Calendar paused. Return online and refresh status; your authored work is kept.'); };
    const lifecycle = AppState.addEventListener('change', state => { current.foreground = state === 'active'; if (!current.foreground) invalidate(); setReady(current.foreground && current.online); });
    const network = addNetworkStateListener(state => { networkEvent = true; update(state); });
    function update(state: NetworkState) {
      if (!current.mounted) return;
      current.online = state.isInternetReachable ?? state.isConnected ?? false;
      if (!current.online) invalidate(); setReady(current.foreground && current.online);
      if (initial && current.online && current.foreground) { initial = false; void perform(status); }
    }
    void getNetworkStateAsync().then(state => { if (!networkEvent) update(state); }, () => undefined);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { current.mounted = false; current.abort.abort(); clearInterval(timer); lifecycle.remove(); network.remove(); };
    // This disposable reader is keyed by owner/Workspace; closure state starts empty on every mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!account?.available || !ready) return;
    const generation = lease.current.selection; let active = true;
    void observe(signal => api.calendars(owner, id, accountId, undefined, signal)).then(page => { if (active && generation === lease.current.selection) { setCalendars(page); setCalendarId(previous => previous || page.calendars[0]?.id || ''); } }).catch(() => { if (active && !lease.current.abort.signal.aborted) { setCalendars(undefined); setError('Calendar list unavailable. Reload before planning.'); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, accountId, ready]);
  useEffect(() => {
    if (ready && taskId) void perform(() => refreshHistory());
    // Task selection starts a new fenced history read; renders do not poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, ready]);
  function chooseTask(selected: string) {
    lease.current.selection++; lease.current.history++; drafts.selectTask(selected); setOperations([]); setHistoryReady(false); setHistoryCursor(null);
    const saved = view.tasks.find(row => row.id === selected), existing = links?.find(row => row.taskId === selected);
    if (saved && !drafts.editors[selected]) drafts.put('editors', selected, initialProviderEditor(saved, existing));
    if (existing) { if (accountId !== existing.calendarId.split(':calendar:')[0]) clearViews(); setAccountId(existing.calendarId.split(':calendar:')[0] ?? ''); setCalendarId(existing.calendarId); setEvents(undefined); setAvailability(undefined); }
  }
  function edit(patch: Partial<ProviderEditor>) { if (editor && task) drafts.put('editors', taskId, { ...editor, ...patch, dirty: true }); }
  function selectAccount(selected: string) { lease.current.selection++; setAccountId(selected); setCalendarId(''); clearViews(); }
  function selectCalendar(selected: string) { lease.current.selection++; setCalendarId(selected); setEvents(undefined); setAvailability(undefined); }
  function setWindowStart(value: string) { lease.current.selection++; writeWindowStart(value); setEvents(undefined); setAvailability(undefined); }
  function setWindowEnd(value: string) { lease.current.selection++; writeWindowEnd(value); setEvents(undefined); setAvailability(undefined); }
  async function loadCalendar(cursor?: string) { const generation = lease.current.selection, page = await observe(signal => api.calendars(owner, id, accountId, cursor, signal)); if (generation === lease.current.selection) { setCalendars(page); setClock(Date.now()); setEvents(undefined); setAvailability(undefined); } }
  async function readCalendar(cursor?: string) {
    if (!selectedCalendar || !account?.available) throw new Error();
    const generation = lease.current.selection, target = calendarId, selectedAccount = accountId, window = { start: providerUtc(windowStart), end: providerUtc(windowEnd) }; setEvents(undefined); setAvailability(undefined);
    if (!cursor) { const value = await observe(signal => api.calendarAvailability(owner, id, selectedAccount, target, window, signal)); if (generation !== lease.current.selection) return; setAvailability(value); }
    if (selectedCalendar.access !== 'busy') { const value = await observe(signal => api.calendarEvents(owner, id, selectedAccount, target, window, cursor, signal)); if (generation === lease.current.selection) setEvents(value); }
    setClock(Date.now());
  }
  function reviewedInput(action: CalendarPlanInput['action']) {
    if (!task || !editor || !writable || !links || link && calendarId !== link.calendarId) throw new Error();
    const common = { action, taskId, requestId: randomUUID() };
    if (action === 'calendar.delete') { if (link?.state !== 'linked' || !link.confirmed || editor.baseEtag !== link.confirmed.etag) throw new Error(); return calendarPlanInput({ ...common, etag: editor.baseEtag }); }
    const span = { start: { kind: 'timed', at: providerUtc(editor.start), timeZone: selectedCalendar!.timeZone }, end: { kind: 'timed', at: providerUtc(editor.end), timeZone: selectedCalendar!.timeZone } };
    return calendarPlanInput(action === 'calendar.create' ? { ...common, accountId, calendarId, title: task.title, span } : { ...common, etag: editor.baseEtag, title: editor.title, span });
  }
  async function queue(action: CalendarPlanInput['action'], retry = false) {
    const signal = usable(); const selected = taskId, previous = drafts.intent(selected); if (previous && !retry) throw new Error();
    const pending: ProviderIntent = previous ?? { input: reviewedInput(action), calendarId, ...(link ? { eventId: link.eventId } : {}) };
    drafts.put('intents', selected, pending);
    try {
      const operation = await api.queueCalendar(owner, id, pending.input);
      if (operation.calendarId !== pending.calendarId || pending.eventId && operation.eventId !== pending.eventId) throw new Error('Wrong target');
      const current = drafts.intent(selected);
      if (current?.input.requestId === pending.input.requestId) {
        if (current.operation && current.operation.id !== operation.id) throw new Error('Wrong operation');
        drafts.put('intents', selected, { ...current, operation: current.operation ?? operation, rejected: false });
      }
    } catch (failure) { const current = drafts.intent(selected); if (current?.input.requestId === pending.input.requestId && !current.operation && ['invalid_input', 'conflict', 'remote_plan_active', 'review_required', 'workspace_capacity'].includes(String((failure as { code?: string }).code))) drafts.put('intents', selected, { ...current, rejected: true }); throw failure; }
    signal.throwIfAborted(); usable(); setNotice('Intent accepted. Provider completion is not confirmed.'); await refreshPlanning(); await refreshHistory(selected);
  }
  async function run(operation: CalendarOperationView) { const signal = usable(), checked = await api.runCalendar(owner, id, operation.id); signal.throwIfAborted(); usable(); setNotice(checked.state === 'confirmed' ? 'Calendar simulation confirmed. No real provider changed.' : `Operation ${checked.state}. Inspect before another intent.`); await refreshPlanning(); await refreshHistory(operation.taskId); }
  async function review() {
    if (!link) return; const signal = usable(), selected = taskId, operation = link.operationId, rows = await api.reviewCalendar(owner, id, selected); signal.throwIfAborted(); usable(); onPlanning(rows);
    const pending = drafts.intent(selected); if (!rows.some(row => row.taskId === selected) && pending?.operation?.id === operation && pending.operation.state === 'unknown') drafts.put('intents', selected, { ...pending, reviewedRemoval: operation });
    setNotice('Provider state reviewed. Original operation history and your editor are kept.'); await refreshHistory(selected);
  }
  async function inspectReview() {
    const operation = intent?.operation; if (!operation) return;
    const selected = taskId, receipt = await observe(signal => api.calendarReviewReceipt(owner, id, selected, operation.id, operation.eventId, signal)), pending = drafts.intent(selected);
    if (receipt.relationship === 'removed' && pending?.operation?.id === operation.id) drafts.put('intents', selected, { ...pending, reviewedRemoval: operation.id });
    setNotice(`Saved review receipt: relationship ${receipt.relationship}. Original history is kept.`); await refreshPlanning();
  }
  const sameDetach = (a: PlanningDetachInput | undefined, b: PlanningDetachInput) => !!a && a.operationId === b.operationId && a.eventId === b.eventId && a.etag === b.etag;
  const resolveDetached = (selected: string, operation: string) => { const pending = drafts.intent(selected); if (pending?.operation?.id === operation && pending.operation.state === 'unknown') drafts.put('intents', selected, { ...pending, reviewedRemoval: operation }); };
  async function detach() {
    if (!link || !['linked', 'review_required'].includes(link.state)) throw new Error();
    const signal = usable(), selected = taskId, input: PlanningDetachInput = drafts.detach(selected) ?? { operationId: link.operationId, eventId: link.eventId, etag: link.confirmed?.etag ?? null, acknowledge: 'leave_provider_event' };
    drafts.put('detaches', selected, input); const receipt = await api.detachCalendar(owner, id, selected, input);
    if (sameDetach(drafts.detach(selected), input)) { drafts.put('receipts', selected, receipt); drafts.put('detaches', selected, undefined); resolveDetached(selected, receipt.operationId); } signal.throwIfAborted(); usable(); setNotice('Task detached. Provider event left untouched.'); await refreshPlanning();
  }
  async function inspectDetach() { const selected = taskId, input = drafts.detach(selected); if (!input) return; const receipt = await observe(signal => api.calendarDetachReceipt(owner, id, selected, input, signal)); if (sameDetach(drafts.detach(selected), input)) { drafts.put('receipts', selected, receipt); drafts.put('detaches', selected, undefined); resolveDetached(selected, receipt.operationId); } setNotice('Saved detach receipt confirmed. Provider event left untouched.'); await refreshPlanning(); }
  function acceptVersion() { if (editor && link?.confirmed && link.state === 'linked') { edit({ baseEtag: link.confirmed.etag }); setNotice('Your edits are kept. The next intent uses this reviewed provider version.'); } }
  function nextIntent() { if (canStartProviderIntent(intent, link)) drafts.put('intents', taskId, undefined); }
  return { accounts, accountId, calendarId, calendars, events, availability, operations, historyCursor, historyReady, taskId, task, link, intent, editor, selectedCalendar, writable, ready, busy, error, notice, clock, windowStart, windowEnd, setWindowStart, setWindowEnd, selectAccount, selectCalendar, chooseTask, edit, perform, status, loadCalendar, readCalendar, refreshPlanning, refreshHistory, queue, run, review, inspectReview, acceptVersion, detach, inspectDetach, nextIntent };
}
