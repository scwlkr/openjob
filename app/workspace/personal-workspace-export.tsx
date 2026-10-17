"use client";

import { useRef, useState } from "react";
import type { AuthSession } from "../openjob-contracts";
import type { PersonalWorkspaceClient } from "./personal-workspace-api";
import type { WorkspaceExportSection } from "../../shared/workspace-export";
import styles from "./workspace.module.css";

export default function PersonalWorkspaceExport({ session, signal, client, busy }: { session: AuthSession; signal: AbortSignal; client: PersonalWorkspaceClient; busy: boolean }) {
  const [selected, setSelected] = useState<WorkspaceExportSection[]>(['tasks', 'calendar']);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const running = useRef(false);
  async function download() {
    if (running.current || busy || !selected.length || signal.aborted) return;
    running.current = true; setWorking(true); setNotice(''); setError('');
    try {
      const data = await client.exportSaved(session, selected, signal);
      if (signal.aborted) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'openjob-personal-export.json';
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Export downloaded: ${data.tasks.length} Tasks, ${data.events.length} Calendar blocks, ${data.drafts.length} drafts. Saved online data as of ${new Date(data.exportedAt).toLocaleString()}.`);
    } catch { if (!signal.aborted) setError('Export could not be downloaded. Nothing was changed. Try again after checking your connection and sign-in.'); }
    finally { running.current = false; if (!signal.aborted) setWorking(false); }
  }
  return <section aria-label="Export personal data" className={`${styles.panel} ${styles.exportPanel}`}>
    <h2>Export personal data</h2>
    <p>Download a versioned JSON copy of selected work saved online. Unsaved editor text, pending offline changes and recovery text are excluded. Import and restore are not available.</p>
    <fieldset disabled={working || busy}><legend>Include in this file</legend>
      {(['tasks', 'calendar', 'drafts'] as WorkspaceExportSection[]).map(section => <label key={section}><input type="checkbox" checked={selected.includes(section)} onChange={event => setSelected(previous => event.target.checked ? [...previous, section] : previous.filter(item => item !== section))} />{section === 'tasks' ? 'Tasks and notes' : section === 'calendar' ? 'Calendar and planning blocks' : 'Saved authored drafts (invented Mail)'}</label>)}
    </fieldset>
    <p>The file contains private text and, if selected, draft recipients and sending account IDs. Keep it somewhere you trust. Incoming messages, source Mail links, credentials and agent access are excluded. Drafts remain labeled invented; no provider is contacted.</p>
    <button disabled={working || busy || !selected.length} onClick={download}>{working ? 'Preparing export…' : 'Download personal JSON'}</button>
    {notice && <p role="status" className={styles.success}>{notice}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
