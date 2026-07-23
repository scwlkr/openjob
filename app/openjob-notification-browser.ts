import type { BrowserPushSubscription } from "./openjob-contracts";
import { VAPID_PUBLIC_KEY } from "../shared/push";

const LOCAL_STATE_KEY = "openjob:notification-installation";
const DATABASE_NAME = "openjob-notifications";
const DATABASE_STORE = "installation-state";
const DATABASE_RECORD = "current";
const PENDING_LAUNCH_RECORD = "pending-launch";

export type LocalInstallationState = {
  installationId: string;
  ownerUserId: string | null;
  enabled: boolean;
  invitationSettled: boolean;
};

function newLocalState(): LocalInstallationState {
  return {
    installationId: `installation_${crypto.randomUUID().replaceAll("-", "")}`,
    ownerUserId: null,
    enabled: false,
    invitationSettled: false,
  };
}

export function readLocalState() {
  try {
    const input = JSON.parse(window.localStorage.getItem(LOCAL_STATE_KEY) ?? "null");
    if (
      input &&
      typeof input.installationId === "string" &&
      /^[A-Za-z0-9_-]{16,128}$/.test(input.installationId) &&
      (typeof input.ownerUserId === "string" || input.ownerUserId === null) &&
      typeof input.enabled === "boolean" &&
      typeof input.invitationSettled === "boolean"
    ) {
      return input as LocalInstallationState;
    }
  } catch {
    // Replace corrupt installation state without exposing its contents.
  }
  const created = newLocalState();
  saveLocalState(created);
  return created;
}

export function saveLocalState(state: LocalInstallationState) {
  window.localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
}

export function writeWorkerState(
  installationId: string,
  ownerUserId: string | null,
  active: boolean,
) {
  if (!("indexedDB" in window)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DATABASE_STORE)) {
        request.result.createObjectStore(DATABASE_STORE);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(DATABASE_STORE, "readwrite");
      transaction.objectStore(DATABASE_STORE).put(
        { installationId, ownerUserId, active },
        DATABASE_RECORD,
      );
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

export function clearWorkerPrivateState(installationId: string) {
  if (!("indexedDB" in window)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DATABASE_STORE)) {
        request.result.createObjectStore(DATABASE_STORE);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(DATABASE_STORE, "readwrite");
      const store = transaction.objectStore(DATABASE_STORE);
      store.put(
        { installationId, ownerUserId: null, active: false },
        DATABASE_RECORD,
      );
      store.delete(PENDING_LAUNCH_RECORD);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

export function consumePendingNotificationGroup() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  return new Promise<string | null>((resolve) => {
    try {
      const request = window.indexedDB.open(DATABASE_NAME, 1);
      request.onerror = () => resolve(null);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DATABASE_STORE)) {
          request.result.createObjectStore(DATABASE_STORE);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DATABASE_STORE)) {
          database.close();
          resolve(null);
          return;
        }
        const transaction = database.transaction(DATABASE_STORE, "readwrite");
        const store = transaction.objectStore(DATABASE_STORE);
        const read = store.get(PENDING_LAUNCH_RECORD);
        let groupId: string | null = null;
        read.onsuccess = () => {
          const candidate = read.result?.groupId;
          if (
            typeof candidate === "string" &&
            /^grp_[A-Za-z0-9_-]+$/.test(candidate)
          ) {
            groupId = candidate;
          }
          store.delete(PENDING_LAUNCH_RECORD);
        };
        read.onerror = () => transaction.abort();
        transaction.oncomplete = () => {
          database.close();
          resolve(groupId);
        };
        transaction.onabort = () => {
          database.close();
          resolve(null);
        };
        transaction.onerror = () => undefined;
      };
    } catch {
      resolve(null);
    }
  });
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function requiresHomeScreenInstallation() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return typeof standaloneNavigator.standalone === "boolean" && !isStandalone();
}

export function supportsNotifications() {
  return (
    typeof Notification !== "undefined" &&
    Boolean(navigator.serviceWorker) &&
    typeof PushManager !== "undefined"
  );
}

function applicationServerKey() {
  const padding = "=".repeat((4 - (VAPID_PUBLIC_KEY.length % 4)) % 4);
  const binary = atob(
    VAPID_PUBLIC_KEY.replaceAll("-", "+").replaceAll("_", "/") + padding,
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function browserSubscription() {
  const registration = await navigator.serviceWorker.register(
    "/notification-service-worker.js",
  );
  const existing = await registration.pushManager.getSubscription();
  if (
    existing &&
    (existing.expirationTime === null || existing.expirationTime > Date.now())
  ) {
    return existing;
  }
  if (existing) await existing.unsubscribe();
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(),
  });
}

export function serializeSubscription(
  subscription: PushSubscription,
): BrowserPushSubscription {
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) {
    throw new Error("The browser returned an incomplete Push subscription.");
  }
  return {
    endpoint: value.endpoint,
    keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
  };
}
