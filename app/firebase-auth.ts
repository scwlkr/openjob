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
declare const __OPENJOB_APPLE_SERVICE_ID__: string;

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

async function primaryCredentialProof(
  method: SignInMethod,
  result: Awaited<ReturnType<typeof signInWithPopup>>,
): Promise<AuthCredentialProof | null> {
  const session = await sessionFor(result.user);
  if (session.signInMethod !== method) {
    throw new Error("Firebase returned a different Sign-in Method.");
  }
  const providerCredential = method === "google"
    ? GoogleAuthProvider.credentialFromResult(result)
    : OAuthProvider.credentialFromResult(result);
  let providerAccessToken = providerCredential?.accessToken ?? null;
  let providerIdToken = providerCredential?.idToken ?? null;
  if (!providerAccessToken || (method === "google" && !providerIdToken)) {
    return null;
  }
  let disposed = false;
  const requireActive = () => {
    if (disposed || !providerAccessToken) {
      throw new Error("The provider sign-in proof is no longer active.");
    }
    return providerAccessToken;
  };
  const base = {
    async dispose() {
      disposed = true;
      providerAccessToken = null;
      providerIdToken = null;
    },
    getIdToken() {
      requireActive();
      return session.getIdToken();
    },
  };
  return method === "apple"
    ? {
        ...base,
        signInMethod: "apple",
        async getRevocationProof() {
          return {
            clientId: __OPENJOB_APPLE_SERVICE_ID__,
            kind: "access_token" as const,
            value: requireActive(),
          };
        },
      }
    : {
        ...base,
        signInMethod: "google",
        async getRevocationProof() {
          const idToken = providerIdToken;
          if (!idToken) {
            throw new Error("The provider sign-in proof is no longer active.");
          }
          return {
            idToken,
            kind: "access_token" as const,
            value: requireActive(),
          };
        },
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
      const result = await signInWithPopup(
        auth,
        providerFor(method, forceAccountSelection),
      );
      forceAccountSelection = false;
      return primaryCredentialProof(method, result);
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
          const providerCredential =
            method === "google"
              ? GoogleAuthProvider.credentialFromResult(result)
              : OAuthProvider.credentialFromResult(result);
          const providerAccessToken = providerCredential?.accessToken;
          const providerIdToken = providerCredential?.idToken;
          if (
            !providerAccessToken ||
            (method === "google" && !providerIdToken)
          ) {
            throw new Error("The provider did not return revocation proof.");
          }
          if (session.signInMethod !== method) {
            throw new Error(
              "Firebase returned a different Sign-in Method.",
            );
          }
          activeSecondaryGeneration = generation;
          let disposed = false;
          const dispose = async () => {
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
          };
          const proof: AuthCredentialProof = method === "apple"
            ? {
                dispose,
                signInMethod: "apple",
                getIdToken: session.getIdToken,
                async getRevocationProof() {
                  return {
                    clientId: __OPENJOB_APPLE_SERVICE_ID__,
                    kind: "access_token",
                    value: providerAccessToken,
                  };
                },
              }
            : {
                dispose,
                signInMethod: "google",
                getIdToken: session.getIdToken,
                async getRevocationProof() {
                  return {
                    idToken: providerIdToken ?? "",
                    kind: "access_token",
                    value: providerAccessToken,
                  };
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
