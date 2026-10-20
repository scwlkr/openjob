import { createNativePersonalWorkspaceApi } from "../personal-workspace-api";
import { createNativeConnectedWorkspaceApi } from '../connected-workspaces-api';
import { createSqlCipherOfflineWorkspaceCache } from '../offline-workspace-cache';
import * as Crypto from 'expo-crypto';
import {
  readNativeApplicationId,
  type OpenJobRuntimeConfig,
} from "../runtime-config";
import {
  createSqlCipherTaskListCache,
  purgeLocalDomainCache,
  registerLocalDomainPurgeBoundary,
} from "../domain-cache";
import { NativeAuthCoordinator } from "./coordinator";
import { createFirebaseAuthClient } from "./firebase-rest";
import { createNativeOpenJobApi } from "./openjob-api";
import {
  clearNativeProviderSessionWithoutConfiguration,
  createProviderGateway,
} from "./provider-gateway";
import { createSecureSessionStore } from "./session-store";

const fallbackLocalIdentities = {
  "dev.openjob.app": "production",
  "dev.openjob.app.dev": "development",
  "dev.openjob.app.preview": "preview",
} as const;

export async function purgeNativeAuthStateWithoutRuntimeConfig() {
  const applicationId = readNativeApplicationId();
  const environment = applicationId
    ? fallbackLocalIdentities[
        applicationId as keyof typeof fallbackLocalIdentities
      ]
    : undefined;
  if (!applicationId || !environment) {
    throw new Error("OpenJob could not identify its local credential boundary.");
  }

  const keychainService = `${applicationId}.auth`;
  const store = createSecureSessionStore({
    allowQaPassword: environment === "preview",
    keychainService,
    storageKey: `openjob.native.auth.${environment}.v1`,
  });
  const domainCache = createSqlCipherTaskListCache({
    databaseName: `openjob-${environment}-task-list-v1.db`,
    keyStorageKey: `openjob.native.cache.${environment}.v1`,
    keychainService: `${keychainService}.cache`,
  });
  const personalCache = createSqlCipherOfflineWorkspaceCache({ databaseName: `openjob-${environment}-personal-offline-v1.db`, keyStorageKey: `openjob.native.personal-offline.${environment}.v1`, keychainService: `${keychainService}.personal-offline` });

  let marked = false;
  try {
    await store.markCleanupPending();
    marked = true;
  } catch {
    // The actual cleanup still runs if neither marker store is writable.
  }
  const cleanup = await Promise.allSettled([
    clearNativeProviderSessionWithoutConfiguration(),
    domainCache.purge(),
    personalCache.purge(),
    store.clear(),
  ]);
  const failures = cleanup.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "OpenJob could not fully clear local authentication state.",
    );
  }
  if (marked) await store.clearCleanupPending();
}

export function createNativeAuthController(config: OpenJobRuntimeConfig) {
  const api = createNativeOpenJobApi({ apiBaseUrl: config.apiBaseUrl });
  const personalWorkspace = createNativePersonalWorkspaceApi({ apiBaseUrl: config.apiBaseUrl });
  const qaPasswordTenantId =
    config.environment === "preview" ? config.qaPasswordTenantId : null;
  const firebase = createFirebaseAuthClient({
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
    qaPasswordTenantId,
  });
  const provider = createProviderGateway({
    appleIosClientId: readNativeApplicationId() ?? "",
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
  const personalCache = createSqlCipherOfflineWorkspaceCache({ databaseName: `openjob-${config.environment}-personal-offline-v1.db`, keyStorageKey: `openjob.native.personal-offline.${config.environment}.v1`, keychainService: `${config.keychainService}.personal-offline` });
  registerLocalDomainPurgeBoundary(async () => {
    const results = await Promise.allSettled([domainCache.purge(), personalCache.purge()]);
    if (results.some(result => result.status === 'rejected')) throw new Error('Could not purge local domain caches.');
  });

  return new NativeAuthCoordinator({
    ...personalWorkspace,
    connectedWorkspaces: createNativeConnectedWorkspaceApi({ apiBaseUrl: config.apiBaseUrl }),
    personalOfflineCache: personalCache,
    loadPersonalOfflineCache: (owner, guard) => personalCache.load(owner, guard),
    offlineRandomUUID: Crypto.randomUUID,
    claimUsername: (token, username) =>
      api.claimUsername(token, username),
    clearCleanupPending: () => store.clearCleanupPending(),
    clearDeletionReceipt: () => store.clearDeletionReceipt(),
    clearProviderSession: () => provider.clearSession(),
    clearStoredSession: () => store.clear(),
    createUser: (token) => api.createUser(token),
    deleteUser: (token, credentials, statusToken) =>
      api.deleteUser(token, credentials, statusToken),
    exchangeProviderCredential: (credential) =>
      firebase.exchange(credential),
    getMe: (token) => api.getMe(token),
    getDeletionStatus: (statusToken) =>
      api.getDeletionStatus(statusToken),
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
    loadDeletionReceipt: () => store.loadDeletionReceipt(),
    loadStoredSession: () => store.load(),
    markCleanupPending: () => store.markCleanupPending(),
    now: Date.now,
    prepareDeletionStatus: (token, credential) =>
      api.prepareDeletionStatus(token, credential),
    purgeLocalDomainCache,
    refreshDeletionProvider: (statusToken, credential) =>
      api.refreshDeletionProvider(statusToken, credential),
    refreshSession: (stored) => firebase.refresh(stored),
    saveStoredSession: (stored) => store.save(stored),
    saveDeletionReceipt: (receipt) =>
      store.saveDeletionReceipt(receipt),
    saveLocalTaskListCache: (entry) => domainCache.save(entry),
    signInWithQaPassword: (email, password) =>
      firebase.signInWithPassword(email, password),
    signInWithProvider: (method) => provider.signIn(method),
    subscribeToCredentialRevocation: (listener) =>
      provider.subscribeToCredentialRevocation(listener),
  });
}
