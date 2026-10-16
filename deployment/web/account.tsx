import { useEffect, useMemo, useRef, useState } from 'react';
import { createFirebaseAuth } from '../../app/firebase-auth';
import { createOpenJobApi } from '../../app/openjob-api';
import { OpenJobBrand } from '../../app/openjob-brand';
import type { AuthSession, SignInMethod, User } from '../../app/openjob-contracts';

export default function PortableAccount() {
  const auth = useMemo(() => createFirebaseAuth(), []);
  const api = useMemo(() => createOpenJobApi(), []);
  const current = useRef<AuthSession | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const stop = auth.observe(next => {
      current.current = next; setSession(next); setUser(null); setCanCreate(false); setError('');
      if (next) void (async () => {
        try {
          const token = await next.getIdToken(); if (!active || current.current !== next) return;
          const value = await api.getMe(token); if (active && current.current === next) setUser(value);
        } catch (problem) {
          if (!active || current.current !== next) return;
          if ((problem as { code?: string }).code === 'sign_in_method_unrecognized') setCanCreate(true);
          else setError('Account could not be loaded. Check the service and try again.');
        }
      })();
    }, () => setError('Authentication could not be restored.'));
    return () => { active = false; current.current = null; stop(); };
  }, [auth, api]);
  async function signIn(method: SignInMethod) {
    setBusy(true); setError('');
    try { const proof = await auth.signIn(method); await proof?.dispose(); }
    catch { setError('Sign-in failed. Check approved Firebase provider/domain setup.'); }
    finally { setBusy(false); }
  }
  async function save(create: boolean) {
    const active = session; if (!active || busy) return;
    setBusy(true); setError('');
    try {
      const token = await active.getIdToken(); if (current.current !== active) return;
      const value = create ? await api.createUser(token) : await api.claimUsername(token, username);
      if (current.current === active) { setUser(value); setCanCreate(false); }
    } catch { if (current.current === active) setError('Account update failed. For usernames use 2–32 lowercase letters/numbers and internal ._-; it may already be taken.'); }
    finally { setBusy(false); }
  }
  return <main style={{ padding: 24, maxWidth: 720 }}><OpenJobBrand /><h1>Account setup</h1>
    <p>Use your existing OpenJob sign-in. Creating a User below is an explicit choice; no account is created automatically.</p>
    {!session && <><button disabled={busy} onClick={() => void signIn('google')}>Sign in with Google</button><button disabled={busy} onClick={() => void signIn('apple')}>Sign in with Apple</button></>}
    {session && canCreate && <button disabled={busy} onClick={() => void save(true)}>Create my OpenJob account</button>}
    {user?.usernameRequired && <form onSubmit={event => { event.preventDefault(); void save(false); }}><label>Username <input value={username} onChange={event => setUsername(event.target.value)} minLength={2} maxLength={32} required /></label><button disabled={busy}>Claim username</button></form>}
    {user && !user.usernameRequired && <p>Account ready{user.username ? ` · ${user.username}` : ''}. <a href="/workspace">Open personal workspace</a></p>}
    {error && <p role="alert">{error}</p>}
    <p>Existing Group administration is not included in this portable pilot. Provider connections and real sending remain unconfigured.</p><p><a href="/workspace">Back to personal workspace</a></p>
  </main>;
}
