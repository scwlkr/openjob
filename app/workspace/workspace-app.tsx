"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkspaceCommand, WorkspaceView } from "../../shared/workspace-contracts";
import { OpenJobBrand } from "../openjob-brand";
import styles from "./workspace.module.css";
import WorkspaceCalendar from "./workspace-calendar";
import WorkspaceAgents from "./workspace-agents";

type Tab = "Mail" | "Calendar" | "Tasks" | "Agents";
type MailFolder = "Inbox" | "Drafts" | "Simulated Sent";
const date = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";
const utc = (value: string) => new Date(value + ":00Z").toISOString();

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
  const [accountId, setAccountId] = useState("");
  const [messageId, setMessageId] = useState("");
  const [mailFolder, setMailFolder] = useState<MailFolder>("Inbox");
  const [mailSearch, setMailSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [editingDraft, setEditingDraft] = useState("");
  const [composeAccount, setComposeAccount] = useState("");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [scheduleTask, setScheduleTask] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [start, setStart] = useState("2026-10-16T14:00");
  const [end, setEnd] = useState("2026-10-16T14:30");

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

  const mailboxMessages = view?.messages.filter((item) => !accountId || item.accountId === accountId) || [];
  const mailboxDrafts = view?.drafts.filter((item) => !accountId || item.accountId === accountId) || [];
  const mailboxSent = view?.sent.filter((item) => !accountId || item.accountId === accountId) || [];
  const search = mailSearch.trim().toLocaleLowerCase();
  const matches = (...values: (string | undefined)[]) => !search || values.some((value) => value?.toLocaleLowerCase().includes(search));
  const visibleMessages = mailboxMessages.filter((item) => matches(item.subject, item.from, item.to, item.body));
  const visibleDrafts = mailboxDrafts.filter((item) => matches(item.subject, item.to, item.body, view?.accounts.find((account) => account.id === item.accountId)?.address));
  const visibleSent = mailboxSent.filter((item) => matches(item.subject, item.from, item.to, item.body));
  const selectedMessage = visibleMessages.find((item) => item.id === messageId);
  const folderCounts = { Inbox: mailboxMessages.length, Drafts: mailboxDrafts.length, "Simulated Sent": mailboxSent.length };
  const resultCount = mailFolder === "Inbox" ? visibleMessages.length : mailFolder === "Drafts" ? visibleDrafts.length : visibleSent.length;
  const calendars = view?.calendars || [];
  const selectedCalendar = calendarId || calendars[0]?.id || "";
  const submit = (fn: () => void) => (event: FormEvent) => { event.preventDefault(); fn(); };

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
        {view && tab === "Mail" && <>
          <button className={styles.compose} onClick={() => { setComposing(!composing); setEditingDraft(""); setComposeAccount(""); setComposeTo(""); setComposeSubject(""); setComposeBody(""); }}>Compose draft</button><label className={styles.filter}>Mailbox<select aria-label="Mailbox" value={accountId} onChange={(e) => { setAccountId(e.target.value); setMessageId(""); setDraft(""); }}><option value="">All mailboxes</option>{view.accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.address}</option>)}</select></label>
          <nav className={styles.folders} aria-label="Mail folders">{(["Inbox", "Drafts", "Simulated Sent"] as MailFolder[]).map((folder) => <button key={folder} aria-label={folder} aria-current={mailFolder === folder ? "page" : undefined} onClick={() => setMailFolder(folder)}>{folder}<span aria-hidden="true">{folderCounts[folder]}</span></button>)}</nav>
          <div className={styles.searchBar}><label className={styles.grow}>Search mail<input type="search" aria-label="Search mail" value={mailSearch} placeholder="Subject, people or message text…" onChange={(e) => setMailSearch(e.target.value)} /></label>{mailSearch && <button onClick={() => setMailSearch("")}>Clear search</button>}</div>
          <p className={styles.small} aria-live="polite">{resultCount} {resultCount === 1 ? "result" : "results"} in {mailFolder}{accountId ? ` · ${view.accounts.find((account) => account.id === accountId)?.label}` : " · all mailboxes"}</p>
          {composing && <section className={styles.panel} aria-label="Draft editor">
            <h2 className={styles.sectionHeading}>{editingDraft ? "Edit saved draft" : "New draft"}</h2>
            <form className={styles.form} onSubmit={submit(async () => {
              const input: WorkspaceCommand = editingDraft
                ? { type: "mail.draft.update", draftId: editingDraft, to: composeTo, subject: composeSubject, body: composeBody }
                : { type: "mail.compose", accountId: composeAccount || view.accounts[0]?.id || "", to: composeTo, subject: composeSubject, body: composeBody };
              if (await command(input, editingDraft ? "Draft updated. Nothing sent." : "New draft saved. Nothing sent.")) { if (editingDraft && view.drafts.find((item) => item.id === editingDraft)?.messageId === messageId) setDraft(composeBody); setComposing(false); setEditingDraft(""); setComposeSubject(""); setComposeBody(""); }
            })}>
              <label>From mailbox<select aria-label="From mailbox" disabled={Boolean(editingDraft)} value={composeAccount || view.accounts[0]?.id || ""} onChange={(e) => setComposeAccount(e.target.value)}>{view.accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.address}</option>)}</select></label>
              {editingDraft && <small>The original sending mailbox stays fixed when editing.</small>}
              <label>To<input aria-label="To" type="email" required value={composeTo} onChange={(e) => setComposeTo(e.target.value)} /></label>
              <label>Subject<input aria-label="Subject" required value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} /></label>
              <label>Message<textarea aria-label="Message" required rows={5} value={composeBody} onChange={(e) => setComposeBody(e.target.value)} /></label>
              <div className={styles.actions}><button className={styles.primary} disabled={busy}>{editingDraft ? "Save draft changes" : "Save new draft"}</button><button type="button" onClick={() => { setComposing(false); setEditingDraft(""); }}>Cancel draft editor</button></div>
              <small>Fixture draft only. Live sending is unavailable.</small>
            </form>
          </section>}
          {mailFolder === "Drafts" && <section className={styles.panel} aria-label="Saved drafts"><h2 className={styles.sectionHeading}>Saved drafts</h2>
            {visibleDrafts.map((item) => <article className={styles.agent} key={item.id} data-testid="saved-draft">
              <strong>{item.subject || view.messages.find((message) => message.id === item.messageId)?.subject || "Reply draft"}</strong>
              <small>From: {view.accounts.find((account) => account.id === item.accountId)?.address}</small>
              <small>To: {item.to || "Reply to selected message"} · Draft only</small><p className={styles.body}>{item.body}</p>
              <div className={styles.actions}>
                <button disabled={busy} onClick={() => { setEditingDraft(item.id); setComposeAccount(item.accountId); setComposeTo(item.to || ""); setComposeSubject(item.subject || ""); setComposeBody(item.body); setComposing(true); }}>Edit draft</button>
                <button disabled={busy} onClick={async () => { if (await command({ type: "mail.simulate-send", draftId: item.id }, "Fixture message moved to Simulated Sent. No actual delivery occurred.")) { if (editingDraft === item.id) { setComposing(false); setEditingDraft(""); } } }}>Simulate send</button>
              </div><small>Simulation only · no actual delivery</small>
            </article>)}
            {!visibleDrafts.length && <p className={styles.empty}>{search ? "No drafts match this search in the selected mailbox." : "No saved drafts in this mailbox. Compose a draft or save a reply from your inbox."}</p>}
          </section>}
          {mailFolder === "Simulated Sent" && <section className={styles.panel} aria-label="Simulated Sent"><h2 className={styles.sectionHeading}>Simulated Sent</h2><p className={styles.inset}>Fixture records only. These messages were never delivered to any provider or recipient.</p>
            {visibleSent.map((item) => <article className={styles.agent} key={item.id} data-testid="sent-message"><strong>{item.subject}</strong><small>From: {item.from}<br />To: {item.to}<br />{date(item.sentAt)} · Simulated delivery</small><p className={styles.body}>{item.body}</p></article>)}
            {!visibleSent.length && <p className={styles.empty}>{search ? "No simulated messages match this search in the selected mailbox." : "No simulated sent messages in this mailbox. Use Simulate send on a saved draft to try the fixture workflow."}</p>}
          </section>}
          {mailFolder === "Inbox" && <div className={styles.mailGrid}><section className={styles.panel} aria-label="Messages">{visibleMessages.map((message) => <button className={`${styles.message} ${messageId === message.id ? styles.selected : ""}`} key={message.id} data-testid="mail-row" onClick={() => { setMessageId(message.id); setDraft(view.drafts.find((item) => item.messageId === message.id)?.body || ""); }}><small>{view.accounts.find((account) => account.id === message.accountId)?.label} · {message.read ? "Read" : "Unread"}</small><strong>{message.subject}</strong><span>{message.from}</span></button>)}{!visibleMessages.length && <p className={styles.empty}>{search ? "No messages match this search in the selected mailbox." : "No inbox messages in this mailbox."}</p>}</section>
            <section className={styles.panel} aria-label="Message reader">{selectedMessage ? <div className={styles.reader}><p className={styles.eyebrow}>PRIVATE MAIL</p><h2>{selectedMessage.subject}</h2><p className={styles.small}>From: {selectedMessage.from}<br />To: {selectedMessage.to}<br />{date(selectedMessage.receivedAt)}</p><pre className={styles.body}>{selectedMessage.body}</pre><div className={styles.actions}><button disabled={busy} onClick={() => command({ type: "mail.read", messageId: selectedMessage.id, read: !selectedMessage.read }, "Message updated")}>Mark {selectedMessage.read ? "unread" : "read"}</button><button className={styles.primary} disabled={busy} onClick={() => command({ type: "task.create", title: selectedMessage.subject, messageId: selectedMessage.id }, "Private task created from this message")}>Create task from mail</button></div><form onSubmit={submit(async () => { const existing = view.drafts.find((item) => item.messageId === selectedMessage.id);
              await command(existing ? { type: "mail.draft.update", draftId: existing.id, to: existing.to || selectedMessage.from, subject: existing.subject || `Re: ${selectedMessage.subject}`, body: draft } : { type: "mail.draft", messageId: selectedMessage.id, body: draft }, "Reply saved as a local fixture draft. No message sent."); })}><label>Reply draft<textarea aria-label="Reply draft" required value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} placeholder="Write a reply to save for later…" /></label><button disabled={busy || !draft.trim()}>Save draft</button><p className={styles.small}>Draft only · live sending is disabled</p></form></div> : <div className={styles.empty}>Select a message to read, draft a reply or create a private task.</div>}</section></div>}
        </>}
        {view && tab === "Tasks" && <>
          <form className={styles.inlineForm} onSubmit={submit(async () => { if (await command({ type: "task.create", title: taskTitle }, "Task created")) setTaskTitle(""); })}><label className={styles.grow}>New task<input aria-label="New task" required value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="What needs your attention?" /></label><button className={styles.primary} disabled={busy}>Add task</button></form>
          <section className={styles.panel} aria-label="Task list">{view.tasks.map((task) => <article className={styles.task} data-testid="task-row" key={task.id}><label><input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.completed} disabled={busy} onChange={(e) => command({ type: "task.complete", taskId: task.id, completed: e.target.checked }, "Task updated")} /><span className={task.completed ? styles.completed : ""}>{task.title}</span></label><div>{task.sourceMessageId && <small>From private mail · </small>}{task.scheduledSlot ? <small>{date(task.scheduledSlot.start)} – {date(task.scheduledSlot.end)}</small> : <small>Unscheduled</small>}<button disabled={busy} onClick={() => { setScheduleTask(task.id); }}>Schedule</button></div></article>)}{!view.tasks.length && <p className={styles.empty}>No tasks yet. Add one or turn a message into a task.</p>}</section>
          {scheduleTask && <section className={styles.panel}><h2 className={styles.sectionHeading}>Schedule task</h2><form className={styles.form} onSubmit={submit(async () => { if (await command({ type: "task.schedule", taskId: scheduleTask, calendarId: selectedCalendar, start: utc(start), end: utc(end) }, "Task scheduled on your calendar")) setScheduleTask(""); })}><p>{view.tasks.find((task) => task.id === scheduleTask)?.title}</p><TimeFields calendars={calendars} calendarId={selectedCalendar} setCalendarId={setCalendarId} start={start} setStart={setStart} end={end} setEnd={setEnd} /><div className={styles.actions}><button className={styles.primary} disabled={busy}>Save schedule</button><button type="button" onClick={() => setScheduleTask("")}>Cancel</button></div></form></section>}
        </>}
        {view && tab === "Calendar" && <WorkspaceCalendar view={view} busy={busy} command={command} />}
        {view && tab === "Agents" && <WorkspaceAgents view={view} owner={owner} busy={busy} command={command} refresh={refresh} />}
        {view && <details className={styles.activity}><summary>Recent activity</summary>{view.activity.slice(-12).reverse().map((entry) => <p key={entry.id}><small>{date(entry.createdAt)}</small> {entry.action} <small>· {entry.actor}</small></p>)}</details>}
      </main>
    </div>
  </div>;
}

function TimeFields({ lockedCalendar = false, calendars, calendarId, setCalendarId, start, setStart, end, setEnd }: { lockedCalendar?: boolean; calendars: WorkspaceView["calendars"]; calendarId: string; setCalendarId: (value: string) => void; start: string; setStart: (value: string) => void; end: string; setEnd: (value: string) => void }) {
  return <><label>Calendar<select aria-label="Calendar" disabled={lockedCalendar} value={calendarId} onChange={(e) => setCalendarId(e.target.value)} required>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label><label>Start (UTC)<input aria-label="Start (UTC)" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></label><label>End (UTC)<input aria-label="End (UTC)" type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} /></label></>;
}
