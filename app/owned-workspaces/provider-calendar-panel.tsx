'use client';
import { useProviderCalendar } from './use-provider-calendar';
import { useEffect, useImperativeHandle, type Ref } from 'react';
import { useProviderPlanningDrafts, initialProviderEditor, canStartProviderIntent } from './provider-planning-drafts';
import type { CalendarPoint } from '../../shared/provider-calendar';
import styles from '../workspace/workspace.module.css';
import layout from './provider-calendar.module.css';
export type ProviderCalendarHandle = { openTask(id: string): boolean; blocksDeletion(id: string): boolean };
type ViewProps = Parameters<typeof useProviderCalendar>[0] & { onOpenTask?(id: string): void };
type Props = Omit<ViewProps, 'drafts'> & { active: boolean; enabled: boolean; ref?: Ref<ProviderCalendarHandle> };
function point(value: CalendarPoint) { return value.kind === 'all-day' ? `${value.date} · all-day · ${value.timeZone}` : `${new Date(value.at).toLocaleString('en-US', { timeZone: value.timeZone, timeZoneName: 'shortOffset' })} · ${value.timeZone}`; }
export default function ProviderCalendarPanel({ ref, active, enabled, ...props }: Props) {
  const drafts = useProviderPlanningDrafts();
  useImperativeHandle(ref, () => ({
    openTask(id) { const task = props.view.tasks.find(row => row.id === id); if (!task) return false; drafts.selectTask(id); if (!drafts.editors[id]) drafts.put('editors', id, initialProviderEditor(task, props.links.find(row => row.taskId === id))); return true; },
    blocksDeletion(id) { return !!drafts.editors[id]?.dirty || !!drafts.detaches[id] || !!drafts.intents[id] && !canStartProviderIntent(drafts.intents[id], props.links.find(row => row.taskId === id)); },
  }), [drafts, props.view.tasks, props.links]);
  useEffect(() => {
    if (!Object.values(drafts.editors).some(row => row.dirty) && !Object.keys(drafts.detaches).length && !Object.entries(drafts.intents).some(([id, intent]) => !canStartProviderIntent(intent, props.links.find(row => row.taskId === id)))) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [drafts.editors, drafts.detaches, drafts.intents, props.links]);
  return enabled && active ? <ProviderCalendarView {...props} drafts={drafts} /> : null;
}
function ProviderCalendarView(props: ViewProps) {
  const state = useProviderCalendar(props), { link, editor, intent } = state;
  const freshAvailability = state.availability && Date.parse(state.availability.expiresAt) > state.clock;
  const freshEvents = state.events && Date.parse(state.events.expiresAt) > state.clock && !!state.selectedCalendar;
  const canManage = !!link && link.calendarId === state.calendarId && state.writable && link.state === 'linked' && !!link.confirmed && editor?.baseEtag === link.confirmed.etag;
  const canNew = canStartProviderIntent(intent, link);
  const operation = intent?.operation;
  return <section aria-label="Provider Calendar planning">
    <h2>Connected Calendar planning</h2><p>Invented Google Calendar fixture · no live provider calls. Local OpenJob blocks stay in the Calendar below. Mail consent alone grants no Calendar access.</p>
    <button disabled={state.busy} onClick={() => state.perform(async () => { await state.status(); await state.refreshHistory(); })}>Refresh provider status</button>
    {state.error && <p role="alert" className={styles.error}>{state.error}</p>}{state.notice && <p role="status" className={styles.success}>{state.notice}</p>}
    <div className={layout.grid}>
      <section className={`${styles.panel} ${layout.section}`} aria-label="Provider Calendar and availability"><h3>Calendar and availability</h3>
        <div className={styles.form}>
          <label>Calendar account<select aria-label="Calendar account" value={state.accountId} disabled={state.busy} onChange={event => state.selectAccount(event.target.value)}><option value="">Choose a configured account</option>{state.accounts.map(row => <option key={row.accountId} value={row.accountId} disabled={!row.available}>{row.label}{row.available ? '' : ' · unavailable'}</option>)}</select></label>
          {!state.accounts.length && <p>No separately configured Calendar account is available here.</p>}
          <label>Provider Calendar<select aria-label="Provider Calendar" value={state.calendarId} disabled={state.busy || !state.selectedCalendar && !state.calendars} onChange={event => state.selectCalendar(event.target.value)}><option value="">Choose a Calendar</option>{state.calendarId && !state.calendars?.calendars.some(row => row.id === state.calendarId) && <option value={state.calendarId} disabled>Previous selection · refresh to verify</option>}{state.calendars?.calendars.map(row => <option key={row.id} value={row.id}>{row.name} · {row.access}</option>)}</select></label>
          <div className={layout.controls}><button disabled={state.busy || !state.accountId} onClick={() => state.perform(() => state.loadCalendar())}>Reload Calendars</button>{state.calendars?.nextCursor && <button disabled={state.busy} onClick={() => state.perform(() => state.loadCalendar(state.calendars!.nextCursor!))}>Next Calendars</button>}</div>
          <label>Availability window start (UTC)<input aria-label="Availability window start (UTC)" type="datetime-local" value={state.windowStart} disabled={state.busy} onChange={event => state.setWindowStart(event.target.value)} /></label>
          <label>Availability window end (UTC)<input aria-label="Availability window end (UTC)" type="datetime-local" value={state.windowEnd} disabled={state.busy} onChange={event => state.setWindowEnd(event.target.value)} /></label>
          <button disabled={state.busy || !state.selectedCalendar} onClick={() => state.perform(() => state.readCalendar())}>Check provider Calendar</button>
        </div>
        {!state.selectedCalendar && state.calendarId && <p>Calendar identity or access is not current. Reload before planning.</p>}
        {freshAvailability && state.availability ? <><p role="status">Availability observed {new Date(state.availability.observedAt).toLocaleTimeString()} · expires {new Date(state.availability.expiresAt).toLocaleTimeString()}. This does not reserve time.</p>{state.availability.busy.length ? <ul>{state.availability.busy.map((row, index) => <li key={index}>Busy {row.start} – {row.end}</li>)}</ul> : <p>No busy intervals were reported in this window. Another event can still be added.</p>}</> : <p>Availability is unavailable, expired or not checked. This does not mean the Calendar is free.</p>}
        {state.selectedCalendar?.access === 'busy' && <p>Busy-only Calendar: event details are unavailable.</p>}
        {freshEvents && state.events && <><h4>Provider events</h4>{state.events.events.map(event => <article className={layout.row} key={event.id}><strong>{event.title || '(Untitled)'}</strong><span>{point(event.span.start)} – {event.span.end ? point(event.span.end) : 'End unspecified'}</span>{event.span.start.kind === 'all-day' && <small>All-day end date is exclusive.</small>}{event.occurrence && <small>Expanded recurrence instance; original start {point(event.occurrence.originalStart)}.</small>}</article>)}{!state.events.events.length && <p>No event details on this page.</p>}{state.events.nextCursor && <button disabled={state.busy} onClick={() => state.perform(() => state.readCalendar(state.events!.nextCursor!))}>Next provider events</button>}</>}
      </section>
      <section className={`${styles.panel} ${layout.section}`} aria-label="Task provider plan"><h3>Plan a Task</h3>
        <label>Task for provider planning<select aria-label="Task for provider planning" disabled={state.busy} value={state.taskId} onChange={event => state.chooseTask(event.target.value)}><option value="">Choose a Task</option>{props.view.tasks.map(task => <option key={task.id} value={task.id} disabled={!!task.scheduledSlot}>{task.title}{task.scheduledSlot ? ' · local block exists' : ''}{task.completed ? ' · complete' : ''}</option>)}</select></label>
        {state.task && editor && <>
          {props.onOpenTask && <button disabled={state.busy} onClick={() => props.onOpenTask!(state.taskId)}>Open Task and source</button>}
          <p>{link ? `Provider plan: ${link.state.replaceAll('_', ' ')}. Local Task edits do not change the provider event.` : 'No active provider relationship is recorded for this Task.'}</p>
          {link?.confirmed && <div className={layout.row}><strong>Last confirmed provider block</strong><span>{link.confirmed.title}</span><span>{point(link.confirmed.span.start)} – {point(link.confirmed.span.end)}</span><button disabled={state.busy || link.state !== 'linked'} onClick={state.acceptVersion}>Accept reviewed version; keep my edits</button></div>}
          <form className={styles.form} onSubmit={event => { event.preventDefault(); void state.perform(() => state.queue(link ? 'calendar.update' : 'calendar.create')); }}>
            <label>Provider block title<input aria-label="Provider block title" value={link ? editor.title : state.task.title} readOnly={!link} maxLength={500} onChange={event => state.edit({ title: event.target.value })} /></label>
            {!link && <small>The initial block uses the saved Task title. Edit the Task first to change it.</small>}
            <label>Provider block start (UTC)<input aria-label="Provider block start (UTC)" required type="datetime-local" step="any" value={editor.start} onChange={event => state.edit({ start: event.target.value })} /></label>
            <label>Provider block end (UTC)<input aria-label="Provider block end (UTC)" required type="datetime-local" step="any" value={editor.end} onChange={event => state.edit({ end: event.target.value })} /></label>
            <small>Times are entered in UTC. Provider event timezone: {state.selectedCalendar?.timeZone ?? 'refresh the selected Calendar'}. One timed block; no attendees or meeting data.</small>
            {link?.confirmed && editor.baseEtag !== link.confirmed.etag && <p>Provider version changed. Review the last confirmed block and explicitly accept that version before another intent.</p>}
            <button className={styles.primary} disabled={state.busy || !!intent || !state.writable || !!state.task.scheduledSlot || !!link && !canManage}>{link ? 'Queue reviewed provider update' : 'Queue provider plan'}</button>
            {editor.dirty && <button type="button" disabled={state.busy} onClick={() => { if (window.confirm('Discard only the unsaved provider editor fields? Frozen requests and saved provider work stay unchanged.')) props.drafts.put('editors', state.taskId, initialProviderEditor(state.task!, link)); }}>Discard unsaved provider edits</button>}
          </form>
          {intent && <section className={layout.confirm} aria-label="Frozen Calendar intent"><strong>Frozen intent · {intent.input.action}</strong><p>Request {intent.input.requestId}</p>{intent.input.action !== 'calendar.delete' && <p>{intent.input.title} · {point(intent.input.span.start)} – {point(intent.input.span.end)}</p>}<p>{operation ? `Operation ${operation.state} · ${operation.outcome ?? 'accepted intent; not completed'}` : intent.rejected ? 'Request rejected before acceptance. Your editor is kept.' : 'Acknowledgement is unverified. Inspect history; the exact request is kept.'}</p><div className={layout.controls}>{!operation && !intent.rejected && <button disabled={state.busy} onClick={() => state.perform(() => state.queue(intent.input.action, true))}>Retry exact reviewed intent</button>}{canNew && <button disabled={state.busy} onClick={state.nextIntent}>Start a new reviewed intent</button>}</div></section>}
          <div className={layout.controls}><button disabled={state.busy} onClick={() => state.perform(async () => { await state.refreshPlanning(); await state.refreshHistory(); })}>Inspect planning status</button>{link && <button disabled={state.busy || link.state === 'reserved'} onClick={() => state.perform(state.review)}>Review current provider state</button>}</div>
          {intent?.operation?.state === 'unknown' && <button disabled={state.busy} onClick={() => state.perform(state.inspectReview)}>Inspect saved provider review receipt</button>}
          {link && <div className={layout.confirm}><p>Detach leaves the provider event in place. Provider deletion is a separate queued effect.</p><div className={layout.controls}><button disabled={state.busy || !['linked', 'review_required'].includes(link.state)} onClick={() => { if (window.confirm('Detach this Task and leave the provider event untouched?')) void state.perform(state.detach); }}>Detach Task; leave provider event</button><button disabled={state.busy || !!intent || !canManage} onClick={() => { if (window.confirm('Queue deletion of this provider event? The Task stays in OpenJob.')) void state.perform(() => state.queue('calendar.delete')); }}>Queue provider event deletion</button></div></div>}
          {state.detachIntent && <p>Detachment acknowledgement is unverified. <button disabled={state.busy} onClick={() => state.perform(state.inspectDetach)}>Inspect detach receipt</button></p>}{state.detachReceipt && <p role="status">Detachment confirmed at {new Date(state.detachReceipt.detachedAt).toLocaleTimeString()}. Provider event left untouched.</p>}
          <h4>Operation history</h4>{!state.historyReady && <p>History is not current. Inspect status before executing an operation.</p>}{state.historyReady && state.operations.map(row => <article className={layout.row} key={row.id}><strong>{row.action} · {row.state}</strong><small>{row.id}</small><span>{row.outcome ?? 'Accepted intent, awaiting explicit fixture execution'}</span>{row.state === 'queued' && <button disabled={state.busy} onClick={() => state.perform(() => state.run(row))}>Run Calendar fixture operation</button>}{row.state === 'unknown' && <small>Execution cannot replay. Review provider state to reconcile.</small>}</article>)}
        </>}
      </section>
    </div>
  </section>;
}
