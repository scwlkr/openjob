import { createPrivateGoogleDeletionCleanup } from '../db/private-google-deletion.ts';
import { createFirestoreRestClient } from '../db/firestore-rest.ts';
import { createWorkspacePilotRuntime } from './workspace-pilot-runtime.ts';
import { internalErrorResponse, defaultRequestId } from './v1-http.ts';
import { createPersonalApplication } from './personal-application.ts';
import { createFirestoreAgentGrantStore } from "@/db/agent-grants";
import { createV1AgentGrantsApi } from "./v1-agent-grants";
import { env, waitUntil } from "cloudflare:workers";
import { createFirestoreGroupStore } from "@/db/groups";
import { createFirestoreAccountDeletionJobStore } from "@/db/account-deletions";
import { createFirestoreNotificationSubscriptionStore } from "@/db/notification-subscriptions";
import { createFirestoreTaskStore } from "@/db/v1-tasks";
import { createFirestorePersonalWorkspaceStore } from "@/db/personal-workspace";
import { createV1PersonalWorkspaceHandler } from "./v1-personal-workspace";
import { createV1PersonalAgentGrantsHandler } from "./v1-personal-agent-grants";
import { createV1ProviderPreviewHandler } from "./v1-provider-preview";
import { createFirestoreUserStore } from "@/db/users";
import { VAPID_PUBLIC_KEY } from "@/shared/push";
import { createFirebaseIdTokenVerifier } from "./firebase-id-token";
import { createAccountDeletionProviderGateway } from "./account-deletion-providers";
import { parseAccountDeletionOperatorTarget } from "./account-deletion-operator.ts";
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
  GOOGLE_CONNECTIONS_CLEANUP_MODE?: string;
  ACCOUNT_DELETION_OPERATOR_TARGET?: string;
  APPLE_ACCOUNT_DELETION_CLIENT_IDS?: string;
  APPLE_ACCOUNT_DELETION_REDIRECT_URI?: string;
  APPLE_ACCOUNT_DELETION_SERVICE_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  APPLE_TEAM_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  GOOGLE_ACCOUNT_DELETION_CLIENT_IDS?: string;
  VAPID_PRIVATE_KEY?: string;
};

type V1Runtime = {
  workspacePilotApi: ReturnType<typeof createWorkspacePilotRuntime>;
  agentGrantsApi: ReturnType<typeof createV1AgentGrantsApi>;
  accountDeletionApi: ReturnType<typeof createV1AccountDeletionApi>;
  groupsApi: ReturnType<typeof createV1GroupsApi>;
  identityApi: ReturnType<typeof createV1IdentityApi>;
  notificationSubscriptionsApi: ReturnType<typeof createV1NotificationSubscriptionsApi>;
  tasksApi: ReturnType<typeof createV1TasksApi>;
  personalWorkspaceApi: ReturnType<typeof createPersonalApplication>['personalWorkspaceApi'];
  personalAgentGrantsApi: ReturnType<typeof createPersonalApplication>['personalAgentGrantsApi'];
  connectionsApi: ReturnType<typeof createPersonalApplication>['connectionsApi'];
  providerPreviewApi: ReturnType<typeof createPersonalApplication>['providerPreviewApi'];
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
    apiKey: requiredBinding(bindings, "FIREBASE_API_KEY"),
    projectId,
    clientEmail: requiredBinding(bindings, "FIREBASE_CLIENT_EMAIL"),
    privateKey: requiredBinding(bindings, "FIREBASE_PRIVATE_KEY"),
  };
  const users = createFirestoreUserStore(firebase);
  const groups = createFirestoreGroupStore(firebase);
  const tasks = createFirestoreTaskStore(firebase);
  const personalWorkspaces = createFirestorePersonalWorkspaceStore(firebase);
  const agentGrants = createFirestoreAgentGrantStore(firebase);
  const notificationSubscriptions =
    createFirestoreNotificationSubscriptionStore(firebase);
  const accountDeletionJobs = createFirestoreAccountDeletionJobStore(
    firebase,
    bindings.ACCOUNT_DELETION_KEY ?? "",
  );
  const privateGoogleCleanup = createPrivateGoogleDeletionCleanup({
    db: createFirestoreRestClient(firebase),
    executionMode: bindings.GOOGLE_CONNECTIONS_CLEANUP_MODE,
  });
  const accountDeletionProviders = createAccountDeletionProviderGateway({
    apple: {
      allowedClientIds: (bindings.APPLE_ACCOUNT_DELETION_CLIENT_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      keyId: bindings.APPLE_KEY_ID ?? "",
      privateKey: bindings.APPLE_PRIVATE_KEY ?? "",
      redirectUrisByClientId: {
        [bindings.APPLE_ACCOUNT_DELETION_SERVICE_ID ?? ""]:
          bindings.APPLE_ACCOUNT_DELETION_REDIRECT_URI
            ? [bindings.APPLE_ACCOUNT_DELETION_REDIRECT_URI]
            : [],
      },
      teamId: bindings.APPLE_TEAM_ID ?? "",
    },
    firebase,
    google: {
      allowedClientIds: (bindings.GOOGLE_ACCOUNT_DELETION_CLIENT_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    },
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
    agentGrantsApi: createV1AgentGrantsApi({ grants: agentGrants, users, verifyIdToken }),
    accountDeletionApi: createV1AccountDeletionApi({
      agentGrants,
      personalWorkspaces,
      privateGoogleConnections: bindings.GOOGLE_CONNECTIONS_CLEANUP_MODE === 'configured' ? privateGoogleCleanup : undefined,
      groups,
      jobs: accountDeletionJobs,
      notifications: notificationSubscriptions,
      providers: accountDeletionProviders,
      reportEscalation() {
        console.warn("Account deletion requires operator completion.");
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
    ...createPersonalApplication({ workspace: personalWorkspaces, users, verifyIdToken }),
    workspacePilotApi: createWorkspacePilotRuntime({ config: firebase, personal: personalWorkspaces, users, verifyIdToken }),
    notificationSubscriptionsApi: createV1NotificationSubscriptionsApi({
      subscriptions: notificationSubscriptions,
      users,
      verifyIdToken,
    }),
    tasksApi: createV1TasksApi({
      agents: agentGrants,
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
export const handleV1PersonalWorkspaceRequest = createV1PersonalWorkspaceHandler(() => getRuntime().personalWorkspaceApi);
export const handleV1PersonalAgentGrantsRequest = createV1PersonalAgentGrantsHandler(() => getRuntime().personalAgentGrantsApi);
export const handleV1ProviderPreviewRequest = createV1ProviderPreviewHandler(() => getRuntime().providerPreviewApi);

export function retryPendingAccountDeletions() {
  const configuredTarget = (env as FirebaseBindings)
    .ACCOUNT_DELETION_OPERATOR_TARGET;
  const target = parseAccountDeletionOperatorTarget(configuredTarget);
  if (configuredTarget !== undefined && !target) {
    console.warn(
      "Account deletion operator target is invalid; bulk retry continues.",
    );
  }
  return getAccountDeletionApi().retryPending(
    undefined,
    target ? { priority: target } : undefined,
  );
}

export function retryAccountDeletion(userId: string, requestId: string) {
  const target = parseAccountDeletionOperatorTarget(JSON.stringify({
    requestId,
    userId,
  }));
  if (!target) {
    throw new Error("Account deletion operator target is invalid.");
  }
  return getAccountDeletionApi().retryPending(target);
}

export async function handleV1AgentGrantsRequest(request: Request) {
  return getRuntime().agentGrantsApi.fetch(request);
}

export async function handleWorkspacePilotRequest(request: Request) {
  try { return await getRuntime().workspacePilotApi.fetch(request); }
  catch { return internalErrorResponse(defaultRequestId); }
}

export async function handleConnectionsRequest(request: Request) {
  try { return await getRuntime().connectionsApi.fetch(request); }
  catch { return internalErrorResponse(defaultRequestId); }
}
