"use client";

import { useState, type FormEvent } from "react";
import type { WorkspaceCommand, WorkspaceTask, WorkspaceView } from "../../shared/workspace-contracts";
import styles from "./workspace.module.css";
import taskStyles from "./workspace-tasks.module.css";

type Props = { view: WorkspaceView; busy: boolean; command: (input: WorkspaceCommand, success: string) => Promise<boolean> };
const defaults = () => { const day = new Date().toISOString().slice(0, 10); return { start: `${day}T14:00`, end: `${day}T14:30` }; };
const utc = (value: string) => new Date(`${value}:00Z`).toISOString();
const format = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";

export default function WorkspaceTasks({ view, busy, command }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [start, setStart] = useState(() => defaults().start);
  const [end, setEnd] = useState(() => defaults().end);
  const scheduledTask = view.tasks.find((task) => task.id === scheduleId);
  const selectedCalendar = calendarId || view.calendars[0]?.id || "";

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
    if (await command({ type: "task.create", title: newTitle }, "Task created")) setNewTitle("");
  }

  return <>
    <form className={styles.inlineForm} onSubmit={create}>
      <label className={styles.grow}>New task<input aria-label="New task" required value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="What needs your attention?" /></label>
      <button className={styles.primary} disabled={busy || !newTitle.trim()}>Add task</button>
    </form>
    <section className={styles.panel} aria-label="Task list">
      {view.tasks.map((task) => <article className={styles.task} data-testid="task-row" key={task.id}>
        <label><input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.completed} disabled={busy} onChange={(event) => command({ type: "task.complete", taskId: task.id, completed: event.target.checked }, "Task updated")} /><span className={`${taskStyles.title} ${task.completed ? styles.completed : ""}`}>{task.title}</span></label>
        <p className={taskStyles.metadata}>{task.sourceMessageId && <small>From private mail · </small>}{task.scheduledSlot ? <small>{format(task.scheduledSlot.start)} – {format(task.scheduledSlot.end)} · {view.calendars.find((calendar) => calendar.id === view.events.find((event) => event.id === task.calendarEventId)?.calendarId)?.name || "Linked calendar"}</small> : <small>Unscheduled</small>}</p>
        {editingId === task.id && <form className={taskStyles.edit} onSubmit={async (event) => { event.preventDefault(); if (await command({ type: "task.update", taskId: task.id, title: editingTitle }, "Task title updated")) setEditingId(""); }}>
          <label className={styles.grow}>Task title<input aria-label="Task title" required value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} /></label>
          <button className={styles.primary} disabled={busy || !editingTitle.trim()}>Save title</button><button type="button" disabled={busy} onClick={() => setEditingId("")}>Cancel edit</button>
        </form>}
        <div className={taskStyles.actions}>
          <button disabled={busy} onClick={() => { setEditingId(task.id); setEditingTitle(task.title); }}>Edit title</button>
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
