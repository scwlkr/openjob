import { useEffect, useMemo, useRef, useState } from 'react';
import { createFirebaseAuth } from '../firebase-auth';
import type { AuthSession, OpenJobAuth } from '../openjob-contracts';
import { OpenJobBrand } from '../openjob-brand';
import SessionGmail from './session-gmail';
import type { withSessionGoogleToken } from './session-google-popup';
import styles from './gmail-session.module.css';

const accountReasons: Record<string, string> = {
  'Account check: revocation_state_unavailable.': 'Google did not return the session state needed to verify safe read access.',
  'Account check: google_signin_revoked.': 'This Google session was revoked. Switch account and sign in again.',
  'Account check: google_identity_mismatch.': 'The current Google identity does not match this sign-in. Switch account and sign in again.',
  'Account check: api_key_http_referrer_blocked.': 'Google rejected OpenJob’s local account-check configuration. Gmail access is still off.',
  'Account check: api_key_service_blocked.': 'Google rejected OpenJob’s account-check configuration. Gmail access is still off.',
};
type Account = { action?: 'signin'; reason?: string; state: 'checking' | 'ready' | 'wrong' | 'error'; address?: string; message?: string };
/** Separate temporary Google login. No saved-work session or database access. */
export default function SelfSessionGmail({ authentication, popup, accountTimeoutMs = 8000 }: { authentication?: Pick<OpenJobAuth, 'observe' | 'signIn' | 'switchUser' | 'signOut'>; popup?: typeof withSessionGoogleToken; accountTimeoutMs?: number } = {}) {
  const auth = useMemo(() => authentication ?? createFirebaseAuth({ sessionOnly: true }), [authentication]);
  const controller = useRef<AbortController | undefined>(undefined);
  const [value, setValue] = useState<{ session: AuthSession; signal: AbortSignal }>();
  const [identityToken, setIdentityToken] = useState<string>();
  const [initializing, setInitializing] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [checkedAccount, setAccount] = useState<Account>({ state: 'checking' }), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const deadline = window.setTimeout(() => { setInitializing(false); setError('Google sign-in status could not be loaded. Try signing in again.'); }, accountTimeoutMs);
    const stop = auth.observe(session => {
      window.clearTimeout(deadline); controller.current?.abort(); setInitializing(false); setError(''); setAccount({ state: 'checking' });
      if (session?.signInMethod === 'google') { controller.current = new AbortController(); setValue({ session, signal: controller.current.signal }); }
      else { setValue(undefined); setIdentityToken(undefined); }
    }, () => { window.clearTimeout(deadline); setInitializing(false); setError('Google sign-in could not be restored. Try again.'); });
    return () => { window.clearTimeout(deadline); controller.current?.abort(); stop(); };
  }, [auth, accountTimeoutMs]);
  useEffect(() => {
    if (!value) return;
    if (!identityToken) return;
    let active = true; const timeout = AbortSignal.timeout(accountTimeoutMs), signal = AbortSignal.any([value.signal, timeout]);
    void (async () => {
      try {
        const interrupted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('Account check interrupted.')), { once: true }));
        const token = await Promise.race([value.session.getIdToken(), interrupted]); signal.throwIfAborted();
        const response = await fetch('/api/v1/connections/session/status', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-openjob-google-identity': identityToken }, body: '{}', signal, cache: 'no-store', redirect: 'error' });
        const result = await response.json() as { data?: { address?: string }; error?: { code?: string; message?: string } };
        if (!active || value.signal.aborted) return;
        if (response.ok && typeof result.data?.address === 'string') setAccount({ state: 'ready', address: result.data.address });
        else if (result.error?.code === 'identity_proof_required') setAccount({ state: 'error', action: 'signin', message: 'This temporary Google identity proof is unavailable or expired. Complete Google sign-in. Gmail access is still off.' });
        else if (result.error?.code === 'wrong_account') setAccount({ state: 'wrong', message: 'Choose the approved test Google account to continue. No Gmail permission was requested.' });
        else setAccount({ state: 'error', reason: result.error?.message ? accountReasons[result.error.message] : undefined, message: result.error?.code === 'account_check_unavailable' ? 'Google could not check this account right now. Retry the account check.' : 'OpenJob could not verify this Google sign-in for Mail. Retry the account check to see its current status.' });
      } catch { if (active && !value.signal.aborted) setAccount({ state: 'error', message: timeout.aborted ? 'The account check timed out. Retry to check this Google sign-in again.' : 'The account check failed. Check your connection and retry.' }); }
    })();
    return () => { active = false; };
  }, [value, identityToken, attempt, accountTimeoutMs]);
  async function signIn(switchAccount = false) {
    setBusy(true); setError(''); setIdentityToken(undefined);
    try {
      if (switchAccount) { setIdentityToken(undefined); await auth.switchUser(); }
      const proof = await auth.signIn('google');
      try {
        if (proof?.signInMethod !== 'google' || !proof.getIdentityToken) throw new Error('Google identity proof unavailable.');
        setIdentityToken(await proof.getIdentityToken());
      } finally { await proof?.dispose(); }
    }
    catch { setError('Google sign-in did not complete. Try again and finish the Google window.'); }
    finally { setBusy(false); }
  }
  async function signOut() { setIdentityToken(undefined); controller.current?.abort(); setValue(undefined); try { await auth.signOut(); } catch { setError('This page is disconnected. Google sign-out did not finish.'); } }
  const identity = value?.session.localIdentity;
  const account: Account = value && !identityToken ? busy ? { state: 'checking' } : { state: 'error', action: 'signin', message: 'Complete Google sign-in to verify this temporary account. Gmail access is still off.' } : checkedAccount;
  return <main className={styles.page}><div className={styles.frame}><header className={styles.header}><OpenJobBrand /><span className={styles.local}>Local Mail session</span></header>
    <section className={styles.card} aria-label="Gmail connection"><h1>Gmail on this Mac</h1><p className={styles.muted}>Connect the approved test account for one read-only check.</p>
      <div className={styles.account} aria-live="polite"><div className={styles.accountTop}><div className={styles.identity}>
        <strong>{value ? identity?.displayName || 'Google account' : initializing ? 'Checking Google sign-in…' : 'You’re signed out'}</strong>
        {value && <span>{account.state === 'ready' ? account.address : identity?.email || 'Email verification pending'}</span>}
      </div><span className={`${styles.status} ${value && account.state === 'ready' ? styles.verified : ''}`}>{value ? account.state === 'ready' ? 'Google account verified' : 'Signed in to Google' : 'Gmail access off'}</span></div>
      {value && <div className={styles.actions}><button className={styles.subtle} disabled={busy} onClick={() => void signIn(true)}>Switch Google account</button><button className={styles.subtle} disabled={busy} onClick={() => void signOut()}>Sign out</button></div>}</div>
      {!value && <><h2>1. Sign in with Google</h2><p>Your Google sign-in identifies the account. Gmail read permission comes next.</p><button className={styles.primary} disabled={busy || initializing} onClick={() => void signIn()}>{busy ? 'Finish sign-in in the Google window…' : 'Sign in with Google'}</button></>}
      {value && account.state === 'checking' && <div role="status"><h2>Checking your account…</h2><p className={styles.muted}>Confirming the selected email and current Google sign-in. Gmail is not connected yet.</p></div>}
      {value && (account.state === 'wrong' || account.state === 'error') && <div className={`${styles.notice} ${styles.error}`} role="alert"><h2>{account.state === 'wrong' ? 'Use the approved Google account' : 'Account check needs attention'}</h2><p>{account.message}</p>{account.reason && <p className={styles.muted}>{account.reason}</p>}<button className={styles.primary} disabled={busy} onClick={() => account.state === 'wrong' ? void signIn(true) : account.action === 'signin' ? void signIn() : (setAccount({ state: 'checking' }), setAttempt(value => value + 1))}>{account.state === 'wrong' ? 'Choose Google account' : account.action === 'signin' ? 'Complete Google sign-in' : 'Retry account check'}</button></div>}
      {value && account.state === 'ready' && <SessionGmail session={value.session} signal={value.signal} verifiedAddress={account.address} identityProof={identityToken} popup={popup} />}
      {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
      <p className={styles.footnote}>Session only · no sending or Mail changes · no Calendar access.<br />Reloading clears this temporary login. Google may remember your permission.</p>
    </section></div></main>;
}
