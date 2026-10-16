"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceCommand, WorkspaceView } from "../../shared/workspace-contracts";
import { OpenJobBrand } from "../openjob-brand";
import styles from "./workspace.module.css";
import WorkspaceCalendar from "./workspace-calendar";
import WorkspaceAgents from "./workspace-agents";
import WorkspaceTasks, { type WorkspaceTasksHandle } from "./workspace-tasks";
import type { CalendarTaskSource } from "./workspace-links";
import WorkspaceMail, { type MailSource, type WorkspaceMailHandle } from "./workspace-mail";

type Tab = "Mail" | "Calendar" | "Tasks" | "Agents";
const date = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";

async function api(path: string, owner: string, command?: WorkspaceCommand, agentId?: string) {
  const response = await fetch(`/api/workspace/${path}`, {
    method: command ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-openjob-fixture-owner": owner, ...(agentId ? { "x-openjob-fixture-agent": agentId } : {}) },
    ...(command ? { body: JSON.stringify(command) } : {}),
  });
  const body = await response.json() as { data?: unknown; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Workspace unavailable (${response.status})`);
  return body.data as WorkspaceView;
}

export default function WorkspaceApp() {
  const [owner, setOwner] = useState("demo_alex");
  return <WorkspaceSession key={owner} owner={owner} setOwner={setOwner} />;
}

function WorkspaceSession({ owner, setOwner }: { owner: string; setOwner: (value: string) => void }) {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [tab, setTab] = useState<Tab>("Mail");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const mail = useRef<WorkspaceMailHandle>(null);
  const tasks = useRef<WorkspaceTasksHandle>(null);

  function openLinkedTask(source: CalendarTaskSource) {
    if (!tasks.current?.openLinkedTask(source)) { setError("The linked Task is unavailable in this workspace."); return; }
    setTab("Tasks"); setError(""); setNotice("Linked Task opened. Unsaved Task and Calendar edits are kept.");
  }

  function openSource(source: MailSource) {
    if (!mail.current?.openSource(source)) { setError("The source message is unavailable in this workspace."); return; }
    setTab("Mail"); setError(""); setNotice("Source message opened. Any unsaved Mail text is kept.");
  }

  const refresh = useCallback(async () => {
    const next: WorkspaceView = await api("snapshot", owner);
    setView(next);
    return next;
  }, [owner]);

  useEffect(() => {
    let active = true;
    api("snapshot", owner).then((next: WorkspaceView) => { if (active) setView(next); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [owner]);

  async function command(input: WorkspaceCommand, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await api("commands", owner, input); await refresh(); setNotice(success); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Request failed"); return false; }
    finally { setBusy(false); }
  }


  return <div className={styles.workspace}>
    <header className={styles.header}>
      <OpenJobBrand />
      <span className={styles.badge}>Prototype · simulated providers</span>
      <label className={styles.owner}>Fixture owner<select aria-label="Fixture owner" value={owner} disabled={busy} onChange={(e) => setOwner(e.target.value)}><option value="demo_alex">Alex</option><option value="demo_sam">Sam</option></select></label>
    </header>
    <div className={styles.banner}>Your mail, time and tasks in one workspace. All data is fictional. Drafts stay here; nothing can be sent to a real mailbox.</div>
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <p className={styles.eyebrow}>WORKSPACE</p>
        <nav aria-label="Workspace"><div className={styles.tabs}>{(["Mail", "Calendar", "Tasks", "Agents"] as Tab[]).map((item) => <button key={item} disabled={!view} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>{item}<span>{item === "Mail" ? view?.messages.length : item === "Calendar" ? view?.events.length : item === "Tasks" ? view?.tasks.filter((task) => !task.completed).length : view?.agents.filter((agent) => !agent.revoked).length}</span></button>)}</div></nav>
        <div className={styles.connection}><strong>Connected fixtures</strong>{view?.accounts.map((account) => <div key={account.id}><span className={styles.dot} />{account.label}<small>{account.provider} · simulated</small></div>)}</div>
        <p className={styles.small}>Shared API • server-owned state<br />No live credentials or delivery</p>
      </aside>
      <main className={styles.main}>
        <div className={styles.title}><div><p className={styles.eyebrow}>{owner === "demo_alex" ? "ALEX’S" : "SAM’S"} PERSONAL WORKSPACE</p><h1>{tab}</h1></div><button disabled={busy || !view} onClick={() => { setError(""); refresh().catch((e: Error) => setError(e.message)); }}>Refresh</button></div>
        {error && <div role="alert" className={styles.error}>{error}</div>}
        {notice && <div role="status" className={styles.success}>{notice}</div>}
        {!view && !error && <p role="status">Loading workspace…</p>}
        {!view && error && <p>This prototype needs the isolated fixture API enabled on its server.</p>}
        {view && <div hidden={tab !== "Mail"}><WorkspaceMail ref={mail} view={view} busy={busy} command={command} /></div>}
        {view && <WorkspaceTasks ref={tasks} active={tab === "Tasks"} view={view} busy={busy} command={command} onOpenSource={openSource} />}
        {view && <WorkspaceCalendar active={tab === "Calendar"} view={view} busy={busy} command={command} onOpenTask={openLinkedTask} />}
        {view && tab === "Agents" && <WorkspaceAgents view={view} owner={owner} busy={busy} command={command} refresh={refresh} />}
        {view && <details className={styles.activity}><summary>Recent activity</summary>{view.activity.slice(-12).reverse().map((entry) => <p key={entry.id}><small>{date(entry.createdAt)}</small> {entry.action} <small>· {entry.actor}</small></p>)}</details>}
      </main>
    </div>
  </div>;
}
