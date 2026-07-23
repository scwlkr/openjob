"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type AuthSession,
  type OpenJobApi,
  type User,
} from "./openjob-contracts";
import {
  browserSubscription,
  clearWorkerPrivateState,
  readLocalState,
  requiresHomeScreenInstallation,
  saveLocalState,
  serializeSubscription,
  supportsNotifications,
  writeWorkerState,
} from "./openjob-notification-browser";
import styles from "./openjob.module.css";

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

type NotificationPresentation = {
  action: "enable" | "pause" | null;
  guidance: string;
  label: string;
};

const NOTIFICATION_PRESENTATION: Record<
  NotificationUiState,
  NotificationPresentation
> = {
  loading: {
    action: null,
    guidance: "Checking this installation's notification status.",
    label: "Checking",
  },
  enabled: {
    action: "pause",
    guidance: "This installation can receive Push Notifications for all your Groups.",
    label: "Enabled",
  },
  paused: {
    action: "enable",
    guidance: "Delivery is paused. Your browser permission and Push subscription are retained.",
    label: "Paused",
  },
  denied: {
    action: null,
    guidance: "Notifications are blocked in browser settings. Allow them there, then return here.",
    label: "Denied",
  },
  unsupported: {
    action: null,
    guidance: "This browser does not support the standards needed for Push Notifications.",
    label: "Unsupported",
  },
  "installation-required": {
    action: null,
    guidance: "On iPhone or iPad, add OpenJob to the Home Screen and open the installed app first.",
    label: "Install required",
  },
};

function notificationError() {
  return "OpenJob could not update notifications. Try again.";
}

async function refreshBrowserSubscription(
  api: OpenJobApi,
  token: string,
  installationId: string,
) {
  const subscription = await browserSubscription();
  return api.registerNotificationSubscription(
    token,
    installationId,
    serializeSubscription(subscription),
  );
}

export function useOpenJobNotifications({
  api,
  hasUsableGroup,
  session,
  user,
}: {
  api: OpenJobApi;
  hasUsableGroup: boolean;
  session: AuthSession | null | undefined;
  user: User | null;
}): NotificationController {
  const [state, setState] = useState<NotificationUiState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showInvitation, setShowInvitation] = useState(false);
  const operationQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueOperation = useCallback(<Result,>(
    operation: () => Promise<Result>,
  ) => {
    const result = operationQueue.current.then(operation, operation);
    operationQueue.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  useEffect(() => {
    let current = true;
    if (!session || !user || user.usernameRequired) {
      if (session === null && typeof window !== "undefined") {
        const local = readLocalState();
        local.ownerUserId = null;
        saveLocalState(local);
        void enqueueOperation(() =>
          clearWorkerPrivateState(local.installationId)
        ).catch(() => undefined);
      }
      return () => {
        current = false;
      };
    }

    void enqueueOperation(async () => {
      const local = readLocalState();
      if (requiresHomeScreenInstallation()) {
        if (current) setState("installation-required");
        return;
      }
      if (!supportsNotifications()) {
        if (current) setState("unsupported");
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
          await refreshBrowserSubscription(api, token, local.installationId);
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
          const shouldEnable =
            local.enabled || serverState.state === "active";
          local.ownerUserId = user.userId;
          local.enabled = shouldEnable;
          saveLocalState(local);
          if (shouldEnable) {
            await refreshBrowserSubscription(api, token, local.installationId);
          }
          await writeWorkerState(
            local.installationId,
            user.userId,
            shouldEnable,
          );
          if (current) setState(shouldEnable ? "enabled" : "paused");
          return;
        }
      }

      await writeWorkerState(local.installationId, local.ownerUserId, false);
      if (current) setState("paused");
    }).catch(() => {
      if (current) {
        setState("paused");
        setError(notificationError());
      }
    });
    return () => {
      current = false;
    };
  }, [api, enqueueOperation, hasUsableGroup, session, user]);

  const dismissInvitation = useCallback(() => {
    const local = readLocalState();
    local.invitationSettled = true;
    saveLocalState(local);
    setShowInvitation(false);
  }, []);

  const enable = useCallback(async () => {
    if (!session || !user) return;
    if (requiresHomeScreenInstallation()) {
      setState("installation-required");
      return;
    }
    if (!supportsNotifications()) {
      setState("unsupported");
      return;
    }
    setBusy(true);
    setError("");
    setShowInvitation(false);
    try {
      await enqueueOperation(async () => {
        const local = readLocalState();
        local.invitationSettled = true;
        saveLocalState(local);
        const permission = Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
        if (permission !== "granted") {
          if (local.ownerUserId === null || local.ownerUserId === user.userId) {
            local.enabled = false;
            saveLocalState(local);
          }
          await writeWorkerState(local.installationId, local.ownerUserId, false);
          if (local.ownerUserId === user.userId) {
            await api.setNotificationSubscriptionState(
              await session.getIdToken(),
              local.installationId,
              "paused",
            ).catch(() => undefined);
          }
          setState(permission === "denied" ? "denied" : "paused");
          return;
        }
        await refreshBrowserSubscription(
          api,
          await session.getIdToken(),
          local.installationId,
        );
        local.ownerUserId = user.userId;
        local.enabled = true;
        saveLocalState(local);
        await writeWorkerState(local.installationId, user.userId, true);
        setState("enabled");
      });
    } catch {
      const local = readLocalState();
      if (local.ownerUserId === null || local.ownerUserId === user.userId) {
        local.enabled = false;
        saveLocalState(local);
      }
      await writeWorkerState(local.installationId, local.ownerUserId, false).catch(
        () => undefined,
      );
      setState("paused");
      setError(notificationError());
    } finally {
      setBusy(false);
    }
  }, [api, enqueueOperation, session, user]);

  const pause = useCallback(async () => {
    if (!session || !user) return;
    setBusy(true);
    setError("");
    try {
      await enqueueOperation(async () => {
        const local = readLocalState();
        local.enabled = false;
        saveLocalState(local);
        await writeWorkerState(local.installationId, user.userId, false);
        setState("paused");
        await api.setNotificationSubscriptionState(
          await session.getIdToken(),
          local.installationId,
          "paused",
        );
      });
    } catch {
      setError(notificationError());
    } finally {
      setBusy(false);
    }
  }, [api, enqueueOperation, session, user]);

  const prepareSignOut = useCallback(async () => {
    await enqueueOperation(async () => {
      const local = readLocalState();
      const ownerUserId = local.ownerUserId;
      await clearWorkerPrivateState(local.installationId);
      local.ownerUserId = null;
      saveLocalState(local);
      if (session && user && ownerUserId === user.userId) {
        try {
          await api.setNotificationSubscriptionState(
            await session.getIdToken(),
            local.installationId,
            "paused",
          );
        } catch {
          // Local suppression is authoritative when the session already expired.
        }
      }
    });
  }, [api, enqueueOperation, session, user]);

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
  return NOTIFICATION_PRESENTATION[state].label;
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

export function NotificationSettings({
  notifications,
  onClose,
}: {
  notifications: NotificationController;
  onClose: () => void;
}) {
  const presentation = NOTIFICATION_PRESENTATION[notifications.state];
  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <section className={`${styles.dialog} ${styles.notificationDialog}`} role="dialog" aria-modal="true" aria-labelledby="notification-settings-title">
        <p className={styles.kicker}>This installation</p>
        <h2 id="notification-settings-title">Notifications</h2>
        <p className={styles.notificationStatus}>
          Status: <strong>{notificationStateLabel(notifications.state)}</strong>
        </p>
        <p>{presentation.guidance}</p>
        {notifications.error ? <p className={styles.inlineError} role="alert">{notifications.error}</p> : null}
        <div className={styles.notificationActions}>
          <button type="button" className={styles.textButton} onClick={onClose}>Close</button>
          {presentation.action === "pause" ? (
            <button type="button" className={styles.primaryButton} disabled={notifications.busy} onClick={() => void notifications.pause()}>
              Pause notifications
            </button>
          ) : presentation.action === "enable" ? (
            <button type="button" className={styles.primaryButton} disabled={notifications.busy} onClick={() => void notifications.enable()}>
              Enable notifications
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
