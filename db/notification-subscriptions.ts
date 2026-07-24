import {
  createFirestoreRestClient,
  FirestoreRequestError,
  type FirebaseConfig,
  type FirestoreDocument,
} from "./firestore-rest.ts";
import { userHistoryWrite } from "./user-history.ts";

export type StoredNotificationSubscription = {
  installationId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  state: "active" | "paused";
  createdAt: string;
  updatedAt: string;
  stateChangedAt: string;
};

type PersistedNotificationSubscription = StoredNotificationSubscription & {
  path: string;
  updateTime: string;
};

type StoreOptions = { now?: () => number };

function isConcurrentWrite(error: unknown) {
  return (
    error instanceof FirestoreRequestError &&
    ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION"].includes(
      error.code ?? "",
    )
  );
}

function parseSubscription(
  document: FirestoreDocument,
  path: string,
): PersistedNotificationSubscription {
  const installationId = document.fields?.installationId?.stringValue;
  const userId = document.fields?.userId?.stringValue;
  const endpoint = document.fields?.endpoint?.stringValue;
  const p256dh = document.fields?.p256dh?.stringValue;
  const auth = document.fields?.auth?.stringValue;
  const state = document.fields?.state?.stringValue;
  const createdAt = document.fields?.createdAt?.timestampValue;
  const updatedAt = document.fields?.updatedAt?.timestampValue;
  const stateChangedAt = document.fields?.stateChangedAt?.timestampValue;
  if (
    !installationId ||
    !userId ||
    !endpoint ||
    !p256dh ||
    !auth ||
    (state !== "active" && state !== "paused") ||
    !createdAt ||
    !updatedAt ||
    !stateChangedAt ||
    !document.updateTime
  ) {
    throw new Error("Firestore returned an invalid Notification Subscription record.");
  }
  return {
    path,
    updateTime: document.updateTime,
    installationId,
    userId,
    endpoint,
    p256dh,
    auth,
    state,
    createdAt,
    updatedAt,
    stateChangedAt,
  };
}

function stored(subscription: PersistedNotificationSubscription): StoredNotificationSubscription {
  return {
    installationId: subscription.installationId,
    userId: subscription.userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
    state: subscription.state,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    stateChangedAt: subscription.stateChangedAt,
  };
}

export function createFirestoreNotificationSubscriptionStore(
  config: FirebaseConfig,
  fetchImplementation: typeof fetch = fetch,
  { now = Date.now }: StoreOptions = {},
) {
  const firestore = createFirestoreRestClient(config, fetchImplementation);

  function pathFor(installationId: string) {
    return `v1NotificationSubscriptions/${installationId}`;
  }

  function deliveryIndexPath(userId: string, installationId: string) {
    return `v1NotificationSubscriptionUsers/${userId}/installations/${installationId}`;
  }

  async function read(installationId: string) {
    const path = pathFor(installationId);
    const response = await firestore.request(path, {}, { allowNotFound: true });
    if (response.status === 404) return null;
    return parseSubscription((await response.json()) as FirestoreDocument, path);
  }

  async function commit(writes: unknown | unknown[]) {
    await firestore.request(":commit", {
      method: "POST",
      body: JSON.stringify({ writes: Array.isArray(writes) ? writes : [writes] }),
    });
  }

  function fields(subscription: StoredNotificationSubscription) {
    return {
      installationId: { stringValue: subscription.installationId },
      userId: { stringValue: subscription.userId },
      endpoint: { stringValue: subscription.endpoint },
      p256dh: { stringValue: subscription.p256dh },
      auth: { stringValue: subscription.auth },
      state: { stringValue: subscription.state },
      createdAt: { timestampValue: subscription.createdAt },
      updatedAt: { timestampValue: subscription.updatedAt },
      stateChangedAt: { timestampValue: subscription.stateChangedAt },
    };
  }

  function deliveryIndexFields(subscription: StoredNotificationSubscription) {
    return {
      installationId: { stringValue: subscription.installationId },
      userId: { stringValue: subscription.userId },
      state: { stringValue: subscription.state },
    };
  }

  return Object.freeze({
    async get(installationId: string) {
      const subscription = await read(installationId);
      return subscription ? stored(subscription) : null;
    },

    async listActive(userId: string) {
      const active: StoredNotificationSubscription[] = [];
      let pageToken: string | null = null;
      do {
        const parameters = new URLSearchParams({
          pageSize: "500",
          orderBy: "__name__",
        });
        if (pageToken !== null) parameters.set("pageToken", pageToken);
        const response = await firestore.request(
          `v1NotificationSubscriptionUsers/${userId}/installations?${parameters}`,
        );
        const page = (await response.json()) as {
          documents?: FirestoreDocument[];
          nextPageToken?: string;
        };
        for (const document of page.documents ?? []) {
          const installationId = document.fields?.installationId?.stringValue;
          const indexedUserId = document.fields?.userId?.stringValue;
          const state = document.fields?.state?.stringValue;
          if (
            !installationId ||
            indexedUserId !== userId ||
            (state !== "active" && state !== "paused")
          ) {
            throw new Error(
              "Firestore returned an invalid Notification Subscription delivery index.",
            );
          }
          if (state !== "active") continue;
          const subscription = await read(installationId);
          if (
            subscription?.userId === userId &&
            subscription.state === "active"
          ) {
            active.push(stored(subscription));
          }
        }
        pageToken = page.nextPageToken ?? null;
      } while (pageToken !== null);
      return active;
    },

    async remove(installationId: string, userId: string) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await read(installationId);
        if (!existing || existing.userId !== userId) return false;
        try {
          await commit([
            {
              delete: firestore.documentName(existing.path),
              currentDocument: { updateTime: existing.updateTime },
            },
            {
              delete: firestore.documentName(
                deliveryIndexPath(userId, installationId),
              ),
            },
          ]);
          return true;
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Notification Subscription removal could not be resolved.");
    },

    async register(input: {
      installationId: string;
      userId: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await read(input.installationId);
        const timestamp = new Date(now()).toISOString();
        const next: StoredNotificationSubscription = {
          ...input,
          state: "active",
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
          stateChangedAt:
            existing?.state === "active" && existing.userId === input.userId
              ? existing.stateChangedAt
              : timestamp,
        };
        try {
          await commit([
            userHistoryWrite(firestore, input.userId),
            {
              update: {
                name: firestore.documentName(pathFor(input.installationId)),
                fields: fields(next),
              },
              currentDocument: existing
                ? { updateTime: existing.updateTime }
                : { exists: false },
            },
            ...(existing && existing.userId !== input.userId
              ? [{
                  delete: firestore.documentName(
                    deliveryIndexPath(existing.userId, input.installationId),
                  ),
                }]
              : []),
            {
              update: {
                name: firestore.documentName(
                  deliveryIndexPath(input.userId, input.installationId),
                ),
                fields: deliveryIndexFields(next),
              },
            },
          ]);
          return next;
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Notification Subscription registration could not be resolved.");
    },

    async setState(
      installationId: string,
      userId: string,
      state: "active" | "paused",
    ) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await read(installationId);
        if (!existing || existing.userId !== userId) return null;
        if (existing.state === state) return stored(existing);
        const timestamp = new Date(now()).toISOString();
        const next: StoredNotificationSubscription = {
          ...stored(existing),
          state,
          updatedAt: timestamp,
          stateChangedAt: timestamp,
        };
        try {
          await commit([
            {
              update: {
                name: firestore.documentName(existing.path),
                fields: {
                  state: { stringValue: state },
                  updatedAt: { timestampValue: timestamp },
                  stateChangedAt: { timestampValue: timestamp },
                },
              },
              updateMask: {
                fieldPaths: ["state", "updatedAt", "stateChangedAt"],
              },
              currentDocument: { updateTime: existing.updateTime },
            },
            {
              update: {
                name: firestore.documentName(
                  deliveryIndexPath(userId, installationId),
                ),
                fields: deliveryIndexFields(next),
              },
            },
          ]);
          return next;
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Notification Subscription state could not be resolved.");
    },
  });
}
