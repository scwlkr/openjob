"use client";

import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from "react";
import type { WorkspaceCommand, WorkspaceView } from "../../shared/workspace-contracts";
import styles from "./workspace.module.css";

type MailFolder = "Inbox" | "Drafts" | "Simulated Sent";
export type MailSource = { accountId: string; messageId: string };
export type WorkspaceMailHandle = { openSource: (source: MailSource) => boolean };
type AuthoredMail = { enabled: true; compose?: { to?: string; subject?: string; body?: string }; replies?: Record<string, string> };
export type BrowserMailRecovery = { load: () => Promise<AuthoredMail | null>; save: (input: AuthoredMail) => Promise<void>; clear: () => Promise<void>; signal: AbortSignal };
type Props = { recovery?: BrowserMailRecovery; view: WorkspaceView; busy: boolean; command: (input: WorkspaceCommand, notice: string) => Promise<boolean>; ref?: Ref<WorkspaceMailHandle> };
const date = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";

/** Both shells share controls; callers provide their existing authenticated or fixture API. */
export default function WorkspaceMail({ view, busy, command, ref, recovery }: Props) {
  const [accountId, setAccountId] = useState("");
  const [messageId, setMessageId] = useState("");
  const [mailFolder, setMailFolder] = useState<MailFolder>("Inbox");
  const [mailSearch, setMailSearch] = useState("");
  const [replyEdits, setReplyEdits] = useState<Record<string, string>>({});
  const [sourceNavigation, setSourceNavigation] = useState(0);
  const readerHeading = useRef<HTMLHeadingElement>(null);
  const [composing, setComposing] = useState(false);
  const [editingDraft, setEditingDraft] = useState("");
  const [composeAccount, setComposeAccount] = useState("");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");

  const [keepUnfinished, setKeepUnfinished] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const authored = useRef<AuthoredMail>({ enabled: true });
  const editVersion = useRef(0);
  const recoveryQueue = useRef(Promise.resolve());
  function persistBuffer(clear = false) {
    if (!recovery) return;
    const store = recovery;
    const buffer = JSON.parse(JSON.stringify(authored.current)) as AuthoredMail;
    recoveryQueue.current = recoveryQueue.current.catch(() => undefined).then(async () => {
      if (store.signal.aborted) return;
      if (clear) await store.clear(); else await store.save(buffer);
    }).catch((failure: unknown) => {
      if (store.signal.aborted) return;
      const issue = failure as { code?: string };
      setRecoveryNotice(issue?.code === "changed_in_another_tab"
        ? "Unfinished text changed in another tab. Your editor text is kept here. Copy it before reloading to review saved text."
        : "Unfinished text could not be saved in this browser. Keep the editor open.");
    });
  }
  function composeEdit(field: "to" | "subject" | "body", value: string) {
    editVersion.current += 1;
    authored.current = { ...authored.current, compose: { ...authored.current.compose, [field]: value } };
    if (keepUnfinished) persistBuffer();
  }
  function resetComposeRecovery() {
    editVersion.current += 1;
    delete authored.current.compose;
    if (keepUnfinished) persistBuffer();
  }
  function replyEdit(id: string, value: string) {
    authored.current = { ...authored.current, replies: { ...authored.current.replies, [id]: value } };
    editVersion.current += 1;
    if (keepUnfinished) persistBuffer();
  }
  useEffect(() => {
    if (!recovery) return;
    let active = true; const version = editVersion.current;
    void recovery.load().then(buffer => {
      if (!active || recovery.signal.aborted || !buffer) return;
      if (editVersion.current !== version) return;
      setKeepUnfinished(true);
      authored.current = buffer;
      setReplyEdits(buffer.replies || {});
      if (buffer.compose) { setComposeTo(buffer.compose.to || ""); setComposeSubject(buffer.compose.subject || ""); setComposeBody(buffer.compose.body || ""); setComposing(true); }
      setRecoveryNotice("Recovered unfinished text from this browser. Review the mailbox, recipient and text before saving a draft. Nothing was submitted or sent.");
    }).catch(() => { if (active && !recovery.signal.aborted) setRecoveryNotice("Unfinished text recovery is unavailable in this browser."); });
    return () => { active = false; };
  }, [recovery]);

  useImperativeHandle(ref, () => ({ openSource(source) {
    const message = view.messages.find(item => item.id === source.messageId && item.accountId === source.accountId);
    if (!message || !view.accounts.some(account => account.id === source.accountId)) return false;
    setAccountId(source.accountId); setMailFolder("Inbox"); setMailSearch(""); setMessageId(source.messageId);
    setSourceNavigation(value => value + 1);
    return true;
  } }), [view]);
  useEffect(() => { if (sourceNavigation) readerHeading.current?.focus(); }, [sourceNavigation]);

  const mailboxMessages = view?.messages.filter((item) => !accountId || item.accountId === accountId) || [];
  const mailboxDrafts = view?.drafts.filter((item) => !accountId || item.accountId === accountId) || [];
  const mailboxSent = view?.sent.filter((item) => !accountId || item.accountId === accountId) || [];
  const search = mailSearch.trim().toLocaleLowerCase();
  const matches = (...values: (string | undefined)[]) => !search || values.some((value) => value?.toLocaleLowerCase().includes(search));
  const visibleMessages = mailboxMessages.filter((item) => matches(item.subject, item.from, item.to, item.body));
  const visibleDrafts = mailboxDrafts.filter((item) => matches(item.subject, item.to, item.body, view?.accounts.find((account) => account.id === item.accountId)?.address));
  const visibleSent = mailboxSent.filter((item) => matches(item.subject, item.from, item.to, item.body));
  const selectedMessage = visibleMessages.find((item) => item.id === messageId);
  const replyBody = selectedMessage ? replyEdits[selectedMessage.id] ?? view.drafts.find(item => item.messageId === selectedMessage.id)?.body ?? "" : "";
  const folderCounts = { Inbox: mailboxMessages.length, Drafts: mailboxDrafts.length, "Simulated Sent": mailboxSent.length };
  const resultCount = mailFolder === "Inbox" ? visibleMessages.length : mailFolder === "Drafts" ? visibleDrafts.length : visibleSent.length;

  return <>
          {recovery && <section className={styles.inset} aria-label="Unfinished Mail recovery"><label><input type="checkbox" aria-label="Keep unfinished drafts in this browser" checked={keepUnfinished} onChange={event => { const enabled = event.target.checked; editVersion.current += 1; setKeepUnfinished(enabled); setRecoveryNotice(enabled ? "Only text you type is kept in this browser. Inbox messages and saved draft bodies are not cached. Signing out or switching users removes unfinished text." : "Unfinished text recovery disabled. Current editor text stays open."); persistBuffer(!enabled); }} /> Keep unfinished drafts in this browser</label>{recoveryNotice && <p role="status">{recoveryNotice}</p>}</section>}
          <button className={styles.compose} onClick={() => { resetComposeRecovery(); setComposing(!composing); setEditingDraft(""); setComposeAccount(""); setComposeTo(""); setComposeSubject(""); setComposeBody(""); }}>Compose draft</button><label className={styles.filter}>Mailbox<select aria-label="Mailbox" value={accountId} onChange={(e) => { setAccountId(e.target.value); setMessageId(""); }}><option value="">All mailboxes</option>{view.accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.address}</option>)}</select></label>
          <nav className={styles.folders} aria-label="Mail folders">{(["Inbox", "Drafts", "Simulated Sent"] as MailFolder[]).map((folder) => <button key={folder} aria-label={folder} aria-current={mailFolder === folder ? "page" : undefined} onClick={() => setMailFolder(folder)}>{folder}<span aria-hidden="true">{folderCounts[folder]}</span></button>)}</nav>
          <div className={styles.searchBar}><label className={styles.grow}>Search mail<input type="search" aria-label="Search mail" value={mailSearch} placeholder="Subject, people or message text…" onChange={(e) => setMailSearch(e.target.value)} /></label>{mailSearch && <button onClick={() => setMailSearch("")}>Clear search</button>}</div>
          <p className={styles.small} aria-live="polite">{resultCount} {resultCount === 1 ? "result" : "results"} in {mailFolder}{accountId ? ` · ${view.accounts.find((account) => account.id === accountId)?.label}` : " · all mailboxes"}</p>
          {composing && <section className={styles.panel} aria-label="Draft editor">
            <h2 className={styles.sectionHeading}>{editingDraft ? "Edit saved draft" : "New draft"}</h2>
            <form className={styles.form} onSubmit={async (event: FormEvent) => { event.preventDefault();
              const version = editVersion.current;
              const input: WorkspaceCommand = editingDraft
                ? { type: "mail.draft.update", draftId: editingDraft, to: composeTo, subject: composeSubject, body: composeBody }
                : { type: "mail.compose", accountId: composeAccount || view.accounts[0]?.id || "", to: composeTo, subject: composeSubject, body: composeBody };
              if (await command(input, editingDraft ? "Draft updated. Nothing sent." : "New draft saved. Nothing sent.")) { if (editVersion.current !== version || recovery?.signal.aborted) return; setComposing(false); setEditingDraft(""); setComposeSubject(""); setComposeBody(""); delete authored.current.compose; if (keepUnfinished) persistBuffer(); }
            }}>
              <label>From mailbox<select aria-label="From mailbox" disabled={Boolean(editingDraft)} value={composeAccount || view.accounts[0]?.id || ""} onChange={(e) => { editVersion.current += 1; setComposeAccount(e.target.value); }}>{view.accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.address}</option>)}</select></label>
              {editingDraft && <small>The original sending mailbox stays fixed when editing.</small>}
              <label>To<input aria-label="To" type="email" required value={composeTo} onChange={(e) => { setComposeTo(e.target.value); composeEdit("to", e.target.value); }} /></label>
              <label>Subject<input aria-label="Subject" required value={composeSubject} onChange={(e) => { setComposeSubject(e.target.value); composeEdit("subject", e.target.value); }} /></label>
              <label>Message<textarea aria-label="Message" required rows={5} value={composeBody} onChange={(e) => { setComposeBody(e.target.value); composeEdit("body", e.target.value); }} /></label>
              <div className={styles.actions}><button className={styles.primary} disabled={busy}>{editingDraft ? "Save draft changes" : "Save new draft"}</button><button type="button" onClick={() => { resetComposeRecovery(); setComposing(false); setEditingDraft(""); }}>Cancel draft editor</button></div>
              <small>Fixture draft only. Live sending is unavailable.</small>
            </form>
          </section>}
          {mailFolder === "Drafts" && <section className={styles.panel} aria-label="Saved drafts"><h2 className={styles.sectionHeading}>Saved drafts</h2>
            {visibleDrafts.map((item) => <article className={styles.agent} key={item.id} data-testid="saved-draft">
              <strong>{item.subject || view.messages.find((message) => message.id === item.messageId)?.subject || "Reply draft"}</strong>
              <small>From: {view.accounts.find((account) => account.id === item.accountId)?.address}</small>
              <small>To: {item.to || "Reply to selected message"} · Draft only</small><p className={styles.body}>{item.body}</p>
              <div className={styles.actions}>
                <button disabled={busy} onClick={() => { resetComposeRecovery(); setEditingDraft(item.id); setComposeAccount(item.accountId); setComposeTo(item.to || ""); setComposeSubject(item.subject || ""); setComposeBody(item.body); setComposing(true); }}>Edit draft</button>
                <button disabled={busy} onClick={async () => { if (await command({ type: "mail.simulate-send", draftId: item.id }, "Fixture message moved to Simulated Sent. No actual delivery occurred.")) { if (editingDraft === item.id) { setComposing(false); setEditingDraft(""); } } }}>Simulate send</button>
              </div><small>Simulation only · no actual delivery</small>
            </article>)}
            {!visibleDrafts.length && <p className={styles.empty}>{search ? "No drafts match this search in the selected mailbox." : "No saved drafts in this mailbox. Compose a draft or save a reply from your inbox."}</p>}
          </section>}
          {mailFolder === "Simulated Sent" && <section className={styles.panel} aria-label="Simulated Sent"><h2 className={styles.sectionHeading}>Simulated Sent</h2><p className={styles.inset}>Fixture records only. These messages were never delivered to any provider or recipient.</p>
            {visibleSent.map((item) => <article className={styles.agent} key={item.id} data-testid="sent-message"><strong>{item.subject}</strong><small>From: {item.from}<br />To: {item.to}<br />{date(item.sentAt)} · Simulated delivery</small><p className={styles.body}>{item.body}</p></article>)}
            {!visibleSent.length && <p className={styles.empty}>{search ? "No simulated messages match this search in the selected mailbox." : "No simulated sent messages in this mailbox. Use Simulate send on a saved draft to try the fixture workflow."}</p>}
          </section>}
          {mailFolder === "Inbox" && <div className={styles.mailGrid}><section className={styles.panel} aria-label="Messages">{visibleMessages.map((message) => <button className={`${styles.message} ${messageId === message.id ? styles.selected : ""}`} key={message.id} data-testid="mail-row" onClick={() => { setMessageId(message.id); }}><small>{view.accounts.find((account) => account.id === message.accountId)?.label} · {message.read ? "Read" : "Unread"}</small><strong>{message.subject}</strong><span>{message.from}</span></button>)}{!visibleMessages.length && <p className={styles.empty}>{search ? "No messages match this search in the selected mailbox." : "No inbox messages in this mailbox."}</p>}</section>
            <section className={styles.panel} aria-label="Message reader">{selectedMessage ? <div className={styles.reader}><p className={styles.eyebrow}>PRIVATE MAIL</p><h2 ref={readerHeading} tabIndex={-1}>{selectedMessage.subject}</h2><p className={styles.small}>From: {selectedMessage.from}<br />To: {selectedMessage.to}<br />{date(selectedMessage.receivedAt)}</p><pre className={styles.body}>{selectedMessage.body}</pre><div className={styles.actions}><button disabled={busy} onClick={() => command({ type: "mail.read", messageId: selectedMessage.id, read: !selectedMessage.read }, "Message updated")}>Mark {selectedMessage.read ? "unread" : "read"}</button><button className={styles.primary} disabled={busy} onClick={() => command({ type: "task.create", title: selectedMessage.subject, messageId: selectedMessage.id }, "Private task created from this message")}>Create task from mail</button></div><form onSubmit={async (event: FormEvent) => { event.preventDefault(); const existing = view.drafts.find((item) => item.messageId === selectedMessage.id);
              const saved = await command(existing ? { type: "mail.draft.update", draftId: existing.id, to: existing.to || selectedMessage.from, subject: existing.subject || `Re: ${selectedMessage.subject}`, body: replyBody } : { type: "mail.draft", messageId: selectedMessage.id, body: replyBody }, "Reply saved as a local fixture draft. No message sent.");
              if (saved && !recovery?.signal.aborted && authored.current.replies?.[selectedMessage.id] === replyBody) { delete authored.current.replies[selectedMessage.id]; if (keepUnfinished) persistBuffer(); }
              if (saved) setReplyEdits(current => { if (current[selectedMessage.id] !== replyBody) return current; const next = { ...current }; delete next[selectedMessage.id]; return next; }); }}><label>Reply draft<textarea aria-label="Reply draft" required value={replyBody} onChange={(e) => { setReplyEdits(current => ({ ...current, [selectedMessage.id]: e.target.value })); replyEdit(selectedMessage.id, e.target.value); }} rows={5} placeholder="Write a reply to save for later…" /></label><button disabled={busy || !replyBody.trim()}>Save draft</button><p className={styles.small}>Draft only · live sending is disabled</p></form></div> : <div className={styles.empty}>Select a message to read, draft a reply or create a private task.</div>}</section></div>}
  </>;
}
