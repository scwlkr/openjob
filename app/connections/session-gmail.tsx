'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthSession } from '../openjob-contracts';
import type { ProviderMessagePage } from '../../shared/provider-contracts';
import { withSessionGoogleToken } from './session-google-popup';
import styles from './gmail-session.module.css';

type Lease = { id: string; bearer: string; controller: AbortController; expiresAt: number };
export default function SessionGmail({ session, signal, onAvailable, verifiedAddress, popup = withSessionGoogleToken }: { session: AuthSession; signal: AbortSignal; onAvailable?(value: boolean): void; verifiedAddress?: string; popup?: typeof withSessionGoogleToken }) {
  const [address, setAddress] = useState(verifiedAddress ?? ''); const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(false);
  const [mail, setMail] = useState<ProviderMessagePage>();
  const lease = useRef<Lease | undefined>(undefined), generation = useRef(0);
  const disconnect = useCallback(async () => {
    generation.current++; const previous = lease.current; lease.current = undefined;
    previous?.controller.abort(); setConnected(false); setBusy(false); setMail(undefined);
    if (previous) {
      try { await fetch('/api/v1/connections/session', { method: 'DELETE', headers: { authorization: `Bearer ${previous.bearer}`, 'x-openjob-mail-session': previous.id }, cache: 'no-store', redirect: 'error', keepalive: true }); }
      catch { /* Local access is cleared. Server deadline still expires within ten minutes. */ }
    }
  }, []);
  useEffect(() => {
    let current = true;
    if (!verifiedAddress) void session.getIdToken().then(token => fetch('/api/v1/connections/session/status', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}', signal, cache: 'no-store', redirect: 'error' })).then(async response => { if (response.ok && current && !signal.aborted) { setAddress((await response.json() as { data: { address: string } }).data.address); onAvailable?.(true); } }).catch(() => {});
    const clear = () => { void disconnect(); };
    signal.addEventListener('abort', clear, { once: true }); window.addEventListener('pagehide', clear);
    return () => { current = false; signal.removeEventListener('abort', clear); window.removeEventListener('pagehide', clear); clear(); };
  }, [session, signal, disconnect, onAvailable, verifiedAddress]);
  async function request(path: string, target: Lease, input?: object) {
    const response = await fetch('/api/v1/connections/session' + path, { method: input ? 'POST' : 'GET', headers: { authorization: `Bearer ${target.bearer}`, 'x-openjob-mail-session': target.id, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}), signal: target.controller.signal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('Read permission unavailable. Disconnect and connect again.');
    return (await response.json() as { data: { expiresAt: number; page: ProviderMessagePage } }).data;
  }
  async function connect() {
    if (busy || !session.localIdentity || !address) return;
    await disconnect(); const epoch = ++generation.current; setBusy(true); setMessage('');
    let target: Lease | undefined;
    try {
      signal.throwIfAborted(); const bearer = await session.getIdToken(); signal.throwIfAborted();
      const response = await fetch('/api/v1/connections/session/begin', { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: '{}', signal, cache: 'no-store', redirect: 'error' });
      if (!response.ok) throw new Error();
      const started = (await response.json() as { data: { sessionId: string; expiresAt: number } }).data;
      target = { id: started.sessionId, expiresAt: started.expiresAt, bearer, controller: new AbortController() };
      if (generation.current !== epoch || signal.aborted) { target.controller.abort(); return; }
      lease.current = target;
      await popup(session.localIdentity.uid, address, target.controller.signal, async accessToken => {
        const value = await request('/connect', target!, { accessToken });
        if (lease.current !== target || signal.aborted) throw new Error();
        target!.expiresAt = value.expiresAt;
      });
      if (lease.current === target && generation.current === epoch && !signal.aborted) {
        setConnected(true); setMessage('Gmail connected. No Mail has been read yet.');
        window.setTimeout(() => { if (lease.current === target) { void disconnect(); setMessage('Mail session expired. Connect again to read.'); } }, Math.max(0, target.expiresAt - Date.now()));
      }
    } catch { if (generation.current === epoch && !signal.aborted) { await disconnect(); setMessage('Google connection did not complete. No Mail was read.'); } }
    finally { if (generation.current === epoch) setBusy(false); }
  }
  async function read() {
    const target = lease.current; if (!target || !connected || busy) return;
    setBusy(true); setMail(undefined); setMessage('');
    try { const result = await request('/mail', target, {}); if (lease.current === target && !signal.aborted && target.expiresAt > Date.now()) setMail(result.page); }
    catch { if (lease.current === target && !signal.aborted) { await disconnect(); setMessage('Mail session unavailable or expired. Connect again.'); } }
    finally { if (lease.current === target && !signal.aborted) setBusy(false); }
  }
  if (!address) return null;
  return <section className={styles.mail}><span className={styles.status}>{busy ? connected ? 'Reading Mail…' : 'Waiting for Google permission…' : connected ? mail ? 'Read complete' : 'Gmail connected' : 'Gmail access off'}</span><h2 style={{ marginTop: 14 }}>{connected ? '3. Read Mail' : '2. Allow read-only Gmail'}</h2><p>{connected ? 'Read up to ten messages once. Nothing will be sent or changed.' : 'Your Google account is verified. Next, give this session permission to read Gmail.'}</p><p className={styles.muted}>{address}</p><div className={styles.actions}>
    {!connected && <button className={styles.primary} disabled={busy} onClick={() => void connect()}>Connect Gmail for this session</button>}
    {connected && !mail && <button className={styles.primary} disabled={busy} onClick={() => void read()}>Read Mail once</button>}
    {(connected || busy) && <button className={mail ? styles.primary : undefined} onClick={() => { void disconnect(); setMessage('Disconnected from this Mail session.'); }}>Disconnect Mail session</button>}
  </div>{message && <p role="status">{message}</p>}{mail && <div className={styles.read}><h3>Read complete · {mail.messages.length} messages</h3>{!mail.messages.length && <p>No messages returned in this read.</p>}{mail.messages.map(item => <article key={item.id}><h4>{item.subject}</h4><p>{item.body}</p></article>)}</div>}<p className={styles.footnote}>Mail access stays in memory for at most ten minutes. Disconnect clears this view and ends local access; failed cleanup expires at that deadline.</p></section>;
}
