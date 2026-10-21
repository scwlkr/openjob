import { useCallback, useEffect, useRef, useState } from 'react';
import { calendarAccounts, calendarListPage, calendarEventsPage, calendarAvailability, remotePlanningLinks, calendarOperation, calendarPlanInput, planningDetachReceipt, planningReviewReceipt } from '../../shared/calendar-client';
import type { ProviderCalendarAccount, RemoteCalendarPage, RemoteEventPage, CalendarAvailability } from '../../shared/provider-calendar';
import type { CalendarOperationView, CalendarPlanInput, RemotePlanningLink, PlanningDetachInput } from '../../shared/remote-planning';
import type { WorkspaceView } from '../../shared/workspace-contracts';
import { providerUtc, canStartProviderIntent, initialProviderEditor as initialEditor, type ProviderEditor, type ProviderIntent as Intent, type ProviderPlanningDrafts } from './provider-planning-drafts';
import { requestProviderCalendar } from './provider-calendar-request';

type Props = { workspaceId: string; view: WorkspaceView; getToken: () => Promise<string>; links: RemotePlanningLink[]; drafts: ProviderPlanningDrafts; onPlanning(links: RemotePlanningLink[] | undefined): void };
const day = () => new Date().toISOString().slice(0, 10);
/** Disposable provider reader; authored requests belong to the retained draft ledger. */
export function useProviderCalendar({ workspaceId, view, getToken, links, drafts, onPlanning }: Props) {
  const initialLink = links.find(row => row.taskId === drafts.taskId);
  const [accounts, setAccounts] = useState<ProviderCalendarAccount[]>([]), [accountId, setAccountId] = useState(() => initialLink?.calendarId.split(':calendar:')[0] ?? ''), [calendarId, setCalendarId] = useState(() => initialLink?.calendarId ?? '');
  const [calendars, setCalendars] = useState<RemoteCalendarPage>(), [events, setEvents] = useState<RemoteEventPage>(), [availability, setAvailability] = useState<CalendarAvailability>();
  const [operations, setOperations] = useState<CalendarOperationView[]>([]), [historyReady, setHistoryReady] = useState(false);
  const { taskId, editors, intents, detaches: detachIntents, receipts: detachReceipts } = drafts;
  const [windowStart, writeWindowStart] = useState(() => day() + 'T00:00'), [windowEnd, writeWindowEnd] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T00:00');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [clock, setClock] = useState(Date.now);
  const lease = useRef(new AbortController()), lock = useRef(false), selection = useRef(0), historyRead = useRef(0);
  const request = useCallback(() => { const signal = lease.current.signal; return (path: string, body?: unknown, post = false) => requestProviderCalendar(getToken, signal, workspaceId, path, body, post); }, [getToken, workspaceId]);
  const task = view.tasks.find(row => row.id === taskId), link = links.find(row => row.taskId === taskId), intent = intents[taskId];
  const editor = task ? editors[taskId]?.dirty ? editors[taskId] : initialEditor(task, link) : undefined;
  const selectedCalendar = calendars && Date.parse(calendars.expiresAt) > clock ? calendars.calendars.find(row => row.id === calendarId) : undefined;
  const account = accounts.find(row => row.accountId === accountId), writable = !!account?.available && !!selectedCalendar && ['owner', 'writer'].includes(selectedCalendar.access);
  function acceptLinks(value: unknown) { const rows = remotePlanningLinks(value); onPlanning(rows); return rows; }
  function clearViews() { setCalendars(undefined); setEvents(undefined); setAvailability(undefined); }
  async function refreshPlanning() { const send = request(), result = await send('planning'); return acceptLinks(result.data); }
  async function refreshHistory(selected = taskId) {
    if (!selected) return;
    const send = request(), generation = selection.current, revision = ++historyRead.current, result = await send('calendar-operations?' + new URLSearchParams({ taskId: selected }));
    if (generation !== selection.current || revision !== historyRead.current) return;
    if (!Array.isArray(result.data) || result.data.length > 50) throw new Error();
    const rows = result.data.map(value => calendarOperation(value, workspaceId)); if (rows.some(row => row.taskId !== selected)) throw new Error();
    const pending = drafts.intent(selected), match = pending && rows.find(row => row.requestId === pending.input.requestId);
    if (pending && match) { calendarOperation(match, workspaceId, { input: pending.input }); if (match.calendarId !== pending.calendarId || pending.eventId && match.eventId !== pending.eventId) throw new Error(); drafts.put('intents', selected, { ...pending, operation: match, rejected: false }); }
    setOperations(rows); setHistoryReady(true);
  }
  async function status() {
    clearViews(); setAccounts([]);
    const send = request(), result = await send('provider-calendars/accounts'), rows = calendarAccounts(result.data); setAccounts(rows);
    setAccountId(previous => previous || rows.find(row => row.available)?.accountId || ''); await refreshPlanning();
  }
  useEffect(() => {
    const controller = new AbortController(); lease.current = controller;
    const send = request();
    void send('provider-calendars/accounts').then(result => { const rows = calendarAccounts(result.data); setAccounts(rows); setAccountId(previous => previous || rows.find(row => row.available)?.accountId || ''); }).catch(() => { if (!controller.signal.aborted) { onPlanning(undefined); setError('Provider planning is unavailable. Local Calendar work remains available. Authored requests are kept.'); } });
    return () => controller.abort();
  }, [request, onPlanning]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!account?.available) return;
    const send = request(), signal = lease.current.signal; let cancelled = false;
    void send('provider-calendars?' + new URLSearchParams({ accountId })).then(result => calendarListPage(result.data, accountId)).then(page => { if (!cancelled && !signal.aborted) { setCalendars(page); setCalendarId(previous => previous || page.calendars[0]?.id || ''); } }).catch(() => { if (!cancelled && !signal.aborted) { clearViews(); setError('Calendar list unavailable. Refresh status before planning.'); } });
    return () => { cancelled = true; };
  }, [account, accountId, request]);
  useEffect(() => {
    if (!taskId) return; const signal = lease.current.signal;
    void refreshHistory(taskId).catch(() => { if (!signal.aborted) setError('Operation history unavailable. Keep the reviewed request and inspect again.'); });
    // A selection change invalidates history in chooseTask before this read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, request]);
  function chooseTask(id: string) {
    const selected = view.tasks.find(row => row.id === id); selection.current++; drafts.selectTask(id); setOperations([]); setHistoryReady(false);
    if (!selected) return; const existing = links.find(row => row.taskId === id);
    if (!drafts.editors[id]) drafts.put('editors', id, initialEditor(selected, existing));
    if (existing) { if (accountId !== existing.calendarId.split(':calendar:')[0]) clearViews(); else { setEvents(undefined); setAvailability(undefined); } setAccountId(existing.calendarId.split(':calendar:')[0]); setCalendarId(existing.calendarId); }
  }
  function edit(patch: Partial<ProviderEditor>) { if (task && editor) drafts.put('editors', taskId, { ...editor, ...patch, dirty: true }); }
  function selectAccount(id: string) { selection.current++; setAccountId(id); setCalendarId(''); clearViews(); }
  function selectCalendar(id: string) { selection.current++; setCalendarId(id); setEvents(undefined); setAvailability(undefined); }
  function setWindowStart(value: string) { selection.current++; writeWindowStart(value); setEvents(undefined); setAvailability(undefined); }
  function setWindowEnd(value: string) { selection.current++; writeWindowEnd(value); setEvents(undefined); setAvailability(undefined); }
  async function perform(action: () => Promise<void>) {
    if (lock.current) return; const signal = lease.current.signal; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch { if (!signal.aborted) { setEvents(undefined); setAvailability(undefined); setError('Provider action or status refresh unavailable. Inspect the verified receipt or pending request before retrying. Your editor is kept.'); } }
    finally { if (!signal.aborted) { lock.current = false; setBusy(false); } }
  }
  async function loadCalendar(cursor?: string) {
    setEvents(undefined); setAvailability(undefined);
    const send = request(), generation = selection.current, selected = accountId;
    const result = await send('provider-calendars?' + new URLSearchParams({ accountId: selected, ...(cursor ? { cursor } : {}) })), page = calendarListPage(result.data, selected);
    if (generation === selection.current) { setCalendars(page); setClock(Date.now()); }
  }
  async function readCalendar(cursor?: string) {
    if (!selectedCalendar || !account?.available) throw new Error();
    const send = request(), generation = selection.current, target = calendarId, selectedAccount = accountId, window = { start: providerUtc(windowStart), end: providerUtc(windowEnd) }, query = new URLSearchParams({ accountId: selectedAccount, calendarId: target, ...window });
    setEvents(undefined); setAvailability(undefined);
    const availabilityResult = cursor ? undefined : await send('provider-calendars/availability?' + query);
    if (generation !== selection.current) return; if (availabilityResult) setAvailability(calendarAvailability(availabilityResult.data, target, window));
    if (selectedCalendar.access !== 'busy') { if (cursor) query.set('cursor', cursor); const result = await send('provider-calendars/events?' + query); if (generation === selection.current) setEvents(calendarEventsPage(result.data, selectedAccount, target)); }
    setClock(Date.now());
  }
  function reviewedInput(action: CalendarPlanInput['action']): CalendarPlanInput {
    if (!task || !editor || !writable || link && calendarId !== link.calendarId) throw new Error();
    const common = { action, taskId, requestId: crypto.randomUUID() };
    if (action === 'calendar.delete') { if (!link?.confirmed || link.state !== 'linked' || editor.baseEtag !== link.confirmed.etag) throw new Error(); return calendarPlanInput({ ...common, etag: editor.baseEtag }); }
    const span = { start: { kind: 'timed', at: providerUtc(editor.start), timeZone: selectedCalendar!.timeZone }, end: { kind: 'timed', at: providerUtc(editor.end), timeZone: selectedCalendar!.timeZone } };
    return calendarPlanInput(action === 'calendar.create' ? { ...common, accountId, calendarId, title: task.title, span } : { ...common, etag: editor.baseEtag, title: editor.title, span });
  }
  async function queue(action: CalendarPlanInput['action'], retry = false) {
    const send = request(), selected = taskId, previous = drafts.intent(selected); if (previous && !retry) throw new Error();
    const pending: Intent = previous ?? { input: reviewedInput(action), calendarId, ...(link ? { eventId: link.eventId } : {}) };
    drafts.put('intents', selected, pending);
    let operation: CalendarOperationView;
    try {
      const result = await send('calendar-operations', pending.input); operation = calendarOperation(result.data, workspaceId, { input: pending.input });
      if (operation.calendarId !== pending.calendarId || pending.eventId && operation.eventId !== pending.eventId) throw new Error();
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (['invalid_input', 'conflict', 'remote_plan_active', 'review_required', 'workspace_capacity'].includes(String(code))) drafts.put('intents', selected, { ...pending, rejected: true }); throw error;
    }
    drafts.put('intents', selected, { ...pending, operation, rejected: false }); setNotice('Intent accepted. Provider completion is not confirmed.'); await refreshPlanning(); await refreshHistory(selected);
  }
  async function run(operation: CalendarOperationView) {
    const send = request(), result = await send('calendar-operations/' + operation.id + '/run-fixture', undefined, true), checked = calendarOperation(result.data, workspaceId, { id: operation.id });
    setNotice(checked.state === 'confirmed' ? 'Simulation confirmed. No real provider was changed.' : `Operation ${checked.state}. Inspect saved status before another intent.`); await refreshPlanning(); await refreshHistory(operation.taskId);
  }
  async function review() {
    if (!taskId || !link) return;
    const send = request(), selected = taskId, reviewedOperation = link.operationId, generation = selection.current, result = await send('planning/' + selected + '/review', undefined, true);
    if (generation !== selection.current) return;
    const rows = acceptLinks(result.data);
    const pending = drafts.intent(selected);
    if (!rows.some(row => row.taskId === selected) && pending?.operation?.id === reviewedOperation && pending.operation.state === 'unknown') drafts.put('intents', selected, { ...pending, reviewedRemoval: reviewedOperation });
    setNotice('Provider state reviewed. Your editor and original operation history are unchanged. Explicitly accept a remaining block’s version before another intent.'); await refreshHistory(selected);
  }
  async function inspectReview() {
    if (!intent?.operation) return;
    const send = request(), selected = taskId, operation = intent.operation, result = await send('planning/' + selected + '/review?' + new URLSearchParams({ operationId: operation.id })), receipt = planningReviewReceipt(result.data, selected, operation.id, operation.eventId);
    const pending = drafts.intent(selected);
    if (receipt.relationship === 'removed' && pending?.operation?.id === operation.id) drafts.put('intents', selected, { ...pending, reviewedRemoval: operation.id });
    setNotice(`Saved review receipt: relationship ${receipt.relationship}. The original operation history is unchanged.`); await refreshPlanning();
  }
  function acceptVersion() { if (editor && link?.confirmed) { edit({ baseEtag: link.confirmed.etag }); setNotice('Your edits are kept. The next intent will use this reviewed provider version.'); } }
  async function detach() {
    if (!link || !['linked', 'review_required'].includes(link.state)) throw new Error();
    const send = request(), selected = taskId, input: PlanningDetachInput = detachIntents[selected] ?? { operationId: link.operationId, eventId: link.eventId, etag: link.confirmed?.etag ?? null, acknowledge: 'leave_provider_event' };
    drafts.put('detaches', selected, input); const result = await send('planning/' + selected + '/detach', input), receipt = planningDetachReceipt(result.data, selected, input.operationId, input);
    drafts.put('receipts', selected, receipt); drafts.put('detaches', selected, undefined); resolveDetached(selected, receipt.operationId); setNotice('Task detached. The provider event was left untouched.'); await refreshPlanning();
  }
  async function inspectDetach() {
    const input = detachIntents[taskId]; if (!input) return; const selected = taskId, send = request(), result = await send('planning/' + selected + '/detach?' + new URLSearchParams({ operationId: input.operationId })), receipt = planningDetachReceipt(result.data, selected, input.operationId, input);
    drafts.put('receipts', selected, receipt); drafts.put('detaches', selected, undefined); resolveDetached(selected, receipt.operationId); setNotice('Detachment receipt confirmed. The provider event was left untouched.'); await refreshPlanning();
  }
  function resolveDetached(selected: string, operationId: string) { const pending = drafts.intent(selected); if (pending?.operation?.id === operationId && pending.operation.state === 'unknown') drafts.put('intents', selected, { ...pending, reviewedRemoval: operationId }); }
  function nextIntent() { if (!canStartProviderIntent(intent, link)) return; drafts.put('intents', taskId, undefined); }
  return { accounts, accountId, calendarId, calendars, events, availability, taskId, task, editor, link, intent, operations, historyReady, selectedCalendar, writable, busy, error, notice, clock, windowStart, windowEnd, setWindowStart, setWindowEnd, selectAccount, selectCalendar, chooseTask, edit, perform, status, loadCalendar, readCalendar, refreshHistory, refreshPlanning, queue, run, review, inspectReview, acceptVersion, detach, nextIntent, detachIntent: detachIntents[taskId], detachReceipt: detachReceipts[taskId], inspectDetach };
}
