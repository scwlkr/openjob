"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AuthSession } from "../openjob-contracts";
import { OpenJobBrand } from "../openjob-brand";
import type { WorkspaceView } from "../../shared/workspace-contracts";
import { PersonalWorkspaceError, type PersonalWorkspaceClient } from "./personal-workspace-api";
import WorkspaceTasks, { type WorkspaceTasksHandle } from "./workspace-tasks";
import type { CalendarTaskSource, MailTaskSource } from "./workspace-links";
import WorkspaceCalendar, { type WorkspaceCalendarHandle } from "./workspace-calendar";
import WorkspaceToday from "./workspace-today";
import WorkspaceCalendarFiles from "./workspace-calendar-files";
import PersonalWorkspaceAgents from "./personal-workspace-agents";
import PersonalWorkspaceMail from "./personal-workspace-mail";
import styles from "./workspace.module.css";
import WorkspaceMail, { type MailSource, type WorkspaceMailHandle } from "./workspace-mail";
import type { PersonalWorkspaceCommand } from "../../shared/personal-workspace";

import type { BrowserMailRecovery } from "./workspace-mail";

export default function PersonalSession({ session, signal, client, onSignOut, onShowSaved, savedAvailable, recovery }: { session: AuthSession; signal: AbortSignal; client: PersonalWorkspaceClient; onSignOut: () => Promise<void>; onShowSaved: () => void; savedAvailable: boolean; recovery?: BrowserMailRecovery }) {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [tab, setTab] = useState("Tasks");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unrecognized, setUnrecognized] = useState(false);
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const mail = useRef<WorkspaceMailHandle>(null);
  const tasks = useRef<WorkspaceTasksHandle>(null);
  const calendar = useRef<WorkspaceCalendarHandle>(null);
  const current = () => mounted.current && !signal.aborted;

  function openTodayItem(kind: "Task" | "Calendar block", id: string) {
    if (!current()) return;
    const opened = kind === "Task" ? tasks.current?.openTask(id) : calendar.current?.openEvent(id);
    if (!opened) { setError(`That ${kind.toLowerCase()} is unavailable in this workspace.`); return; }
    setTab(kind === "Task" ? "Tasks" : "Calendar"); setError(""); setNotice(`${kind} opened from Today. Unfinished editor text is kept.`);
  }

  function openLinkedTask(source: CalendarTaskSource) {
    if (!current()) return;
    if (!tasks.current?.openLinkedTask(source)) { setError("The linked Task is unavailable in this workspace."); return; }
    setTab("Tasks"); setError(""); setNotice("Linked Task opened. Unsaved Task and Calendar edits are kept.");
  }

  function openMailTask(source: MailTaskSource) {
    if (!current()) return;
    if (!tasks.current?.openMailTask(source)) { setError("The linked Task is unavailable in this workspace."); return; }
    setTab("Tasks"); setError(""); setNotice("Task from Mail opened. Unsaved editor text is kept.");
  }

  function openSource(source: MailSource) {
    if (!current()) return;
    if (!mail.current?.openSource(source)) { setError("The source message is unavailable in this workspace."); return; }
    setTab("Mail"); setError(""); setNotice("Source message opened. Any unsaved Mail text is kept.");
  }

  useEffect(() => {
    let active = true;
    mounted.current = true;
    client.snapshot(session, signal).then((next) => { if (active && !signal.aborted) setView(next); }).catch((failure: unknown) => { if (active && !signal.aborted) { setError("Your workspace could not be loaded. Try Refresh."); setUnrecognized(failure instanceof PersonalWorkspaceError && failure.code === "sign_in_method_unrecognized"); } });
    return () => { active = false; mounted.current = false; };
  }, [client, session, signal]);

  async function refresh() {
    if (!current()) return;
    setError("");
    try { const next = await client.snapshot(session, signal); if (current()) { setView(next); setUnrecognized(false); } }
    catch (failure) { if (current()) { setError("Your workspace could not be loaded. Try Refresh."); setUnrecognized(failure instanceof PersonalWorkspaceError && failure.code === "sign_in_method_unrecognized"); } }
  }

  async function command(input: PersonalWorkspaceCommand, success: string) {
    if (!current()) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      await client.command(session, input, signal);
      if (!current()) return false;
      const next = await client.snapshot(session, signal);
      if (!current()) return false;
      setView(next); setNotice(success); return true;
    } catch (failure) { if (current()) setError(input.type === "task.schedule-available" && failure instanceof PersonalWorkspaceError && failure.code === "schedule_conflict" ? "That time is now occupied. Refresh to find another open slot; your Task was not moved." : input.type === "calendar.import" && failure instanceof PersonalWorkspaceError && failure.code === "calendar_import_conflict" ? "An event UID already exists with different title or times. Nothing was imported. Review the existing event separately." : "The change could not be completed. Refresh to check your saved workspace before retrying."); return false; }
    finally { if (current()) setBusy(false); }
  }

  return <div className={styles.workspace}><header className={styles.header}><OpenJobBrand /><span>Personal workspace · signed in</span><button onClick={onSignOut}>Sign out</button></header>
    <div className={styles.layout}><aside className={styles.sidebar}><nav aria-label="Personal workspace"><div className={styles.tabs}>{["Today", "Tasks", "Calendar", "Mail", "Mail preview", "Agents"].map((name) => <button key={name} disabled={!view} aria-current={tab === name ? "page" : undefined} onClick={() => setTab(name)}>{name}</button>)}</div><button disabled={!savedAvailable} onClick={onShowSaved}>Saved Tasks and Calendar</button></nav><p className={styles.small}>Tasks, Calendar and invented Mail use your authenticated OpenJob account.</p><Link href="/">Existing Groups and account</Link></aside>
      <main className={styles.main}><div className={styles.title}><h1>{tab}</h1><button disabled={busy} onClick={refresh}>Refresh</button></div>
        {!view && !error && <p role="status">Loading your personal workspace…</p>}{error && <p role="alert" className={styles.error}>{error}</p>}{unrecognized && <p>Finish setting up your existing sign-in at <Link href="/">OpenJob account setup</Link>. No account has been created automatically.</p>}{notice && <p role="status" className={styles.success}>{notice}</p>}
        {view && tab === "Today" && <WorkspaceToday view={view} busy={busy} onOpenTask={id => openTodayItem("Task", id)} onOpenEvent={id => openTodayItem("Calendar block", id)} onTasks={() => setTab("Tasks")} onCalendar={() => setTab("Calendar")} />}
        {view && <WorkspaceTasks ref={tasks} active={tab === "Tasks"} view={view} busy={busy} command={command} onOpenSource={openSource} />}
        {view && <WorkspaceCalendar ref={calendar} active={tab === "Calendar"} view={view} busy={busy} command={command} onOpenTask={openLinkedTask} />}
        {view && <div hidden={tab !== "Calendar"}><WorkspaceCalendarFiles view={view} signal={signal} busy={busy} command={command} /></div>}
        {view && <section hidden={tab !== "Mail"} aria-label="Invented personal Mail">
          <p className={styles.banner}>Invented Mail · examples and drafts saved privately to your OpenJob account. All mailbox identities and incoming messages are fictional. Simulate send records a local example; no provider or recipient receives mail.</p>
          <button disabled={busy} onClick={() => command({ type: "mail.examples.add" }, "Invented examples are ready. Existing tasks, calendar and drafts were kept.")}>{view.accounts.length ? "Add invented examples again" : "Add invented examples"}</button>
          {!view.accounts.length && <p>Enable these invented examples to try Mail → Task → Calendar and saved reply drafts. Your existing workspace stays intact.</p>}
          {view.accounts.length > 0 && <WorkspaceMail onOpenTask={openMailTask} ref={mail} view={view} busy={busy} command={command} recovery={recovery} />}
        </section>}
        {view && tab === "Mail preview" && <PersonalWorkspaceMail session={session} signal={signal} client={client} busy={busy} command={command} />}
        {view && tab === "Agents" && <PersonalWorkspaceAgents session={session} signal={signal} client={client} onChanged={refresh} />}
        {view && <details className={styles.activity}><summary>Recent activity</summary>{view.activity.slice(-12).reverse().map((entry) => <p key={entry.id} data-testid="personal-activity"><strong>{entry.actor}</strong> · {entry.action} <small>{new Date(entry.createdAt).toLocaleString()}</small></p>)}</details>}
      </main></div></div>;
}
