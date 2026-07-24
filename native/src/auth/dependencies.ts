import type { OpenJobRuntimeConfig } from "../runtime-config";
import { purgeLocalDomainCache } from "../domain-cache";
import { NativeAuthCoordinator } from "./coordinator";
import { createFirebaseAuthClient } from "./firebase-rest";
import { createNativeOpenJobApi } from "./openjob-api";
import { createProviderGateway } from "./provider-gateway";
import { createSecureSessionStore } from "./session-store";

export function createNativeAuthController(config: OpenJobRuntimeConfig) {
  const api = createNativeOpenJobApi({ apiBaseUrl: config.apiBaseUrl });
  const firebase = createFirebaseAuthClient({
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
  });
  const provider = createProviderGateway({
    appleRedirectUri: config.appleRedirectUri,
    appleServiceId: config.appleServiceId,
    googleIosClientId: config.googleIosClientId,
    googleWebClientId: config.googleWebClientId,
  });
  const store = createSecureSessionStore({
    keychainService: config.keychainService,
    storageKey: config.sessionStorageKey,
  });

  return new NativeAuthCoordinator({
    clearCleanupPending: () => store.clearCleanupPending(),
    clearProviderSession: () => provider.clearSession(),
    clearStoredSession: () => store.clear(),
    createUser: (token) => api.createUser(token),
    exchangeProviderCredential: (credential) =>
      firebase.exchange(credential),
    getMe: (token) => api.getMe(token),
    linkSignInMethod: (token, credentialToken, expectedTargetUserId) =>
      api.linkSignInMethod(
        token,
        credentialToken,
        expectedTargetUserId,
      ),
    listSignInMethods: (token) => api.listSignInMethods(token),
    loadCleanupPending: () => store.loadCleanupPending(),
    loadStoredSession: () => store.load(),
    markCleanupPending: () => store.markCleanupPending(),
    now: Date.now,
    purgeLocalDomainCache,
    refreshSession: (stored) => firebase.refresh(stored),
    saveStoredSession: (stored) => store.save(stored),
    signInWithProvider: (method) => provider.signIn(method),
    subscribeToCredentialRevocation: (listener) =>
      provider.subscribeToCredentialRevocation(listener),
  });
}
