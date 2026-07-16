import { getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import type { AuthSession, OpenJobAuth } from "./openjob-contracts";

const firebaseConfig = {
  apiKey: "AIzaSyCnk2KPwHgRu0dhJcy6QDow-hI_rEBTHaU",
  authDomain: "openjob-dev.firebaseapp.com",
  projectId: "openjob-dev",
  storageBucket: "openjob-dev.firebasestorage.app",
  messagingSenderId: "1015996869029",
  appId: "1:1015996869029:web:8508dd4c023e2a16eda04c",
};

let clientPromise:
  | Promise<{
      auth: ReturnType<typeof getAuth>;
      provider: GoogleAuthProvider;
    }>
  | undefined;

function firebaseClient() {
  if (clientPromise) return clientPromise;
  const pending = (async () => {
    const app =
      getApps().find((candidate) => candidate.name === "openjob-web") ??
      initializeApp(firebaseConfig, "openjob-web");
    const auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
    return { auth, provider: new GoogleAuthProvider() };
  })();
  clientPromise = pending;
  void pending.catch(() => {
    if (clientPromise === pending) clientPromise = undefined;
  });
  return pending;
}

function sessionFor(user: { getIdToken(): Promise<string> }): AuthSession {
  return { getIdToken: () => user.getIdToken() };
}

export function createFirebaseAuth(): OpenJobAuth {
  return Object.freeze({
    observe(listener, onError) {
      let active = true;
      let unsubscribe: () => void = () => undefined;
      void firebaseClient()
        .then(({ auth }) => {
          if (!active) return;
          unsubscribe = onAuthStateChanged(auth, (user) => {
            listener(user ? sessionFor(user) : null);
          });
        })
        .catch((error: unknown) => {
          if (active) onError?.(error);
        });
      return () => {
        active = false;
        unsubscribe();
      };
    },

    async signIn() {
      const { auth, provider } = await firebaseClient();
      await signInWithPopup(auth, provider);
    },

    async signOut() {
      const { auth } = await firebaseClient();
      await signOut(auth);
    },
  });
}
