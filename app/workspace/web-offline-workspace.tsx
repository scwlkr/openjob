"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskCalendarOfflineController, TaskCalendarOfflineState } from "../../shared/task-calendar-offline";
import type { WorkspaceCommand, WorkspaceView } from "../../shared/workspace-contracts";
import WorkspaceTasks, { type WorkspaceTasksHandle } from "./workspace-tasks";
import WorkspaceCalendar from "./workspace-calendar";
import type { CalendarTaskSource } from "./workspace-links";
import styles from "./workspace.module.css";

type Props = { offline: TaskCalendarOfflineController; owner: string; signal: AbortSignal; active: boolean; onInvalid: () => void };
const errors: Record<string, string> = {
  changed_in_another_tab: "Saved work changed in another tab. Your editor input is kept. Refresh from server to review the latest work before applying it again.",
  storage: "This change could not be saved in this browser. Your editor input has been kept.",
  workspace_capacity: "Server capacity was reached. Saved work is kept in this browser. Reduce pending work or wait for capacity before syncing.",
  body_too_large: "This batch is too large to sync. Saved work is kept in this browser. Reduce pending work before syncing.",
  invalid_input: "This change was not accepted. Review titles and UTC times. Previously saved work and unsaved editor input are kept.",
  retry_sync_before_edit: "A previous sync needs confirmation. Reconnect and sync saved changes before editing again.",
};
export default function WebOfflineWorkspace({ offline, owner, signal, active, onInvalid }: Props) {
  const [state, setState] = useState<TaskCalendarOfflineState | null>(null);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Tasks");
  const [choice, setChoice] = useState<{ strategy: "server" | "local"; review: string } | null>(null);
  const lease = useRef({ active: true, pending: false, epoch: 0 });
  const tasks = useRef<WorkspaceTasksHandle>(null);
  const run = useCallback(async (action: () => Promise<TaskCalendarOfflineState>, label = "Saving in browser…") => {
    const epoch = lease.current.epoch;
    const current = () => lease.current.active && lease.current.epoch === epoch && !signal.aborted;
    if (!current() || lease.current.pending) return false;
    lease.current.pending = true; setBusy(true); setOperation(label); setError("");
    try { const next = await action(); if (!current()) return false; setState(next); setChoice(null); return !next.error; }
    catch (failure) {
      if (!current()) return false;
      const issue = failure as { status?: number; code?: string };
      if (issue.status === 401 || issue.status === 410 || issue.code === "revoked") { setState(null); onInvalid(); }
      else setError("Request could not be completed. Previously saved work is kept in this browser. Reconnect and review before syncing.");
      return false;
    } finally { if (current()) { lease.current.pending = false; setBusy(false); } }
  }, [signal, onInvalid]);
  useEffect(() => {
    const scope = lease.current; scope.active = true; const epoch = scope.epoch;
    queueMicrotask(() => { if (scope.active && scope.epoch === epoch && !signal.aborted) void run(() => offline.load(owner), "Loading saved workspace…"); });
    return () => { scope.active = false; scope.pending = false; scope.epoch += 1; };
  }, [offline, owner, signal, run]);
  const projection = state?.projection;
  const view: WorkspaceView | null = projection ? { ...projection, accounts: [], messages: [], drafts: [], sent: [], agents: [], activity: [] } : null;
  const review = JSON.stringify({ local: projection, server: state?.currentServer });
  const command = (input: WorkspaceCommand) => run(() => offline.edit(owner, input));
  function openTask(source: CalendarTaskSource) { if (!signal.aborted && tasks.current?.openLinkedTask(source)) setTab("Tasks"); }
  return <section hidden={!active} aria-label="Saved Tasks and Calendar">
    <h1>Saved Tasks and Calendar</h1><p>Saved in this browser for this verified identity. Mail, source references and agent credentials are never included. Signing out or switching users removes saved work, including pending changes. Remote revocation cannot be detected offline; reconnect to verify access before syncing.</p>
    <section className={styles.panel} aria-label="Browser sync status"><h2>{busy ? operation : state?.status === "pending" ? "Pending · saved in browser" : state?.status === "conflict" ? "Conflict · review required" : state?.status === "synced" ? "Synced at last check" : state?.status === "syncing" ? "Sync outcome needs confirmation" : "No saved workspace yet"}</h2><p role="status">{state?.pendingCount || 0} pending changes</p>
      <div className={styles.actions}><button disabled={busy || state?.status === "conflict"} onClick={() => run(() => offline.refresh(owner), "Refreshing…")}>Refresh from server</button><button disabled={busy || !state?.pendingCount || state?.status === "conflict"} onClick={() => run(() => offline.sync(owner), "Syncing saved changes…")}>Sync saved changes</button>{state?.status === "pending" && <button disabled={busy} onClick={() => setChoice({ strategy: "server", review })}>Discard pending changes</button>}</div>
      {(error || state?.error) && <p role="alert">{error || errors[state?.error || ""] || "Offline · server access is unavailable. Previously saved work remains in this browser; reconnect before syncing."}</p>}
    </section>
    {state?.status === "conflict" && <section className={styles.panel} aria-label="Conflict review"><h2>Review local and server work</h2><Summary title="Saved in this browser" projection={projection} /><Summary title="Current server" projection={state.currentServer?.projection} /><div className={styles.actions}><button disabled={busy} onClick={() => setChoice({ strategy: "server", review })}>Use server version</button><button disabled={busy} onClick={() => setChoice({ strategy: "local", review })}>Apply reviewed local version</button></div></section>}
    {choice && <section className={styles.panel} role="alertdialog" aria-label="Confirm workspace resolution"><p>{choice.strategy === "server" ? "Discard all pending local Tasks and Calendar changes and fetch the latest server version? Pending local work will be lost. Server work will not be overwritten." : "Replace current server Tasks and Calendar with the reviewed local version? This can remove newer server tasks and calendar blocks shown above. A changed server revision requires review again."}</p><div className={styles.actions}><button disabled={busy} onClick={() => { if (choice.review !== review) { setChoice(null); setError("Work changed after review. Compare the versions again."); return; } void run(() => offline.resolve(owner, choice.strategy), "Applying reviewed choice…"); }}>{choice.strategy === "server" ? "Confirm discard local changes" : "Confirm apply reviewed local changes"}</button><button disabled={busy} onClick={() => setChoice(null)}>Cancel confirmation</button></div></section>}
    <nav aria-label="Saved workspace"><div className={styles.tabs}>{["Tasks", "Calendar"].map(name => <button key={name} aria-current={tab === name ? "page" : undefined} onClick={() => setTab(name)}>{name}</button>)}</div></nav>
    {!view && <p>No cached Tasks or Calendar. Connect once and choose Refresh from server to start.</p>}
    {view && <><WorkspaceTasks ref={tasks} active={active && tab === "Tasks"} view={view} busy={busy || state?.attempted || state?.status === "syncing" || state?.error === "retry_sync_before_edit"} command={command} /><WorkspaceCalendar active={active && tab === "Calendar"} view={view} busy={busy || state?.attempted || state?.status === "syncing" || state?.error === "retry_sync_before_edit"} command={command} onOpenTask={openTask} /></>}
  </section>;
}
function Summary({ title, projection }: { title: string; projection: TaskCalendarOfflineState["projection"] }) {
  return <section><h3>{title}</h3>{projection?.tasks.map(task => <p key={task.id}>{task.title} · {task.completed ? "Completed" : "Open"} · {task.scheduledSlot ? `${task.scheduledSlot.start} – ${task.scheduledSlot.end}` : "Unscheduled"}</p>)}{projection?.events.map(event => <p key={event.id}>{event.title} · {event.start} – {event.end}</p>)}{(!projection || (!projection.tasks.length && !projection.events.length)) && <p>No tasks or calendar blocks.</p>}</section>;
}
