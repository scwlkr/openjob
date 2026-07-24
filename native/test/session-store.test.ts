import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createSecureSessionStore } from "../src/auth/session-store";

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
  deleteItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const store = createSecureSessionStore({
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
    "openjob.native.auth.preview.v1:cleanup-pending",
    "1",
    {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      keychainService: "dev.openjob.app.preview.auth",
    },
  );
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1:cleanup-pending",
    "1",
  );
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("1");
  await expect(store.loadCleanupPending()).resolves.toBe(true);

  await store.clearCleanupPending();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1:cleanup-pending",
    {
      keychainService: "dev.openjob.app.preview.auth",
    },
  );
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
    "openjob.native.auth.preview.v1:cleanup-pending",
  );
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
