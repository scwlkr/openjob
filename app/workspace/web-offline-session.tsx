"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthSession } from "../openjob-contracts";
import { OpenJobBrand } from "../openjob-brand";
import type { PersonalWorkspaceClient } from "./personal-workspace-api";
import { createBrowserOfflineWorkspace, BROWSER_OFFLINE_PURGED_EVENT } from "./offline-browser-store";
import { prepareOfflineWorkspaceShell } from "./offline-shell";
import PersonalSession from "./personal-workspace-online-session";
import WebOfflineWorkspace from "./web-offline-workspace";
import styles from "./workspace.module.css";

type Props = { session: AuthSession; signal: AbortSignal; client: PersonalWorkspaceClient; onSignOut: () => Promise<void>; onPrivatePurge: () => void };
export default function BrowserSession({ session, signal, client, onSignOut, onPrivatePurge }: Props) {
  const identityKey = session.localIdentity ? JSON.stringify([session.localIdentity.tenantId, session.localIdentity.uid]) : null;
  const cache = useMemo(() => { if (!identityKey) return null; try { return createBrowserOfflineWorkspace({ identityKey, signal, read: owner => client.readTaskCalendarSync(session, owner, signal), write: (owner, input) => client.syncTaskCalendar(session, owner, input, signal) }); } catch { return null; } }, [identityKey, session, signal, client]);
  const [owner, setOwner] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [shellStatus, setShellStatus] = useState("");
  const invalid = useCallback(() => { if (!signal.aborted) void onSignOut(); }, [signal, onSignOut]);
  useEffect(() => {
    let active = true;
    const purge = () => { if (active && !signal.aborted) onPrivatePurge(); };
    window.addEventListener(BROWSER_OFFLINE_PURGED_EVENT, purge);
    return () => { active = false; window.removeEventListener(BROWSER_OFFLINE_PURGED_EVENT, purge); };
  }, [signal, onPrivatePurge]);
  useEffect(() => {
    let active = true;
    if (cache) void (async () => {
      let bound: string | null = null;
      try {
        bound = await cache.loadBinding();
        if (!active || signal.aborted) return;
        if (bound) setOwner(bound);
        const user = await client.me(session, signal);
        if (!active || signal.aborted) return;
        await cache.bindOwner(user.userId);
        if (active && !signal.aborted) setOwner(user.userId);
      } catch (failure) {
        if (!active || signal.aborted) return;
        const issue = failure as { status?: number; code?: string };
        if (issue.status === 401 || issue.status === 410 || issue.code === "revoked") invalid();
        else if (bound) setSaved(true);
      }
    })();
    return () => { active = false; };
  }, [cache, client, session, signal, invalid]);
  const recovery = useMemo(() => cache && owner ? { load: cache.loadAuthored, save: cache.saveAuthored, clear: cache.clearAuthored, signal } : undefined, [cache, owner, signal]);
  async function prepare() {
    if (signal.aborted || preparing) return;
    setPreparing(true); setShellStatus("");
    try { await prepareOfflineWorkspaceShell(); if (!signal.aborted) setShellStatus("Offline page ready. Tasks and Calendar data are saved separately using Saved Tasks and Calendar."); }
    catch { if (!signal.aborted) setShellStatus("Offline page could not be prepared. Keep this page open; reload without a connection is not ready."); }
    finally { if (!signal.aborted) setPreparing(false); }
  }
  return <>
    <div hidden={saved}><PersonalSession session={session} signal={signal} client={client} onSignOut={onSignOut} onShowSaved={() => setSaved(true)} savedAvailable={Boolean(cache && owner)} recovery={recovery} /></div>
    {cache && owner && <div className={styles.workspace} hidden={!saved}><header className={styles.header}><OpenJobBrand /><button onClick={() => setSaved(false)}>Online workspace</button><button onClick={onSignOut}>Sign out</button></header><main className={styles.main}><WebOfflineWorkspace offline={cache.offline} owner={owner} signal={signal} active={saved} onInvalid={invalid} /></main></div>}
    <div className={styles.workspace} style={{ minHeight: 0 }}><div className={styles.main}><button disabled={preparing} onClick={prepare}>{preparing ? "Preparing offline page…" : "Prepare offline page"}</button>{shellStatus && <p role="status">{shellStatus}</p>}<p className={styles.small}>Offline page preparation does not save inbox content or provider data.</p></div></div>
  </>;
}
