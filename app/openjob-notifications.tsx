"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  type AuthSession,
  type BrowserPushSubscription,
  type OpenJobApi,
  type User,
} from "./openjob-contracts";
import styles from "./openjob.module.css";

const LOCAL_STATE_KEY = "openjob:notification-installation";
const DATABASE_NAME = "openjob-notifications";
const DATABASE_STORE = "installation-state";
const DATABASE_RECORD = "current";
const APPLICATION_SERVER_KEY =
  "BAjmkCDWNiVDAavAHLX0Jq4WiwcifG0Oy_p_TjOb_X8KUjc7aUSoRYJWz6-gSCuqSeRnjRYNZ8dQCwNxCneHNgc";

type LocalInstallationState = {
  installationId: string;
  ownerUserId: string | null;
  enabled: boolean;
  invitationSettled: boolean;
};

export type NotificationUiState =
  | "loading"
  | "enabled"
  | "paused"
  | "denied"
  | "unsupported"
  | "installation-required";

export type NotificationController = {
  busy: boolean;
  dismissInvitation(): void;
  enable(): Promise<void>;
  error: string;
  pause(): Promise<void>;
  prepareSignOut(): Promise<void>;
  showInvitation: boolean;
  state: NotificationUiState;
};

function newLocalState(): LocalInstallationState {
  return {
    installationId: `installation_${crypto.randomUUID().replaceAll("-", "")}`,
    ownerUserId: null,
    enabled: false,
    invitationSettled: false,
  };
}

function readLocalState() {
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

function saveLocalState(state: LocalInstallationState) {
  window.localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
}

function writeWorkerState(
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

function isIosBrowser() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function supportsNotifications() {
  return (
    typeof Notification !== "undefined" &&
    Boolean(navigator.serviceWorker) &&
    typeof PushManager !== "undefined"
  );
}

function applicationServerKey() {
  const padding = "=".repeat((4 - (APPLICATION_SERVER_KEY.length % 4)) % 4);
  const binary = atob(
    APPLICATION_SERVER_KEY.replaceAll("-", "+").replaceAll("_", "/") + padding,
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function browserSubscription() {
  const registration = await navigator.serviceWorker.register(
    "/notification-service-worker.js",
  );
  const existing = await registration.pushManager.getSubscription();
  return existing ?? registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(),
  });
}

function serializeSubscription(
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

function notificationError() {
  return "OpenJob could not update notifications. Try again.";
}

export function useOpenJobNotifications({
  api,
  hasUsableGroup,
  session,
  user,
}: {
  api: OpenJobApi;
  hasUsableGroup: boolean;
  session: AuthSession | null;
  user: User | null;
}): NotificationController {
  const [state, setState] = useState<NotificationUiState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showInvitation, setShowInvitation] = useState(false);

  useEffect(() => {
    let current = true;
    if (!session || !user || user.usernameRequired) {
      if (!session && typeof window !== "undefined") {
        const local = readLocalState();
        void writeWorkerState(
          local.installationId,
          local.ownerUserId,
          false,
        ).catch(() => undefined);
      }
      return () => {
        current = false;
      };
    }

    void (async () => {
      const local = readLocalState();
      if (!supportsNotifications()) {
        if (current) setState("unsupported");
        return;
      }
      if (isIosBrowser() && !isStandalone()) {
        if (current) setState("installation-required");
        return;
      }
      if (Notification.permission === "denied") {
        local.invitationSettled = true;
        saveLocalState(local);
        await writeWorkerState(local.installationId, local.ownerUserId, false);
        if (current) setState("denied");
        return;
      }
      if (Notification.permission !== "granted") {
        await writeWorkerState(local.installationId, local.ownerUserId, false);
        if (current) {
          setState("paused");
          setShowInvitation(hasUsableGroup && !local.invitationSettled);
        }
        return;
      }

      const token = await session.getIdToken();
      if (local.ownerUserId === user.userId) {
        if (local.enabled) {
          const subscription = await browserSubscription();
          await api.registerNotificationSubscription(
            token,
            local.installationId,
            serializeSubscription(subscription),
          );
          await writeWorkerState(local.installationId, user.userId, true);
          if (current) setState("enabled");
        } else {
          await api.setNotificationSubscriptionState(
            token,
            local.installationId,
            "paused",
          ).catch((candidate) => {
            if (!(candidate instanceof ApiError && candidate.status === 404)) throw candidate;
          });
          await writeWorkerState(local.installationId, user.userId, false);
          if (current) setState("paused");
        }
        return;
      }

      if (local.ownerUserId === null) {
        const serverState = await api.getNotificationSubscription(
          token,
          local.installationId,
        ).catch((candidate) => {
          if (candidate instanceof ApiError && candidate.status === 404) return null;
          throw candidate;
        });
        if (serverState) {
          local.ownerUserId = user.userId;
          local.enabled = serverState.state === "active";
          saveLocalState(local);
          if (local.enabled) {
            const subscription = await browserSubscription();
            await api.registerNotificationSubscription(
              token,
              local.installationId,
              serializeSubscription(subscription),
            );
          }
          await writeWorkerState(local.installationId, user.userId, local.enabled);
          if (current) setState(local.enabled ? "enabled" : "paused");
          return;
        }
      }

      await writeWorkerState(local.installationId, local.ownerUserId, false);
      if (current) setState("paused");
    })().catch(() => {
      if (current) {
        setState("paused");
        setError(notificationError());
      }
    });
    return () => {
      current = false;
    };
  }, [api, hasUsableGroup, session, user]);

  const dismissInvitation = useCallback(() => {
    const local = readLocalState();
    local.invitationSettled = true;
    saveLocalState(local);
    setShowInvitation(false);
  }, []);

  const enable = useCallback(async () => {
    if (!session || !user || !supportsNotifications()) return;
    if (isIosBrowser() && !isStandalone()) {
      setState("installation-required");
      return;
    }
    setBusy(true);
    setError("");
    const local = readLocalState();
    local.invitationSettled = true;
    saveLocalState(local);
    setShowInvitation(false);
    try {
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") {
        local.enabled = false;
        saveLocalState(local);
        await writeWorkerState(local.installationId, local.ownerUserId, false);
        setState("denied");
        return;
      }
      const subscription = await browserSubscription();
      await api.registerNotificationSubscription(
        await session.getIdToken(),
        local.installationId,
        serializeSubscription(subscription),
      );
      local.ownerUserId = user.userId;
      local.enabled = true;
      saveLocalState(local);
      await writeWorkerState(local.installationId, user.userId, true);
      setState("enabled");
    } catch {
      local.enabled = false;
      saveLocalState(local);
      await writeWorkerState(local.installationId, local.ownerUserId, false).catch(
        () => undefined,
      );
      setState("paused");
      setError(notificationError());
    } finally {
      setBusy(false);
    }
  }, [api, session, user]);

  const pause = useCallback(async () => {
    if (!session || !user) return;
    setBusy(true);
    setError("");
    const local = readLocalState();
    local.enabled = false;
    saveLocalState(local);
    await writeWorkerState(local.installationId, user.userId, false).catch(
      () => undefined,
    );
    setState("paused");
    try {
      await api.setNotificationSubscriptionState(
        await session.getIdToken(),
        local.installationId,
        "paused",
      );
    } catch {
      setError(notificationError());
    } finally {
      setBusy(false);
    }
  }, [api, session, user]);

  const prepareSignOut = useCallback(async () => {
    if (!session || !user) return;
    const local = readLocalState();
    await writeWorkerState(local.installationId, local.ownerUserId, false).catch(
      () => undefined,
    );
    if (local.ownerUserId !== user.userId) return;
    await api.setNotificationSubscriptionState(
      await session.getIdToken(),
      local.installationId,
      "paused",
    ).catch(() => undefined);
  }, [api, session, user]);

  return useMemo(() => ({
    busy,
    dismissInvitation,
    enable,
    error,
    pause,
    prepareSignOut,
    showInvitation,
    state,
  }), [
    busy,
    dismissInvitation,
    enable,
    error,
    pause,
    prepareSignOut,
    showInvitation,
    state,
  ]);
}

export function notificationStateLabel(state: NotificationUiState) {
  switch (state) {
    case "enabled": return "Enabled";
    case "denied": return "Denied";
    case "unsupported": return "Unsupported";
    case "installation-required": return "Install required";
    case "loading": return "Checking";
    default: return "Paused";
  }
}

export function NotificationInvitation({
  notifications,
}: {
  notifications: NotificationController;
}) {
  if (!notifications.showInvitation) return null;
  return (
    <section className={styles.notificationInvitation} aria-labelledby="notification-invitation-title">
      <div>
        <p className={styles.kicker}>Stay in the loop</p>
        <h2 id="notification-invitation-title">Turn on notifications?</h2>
        <p>Get an OS alert when work needs your attention. You can pause this anytime.</p>
      </div>
      <div className={styles.notificationActions}>
        <button type="button" className={styles.textButton} onClick={notifications.dismissInvitation}>
          Not now
        </button>
        <button type="button" className={styles.primaryButton} disabled={notifications.busy} onClick={() => void notifications.enable()}>
          Enable notifications
        </button>
      </div>
    </section>
  );
}

function guidance(state: NotificationUiState) {
  switch (state) {
    case "enabled":
      return "This installation can receive Push Notifications for all your Groups.";
    case "denied":
      return "Notifications are blocked in browser settings. Allow them there, then return here.";
    case "unsupported":
      return "This browser does not support the standards needed for Push Notifications.";
    case "installation-required":
      return "On iPhone or iPad, add OpenJob to the Home Screen and open the installed app first.";
    case "loading":
      return "Checking this installation's notification status.";
    default:
      return "Delivery is paused. Your browser permission and Push subscription are retained.";
  }
}

export function NotificationSettings({
  notifications,
  onClose,
}: {
  notifications: NotificationController;
  onClose: () => void;
}) {
  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <section className={`${styles.dialog} ${styles.notificationDialog}`} role="dialog" aria-modal="true" aria-labelledby="notification-settings-title">
        <p className={styles.kicker}>This installation</p>
        <h2 id="notification-settings-title">Notifications</h2>
        <p className={styles.notificationStatus}>
          Status: <strong>{notificationStateLabel(notifications.state)}</strong>
        </p>
        <p>{guidance(notifications.state)}</p>
        {notifications.error ? <p className={styles.inlineError} role="alert">{notifications.error}</p> : null}
        <div className={styles.notificationActions}>
          <button type="button" className={styles.textButton} onClick={onClose}>Close</button>
          {notifications.state === "enabled" ? (
            <button type="button" className={styles.primaryButton} disabled={notifications.busy} onClick={() => void notifications.pause()}>
              Pause notifications
            </button>
          ) : notifications.state === "paused" ? (
            <button type="button" className={styles.primaryButton} disabled={notifications.busy} onClick={() => void notifications.enable()}>
              Enable notifications
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
