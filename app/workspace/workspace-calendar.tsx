"use client";

import { useState, type FormEvent } from "react";
import type { WorkspaceCommand, WorkspaceEvent, WorkspaceView } from "../../shared/workspace-contracts";
import styles from "./workspace.module.css";
import calendarStyles from "./workspace-calendar.module.css";

type CalendarMode = "Agenda" | "Day" | "Week";
type Props = { view: WorkspaceView; busy: boolean; command: (input: WorkspaceCommand, success: string) => Promise<boolean> };
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const shift = (value: string, days: number) => { const next = asDate(value); next.setUTCDate(next.getUTCDate() + days); return dayKey(next); };
const formatDay = (value: string) => asDate(value).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const formatTime = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";
const iso = (value: string) => new Date(`${value}:00Z`).toISOString();

export default function WorkspaceCalendar({ view, busy, command }: Props) {
  const [mode, setMode] = useState<CalendarMode>("Agenda");
  const [selectedDate, setSelectedDate] = useState(() => dayKey(new Date()));
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => `${dayKey(new Date())}T14:00`);
  const [end, setEnd] = useState(() => `${dayKey(new Date())}T14:30`);
  const selectedCalendar = calendarId || view.calendars[0]?.id || "";
  const weekStart = shift(selectedDate, -((asDate(selectedDate).getUTCDay() + 6) % 7));
  const rangeStart = mode === "Week" ? weekStart : selectedDate;
  const rangeEnd = shift(rangeStart, mode === "Week" ? 7 : 1);
  const days = Array.from({ length: mode === "Week" ? 7 : 1 }, (_, index) => shift(rangeStart, index));
  const matchesDate = (event: WorkspaceEvent, from: string, to: string) => Date.parse(event.start) < asDate(to).getTime() && Date.parse(event.end) > asDate(from).getTime();
  const events = [...view.events].filter(event => (!filter || event.calendarId === filter) && (mode === "Agenda" || matchesDate(event, rangeStart, rangeEnd))).sort((a, b) => a.start.localeCompare(b.start));
  const rangeLabel = mode === "Agenda" ? "All dates" : mode === "Day" ? formatDay(selectedDate) : `${formatDay(weekStart)} – ${formatDay(shift(weekStart, 6))}`;

  function moveDate(value: string) {
    if (!value || !Number.isFinite(asDate(value).getTime())) return;
    setSelectedDate(value);
    if (!editing) { setStart(`${value}T14:00`); setEnd(`${value}T14:30`); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: WorkspaceCommand = editing
      ? { type: "calendar.update", eventId: editing, title, start: iso(start), end: iso(end) }
      : { type: "calendar.create", calendarId: selectedCalendar, title, start: iso(start), end: iso(end) };
    if (await command(input, editing ? "Time block updated" : "Time block created")) { setEditing(""); setTitle(""); }
  }
  function eventRow(event: WorkspaceEvent) {
    return <article className={styles.event} key={event.id} data-testid="calendar-event">
      <small><time dateTime={event.start}>{formatTime(event.start)}</time> – <time dateTime={event.end}>{formatTime(event.end)}</time></small>
      <strong>{event.title}</strong><span>{view.calendars.find(item => item.id === event.calendarId)?.name}{event.taskId ? " · linked task" : ""}</span>
      <div className={styles.actions}><button disabled={busy} onClick={() => { setEditing(event.id); setTitle(event.title); setStart(event.start.slice(0, 16)); setEnd(event.end.slice(0, 16)); setCalendarId(event.calendarId); }}>Edit block</button>
        <button disabled={busy} onClick={async () => { if (window.confirm(`Delete fixture block “${event.title}”?`) && await command({ type: "calendar.delete", eventId: event.id }, "Time block deleted")) { if (editing === event.id) { setEditing(""); setTitle(""); } } }}>Delete block</button></div>
    </article>;
  }

  return <>
    <section className={`${styles.panel} ${calendarStyles.toolbar}`} aria-label="Calendar navigation">
      <div className={calendarStyles.controls}><div role="group" aria-label="Calendar view">{(["Agenda", "Day", "Week"] as CalendarMode[]).map(value => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value}</button>)}</div>
        <label>Show calendar<select aria-label="Show calendar" value={filter} onChange={event => setFilter(event.target.value)}><option value="">All calendars</option>{view.calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label>
      </div>
      <div className={calendarStyles.controls}><div role="group" aria-label="Calendar date navigation"><button aria-label="Previous period" onClick={() => moveDate(shift(selectedDate, mode === "Week" ? -7 : -1))}>Previous</button><button onClick={() => moveDate(dayKey(new Date()))}>Today</button><button aria-label="Next period" onClick={() => moveDate(shift(selectedDate, mode === "Week" ? 7 : 1))}>Next</button></div>
        <label>Calendar date<input aria-label="Calendar date" type="date" value={selectedDate} onChange={event => moveDate(event.target.value)} /></label>
      </div>
      <p className={calendarStyles.period} data-testid="calendar-period" aria-live="polite">{mode} · {rangeLabel} · UTC</p><small>All times shown and edited in UTC. Agenda includes every date; Day and Week show events overlapping the selected period.</small>
    </section>
    <div className={styles.calendarGrid}>
      <section className={styles.panel} aria-label="Calendar events"><h2 className={styles.sectionHeading}>{mode === "Agenda" ? "Upcoming agenda" : `${mode} calendar`}</h2>
        {!events.length && <p className={styles.empty}>{filter || mode !== "Agenda" ? "No events match this calendar and period." : "Your agenda is clear."}</p>}
        {mode === "Agenda" ? events.map(eventRow) : days.map(day => <section key={day} aria-label={formatDay(day)} className={calendarStyles.day}><h3>{formatDay(day)}</h3>{events.filter(event => matchesDate(event, day, shift(day, 1))).map(eventRow)}{!events.some(event => matchesDate(event, day, shift(day, 1))) && <p className={calendarStyles.clear}>No events</p>}</section>)}
      </section>
      <section className={styles.panel}><h2 className={styles.sectionHeading}>{editing ? "Edit time block" : "Create time block"}</h2><form className={styles.form} onSubmit={submit}>
        <label>Block title<input aria-label="Block title" required value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>Calendar<select aria-label="Calendar" required disabled={Boolean(editing) || busy} value={selectedCalendar} onChange={event => setCalendarId(event.target.value)}>{view.calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label>
        {editing && <small>The block stays on its original calendar when editing.</small>}
        <label>Start (UTC)<input aria-label="Start (UTC)" type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} /></label>
        <label>End (UTC)<input aria-label="End (UTC)" type="datetime-local" required value={end} onChange={event => setEnd(event.target.value)} /></label>
        <button className={styles.primary} disabled={busy || !selectedCalendar}>{editing ? "Save block" : "Create block"}</button>
        {editing && <button type="button" disabled={busy} onClick={() => { setEditing(""); setTitle(""); }}>Cancel edit</button>}
      </form></section>
    </div>
  </>;
}
