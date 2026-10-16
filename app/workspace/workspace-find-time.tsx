"use client";

import { useState } from "react";
import type { WorkspaceCommand, WorkspaceView } from "../../shared/workspace-contracts";
import { findAvailableTaskSlots, type TaskSlot } from "../../shared/workspace-availability";
import styles from "./workspace.module.css";

type Props = { view: WorkspaceView; busy: boolean; command: (input: WorkspaceCommand, notice: string) => Promise<boolean> };
const utc = (value: string) => new Date(`${value}:00Z`).toISOString();
const time = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";

export default function WorkspaceFindTime({ view, busy, command }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [task, setTask] = useState("");
  const [calendar, setCalendar] = useState("");
  const [start, setStart] = useState(`${today}T09:00`);
  const [end, setEnd] = useState(`${today}T17:00`);
  const [duration, setDuration] = useState(30);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ view: WorkspaceView; key: string; slots: TaskSlot[] } | null>(null);
  const tasks = view.tasks.filter(item => !item.completed);
  const taskId = tasks.some(item => item.id === task) ? task : tasks[0]?.id || "";
  const calendarId = view.calendars.some(item => item.id === calendar) ? calendar : view.calendars[0]?.id || "";
  const key = JSON.stringify([taskId, calendarId, start, end, duration]);
  const slots = preview?.view === view && preview.key === key ? preview.slots : null;
  function find() {
    setError(""); setPreview(null);
    try { setPreview({ view, key, slots: findAvailableTaskSlots(view, { taskId, start: utc(start), end: utc(end), durationMinutes: duration }) }); }
    catch { setError("Choose an open Task, valid UTC window of at most seven days, and duration from 5 to 480 whole minutes."); }
  }
  async function schedule(slot: TaskSlot) {
    setPreview(null); setError("");
    const success = await command({ type: "task.schedule-available", taskId, calendarId, ...slot }, "Task scheduled in open saved Calendar time. No provider calendar was changed.");
    if (!success) setError("Scheduling was not confirmed. Refresh the workspace, then find time again before retrying.");
  }
  return <section className={styles.panel} aria-label="Find time for a task">
    <h2 className={styles.sectionHeading}>Find time for a task</h2>
    <div className={styles.form}>
      <p>Find open time across all your saved OpenJob calendars, including imported blocks. Live provider calendars are not checked. A scheduled Task’s own linked block is excluded when moving it.</p>
      {!tasks.length && <p>Add an open Task first, or reopen a completed one.</p>}
      <label>Task to schedule<select aria-label="Task to schedule" value={taskId} disabled={busy || !tasks.length} onChange={event => setTask(event.target.value)}>{!tasks.length && <option value="">No open Tasks</option>}{tasks.map(item => <option key={item.id} value={item.id}>{item.title}{item.scheduledSlot ? " · move existing plan" : ""}</option>)}</select></label>
      <label>Save time on calendar<select aria-label="Save time on calendar" value={calendarId} disabled={busy} onChange={event => setCalendar(event.target.value)}>{view.calendars.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Find after (UTC)<input aria-label="Find after (UTC)" type="datetime-local" value={start} disabled={busy} onChange={event => setStart(event.target.value)} /></label>
      <label>Find before (UTC)<input aria-label="Find before (UTC)" type="datetime-local" value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></label>
      <label>Minutes needed<input aria-label="Minutes needed" type="number" min="5" max="480" step="1" value={duration} disabled={busy} onChange={event => setDuration(Number(event.target.value))} /></label>
      <button disabled={busy || !taskId || !calendarId} onClick={find}>Find open slots</button>
      <small>Up to 12 non-overlapping suggestions from the loaded workspace. Choose a slot to schedule; current saved blocks are checked again before the change is saved.</small>
      {error && <p role="alert">{error}</p>}
      {slots && <section aria-label="Suggested task times"><h3>{slots.length ? "Choose a time" : "No open slot fits this window"}</h3>{slots.map(slot => <div className={styles.actions} key={slot.start}><button disabled={busy} onClick={() => schedule(slot)}>Schedule {time(slot.start)} – {time(slot.end)}</button></div>)}</section>}
    </div>
  </section>;
}
