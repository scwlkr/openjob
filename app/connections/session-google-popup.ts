import { getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, inMemoryPersistence, setPersistence, signInWithPopup, signOut } from 'firebase/auth';

declare const __OPENJOB_FIREBASE_CONFIG__: { apiKey: string; appId: string; authDomain: string; projectId: string };
let running = false;

/** Separate from primary sign-in and linking. No refresh credential is requested or saved. */
export async function withSessionGoogleToken(uid: string, address: string, signal: AbortSignal, consume: (token: string) => Promise<void>) {
  if (running || location.hostname !== '127.0.0.1' || location.protocol !== 'http:' || __OPENJOB_FIREBASE_CONFIG__.projectId !== 'openjob-nonprod') throw new Error('Local Gmail session unavailable.');
  running = true;
  const app = getApps().find(item => item.name === 'openjob-mail-session') ?? initializeApp(__OPENJOB_FIREBASE_CONFIG__, 'openjob-mail-session');
  const auth = getAuth(app);
  let accessToken: string | undefined;
  try {
    await setPersistence(auth, inMemoryPersistence); await signOut(auth); signal.throwIfAborted();
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
    provider.setCustomParameters({ prompt: 'select_account', login_hint: address, access_type: 'online', include_granted_scopes: 'false' });
    const result = await signInWithPopup(auth, provider);
    signal.throwIfAborted();
    if (result.user.uid !== uid) throw new Error('Use the selected Google account.');
    // Firebase's top-level email may be null for a federated user. The server
    // verifies Google's token audience, subject, verified email and exact scopes.
    accessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!accessToken) throw new Error('Google did not return read permission.');
    await consume(accessToken); signal.throwIfAborted();
  } finally { accessToken = undefined; try { await signOut(auth); } finally { running = false; } }
}
