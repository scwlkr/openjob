import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createSecureSessionStore } from "../src/auth/session-store";

jest.mock("expo-secure-store", () => {
  function ensureValidKey(key: string) {
    if (!/^[\w.-]+$/u.test(key)) {
      throw new Error("Invalid SecureStore key");
    }
  }

  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
    deleteItemAsync: jest.fn(async (key: string) => {
      ensureValidKey(key);
    }),
    getItemAsync: jest.fn(async (key: string) => {
      ensureValidKey(key);
      return null;
    }),
    setItemAsync: jest.fn(async (key: string) => {
      ensureValidKey(key);
    }),
  };
});

const store = createSecureSessionStore({
  allowQaPassword: true,
  keychainService: "dev.openjob.app.preview.auth",
  storageKey: "openjob.native.auth.preview.v1",
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test("stores only a versioned provider refresh credential with device-only accessibility", async () => {
  await store.save({
    provider: "apple",
    refreshToken: "refresh-only",
    version: 1,
  });

  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1",
    JSON.stringify({
      provider: "apple",
      refreshToken: "refresh-only",
      version: 1,
    }),
    {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      keychainService: "dev.openjob.app.preview.auth",
    },
  );
  expect(JSON.stringify((SecureStore.setItemAsync as jest.Mock).mock.calls)).not.toContain(
    "idToken",
  );
});

test.each(["prepared", "submitting", "completed"] as const)(
  "stores a %s deletion receipt in a separate device-only protected entry",
  async (phase) => {
    const receipt = {
      phase,
      statusToken: "v1.deletionStatusCapability.signaturePayload",
      version: 1 as const,
    };

    await store.saveDeletionReceipt(receipt);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "openjob.native.auth.preview.v1.deletion-receipt",
      JSON.stringify(receipt),
      {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        keychainService: "dev.openjob.app.preview.auth",
      },
    );
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(receipt.statusToken),
    );

    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
      JSON.stringify(receipt),
    );
    await expect(store.loadDeletionReceipt()).resolves.toEqual(receipt);

    await store.clearDeletionReceipt();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      "openjob.native.auth.preview.v1.deletion-receipt",
      { keychainService: "dev.openjob.app.preview.auth" },
    );
  },
);

test("fails closed without deleting a malformed protected deletion receipt", async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
    JSON.stringify({
      phase: "prepared",
      statusToken: "invalid-capability",
      version: 1,
    }),
  );

  await expect(store.loadDeletionReceipt()).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1.deletion-receipt",
    expect.anything(),
  );
});

test.each([
  ["an unknown phase", { phase: "unknown" }],
  ["extra status metadata", { deadline: "2026-08-04T12:00:00.000Z" }],
])("fails closed for a deletion receipt with %s", async (_name, override) => {
  const receipt = {
    phase: "prepared",
    statusToken: "v1.deletionStatusCapability.signaturePayload",
    version: 1,
    ...override,
  };
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
    JSON.stringify(receipt),
  );

  await expect(store.loadDeletionReceipt()).rejects.toMatchObject({
    code: "unavailable",
  });
  await expect(
    store.saveDeletionReceipt(
      receipt as Parameters<typeof store.saveDeletionReceipt>[0],
    ),
  ).rejects.toMatchObject({ code: "unavailable" });
});

test("stores and restores the Preview-only QA refresh credential", async () => {
  const session = {
    provider: "qa-password" as const,
    refreshToken: "qa-refresh-only",
    version: 1 as const,
  };
  await store.save(session);
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
    JSON.stringify(session),
  );

  await expect(store.load()).resolves.toEqual(session);
});

test("stores and restores a canonical owner binding without access tokens", async () => {
  const session = {
    ownerUserId: "usr_one",
    provider: "google" as const,
    refreshToken: "refresh-only",
    version: 2 as const,
  };

  await store.save(session);
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
    JSON.stringify(session),
  );

  await expect(store.load()).resolves.toEqual(session);
  const serialized = JSON.stringify(
    (SecureStore.setItemAsync as jest.Mock).mock.calls,
  );
  expect(serialized).toContain("usr_one");
  expect(serialized).not.toContain("idToken");
});

test("rejects Preview QA credentials when password auth is not configured", async () => {
  const disabledStore = createSecureSessionStore({
    allowQaPassword: false,
    keychainService: "dev.openjob.app.auth",
    storageKey: "openjob.native.auth.production.v1",
  });
  const session = {
    provider: "qa-password" as const,
    refreshToken: "qa-refresh-only",
    version: 1 as const,
  };

  await expect(disabledStore.save(session)).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();

  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
    JSON.stringify(session),
  );
  await expect(disabledStore.load()).resolves.toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
    "openjob.native.auth.production.v1",
    { keychainService: "dev.openjob.app.auth" },
  );
});

test("removes corrupt or unsupported stored credentials", async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
    JSON.stringify({
      provider: "google",
      refreshToken: "",
      version: 2,
    }),
  );

  await expect(store.load()).resolves.toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1",
    {
      keychainService: "dev.openjob.app.preview.auth",
    },
  );
});

test("deletes the credential from the same isolated Keychain or Keystore service", async () => {
  await store.clear();

  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1",
    {
      keychainService: "dev.openjob.app.preview.auth",
    },
  );
});

test("persists and clears a device-only cleanup marker across relaunch", async () => {
  await store.markCleanupPending();

  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1.cleanup-pending",
    "1",
    {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      keychainService: "dev.openjob.app.preview.auth",
    },
  );
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1.cleanup-pending",
    "1",
  );
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("1");
  await expect(store.loadCleanupPending()).resolves.toBe(true);

  await store.clearCleanupPending();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1.cleanup-pending",
    {
      keychainService: "dev.openjob.app.preview.auth",
    },
  );
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1.cleanup-pending",
  );
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1:cleanup-pending",
  );
});

test("detects and clears the legacy AsyncStorage-only cleanup marker", async () => {
  const legacyKey = "openjob.native.auth.preview.v1:cleanup-pending";
  await AsyncStorage.setItem(legacyKey, "1");

  await expect(store.loadCleanupPending()).resolves.toBe(true);
  await store.clearCleanupPending();

  await expect(AsyncStorage.getItem(legacyKey)).resolves.toBeNull();
  for (const operation of [
    SecureStore.getItemAsync,
    SecureStore.deleteItemAsync,
  ]) {
    for (const [key] of (operation as jest.Mock).mock.calls) {
      expect(key).toMatch(/^[\w.-]+$/u);
    }
  }
});

test("uses the non-secret marker fallback when protected marker storage fails", async () => {
  (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(
    new Error("Keychain unavailable"),
  );
  await expect(store.markCleanupPending()).resolves.toBeUndefined();

  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("1");
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(
    new Error("Keychain unavailable"),
  );
  await expect(store.loadCleanupPending()).resolves.toBe(true);
});

test.each([
  ["AsyncStorage", null, new Error("Keychain unavailable")],
  ["SecureStore", new Error("AsyncStorage unavailable"), null],
])("fails closed when the %s marker read is the only successful read", async (
  _backend,
  asyncResult,
  secureResult,
) => {
  if (asyncResult instanceof Error) {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(asyncResult);
  } else {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(asyncResult);
  }
  if (secureResult instanceof Error) {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(
      secureResult,
    );
  } else {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
      secureResult,
    );
  }

  await expect(store.loadCleanupPending()).rejects.toMatchObject({
    code: "unavailable",
  });
});

test("reports protected storage failure instead of treating it as a signed-out device", async () => {
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(
    new Error("Keychain unavailable"),
  );

  await expect(store.load()).rejects.toMatchObject({
    code: "unavailable",
  });
});
