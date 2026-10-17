"use client";
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AuthSession } from '../openjob-contracts';
import OwnedWorkspacesApp from './owned-workspaces-app';
import styles from '../workspace/workspace.module.css';
export default function WorkspacePilotSession({ session, signal, onSignOut }: { session: AuthSession; signal: AbortSignal; onSignOut: () => Promise<void> }) {
  const [owner, setOwner] = useState(''); const [message, setMessage] = useState('Checking Workspace pilot admission…');
  const getToken = useCallback(async () => { signal.throwIfAborted(); const token = await session.getIdToken(); signal.throwIfAborted(); return token; }, [session, signal]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await getToken();
        const response = await fetch('/api/v1/workspaces/session', { headers: { authorization: `Bearer ${token}` }, signal, cache: 'no-store', redirect: 'error' });
        if (!active || signal.aborted) return;
        if (!response.ok) { setMessage(response.status === 503 ? 'The Workspace pilot is not configured for this service. Your existing Personal work is available separately.' : 'This sign-in is not admitted to the Workspace pilot. Your existing Personal work is unchanged.'); return; }
        const body = await response.json() as { data?: { ownerUserId?: string; assurance?: string; employerIsolation?: boolean } };
        if (!body.data || !/^user_[a-f0-9]{32}$/.test(body.data.ownerUserId ?? '') || body.data.assurance !== 'limited_owner_pilot' || body.data.employerIsolation !== false) throw new Error();
        if (active && !signal.aborted) setOwner(body.data.ownerUserId!);
      } catch { if (active && !signal.aborted) setMessage('Workspace pilot could not be opened. Check your connection and sign-in.'); }
    })();
    return () => { active = false; };
  }, [getToken, signal]);
  return <><div className={styles.actions}><Link href="/connections">Connections</Link><Link href="/workspace">Existing Personal work</Link><button onClick={onSignOut}>Sign out</button></div>{owner ? <OwnedWorkspacesApp key={owner} ownerUserId={owner} getToken={getToken} apiBase="/api/v1/workspaces" mode="pilot" /> : <main className={styles.main}><h1>Workspace pilot</h1><p role="status">{message}</p></main>}</>;
}
