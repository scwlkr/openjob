import type { OpenJobRuntimeConfig } from "../runtime-config";
import {
  createSqlCipherTaskListCache,
  purgeLocalDomainCache,
  registerLocalDomainPurgeBoundary,
} from "../domain-cache";
import { NativeAuthCoordinator } from "./coordinator";
import { createFirebaseAuthClient } from "./firebase-rest";
import { createNativeOpenJobApi } from "./openjob-api";
import { createProviderGateway } from "./provider-gateway";
import { createSecureSessionStore } from "./session-store";

export function createNativeAuthController(config: OpenJobRuntimeConfig) {
  const api = createNativeOpenJobApi({ apiBaseUrl: config.apiBaseUrl });
  const qaPasswordTenantId =
    config.environment === "preview" ? config.qaPasswordTenantId : null;
  const firebase = createFirebaseAuthClient({
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
    qaPasswordTenantId,
  });
  const provider = createProviderGateway({
    appleRedirectUri: config.appleRedirectUri,
    appleServiceId: config.appleServiceId,
    googleIosClientId: config.googleIosClientId,
    googleWebClientId: config.googleWebClientId,
  });
  const store = createSecureSessionStore({
    allowQaPassword: qaPasswordTenantId !== null,
    keychainService: config.keychainService,
    storageKey: config.sessionStorageKey,
  });
  const domainCache = createSqlCipherTaskListCache({
    databaseName: `openjob-${config.environment}-task-list-v1.db`,
    keyStorageKey: `openjob.native.cache.${config.environment}.v1`,
    keychainService: `${config.keychainService}.cache`,
  });
  registerLocalDomainPurgeBoundary(() => domainCache.purge());

  return new NativeAuthCoordinator({
    claimUsername: (token, username) =>
      api.claimUsername(token, username),
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
    listGroups: (token) => api.listGroups(token),
    listMembers: (token, groupId) => api.listMembers(token, groupId),
    listSignInMethods: (token) => api.listSignInMethods(token),
    listTasks: (token, groupId, validator) =>
      api.listTasks(token, groupId, validator),
    loadLocalTaskListCache: (ownerUserId) => domainCache.load(ownerUserId),
    loadCleanupPending: () => store.loadCleanupPending(),
    loadStoredSession: () => store.load(),
    markCleanupPending: () => store.markCleanupPending(),
    now: Date.now,
    purgeLocalDomainCache,
    refreshSession: (stored) => firebase.refresh(stored),
    saveStoredSession: (stored) => store.save(stored),
    saveLocalTaskListCache: (entry) => domainCache.save(entry),
    signInWithQaPassword: (email, password) =>
      firebase.signInWithPassword(email, password),
    signInWithProvider: (method) => provider.signIn(method),
    subscribeToCredentialRevocation: (listener) =>
      provider.subscribeToCredentialRevocation(listener),
  });
}
