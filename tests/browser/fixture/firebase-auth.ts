const SESSION_KEY = "openjob-test:firebase-session";
const PERSISTENCE_KEY = "openjob-test:firebase-persistence";
const listeners = new Set<(user: TestUser | null) => void>();
const auth = {};
let initializationFailed = false;

type TestUser = { getIdToken(): Promise<string> };

const user: TestUser = {
  async getIdToken() {
    return "browser-test-token";
  },
};

function currentUser() {
  return window.localStorage.getItem(SESSION_KEY) ? user : null;
}

function emit() {
  for (const listener of listeners) listener(currentUser());
}

export const browserLocalPersistence = { type: "LOCAL" };

export class GoogleAuthProvider {
  static credentialFromResult() {
    return { idToken: "google-browser-process-only-secret" };
  }
}

export function getAuth() {
  return auth;
}

export async function setPersistence(
  _auth: unknown,
  persistence: { type: string },
) {
  if (
    new URLSearchParams(window.location.search).get("scenario") === "auth-error" &&
    !initializationFailed
  ) {
    initializationFailed = true;
    throw new Error("Test Firebase initialization failure.");
  }
  window.localStorage.setItem(PERSISTENCE_KEY, persistence.type);
}

export function onAuthStateChanged(
  _auth: unknown,
  listener: (user: TestUser | null) => void,
) {
  listeners.add(listener);
  queueMicrotask(() => {
    if (listeners.has(listener)) listener(currentUser());
  });
  return () => listeners.delete(listener);
}

export async function signInWithPopup() {
  window.localStorage.setItem(SESSION_KEY, "signed-in");
  emit();
  return { user };
}

export async function signOut() {
  window.localStorage.removeItem(SESSION_KEY);
  emit();
}
