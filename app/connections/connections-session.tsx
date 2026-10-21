'use client';
import GoogleConnections from './google-connections';
import { requestConnections } from './connection-request';
import SessionGmail from './session-gmail';
import { useConnectedMailDrafts } from './connected-mail-drafts';
import { PendingConnectedMailTasks } from './connected-mail-task';
import type { GoogleConnectionCatalog } from '../../server/connections/google-state';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AuthSession } from '../openjob-contracts';
import type { ConnectionCatalog } from '../../shared/connection-onboarding';
import type { ProviderMessagePage } from '../../shared/provider-contracts';
import styles from '../workspace/workspace.module.css';
type Mail = { mode: 'simulated'; workspaceId: string; page: ProviderMessagePage };
const labels = { authorizing: 'Checking consent — refresh or cancel if interrupted', consent_required: 'Read-only consent required', connected: 'Connected · simulated', cancelled: 'Consent cancelled', reconnect_required: 'Reconnect required', cleanup_pending: 'Disconnected · cleanup pending', disconnected: 'Disconnected' };
export default function ConnectionsSession({ session, signal, onSignOut }: { session: AuthSession; signal: AbortSignal; onSignOut(): Promise<void> }) {
  const [sessionOnly, setSessionOnly] = useState(false);
  const [catalog, setCatalog] = useState<ConnectionCatalog | GoogleConnectionCatalog>(); const [error, setError] = useState('');
  const [choice, setChoice] = useState(''); const [home, setHome] = useState('');
  const [busy, setBusy] = useState(false); const [mail, setMail] = useState<Mail>();
  const request = useCallback((path = '', input?: object) => requestConnections(() => session.getIdToken(), signal, path, input), [session, signal]);
  const taskDrafts = useConnectedMailDrafts(request);
  const refresh = useCallback(async () => { setMail(undefined); try { const value = await request(); if (!signal.aborted) setCatalog(value as ConnectionCatalog | GoogleConnectionCatalog); } catch (error) { if (!signal.aborted) setCatalog(undefined); throw error; } }, [request, signal]);
  const completion = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    let current = true;
    if (location.pathname === '/connections/google/callback' && !completion.current) {
      const url = new URL(location.href), state = url.searchParams.get('state'), code = url.searchParams.get('code'), providerError = url.searchParams.get('error');
      history.replaceState(null, '', url.pathname);
      completion.current = !state || (!code && providerError !== 'access_denied') ? Promise.reject(new Error('Google callback is incomplete. Reconnect from Connections.')) : request('/google/callback', { state, callbackUri: url.origin + url.pathname, ...(providerError ? { error: providerError } : { code }) });
    }
    void (completion.current ? completion.current.then(() => request()) : request()).then(value => { if (current && !signal.aborted) setCatalog(value as ConnectionCatalog | GoogleConnectionCatalog); }).catch(error => { if (current && !signal.aborted) setError(error.message); }); return () => { current = false; }; }, [request, signal]);
  async function act(path: string, input?: object) {
    if (busy) return; setBusy(true); setError(''); setMail(undefined);
    try { if (path.endsWith('/mail')) { const value = await request(path); if (!signal.aborted) setMail(value as Mail); } else { await request(path, input); await refresh(); } }
    catch (error) { if (!signal.aborted) { setMail(undefined); setError(error instanceof Error ? error.message : 'Connection unavailable.'); try { await refresh(); } catch { setCatalog(undefined); } } }
    finally { if (!signal.aborted) setBusy(false); }
  }
  return <main className={`${styles.workspace} ${styles.main}`}><h1>Connections</h1><div className={styles.actions}><Link href="/workspaces">Workspaces</Link><Link href="/workspace">Personal work</Link><button onClick={onSignOut}>Sign out</button><button disabled={busy} onClick={() => void act('')}>Refresh status</button></div>
    <SessionGmail session={session} signal={signal} onAvailable={setSessionOnly} />
    {error && !sessionOnly && <p role="alert">{error}</p>}
    {catalog && catalog.mode !== 'simulated' && <GoogleConnections catalog={catalog} request={request} refresh={refresh} taskDrafts={taskDrafts} />}
    <PendingConnectedMailTasks drafts={taskDrafts} />
    {catalog?.mode === 'simulated' && <><p className={styles.banner}>Simulated onboarding · invented accounts and Mail · no provider access, grants or sending. Approval below runs a local test transport.</p>
      <section className={styles.panel}><h2>Add read-only Mail</h2>{catalog.providers.map(provider => <p key={provider.id}>{provider.id}: {provider.reason}</p>)}
        {!catalog.homes.length ? <p>Create an owned Workspace before choosing a Mail resource home.</p> : <form className={styles.form} onSubmit={event => { event.preventDefault(); void act('', { choiceId: choice, workspaceId: home }); }}>
          <label>Provider account<select required disabled={busy} value={choice} onChange={event => setChoice(event.target.value)}><option value="">Choose an invented account</option>{catalog.choices.map(item => <option key={item.id} value={item.id}>{item.provider} · {item.label}</option>)}</select></label>
          <label>Mail home Workspace<select required disabled={busy} value={home} onChange={event => setHome(event.target.value)}><option value="">Choose resource home</option>{catalog.homes.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</select></label>
          <p>Read Mail only. No send or provider Calendar access. Resource home stays fixed through consent and reconnect.</p><button disabled={busy || !choice || !home}>Review simulated consent</button>
        </form>}
      </section>
      <section className={styles.panel}><h2>Your connections</h2>{!catalog.bindings.length && <p>No accounts connected.</p>}{catalog.bindings.map(row => <article key={row.id}><h3>{row.address || catalog.choices.find(item => item.id === row.choiceId)?.label}</h3><p>{catalog.homes.find(item => item.workspaceId === row.workspaceId)?.name || 'Resource home unavailable'} · {labels[row.status]}</p><div className={styles.actions}>
        {row.status === 'consent_required' && <button disabled={busy} onClick={() => void act(`/${row.id}`, { action: 'approve' })}>Simulate read-only approval</button>}
        {['authorizing', 'consent_required'].includes(row.status) && <button disabled={busy} onClick={() => void act(`/${row.id}`, { action: 'cancel' })}>Cancel consent</button>}
        {row.status === 'connected' && <button disabled={busy} onClick={() => void act(`/${row.id}/mail`)}>Open simulated Mail</button>}
        {['reconnect_required', 'cancelled', 'disconnected'].includes(row.status) && <button disabled={busy} onClick={() => void act('', { choiceId: row.choiceId, workspaceId: row.workspaceId })}>Review reconnect consent</button>}
        {row.status === 'connected' && <button disabled={busy} onClick={() => void act(`/${row.id}`, { action: 'disconnect' })}>Disconnect</button>}
        {row.status === 'cleanup_pending' && <button disabled={busy} onClick={() => void act(`/${row.id}`, { action: 'retry-cleanup' })}>Retry cleanup</button>}
      </div></article>)}</section>
      {mail && <section className={styles.panel}><h2>Simulated Mail</h2><p>{catalog.homes.find(item => item.workspaceId === mail.workspaceId)?.name} · read-only · invented data</p>{!mail.page.messages.length && <p>This mailbox is empty.</p>}{mail.page.messages.map(message => <article key={message.id}><h3>{message.subject}</h3><p>{message.body}</p></article>)}<p><Link href={`/workspaces#${mail.workspaceId}`}>Open this Workspace for Calendar planning</Link> · OpenJob blocks, no provider Calendar connection.</p></section>}
    </>}
  </main>;
}
