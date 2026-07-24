import { getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  OAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import type {
  AuthenticationMethod,
  AuthCredentialProof,
  AuthSession,
  OpenJobAuth,
  SignInMethod,
} from "./openjob-contracts";

declare const __OPENJOB_FIREBASE_CONFIG__: {
  apiKey: string;
  appId: string;
  authDomain: string;
  projectId: string;
};
declare const __OPENJOB_QA_PASSWORD_AUTH__: {
  tenantId: string;
} | null;

const firebaseConfig = __OPENJOB_FIREBASE_CONFIG__;
const qaPasswordAuth = __OPENJOB_QA_PASSWORD_AUTH__;

let clientPromise:
  | Promise<{ auth: ReturnType<typeof getAuth> }>
  | undefined;
let secondaryClientPromise:
  | Promise<{ auth: ReturnType<typeof getAuth> }>
  | undefined;

function firebaseClient() {
  if (clientPromise) return clientPromise;
  const pending = (async () => {
    const app =
      getApps().find((candidate) => candidate.name === "openjob-web") ??
      initializeApp(firebaseConfig, "openjob-web");
    const auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
    return { auth };
  })();
  clientPromise = pending;
  void pending.catch(() => {
    if (clientPromise === pending) clientPromise = undefined;
  });
  return pending;
}

function secondaryFirebaseClient() {
  if (secondaryClientPromise) return secondaryClientPromise;
  const pending = (async () => {
    const app =
      getApps().find((candidate) => candidate.name === "openjob-web-secondary") ??
      initializeApp(firebaseConfig, "openjob-web-secondary");
    const auth = getAuth(app);
    await setPersistence(auth, inMemoryPersistence);
    return { auth };
  })();
  secondaryClientPromise = pending;
  void pending.catch(() => {
    if (secondaryClientPromise === pending) secondaryClientPromise = undefined;
  });
  return pending;
}

function providerFor(method: SignInMethod, fresh = false) {
  const provider =
    method === "google"
      ? new GoogleAuthProvider()
      : new OAuthProvider("apple.com");
  if (fresh) {
    provider.setCustomParameters({
      prompt: method === "google" ? "select_account" : "login",
    });
  }
  return provider;
}

function signInMethodFor(
  providerId: string | null,
  tenantId: string | null,
): AuthenticationMethod {
  if (providerId === "apple.com") return "apple";
  if (providerId === "google.com") return "google";
  if (
    providerId === "password" &&
    qaPasswordAuth &&
    tenantId === qaPasswordAuth.tenantId
  ) {
    return "qa-password";
  }
  throw new Error("Firebase returned an unsupported Sign-in Method.");
}

async function sessionFor(user: {
  tenantId: string | null;
  getIdToken(): Promise<string>;
  getIdTokenResult(): Promise<{ signInProvider: string | null }>;
}): Promise<AuthSession> {
  const token = await user.getIdTokenResult();
  return {
    signInMethod: signInMethodFor(token.signInProvider, user.tenantId),
    getIdToken: () => user.getIdToken(),
  };
}

export function createFirebaseAuth(): OpenJobAuth {
  let forceAccountSelection = false;
  let secondaryGeneration = 0;
  let activeSecondaryGeneration: number | null = null;
  let secondaryOperationTail = Promise.resolve();

  function enqueueSecondaryOperation<Result>(
    operation: () => Promise<Result>,
  ) {
    const result = secondaryOperationTail.then(operation, operation);
    secondaryOperationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function clearSecondarySession() {
    secondaryGeneration += 1;
    activeSecondaryGeneration = null;
    const pending = secondaryClientPromise;
    if (!pending) return;
    await enqueueSecondaryOperation(async () => {
      const { auth } = await pending;
      await signOut(auth);
    });
  }

  return Object.freeze({
    qaPasswordEnabled: qaPasswordAuth !== null,

    observe(listener, onError) {
      let active = true;
      let emission = 0;
      let unsubscribe: () => void = () => undefined;
      void firebaseClient()
        .then(({ auth }) => {
          if (!active) return;
          unsubscribe = onAuthStateChanged(auth, (user) => {
            const currentEmission = ++emission;
            if (!user) {
              listener(null);
              return;
            }
            void sessionFor(user)
              .then((session) => {
                if (active && currentEmission === emission) listener(session);
              })
              .catch((error: unknown) => {
                if (active && currentEmission === emission) onError?.(error);
              });
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

    async signIn(method) {
      const { auth } = await firebaseClient();
      await signInWithPopup(
        auth,
        providerFor(method, forceAccountSelection),
      );
      forceAccountSelection = false;
    },

    async signInWithQaPassword(email, password) {
      if (!qaPasswordAuth) {
        throw Object.assign(
          new Error("Preview QA password sign-in is unavailable."),
          { code: "auth/operation-not-allowed" },
        );
      }
      const { auth } = await firebaseClient();
      const previousTenantId = auth.tenantId;
      try {
        auth.tenantId = qaPasswordAuth.tenantId;
        const result = await signInWithEmailAndPassword(
          auth,
          email,
          password,
        );
        if (result.user.tenantId !== qaPasswordAuth.tenantId) {
          await signOut(auth);
          throw new Error("Firebase returned an unexpected tenant.");
        }
      } finally {
        auth.tenantId = previousTenantId;
      }
    },

    async authenticateForLink(method) {
      const generation = ++secondaryGeneration;
      activeSecondaryGeneration = null;
      return enqueueSecondaryOperation(async () => {
        const { auth } = await secondaryFirebaseClient();
        try {
          await signOut(auth);
          const result = await signInWithPopup(
            auth,
            providerFor(method, true),
          );
          if (generation !== secondaryGeneration) {
            throw Object.assign(
              new Error("The provider sign-in is no longer active."),
              { code: "auth/cancelled-popup-request" },
            );
          }
          const session = await sessionFor(result.user);
          if (session.signInMethod !== method) {
            throw new Error(
              "Firebase returned a different Sign-in Method.",
            );
          }
          activeSecondaryGeneration = generation;
          let disposed = false;
          const proof: AuthCredentialProof = {
            signInMethod: method,
            getIdToken: session.getIdToken,
            async dispose() {
              if (disposed) return;
              await enqueueSecondaryOperation(async () => {
                if (disposed) return;
                if (activeSecondaryGeneration !== generation) {
                  disposed = true;
                  return;
                }
                await signOut(auth);
                if (activeSecondaryGeneration === generation) {
                  activeSecondaryGeneration = null;
                }
                disposed = true;
              });
            },
          };
          return proof;
        } catch (error) {
          await signOut(auth);
          throw error;
        }
      });
    },

    async signOut() {
      forceAccountSelection = false;
      const { auth } = await firebaseClient();
      await clearSecondarySession();
      await signOut(auth);
    },

    async switchUser() {
      forceAccountSelection = true;
      const { auth } = await firebaseClient();
      await clearSecondarySession();
      await signOut(auth);
    },
  });
}
