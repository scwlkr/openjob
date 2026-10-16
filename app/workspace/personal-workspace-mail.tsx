"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthSession } from "../openjob-contracts";
import type { ProviderAccount, ProviderPreview } from "../../shared/provider-contracts";
import type { WorkspaceCommand } from "../../shared/workspace-contracts";
import type { PersonalWorkspaceClient } from "./personal-workspace-api";
import styles from "./workspace.module.css";

type Props = { session: AuthSession; signal: AbortSignal; client: PersonalWorkspaceClient; busy: boolean; command: (input: WorkspaceCommand, notice: string) => Promise<boolean> };
type Page = { accountId?: string; cursor?: string; history: (string | undefined)[] };
const statusLabels = { ready: "Ready (synthetic)", reconnect_required: "Reconnect required", error: "Provider error", unsupported: "Unsupported", not_connected: "Not connected", needs_consent: "Mail consent required", revoked: "Access revoked", disabled: "Connection disabled" };
const capabilities: [keyof ProviderAccount["capabilities"], string][] = [["mailRead", "Mail read"], ["draft", "Mail draft"], ["send", "Mail send"], ["calendarRead", "Calendar read"], ["calendarWrite", "Calendar write"], ["reconnect", "Reconnect"]];
const operationLabels: Record<string, string> = {
  "mail.read": "Read messages", "mail.labels": "Read labels", "mail.draft": "Create drafts", "mail.send": "Send mail",
  "mail.write": "Change mailbox data", "mail.history": "Mail history synchronization", "mail.delta": "Mail change synchronization",
  "calendar.read": "Read provider calendars", "calendar.write": "Change provider calendars",
};
const operationLabel = (operation: string) => operationLabels[operation] || operation.replaceAll(".", " ");
const exampleTime = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";

export default function PersonalWorkspaceMail({ session, signal, client, busy, command }: Props) {
  const requestController = useRef<AbortController | null>(null);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page>({ history: [] });
  const [result, setResult] = useState<{ key: string; data?: ProviderPreview; failed?: boolean } | null>(null);
  const [accountOptions, setAccountOptions] = useState<ProviderAccount[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const key = JSON.stringify([page.accountId, page.cursor, revision]);
  const data = result?.key === key ? result.data : undefined;
  const failed = result?.key === key && result.failed;
  const selectedAccount = data?.accounts.find((account) => account.id === data.selectedAccountId);
  const displayAccount = selectedAccount || accountOptions.find((account) => account.id === page.accountId);
  const isMock = displayAccount?.mode === "mock";
  const readable = selectedAccount?.status === "ready" && selectedAccount.capabilities.mailRead.available;
  const messages = readable ? data?.messages || [] : [];
  const events = selectedAccount?.status === "ready" && selectedAccount.capabilities.calendarRead.available ? data?.events || [] : [];
  const selectedMessage = messages.find((message) => message.id === selectedMessageId);

  useEffect(() => {
    const controller = new AbortController();
    requestController.current = controller;
    const abort = () => controller.abort();
    if (signal.aborted) controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    client.providerPreview(session, controller.signal, { accountId: page.accountId, cursor: page.cursor }).then((next) => {
      if (!controller.signal.aborted) { setResult({ key, data: next }); setAccountOptions(next.accounts); }
    }).catch(() => { if (!controller.signal.aborted) setResult({ key, failed: true }); });
    return () => { controller.abort(); signal.removeEventListener("abort", abort); if (requestController.current === controller) requestController.current = null; };
  }, [client, session, signal, page.accountId, page.cursor, key]);

  function selectAccount(accountId: string) { requestController.current?.abort(); setPage({ accountId, history: [] }); setSelectedMessageId(""); }
  function nextPage() {
    if (!data?.nextCursor || !readable) return;
    requestController.current?.abort();
    setPage({ accountId: data.selectedAccountId, cursor: data.nextCursor, history: [...page.history, page.cursor] });
    setSelectedMessageId("");
  }
  function previousPage() {
    requestController.current?.abort();
    const history = page.history.slice(0, -1);
    setPage({ accountId: data?.selectedAccountId || page.accountId, cursor: page.history[page.history.length - 1], history });
    setSelectedMessageId("");
  }

  return <section aria-label="Authenticated provider preview">
    <button disabled={signal.aborted} onClick={() => { requestController.current?.abort(); setPage({ accountId: page.accountId || data?.selectedAccountId, history: [] }); setRevision((value) => value + 1); setSelectedMessageId(""); }}>Refresh preview</button>
    <p className={styles.banner} data-testid="provider-mode">{isMock ? "Mock Gmail protocol · invented data · no live connection or sending. The read adapter and credential broker use invented Gmail responses and mock consent records." : "Synthetic Mail preview · fictional provider data returned through your authenticated API. No live provider connection, credentials, drafts or sending. These examples are not saved Mail."}</p>
    {data && <section className={styles.panel} aria-label="Provider connections"><div className={styles.reader}>
      <h2>Provider connections</h2>
      {data.connectors.map((connector) => <article key={connector.adapter} data-testid="provider-connection">
        <h3>Gmail read adapter</h3><p><strong>Implemented · not connected</strong></p>
        <p>Gmail Mail-read consent required · live execution disabled.</p>
        <p>Gmail consent is separate from your OpenJob sign-in.</p>
        <p>{connector.message}</p>
        <dl className={styles.providerCapabilities}><div><dt><strong>Implemented reads</strong></dt><dd>{connector.implementedOperations.map(operationLabel).join(", ")}</dd></div><div><dt><strong>Not supported</strong></dt><dd>{connector.unsupportedOperations.map(operationLabel).join(", ")}</dd></div></dl>
        <p className={styles.small}>Next step: choose an approved test account and complete owner-reviewed setup for read-only Mail consent.</p>
      </article>)}
      {!data.connectors.length && <p>No provider connections are available in this build.</p>}
    </div></section>}
    <label className={styles.filter}>Preview account<select aria-label="Preview account" value={page.accountId || data?.selectedAccountId || ""} disabled={!accountOptions.length} onChange={(event) => selectAccount(event.target.value)}>{!accountOptions.length && <option value="">Loading preview accounts…</option>}{accountOptions.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.provider} · {account.mode === "mock" ? "mock protocol" : "synthetic"}</option>)}</select></label>
    {failed && <p role="alert" className={styles.error}>Provider preview could not be loaded. Your saved Tasks and Calendar are unchanged. Choose another available account or reopen Mail preview.</p>}
    {!data && !failed && <p role="status">Loading authenticated provider preview…</p>}
    {data && selectedAccount && <>
      <section className={styles.panel} aria-label="Provider status"><div className={styles.reader}>
        <p className={styles.eyebrow}>{isMock ? "MOCK PROTOCOL" : "SYNTHETIC"} {selectedAccount.provider.toUpperCase()} ACCOUNT</p><h2>{selectedAccount.label}</h2><p>{selectedAccount.address}</p>
        <p data-testid="provider-status"><strong>{selectedAccount.status === "ready" && isMock ? "Ready (mock protocol)" : statusLabels[selectedAccount.status]}</strong> · {selectedAccount.statusReason}</p>
        <p data-testid="provider-sync">{selectedAccount.sync.state === "blocked" ? "Preview sync blocked" : isMock ? "Mock protocol snapshot ready" : "Synthetic snapshot ready"} · {selectedAccount.sync.reason}</p>
        <p className={styles.small}>{isMock ? "Mock snapshot time" : "Fixed example snapshot time"}: {selectedAccount.sync.asOf ? exampleTime(selectedAccount.sync.asOf) : "unavailable"}. {isMock ? "This mock read is not live synchronization." : "This is fixture time, not a live sync timestamp."}</p>
        <dl className={styles.providerCapabilities}>{capabilities.map(([capability, label]) => <div key={capability}><dt><strong>{label}</strong> · {selectedAccount.capabilities[capability].available ? isMock ? "Available in mock protocol" : "Available in synthetic adapter" : "Unavailable"}</dt><dd>{selectedAccount.capabilities[capability].reason}</dd></div>)}</dl>
      </div></section>
      <div className={styles.mailGrid}>
        <section className={styles.panel} aria-label={isMock ? "Mock Gmail messages" : "Synthetic messages"}>
          <h2 className={styles.sectionHeading}>Example messages · page {page.history.length + 1}</h2>
          {messages.map((message) => <button key={message.id} data-testid="provider-message" className={`${styles.message} ${selectedMessageId === message.id ? styles.selected : ""}`} onClick={() => setSelectedMessageId(message.id)}><strong>{message.subject}</strong><span>{message.from}</span><small>{message.folderIds.map((id) => data.folders.find((folder) => folder.id === id)?.name || "Example folder").join(" · ")} · {isMock ? "mock protocol" : "synthetic"}</small></button>)}
          {!messages.length && <p className={styles.empty}>{selectedAccount.capabilities.mailRead.available ? "No example messages on this page." : `Message preview unavailable: ${selectedAccount.capabilities.mailRead.reason}`}</p>}
          <div className={`${styles.actions} ${styles.providerPaging}`}><button disabled={!page.history.length} onClick={previousPage}>Previous messages</button><button disabled={!readable || !data.nextCursor} onClick={nextPage}>Next messages</button>{page.history.length > 0 && <button onClick={() => { requestController.current?.abort(); setPage({ accountId: data.selectedAccountId, history: [] }); setSelectedMessageId(""); }}>First page</button>}</div>
        </section>
        <section className={styles.panel} aria-label={isMock ? "Mock Gmail message reader" : "Synthetic message reader"}>{selectedMessage ? <div className={styles.reader}><h2>{selectedMessage.subject}</h2><p>From: {selectedMessage.from}<br />To: {selectedMessage.to}</p><p className={styles.small}>{isMock ? "Mock message timestamp" : "Fixed example received time"}: {exampleTime(selectedMessage.receivedAt)}</p><pre className={styles.body}>{selectedMessage.body}</pre><dl className={styles.providerReferences}><dt>Folders</dt><dd>{selectedMessage.folderIds.map((id) => data.folders.find((folder) => folder.id === id)?.name || id).join(", ")}</dd><dt>Thread reference</dt><dd>{selectedMessage.threadId}</dd><dt>Provider thread reference</dt><dd>{selectedMessage.upstreamThreadId}</dd><dt>Provider message reference</dt><dd>{selectedMessage.upstreamId}</dd></dl><button disabled={busy} onClick={() => command({ type: "task.create", title: selectedMessage.subject }, `Task created from a ${isMock ? "mock" : "synthetic"} example; no mailbox link was saved`)}>Create personal task from example</button></div> : <p className={styles.empty}>Select a fictional message to read its plain text and provider context.</p>}</section>
      </div>
      <section className={styles.panel} aria-label="Read-only provider calendar"><h2 className={styles.sectionHeading}>Provider calendar examples · read only</h2><p className={styles.inset}>{isMock ? "This mock Gmail protocol provides no calendar access. Your saved OpenJob Calendar is separate." : "These synthetic events stay in this preview. They are not merged into your saved OpenJob Calendar and cannot be edited or scheduled here."}</p>{events.map((event) => <article key={event.id} className={styles.event} data-testid="provider-event"><strong>{event.title}</strong><span>{data.calendars.find((calendar) => calendar.id === event.calendarId)?.name}</span><small>{exampleTime(event.start)} – {exampleTime(event.end)} · fixed example time</small></article>)}{!events.length && <p className={styles.empty}>{selectedAccount.capabilities.calendarRead.available ? "No example calendar events for this account." : `Calendar preview unavailable: ${selectedAccount.capabilities.calendarRead.reason}`}</p>}</section>
    </>}
  </section>;
}
