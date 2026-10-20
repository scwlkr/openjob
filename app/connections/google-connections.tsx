'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { GoogleConnectionCatalog } from '../../server/connections/google-state';
import type { ProviderMessagePage } from '../../shared/provider-contracts';
import styles from '../workspace/workspace.module.css';
import ConnectedGoogleMail from './connected-google-mail';
type Request = (path?: string, input?: object) => Promise<unknown>;
const labels = { consent_required: 'Awaiting Google consent', authorizing: 'Checking connection; refresh status or cancel if interrupted', connected: 'Read access connected', cancelled: 'Consent cancelled', reconnect_required: 'Reconnect required; previous attempt will not be replayed', cleanup_pending: 'OpenJob access denied; finish local cleanup', disconnected: 'Disconnected in OpenJob' };
export default function GoogleConnections({ catalog, request, refresh }: { catalog: GoogleConnectionCatalog; request: Request; refresh(): Promise<void> }) {
  const [address, setAddress] = useState(''); const [home, setHome] = useState(''); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [handoff, setHandoff] = useState<string>(); const [mail, setMail] = useState<{ connectionId: string; workspaceId: string; page: ProviderMessagePage }>();
  async function act(path: string, input?: object) {
    if (busy) return; setBusy(true); setError(''); setHandoff(undefined); setMail(undefined);
    try {
      const result = await request(path, input) as { authorizationUrl?: string; workspaceId: string; page: ProviderMessagePage };
      if (result.authorizationUrl) setHandoff(result.authorizationUrl);
      if (path.endsWith('/mail')) setMail({ ...result, connectionId: path.split('/')[1] });
      else await refresh();
    } catch { setError('Connection unavailable. Refresh status before retrying.'); try { await refresh(); } catch { /* Parent shows unavailable state. */ } }
    finally { setBusy(false); }
  }
  return <>
    <p className={styles.banner}>{catalog.mode === 'google-fixture' ? 'Google protocol fixture · invented signed identities, credentials and Mail · no live provider calls.' : 'Read-only Google connection · Google consent is separate from OpenJob sign-in.'} No sending or external Calendar access.</p>
    {error && <p role="alert">{error}</p>}
    <section className={styles.panel}><h2>Connect read-only Gmail</h2><form className={styles.form} onSubmit={event => { event.preventDefault(); void act('', { address, workspaceId: home }); }}>
      <label>Google mailbox address<input type="email" required value={address} onChange={event => setAddress(event.target.value)} disabled={busy} /></label>
      <label>Mail home Workspace<select required value={home} onChange={event => setHome(event.target.value)} disabled={busy}><option value="">Choose resource home</option>{catalog.homes.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</select></label>
      <p>The verified Google address must match. The home and verified account stay fixed through reconnect.</p><button disabled={busy || !home || !address}>Prepare Google read consent</button>
    </form>{!catalog.homes.length && <p>No Mail home yet. <Link href="/workspaces">Open Workspace setup</Link> and choose Open existing Personal context to use your retained Tasks and Calendar. This does not connect a provider or request consent.</p>}{handoff && <p><a href={handoff} rel="noreferrer">Continue to Google for read-only consent</a></p>}</section>
    <section className={styles.panel}><h2>Your Google connections</h2>{!catalog.bindings.length && <p>No Google accounts connected.</p>}{catalog.bindings.map(row => <article key={row.id}><h3>{row.address}</h3><p>{catalog.homes.find(item => item.workspaceId === row.workspaceId)?.name || 'Resource home unavailable'} · {row.operation === 'refresh' ? 'Refreshing read access' : labels[row.status]}{row.expired ? ' · read credential expired' : ''}</p><div className={styles.actions}>
      {['consent_required', 'authorizing'].includes(row.status) && <button disabled={busy} onClick={() => void act(`/${row.id}`, { action: 'cancel' })}>Cancel connection attempt</button>}
      {row.status === 'connected' && <><button disabled={busy} onClick={() => void act(`/${row.id}`, { action: 'refresh' })}>Refresh read access</button>{catalog.mailAvailable && <button disabled={busy || row.expired} onClick={() => void act(`/${row.id}/mail`)}>Open read-only Mail</button>}<button disabled={busy} onClick={() => void act(`/${row.id}`, { action: 'disconnect' })}>Disconnect from OpenJob</button></>}
      {['cancelled', 'disconnected', 'reconnect_required'].includes(row.status) && <button disabled={busy} onClick={() => void act('', { address: row.address, workspaceId: row.workspaceId })}>Prepare reconnect consent</button>}
      {row.status === 'cleanup_pending' && <button disabled={busy} onClick={() => void act(`/${row.id}`, { action: 'retry-cleanup' })}>Finish local cleanup</button>}
    </div></article>)}<p>Disconnect denies OpenJob reads and removes its private credential copy. Google may retain the upstream grant. Revoking Google access can affect other clients in the same project; this application does not perform that revocation.</p></section>
    {mail && <ConnectedGoogleMail key={`${mail.connectionId}:${mail.workspaceId}`} connectionId={mail.connectionId} workspaceId={mail.workspaceId} initialPage={mail.page} fixture={catalog.mode === 'google-fixture'} request={request} />}
  </>;
}
