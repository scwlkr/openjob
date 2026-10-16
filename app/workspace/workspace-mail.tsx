"use client";

import { useState, type FormEvent } from "react";
import type { WorkspaceCommand, WorkspaceView } from "../../shared/workspace-contracts";
import styles from "./workspace.module.css";

type MailFolder = "Inbox" | "Drafts" | "Simulated Sent";
type Props = { view: WorkspaceView; busy: boolean; command: (input: WorkspaceCommand, notice: string) => Promise<boolean> };
const date = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";

/** Both shells share controls; callers provide their existing authenticated or fixture API. */
export default function WorkspaceMail({ view, busy, command }: Props) {
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
  const submit = (fn: () => void) => (event: FormEvent) => { event.preventDefault(); fn(); };

  return <>
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
  </>;
}
