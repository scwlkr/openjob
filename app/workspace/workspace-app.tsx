"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkspaceCommand, WorkspaceScope, WorkspaceView } from "../../shared/workspace-contracts";
import { OpenJobBrand } from "../openjob-brand";
import styles from "./workspace.module.css";

type Tab = "Mail" | "Calendar" | "Tasks" | "Agents";
const scopes: WorkspaceScope[] = ["mail:read", "mail:draft", "tasks:read", "tasks:write", "calendar:read", "calendar:write"];
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
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [composeAccount, setComposeAccount] = useState("");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [editingEvent, setEditingEvent] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [scheduleTask, setScheduleTask] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [start, setStart] = useState("2026-10-16T14:00");
  const [end, setEnd] = useState("2026-10-16T14:30");
  const [agentName, setAgentName] = useState("");
  const [agentScopes, setAgentScopes] = useState<WorkspaceScope[]>(["tasks:read"]);
  const [resources, setResources] = useState<string[]>([]);
  const [inspectedAgent, setInspectedAgent] = useState("");
  const [agentView, setAgentView] = useState<WorkspaceView | null>(null);
  const [agentError, setAgentError] = useState("");

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

  async function inspect(id: string) {
    setInspectedAgent(id); setAgentView(null); setAgentError("");
    try { setAgentView(await api("snapshot", owner, undefined, id)); }
    catch (e) { setAgentError(e instanceof Error ? e.message : "Access denied"); }
  }

  const selectedMessage = view?.messages.find((item) => item.id === messageId);
  const calendars = view?.calendars || [];
  const selectedCalendar = calendarId || calendars[0]?.id || "";
  const resourceOptions = view ? [...view.accounts.map((item) => ({ id: item.id, label: `${item.label} mailbox` })), ...view.calendars.map((item) => ({ id: item.id, label: `${item.name} calendar` })), { id: "tasks:personal", label: "Personal tasks" }] : [];
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
        <nav aria-label="Workspace"><div className={styles.tabs}>{(["Mail", "Calendar", "Tasks", "Agents"] as Tab[]).map((item) => <button key={item} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>{item}<span>{item === "Mail" ? view?.messages.length : item === "Calendar" ? view?.events.length : item === "Tasks" ? view?.tasks.filter((task) => !task.completed).length : view?.agents.filter((agent) => !agent.revoked).length}</span></button>)}</div></nav>
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
          <button className={styles.compose} onClick={() => setComposing(!composing)}>Compose draft</button><label className={styles.filter}>Mailbox<select aria-label="Mailbox" value={accountId} onChange={(e) => { setAccountId(e.target.value); setMessageId(""); setDraft(""); }}><option value="">All mailboxes</option>{view.accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.address}</option>)}</select></label>
          {composing && <section className={styles.panel}><h2 className={styles.sectionHeading}>New draft</h2><form className={styles.form} onSubmit={submit(async () => { if (await command({ type: "mail.compose", accountId: composeAccount || view.accounts[0]?.id || "", to: composeTo, subject: composeSubject, body: composeBody }, "New draft saved. Nothing sent.")) { setComposing(false); setComposeSubject(""); setComposeBody(""); } })}><label>From mailbox<select aria-label="From mailbox" value={composeAccount || view.accounts[0]?.id || ""} onChange={(e) => setComposeAccount(e.target.value)}>{view.accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.address}</option>)}</select></label><label>To<input aria-label="To" type="email" required value={composeTo} onChange={(e) => setComposeTo(e.target.value)} /></label><label>Subject<input aria-label="Subject" required value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} /></label><label>Message<textarea aria-label="Message" required rows={5} value={composeBody} onChange={(e) => setComposeBody(e.target.value)} /></label><button className={styles.primary} disabled={busy}>Save new draft</button><small>Fixture draft only. Live sending is unavailable.</small></form></section>}
          {view.drafts.length > 0 && <details className={styles.activity}><summary>Saved drafts ({view.drafts.length})</summary>{view.drafts.map((item) => <article className={styles.agent} key={item.id} data-testid="saved-draft"><strong>{item.subject || view.messages.find((message) => message.id === item.messageId)?.subject || "Reply draft"}</strong><small>{item.to || "Reply to selected message"} · Draft only</small><p className={styles.body}>{item.body}</p></article>)}</details>}
          <div className={styles.mailGrid}><section className={styles.panel} aria-label="Messages">{view.messages.filter((item) => !accountId || item.accountId === accountId).map((message) => <button className={`${styles.message} ${messageId === message.id ? styles.selected : ""}`} key={message.id} data-testid="mail-row" onClick={() => { setMessageId(message.id); setDraft(view.drafts.find((item) => item.messageId === message.id)?.body || ""); }}><small>{view.accounts.find((account) => account.id === message.accountId)?.label} · {message.read ? "Read" : "Unread"}</small><strong>{message.subject}</strong><span>{message.from}</span></button>)}</section>
            <section className={styles.panel} aria-label="Message reader">{selectedMessage ? <div className={styles.reader}><p className={styles.eyebrow}>PRIVATE MAIL</p><h2>{selectedMessage.subject}</h2><p className={styles.small}>From: {selectedMessage.from}<br />To: {selectedMessage.to}<br />{date(selectedMessage.receivedAt)}</p><pre className={styles.body}>{selectedMessage.body}</pre><div className={styles.actions}><button disabled={busy} onClick={() => command({ type: "mail.read", messageId: selectedMessage.id, read: !selectedMessage.read }, "Message updated")}>Mark {selectedMessage.read ? "unread" : "read"}</button><button className={styles.primary} disabled={busy} onClick={() => command({ type: "task.create", title: selectedMessage.subject, messageId: selectedMessage.id }, "Private task created from this message")}>Create task from mail</button></div><form onSubmit={submit(async () => { await command({ type: "mail.draft", messageId: selectedMessage.id, body: draft }, "Reply saved as a local fixture draft. No message sent."); })}><label>Reply draft<textarea aria-label="Reply draft" required value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} placeholder="Write a reply to save for later…" /></label><button disabled={busy || !draft.trim()}>Save draft</button><p className={styles.small}>Draft only · live sending is disabled</p></form></div> : <div className={styles.empty}>Select a message to read, draft a reply or create a private task.</div>}</section></div>
        </>}
        {view && tab === "Tasks" && <>
          <form className={styles.inlineForm} onSubmit={submit(async () => { if (await command({ type: "task.create", title: taskTitle }, "Task created")) setTaskTitle(""); })}><label className={styles.grow}>New task<input aria-label="New task" required value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="What needs your attention?" /></label><button className={styles.primary} disabled={busy}>Add task</button></form>
          <section className={styles.panel} aria-label="Task list">{view.tasks.map((task) => <article className={styles.task} data-testid="task-row" key={task.id}><label><input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.completed} disabled={busy} onChange={(e) => command({ type: "task.complete", taskId: task.id, completed: e.target.checked }, "Task updated")} /><span className={task.completed ? styles.completed : ""}>{task.title}</span></label><div>{task.sourceMessageId && <small>From private mail · </small>}{task.scheduledSlot ? <small>{date(task.scheduledSlot.start)} – {date(task.scheduledSlot.end)}</small> : <small>Unscheduled</small>}<button disabled={busy} onClick={() => { setScheduleTask(task.id); setEventTitle(task.title); }}>Schedule</button></div></article>)}{!view.tasks.length && <p className={styles.empty}>No tasks yet. Add one or turn a message into a task.</p>}</section>
          {scheduleTask && <section className={styles.panel}><h2 className={styles.sectionHeading}>Schedule task</h2><form className={styles.form} onSubmit={submit(async () => { if (await command({ type: "task.schedule", taskId: scheduleTask, calendarId: selectedCalendar, start: utc(start), end: utc(end) }, "Task scheduled on your calendar")) setScheduleTask(""); })}><p>{view.tasks.find((task) => task.id === scheduleTask)?.title}</p><TimeFields calendars={calendars} calendarId={selectedCalendar} setCalendarId={setCalendarId} start={start} setStart={setStart} end={end} setEnd={setEnd} /><div className={styles.actions}><button className={styles.primary} disabled={busy}>Save schedule</button><button type="button" onClick={() => setScheduleTask("")}>Cancel</button></div></form></section>}
        </>}
        {view && tab === "Calendar" && <div className={styles.calendarGrid}><section className={styles.panel}><h2 className={styles.sectionHeading}>Upcoming agenda</h2>{[...view.events].sort((a, b) => a.start.localeCompare(b.start)).map((event) => <article className={styles.event} key={event.id} data-testid="calendar-event"><small>{date(event.start)} – {date(event.end)}</small><strong>{event.title}</strong><span>{calendars.find((item) => item.id === event.calendarId)?.name}{event.taskId ? " · linked task" : ""}</span><div className={styles.actions}><button onClick={() => { setEditingEvent(event.id); setEventTitle(event.title); setStart(event.start.slice(0, 16)); setEnd(event.end.slice(0, 16)); setCalendarId(event.calendarId); }}>Edit block</button><button disabled={busy} onClick={() => { if (window.confirm(`Delete fixture block “${event.title}”?`)) command({ type: "calendar.delete", eventId: event.id }, "Time block deleted"); }}>Delete block</button></div></article>)}{!view.events.length && <p className={styles.empty}>Your agenda is clear.</p>}</section><section className={styles.panel}><h2 className={styles.sectionHeading}>{editingEvent ? "Edit time block" : "Create time block"}</h2><form className={styles.form} onSubmit={submit(async () => { if (await command(editingEvent ? { type: "calendar.update", eventId: editingEvent, title: eventTitle, start: utc(start), end: utc(end) } : { type: "calendar.create", calendarId: selectedCalendar, title: eventTitle, start: utc(start), end: utc(end) }, editingEvent ? "Time block updated" : "Time block created")) { setEventTitle(""); setEditingEvent(""); } })}><label>Block title<input aria-label="Block title" required value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} /></label><TimeFields lockedCalendar={Boolean(editingEvent)} calendars={calendars} calendarId={selectedCalendar} setCalendarId={setCalendarId} start={start} setStart={setStart} end={end} setEnd={setEnd} /><button className={styles.primary} disabled={busy}>{editingEvent ? "Save block" : "Create block"}</button>{editingEvent && <button type="button" onClick={() => { setEditingEvent(""); setEventTitle(""); }}>Cancel edit</button>}</form></section></div>}
        {view && tab === "Agents" && <div className={styles.calendarGrid}><section className={styles.panel}><h2 className={styles.sectionHeading}>Personal agents</h2><p className={styles.inset}>Simulated identities with explicit scopes and resources. No API secrets are created.</p>{view.agents.map((agent) => <article key={agent.id} className={styles.agent} data-testid="agent-row"><strong>{agent.name}</strong><small>{agent.revoked ? "Revoked" : "Active"} · {agent.scopes.join(", ")}</small><small>{agent.resourceIds.length} selected resources</small><div className={styles.actions}><button disabled={busy} onClick={() => inspect(agent.id)}>Inspect access</button><button disabled={busy || agent.revoked} onClick={async () => { if (await command({ type: "agent.revoke", agentId: agent.id }, "Agent access revoked")) { if (inspectedAgent === agent.id) await inspect(agent.id); } }}>Revoke</button></div></article>)}{inspectedAgent && <section aria-label="Agent access result" className={styles.inspection}><h3>Agent access result</h3>{agentError && <p role="alert">{agentError}</p>}{agentView && <><p data-testid="agent-counts">{agentView.messages.length} messages · {agentView.tasks.length} tasks · {agentView.events.length} events</p><ul>{agentView.messages.map((item) => <li key={item.id}>Mail: {item.subject}</li>)}{agentView.tasks.map((item) => <li key={item.id}>Task: {item.title}</li>)}{agentView.events.map((item) => <li key={item.id}>Event: {item.title}</li>)}</ul></>}</section>}</section><section className={styles.panel}><h2 className={styles.sectionHeading}>Grant scoped access</h2><form className={styles.form} onSubmit={submit(async () => { if (await command({ type: "agent.grant", name: agentName, scopes: agentScopes, resourceIds: resources }, "Scoped agent created")) { setAgentName(""); setResources([]); } })}><label>Agent name<input aria-label="Agent name" required value={agentName} onChange={(e) => setAgentName(e.target.value)} /></label><fieldset><legend>Capabilities</legend>{scopes.map((scope) => <label className={styles.check} key={scope}><input type="checkbox" checked={agentScopes.includes(scope)} onChange={(e) => setAgentScopes(e.target.checked ? [...agentScopes, scope] : agentScopes.filter((item) => item !== scope))} />{scope}</label>)}</fieldset><fieldset><legend>Allowed resources</legend>{resourceOptions.map((resource) => <label className={styles.check} key={resource.id}><input type="checkbox" checked={resources.includes(resource.id)} onChange={(e) => setResources(e.target.checked ? [...resources, resource.id] : resources.filter((item) => item !== resource.id))} />{resource.label}</label>)}</fieldset><p className={styles.small}>Select only the mailboxes, calendars and personal task collection this agent needs. Unselected resources stay private.</p><button className={styles.primary} disabled={busy || !agentScopes.length || !resources.length}>Create agent</button></form></section></div>}
        {view && <details className={styles.activity}><summary>Recent activity</summary>{view.activity.slice(-12).reverse().map((entry) => <p key={entry.id}><small>{date(entry.createdAt)}</small> {entry.action} <small>· {entry.actor}</small></p>)}</details>}
      </main>
    </div>
  </div>;
}

function TimeFields({ lockedCalendar = false, calendars, calendarId, setCalendarId, start, setStart, end, setEnd }: { lockedCalendar?: boolean; calendars: WorkspaceView["calendars"]; calendarId: string; setCalendarId: (value: string) => void; start: string; setStart: (value: string) => void; end: string; setEnd: (value: string) => void }) {
  return <><label>Calendar<select aria-label="Calendar" disabled={lockedCalendar} value={calendarId} onChange={(e) => setCalendarId(e.target.value)} required>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label><label>Start (UTC)<input aria-label="Start (UTC)" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></label><label>End (UTC)<input aria-label="End (UTC)" type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} /></label></>;
}
