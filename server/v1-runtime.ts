import { env, waitUntil } from "cloudflare:workers";
import { createFirestoreGroupStore } from "@/db/groups";
import { createFirestoreAccountDeletionJobStore } from "@/db/account-deletions";
import { createFirestoreNotificationSubscriptionStore } from "@/db/notification-subscriptions";
import { createFirestoreTaskStore } from "@/db/v1-tasks";
import { createFirestoreUserStore } from "@/db/users";
import { VAPID_PUBLIC_KEY } from "@/shared/push";
import { createFirebaseIdTokenVerifier } from "./firebase-id-token";
import { createAccountDeletionProviderGateway } from "./account-deletion-providers";
import {
  qaPasswordIdentityConfig,
  type QaPasswordRuntimeBindings,
} from "./qa-password-config";
import { createTaskNotificationDispatcher } from "./task-notifications";
import { createV1GroupsApi, createV1GroupsHandler } from "./v1-groups";
import {
  createV1AccountDeletionApi,
  createV1AccountDeletionHandler,
} from "./v1-account-deletion";
import { createV1IdentityApi, createV1IdentityHandler } from "./v1-identity";
import {
  createV1NotificationSubscriptionsApi,
  createV1NotificationSubscriptionsHandler,
} from "./v1-notification-subscriptions";
import { createV1TasksApi, createV1TasksHandler } from "./v1-tasks";
import { createWebPushSender } from "./web-push";

type FirebaseBindings = QaPasswordRuntimeBindings & {
  ACCOUNT_DELETION_KEY?: string;
  APPLE_ACCOUNT_DELETION_CLIENT_IDS?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  APPLE_TEAM_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  VAPID_PRIVATE_KEY?: string;
};

type V1Runtime = {
  accountDeletionApi: ReturnType<typeof createV1AccountDeletionApi>;
  groupsApi: ReturnType<typeof createV1GroupsApi>;
  identityApi: ReturnType<typeof createV1IdentityApi>;
  notificationSubscriptionsApi: ReturnType<typeof createV1NotificationSubscriptionsApi>;
  tasksApi: ReturnType<typeof createV1TasksApi>;
};

let runtime: V1Runtime | null = null;

function requiredBinding(
  bindings: FirebaseBindings,
  name: keyof FirebaseBindings,
) {
  const value = bindings[name];
  if (!value) throw new Error(`The ${name} binding is unavailable.`);
  return value;
}

function getRuntime() {
  if (runtime) return runtime;
  const bindings = env as FirebaseBindings;
  const projectId = requiredBinding(bindings, "FIREBASE_PROJECT_ID");
  const firebase = {
    projectId,
    clientEmail: requiredBinding(bindings, "FIREBASE_CLIENT_EMAIL"),
    privateKey: requiredBinding(bindings, "FIREBASE_PRIVATE_KEY"),
  };
  const users = createFirestoreUserStore(firebase);
  const groups = createFirestoreGroupStore(firebase);
  const tasks = createFirestoreTaskStore(firebase);
  const notificationSubscriptions =
    createFirestoreNotificationSubscriptionStore(firebase);
  const accountDeletionJobs = createFirestoreAccountDeletionJobStore(
    firebase,
    bindings.ACCOUNT_DELETION_KEY ?? "",
  );
  const accountDeletionProviders = createAccountDeletionProviderGateway({
    apple: {
      allowedClientIds: (bindings.APPLE_ACCOUNT_DELETION_CLIENT_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      keyId: bindings.APPLE_KEY_ID ?? "",
      privateKey: bindings.APPLE_PRIVATE_KEY ?? "",
      teamId: bindings.APPLE_TEAM_ID ?? "",
    },
    firebase,
  });
  const notificationDispatcher = createTaskNotificationDispatcher({
    groups,
    subscriptions: notificationSubscriptions,
    push: createWebPushSender({
      vapid: {
        subject: "https://openjob.dev",
        publicKey: VAPID_PUBLIC_KEY,
        privateKey: bindings.VAPID_PRIVATE_KEY,
      },
    }),
    reportFailure(failure) {
      console.warn("Push Notification delivery failed.", failure);
    },
  });
  const verifyIdToken = createFirebaseIdTokenVerifier({
    projectId,
    qaPassword: qaPasswordIdentityConfig(bindings, projectId),
  });
  runtime = {
    accountDeletionApi: createV1AccountDeletionApi({
      groups,
      jobs: accountDeletionJobs,
      notifications: notificationSubscriptions,
      providers: accountDeletionProviders,
      reportEscalation(requestId) {
        console.warn(
          `Account deletion ${requestId} requires operator completion.`,
        );
      },
      users,
      verifyCredentialToken: verifyIdToken.verifyToken,
      verifyIdToken,
    }),
    groupsApi: createV1GroupsApi({ groups, users, verifyIdToken }),
    identityApi: createV1IdentityApi({
      groups,
      users,
      verifyCredentialToken: verifyIdToken.verifyToken,
      verifyIdToken,
    }),
    notificationSubscriptionsApi: createV1NotificationSubscriptionsApi({
      subscriptions: notificationSubscriptions,
      users,
      verifyIdToken,
    }),
    tasksApi: createV1TasksApi({
      notifications: {
        dispatch: notificationDispatcher.dispatch,
        schedule(delivery) {
          waitUntil(delivery().catch(() => {
            console.warn("Task notification dispatch failed.");
          }));
        },
      },
      tasks,
      users,
      verifyIdToken,
    }),
  };
  return runtime;
}

function getIdentityApi() {
  return getRuntime().identityApi;
}

function getAccountDeletionApi() {
  return getRuntime().accountDeletionApi;
}

function getGroupsApi() {
  return getRuntime().groupsApi;
}

function getNotificationSubscriptionsApi() {
  return getRuntime().notificationSubscriptionsApi;
}

function getTasksApi() {
  return getRuntime().tasksApi;
}

export const handleV1IdentityRequest = createV1IdentityHandler(getIdentityApi);
export const handleV1AccountDeletionRequest =
  createV1AccountDeletionHandler(getAccountDeletionApi);
export const handleV1GroupsRequest = createV1GroupsHandler(getGroupsApi);
export const handleV1NotificationSubscriptionsRequest =
  createV1NotificationSubscriptionsHandler(getNotificationSubscriptionsApi);
export const handleV1TasksRequest = createV1TasksHandler(getTasksApi);

export function retryPendingAccountDeletions() {
  return getAccountDeletionApi().retryPending();
}
