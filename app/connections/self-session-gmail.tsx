import { useEffect, useMemo, useRef, useState } from 'react';
import { createFirebaseAuth } from '../firebase-auth';
import type { AuthSession } from '../openjob-contracts';
import { OpenJobBrand } from '../openjob-brand';
import SessionGmail from './session-gmail';
import styles from '../workspace/workspace.module.css';

/** Ordinary alternate Google sign-in; this page never opens saved OpenJob work. */
export default function SelfSessionGmail() {
  const auth = useMemo(() => createFirebaseAuth({ sessionOnly: true }), []);
  const controller = useRef<AbortController | undefined>(undefined);
  const [value, setValue] = useState<{ session: AuthSession; signal: AbortSignal }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [available, setAvailable] = useState(false);
  useEffect(() => auth.observe(session => {
    controller.current?.abort(); setAvailable(false); setError('');
    if (session?.signInMethod === 'google') { controller.current = new AbortController(); setValue({ session, signal: controller.current.signal }); }
    else setValue(undefined);
  }, () => setError('Google sign-in could not be restored.')), [auth]);
  useEffect(() => () => { controller.current?.abort(); }, []);
  async function signIn() {
    setBusy(true); setError('');
    try { const proof = await auth.signIn('google'); await proof?.dispose(); }
    catch { setError('Google sign-in did not complete.'); }
    finally { setBusy(false); }
  }
  async function signOut() { controller.current?.abort(); setValue(undefined); await auth.signOut(); }
  return <main className={styles.main}><OpenJobBrand /><h1>Gmail on this Mac</h1>
    <p>Use the selected alternate Google account. This temporary session does not open or change saved OpenJob work.</p>
    {!value && <button disabled={busy} onClick={() => void signIn()}>Sign in with Google</button>}
    {value && <><button onClick={() => void signOut()}>Sign out</button><SessionGmail key={value.session.localIdentity?.uid} session={value.session} signal={value.signal} onAvailable={setAvailable} />{!available && <p>Checking the selected Google account. If Mail controls do not appear, sign out and choose the approved alternate.</p>}</>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
