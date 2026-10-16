"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkspaceView } from "../../shared/workspace-contracts";
import type { PersonalWorkspaceCommand } from "../../shared/personal-workspace-contracts";
import { createCalendarIcalExport, previewCalendarIcalImport } from "../../shared/calendar-ical";
import styles from "./workspace.module.css";

type Props = { view: WorkspaceView; signal: AbortSignal; busy: boolean; command: (input: PersonalWorkspaceCommand, success: string) => Promise<boolean> };
type Preview = Awaited<ReturnType<typeof previewCalendarIcalImport>> & { ical: string; filename: string };
const failureMessage = (failure: unknown) => (failure as { code?: string })?.code === "calendar_ical_unsupported"
  ? "This file uses unsupported calendar features. Import supports timed UTC events only, without recurrence, invitations, time zones, alarms, links or attachments. Nothing was imported."
  : "This calendar file could not be processed. Use a valid UTF-8 iCalendar file with at most 50 timed UTC events and 16 KiB. Nothing was imported.";

export default function WorkspaceCalendarFiles({ view, signal, busy, command }: Props) {
  const [selected, setSelected] = useState("");
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lease = useRef({ active: true, version: 0 });
  const calendarId = view.calendars.some(calendar => calendar.id === selected) ? selected : view.calendars[0]?.id || "";
  const calendar = view.calendars.find(item => item.id === calendarId);
  useEffect(() => { const scope = lease.current; scope.active = true; return () => { scope.active = false; scope.version += 1; }; }, []);
  const current = (version: number) => lease.current.active && lease.current.version === version && !signal.aborted;
  async function download() {
    const version = ++lease.current.version;
    setWorking(true); setError(""); setNotice("");
    try {
      const file = await createCalendarIcalExport(view, calendarId);
      if (!current(version)) return;
      const url = URL.createObjectURL(new Blob([file.ical], { type: file.contentType }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Calendar file downloaded from the currently loaded workspace. Refresh before exporting newer server work. No provider was contacted.");
    } catch (failure) { if (current(version)) setError(failureMessage(failure)); }
    finally { if (current(version)) setWorking(false); }
  }
  async function readFile(file: File | undefined) {
    const version = ++lease.current.version;
    setPreview(null); setConfirming(false); setError(""); setNotice("");
    if (!file) return;
    setWorking(true);
    try {
      if (file.size > 16384) throw new Error("File too large");
      const ical = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const result = await previewCalendarIcalImport(view, calendarId, ical);
      if (current(version)) setPreview({ ...result, ical, filename: file.name.slice(0, 160) });
    } catch (failure) { if (current(version)) setError(failureMessage(failure)); }
    finally { if (current(version)) setWorking(false); }
  }
  async function importFile() {
    if (!preview || preview.calendarId !== calendarId || busy || working || signal.aborted) return;
    const version = ++lease.current.version;
    setWorking(true); setError("");
    const success = await command({ type: "calendar.import", calendarId, ical: preview.ical, expectedRevision: preview.expectedRevision }, "Calendar file processed. New standalone blocks were added; unchanged events were kept. No Task links or providers were changed.");
    if (!current(version)) return;
    setWorking(false); setConfirming(false);
    if (success) setPreview(null);
    else setError("Import did not complete. Refresh and preview the file again before retrying. An existing UID with different title or times must be resolved separately; no records are overwritten by import.");
  }
  return <section className={styles.panel} aria-label="Calendar files" style={{ overflowWrap: "anywhere" }}>
    <h2 className={styles.sectionHeading}>Calendar files</h2>
    <div className={styles.form}>
      <p>Exchange local iCalendar files without connecting a provider. Exports include event titles and UTC times, including scheduled Tasks. Imports create standalone Calendar blocks and never change Tasks or send invitations.</p>
      <label>Calendar for files<select aria-label="Calendar for files" value={calendarId} disabled={busy || working} onChange={event => { lease.current.version += 1; setSelected(event.target.value); setPreview(null); setConfirming(false); setError(""); setNotice(""); }}>{view.calendars.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className={styles.actions}><button disabled={busy || working || !calendar} onClick={download}>Download calendar file</button></div>
      <label>Preview iCalendar file<input aria-label="Preview iCalendar file" type="file" accept=".ics,text/calendar" disabled={busy || working || !calendar} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void readFile(file); }} /></label>
      <small>Up to 50 whole-second UTC events / 16 KiB. Recurrence, all-day or local-time events, invitations, alarms, links and attachments are unsupported. Your file stays local until you confirm import.</small>
      {working && <p role="status">Processing calendar file…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {preview && <section aria-label="Calendar import preview"><h3>Review {preview.events.length} events for {calendar?.name}</h3><p>{preview.filename} · existing events are kept. A changed duplicate or newer Calendar revision stops the entire import.</p><ul>{preview.events.map(event => <li key={event.uid}><strong>{event.title}</strong><br /><span>{event.start} – {event.end} · UTC</span></li>)}</ul><button disabled={busy || working || !preview.events.length} onClick={() => setConfirming(true)}>Import reviewed events</button><button disabled={busy || working} onClick={() => { setPreview(null); setConfirming(false); }}>Cancel file preview</button></section>}
      {confirming && preview && <section role="alertdialog" aria-label="Confirm calendar import"><p>Add reviewed events to {calendar?.name}? This copies new events into OpenJob. No external calendar or Task will be updated.</p><div className={styles.actions}><button disabled={busy || working} onClick={importFile}>Confirm calendar import</button><button disabled={busy || working} onClick={() => setConfirming(false)}>Cancel import</button></div></section>}
    </div>
  </section>;
}
