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
import type { AuthSession, OpenJobAuth } from "./openjob-app";

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
  clientPromise ??= (async () => {
    const app =
      getApps().find((candidate) => candidate.name === "openjob-web") ??
      initializeApp(firebaseConfig, "openjob-web");
    const auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
    return { auth, provider: new GoogleAuthProvider() };
  })();
  return clientPromise;
}

function sessionFor(user: { getIdToken(): Promise<string> }): AuthSession {
  return { getIdToken: () => user.getIdToken() };
}

export function createFirebaseAuth(): OpenJobAuth {
  return Object.freeze({
    observe(listener) {
      let active = true;
      let unsubscribe: () => void = () => undefined;
      void firebaseClient().then(({ auth }) => {
        if (!active) return;
        unsubscribe = onAuthStateChanged(auth, (user) => {
          listener(user ? sessionFor(user) : null);
        });
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
