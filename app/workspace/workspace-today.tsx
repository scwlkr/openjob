'use client';
import { useEffect, useState } from 'react';
import type { WorkspaceView } from '../../shared/workspace-contracts';
import { personalToday } from '../../shared/workspace-today';
import styles from './workspace.module.css';

type Props = { contextName?: string; view: WorkspaceView; busy: boolean; onOpenTask: (id: string) => void; onOpenEvent: (id: string) => void; onTasks: () => void; onCalendar: () => void };
export default function WorkspaceToday({ contextName, view, busy, onOpenTask, onOpenEvent, onTasks, onCalendar }: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  const today = personalToday(view, now);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return <section aria-label={contextName ? `${contextName} Today` : "Personal Today"}>
    <p>{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · {zone} (this browser)</p>
    <p className={styles.small}>{contextName ? "Work from the last loaded Workspace." : "Your personal work from the last loaded workspace."} Refresh for saved changes. Calendar editors use UTC.</p>
    <div className={styles.calendarGrid}>
      <section className={styles.panel} aria-label="Today's plan"><h2 className={styles.sectionHeading}>Today&apos;s plan</h2>
        {!today.events.length && <p className={styles.empty}>No saved blocks today. Plan time in Calendar.</p>}
        {today.events.map(event => <article className={styles.event} key={event.id}>
          <small>{when(event.start)} – {when(event.end)}</small><strong>{event.title}</strong><span>{view.calendars.find(calendar => calendar.id === event.calendarId)?.name}</span>
          <button disabled={busy} onClick={() => onOpenEvent(event.id)}>Open block: {event.title}</button>
        </article>)}
        <div className={styles.inset}><button disabled={busy} onClick={onCalendar}>Plan time in Calendar</button></div>
      </section>
      <section className={styles.panel} aria-label="Today's open tasks"><h2 className={styles.sectionHeading}>Open tasks</h2>
        <div className={styles.inset}><h3>Planned today</h3>
          {!today.planned.length && <p>No open tasks planned today.</p>}
          {today.planned.map(task => <div className={styles.actions} key={task.id}><button disabled={busy} onClick={() => onOpenTask(task.id)}>Open task: {task.title}</button><small>{when(task.scheduledSlot!.start)}</small></div>)}
          <h3>Not yet planned</h3><p className={styles.small}>Choose time for these tasks in Calendar.</p>
          {!today.unplanned.length && <p>No unscheduled open tasks.</p>}
          {today.unplanned.map(task => <div className={styles.actions} key={task.id}><button disabled={busy} onClick={() => onOpenTask(task.id)}>Open task: {task.title}</button></div>)}
          <button disabled={busy} onClick={onTasks}>Open all Tasks</button>
        </div>
      </section>
    </div>
  </section>;
}
