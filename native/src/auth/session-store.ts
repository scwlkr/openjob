import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  ProviderSignInError,
  type StoredSession,
} from "./coordinator";

type SecureSessionStoreConfig = {
  allowQaPassword: boolean;
  keychainService: string;
  storageKey: string;
};

function isStoredSession(
  value: unknown,
  allowQaPassword: boolean,
): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StoredSession>;
  return (
    session.version === 1 &&
    (session.provider === "apple" ||
      session.provider === "google" ||
      (allowQaPassword && session.provider === "qa-password")) &&
    typeof session.refreshToken === "string" &&
    session.refreshToken.length > 0
  );
}

export function createSecureSessionStore({
  allowQaPassword,
  keychainService,
  storageKey,
}: SecureSessionStoreConfig) {
  const sharedOptions = { keychainService };
  const cleanupStorageKey = `${storageKey}.cleanup-pending`;
  const legacyCleanupStorageKey = `${storageKey}:cleanup-pending`;
  const protectedOptions = {
    ...sharedOptions,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };

  return {
    async clear() {
      await SecureStore.deleteItemAsync(storageKey, sharedOptions);
    },

    async load(): Promise<StoredSession | null> {
      let serialized: string | null;
      try {
        serialized = await SecureStore.getItemAsync(storageKey, sharedOptions);
      } catch {
        throw new ProviderSignInError("unavailable");
      }
      if (!serialized) return null;

      try {
        const session: unknown = JSON.parse(serialized);
        if (isStoredSession(session, allowQaPassword)) return session;
      } catch {
        // Corrupt credentials are removed below.
      }
      await SecureStore.deleteItemAsync(storageKey, sharedOptions);
      return null;
    },

    async loadCleanupPending() {
      const results = await Promise.allSettled([
        AsyncStorage.getItem(cleanupStorageKey),
        AsyncStorage.getItem(legacyCleanupStorageKey),
        SecureStore.getItemAsync(cleanupStorageKey, sharedOptions),
      ]);
      if (
        results.some(
          (result) =>
            result.status === "fulfilled" && result.value !== null,
        )
      ) {
        return true;
      }
      if (results.some((result) => result.status === "rejected")) {
        throw new ProviderSignInError("unavailable");
      }
      return false;
    },

    async markCleanupPending() {
      const results = await Promise.allSettled([
        AsyncStorage.setItem(cleanupStorageKey, "1"),
        SecureStore.setItemAsync(
          cleanupStorageKey,
          "1",
          protectedOptions,
        ),
      ]);
      if (results.every((result) => result.status === "rejected")) {
        throw new ProviderSignInError("unavailable");
      }
    },

    async clearCleanupPending() {
      const results = await Promise.allSettled([
        AsyncStorage.removeItem(cleanupStorageKey),
        AsyncStorage.removeItem(legacyCleanupStorageKey),
        SecureStore.deleteItemAsync(cleanupStorageKey, sharedOptions),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        throw new ProviderSignInError("unavailable");
      }
    },

    async save(session: StoredSession) {
      if (session.provider === "qa-password" && !allowQaPassword) {
        throw new ProviderSignInError("unavailable");
      }
      await SecureStore.setItemAsync(
        storageKey,
        JSON.stringify(session),
        protectedOptions,
      );
    },
  };
}
