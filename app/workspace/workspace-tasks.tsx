"use client";

import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from "react";
import type { WorkspaceCommand, WorkspaceTask, WorkspaceView } from "../../shared/workspace-contracts";
import type { MailSource } from "./workspace-mail";
import { linkedTask, mailLinkedTasks, type CalendarTaskSource, type MailTaskSource } from "./workspace-links";
import { filterWorkspaceTasks } from "../../shared/workspace-task-query.mjs";
import styles from "./workspace.module.css";
import taskStyles from "./workspace-tasks.module.css";

export type WorkspaceTasksHandle = { openTask: (id: string) => boolean; openLinkedTask: (source: CalendarTaskSource) => boolean; openMailTask: (source: MailTaskSource) => boolean };
type Props = { view: WorkspaceView; busy: boolean; command: (input: WorkspaceCommand, success: string) => Promise<boolean>; onSaveNotes?: (taskId: string, notes: string, expectedNotes: string) => Promise<boolean>; onOpenSource?: (source: MailSource) => void; active?: boolean; ref?: Ref<WorkspaceTasksHandle> };
const defaults = () => { const day = new Date().toISOString().slice(0, 10); return { start: `${day}T14:00`, end: `${day}T14:30` }; };
const utc = (value: string) => new Date(`${value}:00Z`).toISOString();
const format = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";

export default function WorkspaceTasks({ view, busy, command, onSaveNotes, onOpenSource, active = true, ref }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [notesId, setNotesId] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesBase, setNotesBase] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [start, setStart] = useState(() => defaults().start);
  const [end, setEnd] = useState(() => defaults().end);
  const [openedTask, setOpenedTask] = useState("");
  const [navigation, setNavigation] = useState(0);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const taskArticle = useRef<HTMLElement>(null);
  const scheduledTask = view.tasks.find((task) => task.id === scheduleId);
  const selectedCalendar = calendarId || view.calendars[0]?.id || "";
  let visibleTasks: WorkspaceTask[] = [];
  let filterError = "";
  try { visibleTasks = filterWorkspaceTasks(view.tasks, { status, search, scheduledOn }); }
  catch { filterError = "Choose a valid status, search up to 200 characters, and a real planned day in UTC."; }

  function clearFilters() { setStatus("all"); setSearch(""); setScheduledOn(""); }

  useImperativeHandle(ref, () => ({ openTask(id) {
    if (!view.tasks.some(task => task.id === id)) return false;
    clearFilters(); setOpenedTask(id); setNavigation(value => value + 1); return true;
  }, openLinkedTask(source) {
    const task = linkedTask(view, source);
    if (!task) return false;
    setStatus("all"); setSearch(""); setScheduledOn("");
    setOpenedTask(task.id); setNavigation(value => value + 1); return true;
  }, openMailTask(source) {
    const task = mailLinkedTasks(view, source).find(item => item.id === source.taskId);
    if (!task) return false;
    clearFilters(); setOpenedTask(task.id); setNavigation(value => value + 1); return true;
  } }), [view]);
  useEffect(() => { if (active && navigation) taskArticle.current?.focus(); }, [active, navigation]);

  function openSchedule(task: WorkspaceTask) {
    const linkedEvent = view.events.find((event) => event.id === task.calendarEventId || event.taskId === task.id);
    const fresh = defaults();
    setScheduleId(task.id);
    setCalendarId(linkedEvent?.calendarId || view.calendars[0]?.id || "");
    setStart(task.scheduledSlot?.start.slice(0, 16) || fresh.start);
    setEnd(task.scheduledSlot?.end.slice(0, 16) || fresh.end);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (await command({ type: "task.create", title: newTitle }, "Task created")) { setNewTitle(""); clearFilters(); }
  }

  if (!active) return null;
  return <>
    <form className={styles.inlineForm} onSubmit={create}>
      <label className={styles.grow}>New task<input aria-label="New task" required value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="What needs your attention?" /></label>
      <button className={styles.primary} disabled={busy || !newTitle.trim()}>Add task</button>
    </form>
    <section className={styles.panel} aria-label="Find tasks">
      <div className={taskStyles.filters}>
        <label>Task status<select aria-label="Task status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All tasks</option><option value="open">Open tasks</option><option value="completed">Completed tasks</option></select></label>
        <label className={styles.grow}>Search tasks<input aria-label="Search tasks" type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder="Task title…" /></label>
        <label>Planned day (UTC)<input aria-label="Planned day (UTC)" type="date" value={scheduledOn} onChange={event => setScheduledOn(event.target.value)} /></label>
        <button onClick={() => setScheduledOn(new Date().toISOString().slice(0, 10))}>Planned today</button>
        <button onClick={clearFilters}>Clear task filters</button>
      </div>
      <p className={styles.small} aria-live="polite">{visibleTasks.length} of {view.tasks.length} tasks · {status}{scheduledOn ? ` · overlaps ${scheduledOn} UTC` : " · any planned day"}{search.trim() ? ` · title contains “${search.trim()}”` : ""}</p>
      {filterError && <p role="alert" className={styles.error}>{filterError}</p>}
    </section>
    <section className={styles.panel} aria-label="Task list">
      {visibleTasks.map((task) => <article ref={task.id === openedTask ? taskArticle : undefined} tabIndex={-1} className={`${styles.task} ${task.id === openedTask ? styles.selected : ""}`} data-testid="task-row" key={task.id}>
        <label><input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.completed} disabled={busy} onChange={(event) => command({ type: "task.complete", taskId: task.id, completed: event.target.checked }, "Task updated")} /><span className={`${taskStyles.title} ${task.completed ? styles.completed : ""}`}>{task.title}</span></label>
        <p className={taskStyles.metadata}>{task.sourceMessageId && <small>From private mail · </small>}{task.scheduledSlot ? <small>{format(task.scheduledSlot.start)} – {format(task.scheduledSlot.end)} · {view.calendars.find((calendar) => calendar.id === view.events.find((event) => event.id === task.calendarEventId)?.calendarId)?.name || "Linked calendar"}</small> : <small>Unscheduled</small>}</p>
        {onSaveNotes && notesId === task.id && !task.notes && <p>No saved notes.</p>}
        {task.notes && <pre className={taskStyles.notes} aria-label={`Notes for ${task.title}`}>{task.notes}</pre>}
        {notesId === task.id && <form className={taskStyles.notesEditor} onSubmit={async event => { event.preventDefault(); if (await (onSaveNotes ? onSaveNotes(task.id, notesDraft, notesBase) : command({ type: "task.notes", taskId: task.id, notes: notesDraft }, "Task notes saved"))) setNotesId(""); }}>
          {onSaveNotes && (task.notes ?? "") !== notesBase && <p role="alert">Saved notes changed since you opened this editor. Your text is kept below. Review the latest saved notes above; discard and reopen to edit that version.</p>}
          <label>Task notes<textarea aria-label="Task notes" rows={7} maxLength={40000} disabled={busy} value={notesDraft} onChange={event => setNotesDraft(event.target.value)} /></label>
          <small>{[...notesDraft].length.toLocaleString()} / 20,000 characters · saved with this Task. Saved/offline Tasks include these authored notes.</small>
          <div className={taskStyles.actions}><button disabled={busy || [...notesDraft].length > 20000 || !!onSaveNotes && (task.notes ?? "") !== notesBase} className={styles.primary}>Save notes</button><button type="button" disabled={busy} onClick={() => setNotesId("")}>Discard note edits</button></div>
        </form>}
        {editingId === task.id && <form className={taskStyles.edit} onSubmit={async (event) => { event.preventDefault(); if (await command({ type: "task.update", taskId: task.id, title: editingTitle }, "Task title updated")) setEditingId(""); }}>
          <label className={styles.grow}>Task title<input aria-label="Task title" required value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} /></label>
          <button className={styles.primary} disabled={busy || !editingTitle.trim()}>Save title</button><button type="button" disabled={busy} onClick={() => setEditingId("")}>Cancel edit</button>
        </form>}
        <div className={taskStyles.actions}>
          {onOpenSource && view.accounts.some(account => account.id === task.sourceAccountId && account.ownerId === task.ownerId) && view.messages.some(message => message.id === task.sourceMessageId && message.accountId === task.sourceAccountId) && <button disabled={busy} onClick={() => onOpenSource({ accountId: task.sourceAccountId!, messageId: task.sourceMessageId! })}>Open source mail</button>}
          <button disabled={busy} onClick={() => { setEditingId(task.id); setEditingTitle(task.title); }}>Edit title</button>
          <button disabled={busy || notesId === task.id} onClick={() => {
            if (notesId && notesDraft !== notesBase && !window.confirm("Discard unfinished notes for the other Task?")) return;
            setNotesId(task.id); setNotesDraft(task.notes || ""); setNotesBase(task.notes || "");
          }}>Edit notes</button>
          <button disabled={busy} onClick={() => openSchedule(task)}>Schedule</button>
          {task.scheduledSlot && <button disabled={busy} onClick={async () => { if (await command({ type: "task.unschedule", taskId: task.id }, "Task unscheduled and linked calendar block removed")) { if (scheduleId === task.id) setScheduleId(""); } }}>Unschedule</button>}
          <button disabled={busy} onClick={async () => {
            const explanation = task.calendarEventId ? "This also removes its linked calendar block. Source mail is kept." : "Source mail is kept.";
            if (window.confirm(`Delete task “${task.title}”? ${explanation}`) && await command({ type: "task.delete", taskId: task.id }, "Task deleted; source mail kept")) {
              if (scheduleId === task.id) setScheduleId("");
              if (editingId === task.id) setEditingId("");
            }
          }}>Delete task</button>
        </div>
      </article>)}
      {!view.tasks.length && <p className={styles.empty}>No tasks yet. Add one or turn a message into a task.</p>}
      {view.tasks.length > 0 && !visibleTasks.length && !filterError && <p className={styles.empty}>No tasks match these filters. Try another title, status or planned day.</p>}
    </section>
    {scheduledTask && <section className={styles.panel} aria-label="Task schedule editor"><h2 className={styles.sectionHeading}>Schedule task</h2>
      <form className={styles.form} onSubmit={async (event) => { event.preventDefault(); if (await command({ type: "task.schedule", taskId: scheduledTask.id, calendarId: selectedCalendar, start: utc(start), end: utc(end) }, "Task scheduled on your calendar")) setScheduleId(""); }}>
        <p>{scheduledTask.title}</p>
        <label>Calendar<select aria-label="Calendar" value={selectedCalendar} onChange={(event) => setCalendarId(event.target.value)} required>{view.calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label>
        <label>Start (UTC)<input aria-label="Start (UTC)" type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>End (UTC)<input aria-label="End (UTC)" type="datetime-local" required value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <div className={styles.actions}><button className={styles.primary} disabled={busy || !selectedCalendar}>Save schedule</button><button type="button" disabled={busy} onClick={() => setScheduleId("")}>Cancel</button></div>
      </form>
    </section>}
  </>;
}
