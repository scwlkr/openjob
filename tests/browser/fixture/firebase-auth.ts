const SESSION_KEY = "openjob-test:firebase-session";
const PERSISTENCE_KEY = "openjob-test:firebase-persistence";
const PRIMARY_AUTH_NAME = "openjob-web";
const auths = new Map<string, TestAuth>();
const listeners = new Map<TestAuth, Set<(user: TestUser | null) => void>>();
const failedPopupScenarios = new Set<string>();
let signOutFailed = false;
let initializationFailed = false;
let releaseSecondaryPopup: (() => void) | null = null;

type SignInMethod = "apple" | "google";
type TestApp = { name: string };
type TestAuth = {
  name: string;
  currentUser: TestUser | null;
};
type TestProvider = {
  customParameters?: Record<string, string>;
  providerId: "apple.com" | "google.com";
};
type TestUser = {
  providerData: Array<{ providerId: TestProvider["providerId"] }>;
  getIdToken(): Promise<string>;
  getIdTokenResult(): Promise<{ signInProvider: TestProvider["providerId"] }>;
};

function methodFor(provider: TestProvider): SignInMethod {
  return provider.providerId === "apple.com" ? "apple" : "google";
}

function userFor(method: SignInMethod, fresh: boolean): TestUser {
  const multiProvider =
    new URLSearchParams(window.location.search).get("scenario") ===
    "multi-provider";
  const providerId = method === "apple" ? "apple.com" : "google.com";
  return {
    providerData: multiProvider
      ? [{ providerId: "apple.com" }, { providerId: "google.com" }]
      : [{ providerId }],
    async getIdToken() {
      const tokenError = !fresh
        ? window.sessionStorage.getItem("openjob-test:token-error")
        : null;
      if (tokenError) {
        throw Object.assign(new Error("Test Firebase credential failure."), {
          code: tokenError,
        });
      }
      return fresh
        ? `browser-fresh-${method}-token`
        : "browser-test-token";
    },
    async getIdTokenResult() {
      const tokenError = window.sessionStorage.getItem(
        fresh
          ? "openjob-test:fresh-token-result-error"
          : "openjob-test:token-result-error",
      );
      if (tokenError) {
        throw Object.assign(new Error("Test Firebase session failure."), {
          code: tokenError,
        });
      }
      return { signInProvider: providerId };
    },
  };
}

function authFor(app?: TestApp) {
  const name = app?.name ?? "[DEFAULT]";
  const existing = auths.get(name);
  if (existing) return existing;
  const auth = { name, currentUser: null };
  auths.set(name, auth);
  return auth;
}

function currentUser(auth: TestAuth) {
  if (auth.name !== PRIMARY_AUTH_NAME) return auth.currentUser;
  const stored = window.localStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  return userFor(stored === "apple" ? "apple" : "google", false);
}

function emit(auth: TestAuth) {
  for (const listener of listeners.get(auth) ?? []) {
    listener(currentUser(auth));
  }
}

function popupFailure(auth: TestAuth) {
  const scenario = new URLSearchParams(window.location.search).get("scenario");
  if (
    scenario !== "auth-cancel" &&
    scenario !== "auth-interrupted" &&
    scenario !== "auth-offline" &&
    scenario !== "auth-provider-error"
  ) {
    return null;
  }
  const key = `${auth.name}:${scenario}`;
  if (failedPopupScenarios.has(key)) return null;
  failedPopupScenarios.add(key);
  const code = scenario === "auth-cancel"
    ? "auth/popup-closed-by-user"
    : scenario === "auth-interrupted"
      ? "auth/cancelled-popup-request"
      : scenario === "auth-offline"
        ? "auth/network-request-failed"
        : "auth/provider-error";
  return Object.assign(new Error("Test provider interruption."), { code });
}

export const browserLocalPersistence = { type: "LOCAL" };
export const inMemoryPersistence = { type: "NONE" };

export class GoogleAuthProvider implements TestProvider {
  readonly providerId = "google.com";

  setCustomParameters(parameters: Record<string, string>) {
    this.customParameters = parameters;
  }

  customParameters?: Record<string, string>;
}

export class OAuthProvider implements TestProvider {
  readonly providerId: "apple.com";

  constructor(providerId: string) {
    if (providerId !== "apple.com") {
      throw new Error("Only Apple is supported by the browser auth fixture.");
    }
    this.providerId = providerId;
  }

  setCustomParameters(parameters: Record<string, string>) {
    this.customParameters = parameters;
  }

  customParameters?: Record<string, string>;
}

export function getAuth(app?: TestApp) {
  return authFor(app);
}

export async function setPersistence(
  auth: TestAuth,
  persistence: { type: string },
) {
  if (
    new URLSearchParams(window.location.search).get("scenario") === "auth-error" &&
    !initializationFailed
  ) {
    initializationFailed = true;
    throw new Error("Test Firebase initialization failure.");
  }
  if (auth.name === PRIMARY_AUTH_NAME) {
    window.localStorage.setItem(PERSISTENCE_KEY, persistence.type);
  }
}

export function onAuthStateChanged(
  auth: TestAuth,
  listener: (user: TestUser | null) => void,
) {
  const authListeners = listeners.get(auth) ?? new Set();
  authListeners.add(listener);
  listeners.set(auth, authListeners);
  queueMicrotask(() => {
    if (authListeners.has(listener)) listener(currentUser(auth));
  });
  return () => authListeners.delete(listener);
}

export async function signInWithPopup(
  auth: TestAuth,
  provider: TestProvider,
) {
  const failure = popupFailure(auth);
  if (failure) throw failure;
  if (
    auth.name !== PRIMARY_AUTH_NAME &&
    window.sessionStorage.getItem(
      "openjob-test:defer-secondary-popup",
    ) === "true"
  ) {
    await new Promise<void>((resolve) => {
      releaseSecondaryPopup = resolve;
    });
    releaseSecondaryPopup = null;
  }
  const method = methodFor(provider);
  const prompt = provider.customParameters?.prompt;
  if (prompt) {
    window.sessionStorage.setItem("openjob-test:provider-prompt", prompt);
  }
  const user = userFor(method, auth.name !== PRIMARY_AUTH_NAME);
  if (auth.name === PRIMARY_AUTH_NAME) {
    window.localStorage.setItem(SESSION_KEY, method);
  } else {
    auth.currentUser = user;
  }
  emit(auth);
  return { user };
}

export async function signOut(auth: TestAuth) {
  if (
    auth.name !== PRIMARY_AUTH_NAME &&
    window.sessionStorage.getItem(
      "openjob-test:secondary-signout-failure",
    ) === "once"
  ) {
    window.sessionStorage.removeItem(
      "openjob-test:secondary-signout-failure",
    );
    throw new Error("Test secondary credential cleanup failure.");
  }
  if (
    auth.name === PRIMARY_AUTH_NAME &&
    new URLSearchParams(window.location.search).get("scenario") ===
      "signout-failure" &&
    !signOutFailed
  ) {
    signOutFailed = true;
    throw new Error("Test browser credential cleanup failure.");
  }
  if (auth.name === PRIMARY_AUTH_NAME) {
    window.localStorage.removeItem(SESSION_KEY);
  } else {
    auth.currentUser = null;
  }
  emit(auth);
}

(window as typeof window & {
  __openjobFirebaseTest: {
    emitPrimarySignedOut(): void;
    releaseSecondaryPopup(): void;
    secondarySignedIn(): boolean;
  };
}).__openjobFirebaseTest = {
  emitPrimarySignedOut() {
    window.localStorage.removeItem(SESSION_KEY);
    emit(authFor({ name: PRIMARY_AUTH_NAME }));
  },
  releaseSecondaryPopup() {
    releaseSecondaryPopup?.();
  },
  secondarySignedIn() {
    return Boolean(
      authFor({ name: "openjob-web-secondary" }).currentUser,
    );
  },
};
