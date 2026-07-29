import { expect, type Page, test } from "@playwright/test";
import packageMetadata from "../../package.json" with { type: "json" };

type Group = {
  groupId: string;
  name: string;
  role: "member" | "admin";
  createdAt: string;
};

type Member = {
  userId: string;
  username: string | null;
  role: "member" | "admin";
  joinedAt: string;
};

type Ban = {
  userId: string;
  username: string | null;
  bannedAt: string;
};

type InviteLink = {
  token: string;
  url: string;
  issuedAt: string;
  expiresAt: string;
  remainingJoins: number;
};

type Task = {
  taskId: string;
  groupId: string;
  text: string;
  assignee:
    | { state: "assigned"; userId: string; username: string }
    | { state: "unassigned" }
    | { state: "deleted" };
  priority?: "high" | "normal" | "low";
  dueDate: string | null;
  state: "open" | "done";
  createdAt: string;
  completedAt: string | null;
};

type SignInMethod = "apple" | "google";

type DeletionStatusReceipt = {
  phase: "completed" | "prepared" | "submitting";
  statusToken: string;
  submissionExpiresAt: string | null;
  version: 1;
};

type ApiState = {
  user: { userId: string; username: string | null; usernameRequired: boolean };
  groups: Group[];
  members: Member[];
  knownUsers: Map<string, string | null>;
  bans: Ban[];
  invite: InviteLink;
  tasks: Task[];
  taskQueries: string[];
  taskStateRequests: { state: "open" | "done"; taskId: string }[];
  concealedGroupIds: Set<string>;
  authorizationHeaders: string[];
  meFailureStatus: number | null;
  claimFailureStatus: number | null;
  getGroupFailureStatus: number | null;
  taskFailureStatus: number | null;
  taskMutationFailureStatus: number | null;
  taskMutationRequests: number;
  failGroups: boolean;
  failTaskNetwork: boolean;
  failTaskMutationNetwork: boolean;
  hangMe: boolean;
  hangTasks: boolean;
  meDelayMs: number;
  createGroupDelayMs: number;
  getGroupDelayMs: number;
  linkDelayMs: number;
  membershipDenied: boolean;
  taskMutationDelayMs: number;
  notificationSubscription: {
    installationId: string;
    userId: string;
    state: "active" | "paused";
    capability: { endpoint: string; keys: { p256dh: string; auth: string } };
  } | null;
  notificationRequests: { method: string; userId: string }[];
  notificationRegistrationDelayMs: number;
  notificationRegistrationsCompleted: number;
  credentialRecognized: boolean;
  freshCredentialRecognized: boolean;
  signInMethods: SignInMethod[];
  identityRequests: Array<{ path: string; body: unknown }>;
  linkAuthorizationHeaders: string[];
  deletionRequests: unknown[];
  deletionPreparationBodies: unknown[];
  deletionPreparationFailureStatuses: number[];
  deletionPreparationRequests: number;
  deletionRefreshDelayMs: number;
  deletionRefreshPayload: unknown | undefined;
  deletionRefreshRequests: unknown[];
  deletionRequestStatus: "completed" | "pending";
  deletionStatus: "completed" | "not_started" | "pending";
  deletionPostDelayMs: number;
  deletionPostPayload: unknown | undefined;
  deletionPreparePayload: unknown | undefined;
  deletionStatusFailureStatus: number | null;
  deletionStatusDelayMs: number;
  deletionStatusPayload: unknown | undefined;
  deletionStatusRequests: number;
  deletionStatusToken: string;
  deletionSubmissionExpiresAt: string;
  deletionSubmissionHeaders: string[];
  linkFailureCode:
    | "fresh_authentication_required"
    | "link_target_changed"
    | "sign_in_method_conflict"
    | null;
};

const signedInUser = {
  userId: "user_shane",
  username: "shane",
  usernameRequired: false,
};

const walkerLabs: Group = {
  groupId: "grp_walker",
  name: "Walker Labs",
  role: "admin",
  createdAt: "2026-07-15T15:00:00.000Z",
};

const openJobCore: Group = {
  groupId: "grp_openjob",
  name: "OpenJob Core",
  role: "member",
  createdAt: "2026-07-16T15:00:00.000Z",
};

function visibleMorganTask(createdAt: string): Task {
  return {
    taskId: "task_morgan_entry",
    groupId: walkerLabs.groupId,
    text: "Keep Morgan visible",
    assignee: { state: "assigned", userId: "user_morgan", username: "morgan" },
    dueDate: null,
    state: "open",
    createdAt,
    completedAt: null,
  };
}

async function startSignedIn(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("openjob-test:firebase-session", "signed-in");
  });
}

async function installDeletionReceiptStorageFailures(
  page: Page,
  options: {
    failRemove?: boolean;
    failSet?: boolean;
    failSetAt?: number;
    initialReceipt?: DeletionStatusReceipt;
  },
) {
  await page.addInitScript((settings) => {
    const receiptKey = "openjob:account-deletion-status-receipt";
    const seededKey = "openjob-test:deletion-receipt-seeded";
    const nativeRemoveItem = Storage.prototype.removeItem;
    const nativeSetItem = Storage.prototype.setItem;
    if (
      settings.initialReceipt &&
      window.sessionStorage.getItem(seededKey) !== "true"
    ) {
      nativeSetItem.call(
        window.localStorage,
        receiptKey,
        JSON.stringify(settings.initialReceipt),
      );
      window.sessionStorage.setItem(seededKey, "true");
    }
    const controls = {
      failRemove: Boolean(settings.failRemove),
      failSet: Boolean(settings.failSet),
      failSetAt: settings.failSetAt ?? null,
      secondarySignedInAtSet: [] as boolean[],
      setCalls: 0,
      values: [] as string[],
    };
    Object.defineProperty(window, "__openjobDeletionReceiptStorageFailures", {
      configurable: true,
      value: controls,
    });
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage && key === receiptKey) {
        controls.setCalls += 1;
        controls.values.push(value);
        controls.secondarySignedInAtSet.push(Boolean((window as typeof window & {
          __openjobFirebaseTest?: { secondarySignedIn(): boolean };
        }).__openjobFirebaseTest?.secondarySignedIn()));
        if (
          controls.failSet ||
          controls.setCalls === controls.failSetAt
        ) {
          throw new DOMException("Test receipt write failure.", "QuotaExceededError");
        }
      }
      return nativeSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (
        this === window.localStorage &&
        key === receiptKey &&
        controls.failRemove
      ) {
        throw new DOMException("Test receipt removal failure.", "SecurityError");
      }
      return nativeRemoveItem.call(this, key);
    };
  }, options);
}

function deletionReceipt(
  statusToken: string,
  phase: DeletionStatusReceipt["phase"] = "submitting",
  submissionExpiresAt: string | null = "2026-07-28T12:05:00.000Z",
): DeletionStatusReceipt {
  return { phase, statusToken, submissionExpiresAt, version: 1 };
}

async function storedDeletionReceipt(page: Page) {
  return page.evaluate(() => {
    const value = window.localStorage.getItem(
      "openjob:account-deletion-status-receipt",
    );
    return value === null ? null : JSON.parse(value) as unknown;
  });
}

async function installDeletionPrivateState(
  page: Page,
  { signedIn = false }: { signedIn?: boolean } = {},
) {
  await page.addInitScript((shouldSignIn) => {
    const seededKey = "openjob-test:deletion-private-state-seeded";
    if (window.sessionStorage.getItem(seededKey) === "true") return;
    window.sessionStorage.setItem(seededKey, "true");
    window.localStorage.setItem("openjob:selected-group-id", "grp_private");
    window.sessionStorage.setItem("openjob:pending-task-editor", "private draft");
    if (shouldSignIn) {
      window.localStorage.setItem("openjob-test:firebase-session", "google");
    }
  }, signedIn);
}

async function seedDeletionNotificationState(page: Page) {
  await page.evaluate(async () => {
    window.localStorage.setItem(
      "openjob:notification-installation",
      JSON.stringify({
        enabled: true,
        installationId: "installation_deletion_1234567890",
        invitationSettled: true,
        ownerUserId: "user_shane",
      }),
    );
    window.localStorage.setItem("openjob-test:push-subscription", "present");
    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.open("openjob-notifications", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("installation-state")) {
          request.result.createObjectStore("installation-state");
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          "installation-state",
          "readwrite",
        );
        const store = transaction.objectStore("installation-state");
        store.put(
          {
            active: true,
            installationId: "installation_deletion_1234567890",
            ownerUserId: "user_shane",
          },
          "current",
        );
        store.put({ groupId: "grp_private" }, "pending-launch");
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
}

async function deletionNotificationState(page: Page) {
  return page.evaluate(async () => {
    const indexed = await new Promise<{ current: unknown; pending: unknown }>(
      (resolve, reject) => {
        const request = window.indexedDB.open("openjob-notifications", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            "installation-state",
            "readonly",
          );
          const store = transaction.objectStore("installation-state");
          const current = store.get("current");
          const pending = store.get("pending-launch");
          transaction.oncomplete = () => {
            database.close();
            resolve({
              current: current.result ?? null,
              pending: pending.result ?? null,
            });
          };
          transaction.onerror = () => reject(transaction.error);
        };
      },
    );
    return {
      ...indexed,
      installation: window.localStorage.getItem(
        "openjob:notification-installation",
      ),
      pushSubscription: window.localStorage.getItem(
        "openjob-test:push-subscription",
      ),
      unsubscribeCalls: (window as typeof window & {
        __openjobNotificationTest?: { unsubscribeCalls: number };
      }).__openjobNotificationTest?.unsubscribeCalls ?? 0,
    };
  });
}

async function openGroupMenu(page: Page) {
  await page.getByRole("button", { name: "Group menu" }).click();
}

async function openGroupManagement(page: Page, action: "Manage Group" | "Group settings") {
  await openGroupMenu(page);
  await page.getByRole("button", { name: action }).click();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
}

async function expectConfirmation(
  page: Page,
  expectedMessage: string,
  action: () => Promise<unknown>,
  accept = true,
) {
  const confirmation = page.waitForEvent("dialog").then(async (dialog) => {
    const message = dialog.message();
    if (accept) await dialog.accept();
    else await dialog.dismiss();
    return message;
  });
  await action();
  expect(await confirmation).toContain(expectedMessage);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
}

async function installNotificationEnvironment(
  page: Page,
  options: {
    permission?: "default" | "denied" | "granted";
    permissionResult?: "default" | "denied" | "granted";
    supported?: boolean;
    ios?: boolean;
    standalone?: boolean;
  } = {},
) {
  await page.addInitScript((settings) => {
    const testState = {
      permissionCalls: 0,
      subscribeCalls: 0,
      unsubscribeCalls: 0,
      subscription: null as PushSubscription | null,
      serviceWorkerMessageListener: null as ((event: MessageEvent) => void) | null,
    };
    Object.defineProperty(window, "__openjobNotificationTest", {
      configurable: true,
      value: testState,
    });
    if (settings.ios) {
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        value: Boolean(settings.standalone),
      });
    }
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === "(display-mode: standalone)"
        ? ({ matches: Boolean(settings.standalone) } as MediaQueryList)
        : nativeMatchMedia(query);
    if (settings.supported === false) {
      Reflect.deleteProperty(window, "Notification");
      Reflect.deleteProperty(window, "PushManager");
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: undefined,
      });
      return;
    }

    let permission = (window.localStorage.getItem(
      "openjob-test:notification-permission",
    ) as NotificationPermission | null) ?? settings.permission ?? "default";
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        get permission() {
          return permission;
        },
        async requestPermission() {
          testState.permissionCalls += 1;
          permission = settings.permissionResult ?? "granted";
          window.localStorage.setItem("openjob-test:notification-permission", permission);
          return permission;
        },
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class TestPushManager {},
    });
    const createSubscription = () => ({
      endpoint: window.localStorage.getItem("openjob-test:push-endpoint") ??
        "https://push.example.test/subscriptions/browser-capability",
      expirationTime: window.localStorage.getItem("openjob-test:push-expired")
        ? Date.now() - 1
        : null,
      getKey() {
        return null;
      },
      async unsubscribe() {
        testState.unsubscribeCalls += 1;
        window.localStorage.removeItem("openjob-test:push-subscription");
        window.localStorage.removeItem("openjob-test:push-expired");
        testState.subscription = null;
        return true;
      },
      toJSON() {
        return {
          endpoint: window.localStorage.getItem("openjob-test:push-endpoint") ??
            "https://push.example.test/subscriptions/browser-capability",
          keys: {
            p256dh: "p256dh_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
            auth: "auth_0123456789abcdef",
          },
        };
      },
    } as unknown as PushSubscription);
    if (window.localStorage.getItem("openjob-test:push-subscription")) {
      testState.subscription = createSubscription();
    }
    const pushManager = {
      async getSubscription() {
        if (
          !testState.subscription &&
          window.localStorage.getItem("openjob-test:push-subscription")
        ) {
          testState.subscription = createSubscription();
        }
        return testState.subscription;
      },
      async subscribe() {
        testState.subscribeCalls += 1;
        window.localStorage.setItem("openjob-test:push-subscription", "present");
        window.localStorage.removeItem("openjob-test:push-expired");
        testState.subscription = createSubscription();
        return testState.subscription;
      },
    };
    const registration = { active: {}, pushManager };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve(registration),
        async getRegistration() {
          return registration;
        },
        addEventListener(type: string, listener: (event: MessageEvent) => void) {
          if (type === "message") testState.serviceWorkerMessageListener = listener;
        },
        removeEventListener(type: string, listener: (event: MessageEvent) => void) {
          if (
            type === "message" &&
            testState.serviceWorkerMessageListener === listener
          ) {
            testState.serviceWorkerMessageListener = null;
          }
        },
        async register() {
          return registration;
        },
      },
    });
  }, options);
}

async function failIndexedDbWrites(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(window.indexedDB, "open", {
      configurable: true,
      value() {
        throw new Error("Test IndexedDB failure.");
      },
    });
  });
}

async function installApi(
  page: Page,
  initial: Partial<Pick<ApiState, "user" | "groups" | "members" | "bans" | "invite" | "tasks" | "meFailureStatus" | "claimFailureStatus" | "getGroupFailureStatus" | "taskFailureStatus" | "taskMutationFailureStatus" | "failGroups" | "failTaskNetwork" | "failTaskMutationNetwork" | "hangMe" | "hangTasks" | "meDelayMs" | "createGroupDelayMs" | "getGroupDelayMs" | "linkDelayMs" | "membershipDenied" | "taskMutationDelayMs" | "notificationSubscription" | "notificationRegistrationDelayMs" | "credentialRecognized" | "freshCredentialRecognized" | "signInMethods" | "deletionRequestStatus" | "deletionStatus" | "deletionStatusFailureStatus" | "linkFailureCode">> = {},
) {
  const members = [...(initial.members ?? [])];
  const bans = [...(initial.bans ?? [])];
  const tasks = [...(initial.tasks ?? [])];
  const state: ApiState = {
    user: initial.user ?? {
      userId: "user_shane",
      username: null,
      usernameRequired: true,
    },
    groups: [...(initial.groups ?? [])],
    members,
    knownUsers: new Map([
      ...members.map((member) => [member.userId, member.username] as const),
      ...bans.map((ban) => [ban.userId, ban.username] as const),
      ...tasks.flatMap((task) => task.assignee.state === "assigned"
        ? [[task.assignee.userId, task.assignee.username] as const]
        : []),
    ]),
    bans,
    invite: initial.invite ?? {
      token: "ivt_browser_active",
      url: "https://openjob.dev/invites/ivt_browser_active",
      issuedAt: "2026-07-16T15:00:00.000Z",
      expiresAt: "2026-07-23T15:00:00.000Z",
      remainingJoins: 25,
    },
    tasks,
    taskQueries: [],
    taskStateRequests: [],
    concealedGroupIds: new Set(),
    authorizationHeaders: [],
    meFailureStatus: initial.meFailureStatus ?? null,
    claimFailureStatus: initial.claimFailureStatus ?? null,
    getGroupFailureStatus: initial.getGroupFailureStatus ?? null,
    taskFailureStatus: initial.taskFailureStatus ?? null,
    taskMutationFailureStatus: initial.taskMutationFailureStatus ?? null,
    taskMutationRequests: 0,
    failGroups: initial.failGroups ?? false,
    failTaskNetwork: initial.failTaskNetwork ?? false,
    failTaskMutationNetwork: initial.failTaskMutationNetwork ?? false,
    hangMe: initial.hangMe ?? false,
    hangTasks: initial.hangTasks ?? false,
    meDelayMs: initial.meDelayMs ?? 0,
    createGroupDelayMs: initial.createGroupDelayMs ?? 0,
    getGroupDelayMs: initial.getGroupDelayMs ?? 0,
    linkDelayMs: initial.linkDelayMs ?? 0,
    membershipDenied: initial.membershipDenied ?? false,
    taskMutationDelayMs: initial.taskMutationDelayMs ?? 0,
    notificationSubscription: initial.notificationSubscription ?? null,
    notificationRequests: [],
    notificationRegistrationDelayMs: initial.notificationRegistrationDelayMs ?? 0,
    notificationRegistrationsCompleted: 0,
    credentialRecognized: initial.credentialRecognized ?? true,
    freshCredentialRecognized: initial.freshCredentialRecognized ?? true,
    signInMethods: [...(initial.signInMethods ?? ["google"])],
    identityRequests: [],
    linkAuthorizationHeaders: [],
    deletionRequests: [],
    deletionPreparationBodies: [],
    deletionPreparationFailureStatuses: [],
    deletionPreparationRequests: 0,
    deletionRefreshDelayMs: 0,
    deletionRefreshPayload: undefined,
    deletionRefreshRequests: [],
    deletionRequestStatus: initial.deletionRequestStatus ?? "completed",
    deletionStatus: initial.deletionStatus ?? "completed",
    deletionPostDelayMs: 0,
    deletionPostPayload: undefined,
    deletionPreparePayload: undefined,
    deletionStatusFailureStatus: initial.deletionStatusFailureStatus ?? null,
    deletionStatusDelayMs: 0,
    deletionStatusPayload: undefined,
    deletionStatusRequests: 0,
    deletionStatusToken: "v1.browser-receipt.browser-capability",
    deletionSubmissionExpiresAt: "2026-07-28T12:05:00.000Z",
    deletionSubmissionHeaders: [],
    linkFailureCode: initial.linkFailureCode ?? null,
  };

  const removeMember = (userId: string) => {
    state.members = state.members.filter((item) => item.userId !== userId);
    state.tasks = state.tasks.map((task) =>
      task.state === "open" && task.assignee.state === "assigned" && task.assignee.userId === userId
        ? { ...task, assignee: { state: "unassigned" as const } }
        : task,
    );
  };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const authorization = request.headers().authorization ?? "";
    const isLinkRequest =
      url.pathname === "/api/v1/me/sign-in-methods" &&
      request.method() === "POST";
    const isFreshIdentityRequest =
      url.pathname === "/api/v1/me" && request.method() === "GET";
    const isDeletionCapabilityRequest =
      url.pathname === "/api/v1/me/deletion" &&
      (request.method() === "GET" || request.method() === "PATCH");
    state.authorizationHeaders.push(authorization);

    const reply = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const error = (
      status: number,
      code: string,
      message: string,
      fields?: Record<string, string>,
    ) => reply(status, { error: { code, message, fields, requestId: "req_browser" } });
    const handleMockTaskMutationPreflight = async () => {
      state.taskMutationRequests += 1;
      if (state.taskMutationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.taskMutationDelayMs));
      }
      if (state.failTaskMutationNetwork) {
        await route.abort("failed");
        return true;
      }
      if (!state.taskMutationFailureStatus) return false;
      const status = state.taskMutationFailureStatus;
      const code = status === 401
        ? "authentication_required"
        : status === 403
          ? "forbidden"
          : status === 409
            ? "task_changed"
            : "internal_error";
      await error(status, code, "The Task could not be changed.");
      return true;
    };

    if (
      authorization !== "Bearer browser-test-token" &&
      !(
        (isLinkRequest || isFreshIdentityRequest) &&
        (authorization === "Bearer browser-fresh-apple-token" ||
          authorization === "Bearer browser-fresh-google-token")
      ) &&
      !(
        isDeletionCapabilityRequest &&
        authorization === `Bearer ${state.deletionStatusToken}`
      )
    ) {
      await error(401, "authentication_required", "Authentication is required.");
      return;
    }

    if (
      url.pathname === "/api/v1/me/sign-in-methods" &&
      request.method() === "GET"
    ) {
      await reply(200, { data: [...state.signInMethods].sort() });
      return;
    }

    if (
      url.pathname === "/api/v1/me/deletion" &&
      request.method() === "PUT"
    ) {
      state.deletionPreparationRequests += 1;
      state.deletionPreparationBodies.push(
        request.postData() === null ? null : request.postDataJSON(),
      );
      const failureStatus = state.deletionPreparationFailureStatuses.shift();
      if (failureStatus === 0) {
        await route.abort("failed");
        return;
      }
      if (failureStatus) {
        await error(
          failureStatus,
          "account_deletion_unavailable",
          "Account deletion recovery is temporarily unavailable.",
        );
        return;
      }
      const payload = state.deletionPreparePayload ?? {
        data: {
          status: "not_started",
          statusToken: state.deletionStatusToken,
          submissionExpiresAt: state.deletionSubmissionExpiresAt,
        },
      };
      const status = (payload as { data?: { status?: string } }).data?.status ===
          "pending"
        ? 202
        : 200;
      await reply(status, payload);
      return;
    }

    if (
      url.pathname === "/api/v1/me/deletion" &&
      request.method() === "GET"
    ) {
      state.deletionStatusRequests += 1;
      if (state.deletionStatusDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, state.deletionStatusDelayMs)
        );
      }
      if (state.deletionStatusFailureStatus) {
        await error(
          state.deletionStatusFailureStatus,
          "account_deletion_unavailable",
          "Account deletion status is temporarily unavailable.",
        );
        return;
      }
      await reply(200, state.deletionStatusPayload ?? {
        data: state.deletionStatus === "completed"
          ? { status: "completed" }
          : state.deletionStatus === "not_started"
            ? {
                status: "not_started",
                submissionExpired: true,
                submissionExpiresAt: state.deletionSubmissionExpiresAt,
              }
            : {
              deadline: "2026-08-04T12:00:00.000Z",
              reauthenticationProviders: [],
              requestedAt: "2026-07-28T12:00:00.000Z",
              status: "pending",
            },
      });
      return;
    }

    if (
      url.pathname === "/api/v1/me/deletion" &&
      request.method() === "PATCH"
    ) {
      state.deletionRefreshRequests.push(request.postDataJSON());
      if (state.deletionRefreshDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, state.deletionRefreshDelayMs)
        );
      }
      const payload = state.deletionRefreshPayload ?? {
        data: {
          completedAt: "2026-07-28T12:00:00.000Z",
          status: "completed",
        },
      };
      const status = (payload as { data?: { status?: string } }).data?.status ===
          "pending"
        ? 202
        : 200;
      await reply(status, payload);
      return;
    }

    if (
      url.pathname === "/api/v1/me/deletion" &&
      request.method() === "POST"
    ) {
      state.deletionRequests.push(request.postDataJSON());
      state.deletionSubmissionHeaders.push(
        request.headers()["x-openjob-deletion-status"] ?? "",
      );
      if (
        state.deletionSubmissionHeaders.at(-1) !== state.deletionStatusToken
      ) {
        await error(401, "authentication_required", "Deletion status is required.");
        return;
      }
      if (state.deletionPostDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.deletionPostDelayMs));
      }
      await reply(state.deletionRequestStatus === "pending" ? 202 : 200,
        state.deletionPostPayload ?? {
        data: state.deletionRequestStatus === "completed"
          ? {
              completedAt: "2026-07-28T12:00:00.000Z",
              status: "completed",
            }
          : {
              deadline: "2026-08-04T12:00:00.000Z",
              reauthenticationProviders: [],
              requestedAt: "2026-07-28T12:00:00.000Z",
              status: "pending",
              statusToken: state.deletionStatusToken,
            },
        });
      return;
    }

    if (
      url.pathname === "/api/v1/me/sign-in-methods" &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as {
        confirmation?: unknown;
        credentialToken?: unknown;
        expectedTargetUserId?: unknown;
      };
      state.identityRequests.push({ path: url.pathname, body });
      state.linkAuthorizationHeaders.push(authorization);
      const confirmedUser = state.user;
      if (state.linkDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, state.linkDelayMs)
        );
      }
      if (state.linkFailureCode) {
        const status = state.linkFailureCode === "fresh_authentication_required"
          ? 401
          : 409;
        await error(
          status,
          state.linkFailureCode,
          state.linkFailureCode === "fresh_authentication_required"
            ? "Fresh provider authentication is required."
            : state.linkFailureCode === "link_target_changed"
              ? "The confirmed User changed before linking."
              : "That Sign-in Method is already linked to another User.",
        );
        return;
      }
      if (
        body.confirmation !== "link" ||
        body.expectedTargetUserId !== confirmedUser.userId ||
        (authorization === "Bearer browser-test-token"
          ? body.credentialToken !== "browser-fresh-apple-token" &&
            body.credentialToken !== "browser-fresh-google-token"
          : body.credentialToken !== "browser-test-token")
      ) {
        await error(400, "invalid_request", "One or more fields are invalid.");
        return;
      }
      state.signInMethods = ["apple", "google"];
      state.credentialRecognized = true;
      await reply(200, { data: confirmedUser });
      return;
    }

    if (url.pathname === "/api/v1/me" && request.method() === "GET") {
      if (state.hangMe) return await new Promise<void>(() => undefined);
      if (state.meDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.meDelayMs));
      }
      if (state.meFailureStatus) {
        await error(
          state.meFailureStatus,
          state.meFailureStatus === 401
            ? "authentication_required"
            : state.meFailureStatus === 410
              ? "account_deletion_pending"
              : "internal_error",
          state.meFailureStatus === 401
            ? "Authentication is required."
            : state.meFailureStatus === 410
              ? "Account deletion is already in progress."
              : "An unexpected error occurred.",
        );
        return;
      }
      if (
        authorization === "Bearer browser-test-token"
          ? !state.credentialRecognized
          : !state.freshCredentialRecognized
      ) {
        await error(
          409,
          "sign_in_method_unrecognized",
          "That Sign-in Method is not linked to an OpenJob User.",
        );
        return;
      }
      await reply(200, { data: state.user });
      return;
    }

    if (url.pathname === "/api/v1/me" && request.method() === "POST") {
      const body = request.postDataJSON() as { confirmation?: unknown };
      state.identityRequests.push({ path: url.pathname, body });
      if (body.confirmation !== "create") {
        await error(400, "invalid_request", "One or more fields are invalid.");
        return;
      }
      state.credentialRecognized = true;
      await reply(201, { data: state.user });
      return;
    }

    if (url.pathname === "/api/v1/me/username" && request.method() === "PUT") {
      if (state.claimFailureStatus) {
        await error(
          state.claimFailureStatus,
          "authentication_required",
          "Authentication is required.",
        );
        return;
      }
      const { username } = request.postDataJSON() as { username?: unknown };
      const valid =
        typeof username === "string" &&
        /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])$/.test(username);
      if (!valid) {
        await error(400, "invalid_request", "One or more fields are invalid.", {
          username: "Use 2 to 32 lowercase letters, numbers, or internal ._- characters.",
        });
        return;
      }
      state.user = { ...state.user, username, usernameRequired: false };
      await reply(200, { data: state.user });
      return;
    }

    const notificationMatch = url.pathname.match(
      /^\/api\/v1\/me\/notification-subscriptions\/([^/]+)$/,
    );
    if (notificationMatch) {
      const installationId = decodeURIComponent(notificationMatch[1]);
      state.notificationRequests.push({ method: request.method(), userId: state.user.userId });
      if (request.method() === "PUT") {
        if (state.notificationRegistrationDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, state.notificationRegistrationDelayMs),
          );
        }
        const capability = request.postDataJSON() as {
          endpoint: string;
          keys: { p256dh: string; auth: string };
        };
        state.notificationSubscription = {
          installationId,
          userId: state.user.userId,
          state: "active",
          capability,
        };
        state.notificationRegistrationsCompleted += 1;
        await reply(200, { data: { installationId, state: "active" } });
        return;
      }
      if (
        !state.notificationSubscription ||
        state.notificationSubscription.userId !== state.user.userId
      ) {
        await error(
          404,
          "notification_subscription_not_found",
          "Notification Subscription was not found.",
        );
        return;
      }
      if (request.method() === "PATCH") {
        const { state: nextState } = request.postDataJSON() as {
          state: "active" | "paused";
        };
        state.notificationSubscription.state = nextState;
      }
      await reply(200, {
        data: {
          installationId,
          state: state.notificationSubscription.state,
        },
      });
      return;
    }

    if (url.pathname === "/api/v1/groups" && request.method() === "GET") {
      if (state.failGroups) {
        await error(500, "internal_error", "An unexpected error occurred.");
        return;
      }
      await reply(200, { data: state.groups, nextCursor: null });
      return;
    }

    if (url.pathname === "/api/v1/groups" && request.method() === "POST") {
      const { name: rawName } = request.postDataJSON() as { name?: unknown };
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (
        [...name].length < 1 ||
        [...name].length > 80 ||
        /[\n\r\p{Cc}]/u.test(name)
      ) {
        await error(400, "invalid_request", "One or more fields are invalid.", {
          name: "Use 1 to 80 characters without line breaks or control characters.",
        });
        return;
      }
      const group: Group = {
        groupId: `grp_${String(state.groups.length + 1).padStart(4, "0")}`,
        name,
        role: "admin",
        createdAt: "2026-07-16T16:00:00.000Z",
      };
      state.groups.push(group);
      if (state.createGroupDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, state.createGroupDelayMs)
        );
      }
      await reply(201, { data: group });
      return;
    }

    const inviteMatch = url.pathname.match(/^\/api\/v1\/invites\/([^/]+)$/);
    if (inviteMatch && request.method() === "GET") {
      if (decodeURIComponent(inviteMatch[1]) !== state.invite.token) {
        await error(404, "invite_not_found", "Invite Link is not valid.");
        return;
      }
      await reply(200, { data: { groupName: walkerLabs.name } });
      return;
    }

    const joinMatch = url.pathname.match(/^\/api\/v1\/invites\/([^/]+)\/actions\/join$/);
    if (joinMatch && request.method() === "POST") {
      if (decodeURIComponent(joinMatch[1]) !== state.invite.token) {
        await error(404, "invite_not_found", "Invite Link is not valid.");
        return;
      }
      if (state.membershipDenied) {
        await error(403, "membership_denied", "Membership could not be granted.");
        return;
      }
      const existing = state.groups.find((group) => group.groupId === walkerLabs.groupId);
      const joined = existing ?? { ...walkerLabs, role: "member" as const };
      if (!existing) {
        state.groups.push(joined);
      }
      if (!state.members.some((member) => member.userId === state.user.userId)) {
        state.members.push({
          userId: state.user.userId,
          username: state.user.username,
          role: "member",
          joinedAt: "2026-07-16T16:00:00.000Z",
        });
        state.knownUsers.set(state.user.userId, state.user.username);
        state.invite = { ...state.invite, remainingJoins: state.invite.remainingJoins - 1 };
      }
      await reply(200, { data: joined });
      return;
    }

    const groupMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)$/);
    if (groupMatch && request.method() === "PATCH") {
      const groupId = decodeURIComponent(groupMatch[1]);
      const group = state.groups.find((item) => item.groupId === groupId);
      if (!group) {
        await error(404, "group_not_found", "The requested Group was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      const { name: rawName } = request.postDataJSON() as { name?: unknown };
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (!name) {
        await error(400, "invalid_request", "One or more fields are invalid.", {
          name: "Use 1 to 80 characters without line breaks or control characters.",
        });
        return;
      }
      const renamed = { ...group, name };
      state.groups = state.groups.map((item) => item.groupId === groupId ? renamed : item);
      await reply(200, { data: renamed });
      return;
    }

    const leaveMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/actions\/leave$/);
    if (leaveMatch && request.method() === "POST") {
      const groupId = decodeURIComponent(leaveMatch[1]);
      const group = state.groups.find((item) => item.groupId === groupId);
      if (!group) {
        await error(404, "group_not_found", "The requested Group was not found.");
        return;
      }
      const ownsOpenTask = state.tasks.some((task) =>
        task.groupId === groupId &&
        task.state === "open" &&
        task.assignee.state === "assigned" &&
        task.assignee.userId === state.user.userId
      );
      if (ownsOpenTask) {
        await error(409, "open_tasks_assigned", "Reassign or complete your open Tasks before leaving.");
        return;
      }
      const admins = state.members.filter((member) => member.role === "admin");
      if (group.role === "admin" && admins.length === 1) {
        await error(409, "last_admin", "Promote another Admin before leaving.");
        return;
      }
      state.groups = state.groups.filter((item) => item.groupId !== groupId);
      state.members = state.members.filter((member) => member.userId !== state.user.userId);
      await route.fulfill({ status: 204 });
      return;
    }

    const endMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/actions\/end$/);
    if (endMatch && request.method() === "POST") {
      const groupId = decodeURIComponent(endMatch[1]);
      const group = state.groups.find((item) => item.groupId === groupId);
      if (!group) {
        await error(404, "group_not_found", "The requested Group was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      const { confirmationName } = request.postDataJSON() as { confirmationName?: unknown };
      if (confirmationName !== group.name) {
        await error(409, "confirmation_mismatch", "Enter the current Group Name exactly.");
        return;
      }
      if (state.members.length !== 1) {
        await error(409, "members_remain", "Remove every other Member before ending this Group.");
        return;
      }
      state.groups = state.groups.filter((item) => item.groupId !== groupId);
      state.members = [];
      state.tasks = state.tasks.filter((task) => task.groupId !== groupId);
      state.bans = [];
      await route.fulfill({ status: 204 });
      return;
    }

    const inviteAdminMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/invite-link(?:\/actions\/rotate)?$/);
    if (inviteAdminMatch) {
      const group = state.groups.find((item) => item.groupId === decodeURIComponent(inviteAdminMatch[1]));
      if (!group) {
        await error(404, "group_not_found", "The requested Group was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      if (request.method() === "GET" && !url.pathname.endsWith("/actions/rotate")) {
        await reply(200, { data: state.invite });
        return;
      }
      if (request.method() === "POST" && url.pathname.endsWith("/actions/rotate")) {
        state.invite = {
          ...state.invite,
          token: `${state.invite.token}_rotated`,
          url: `${state.invite.url}_rotated`,
          issuedAt: "2026-07-16T17:00:00.000Z",
          expiresAt: "2026-07-23T17:00:00.000Z",
          remainingJoins: 25,
        };
        await reply(200, { data: state.invite });
        return;
      }
    }

    const memberActionMatch = url.pathname.match(
      /^\/api\/v1\/groups\/([^/]+)\/members\/([^/]+)\/actions\/(promote|demote|kick)$/,
    );
    if (memberActionMatch && request.method() === "POST") {
      const [, encodedGroupId, encodedUserId, action] = memberActionMatch;
      const group = state.groups.find((item) => item.groupId === decodeURIComponent(encodedGroupId));
      const userId = decodeURIComponent(encodedUserId);
      const member = state.members.find((item) => item.userId === userId);
      if (!group || !member) {
        await error(404, "member_not_found", "Member was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      if (action === "kick") {
        if (userId === state.user.userId) {
          await error(409, "self_removal", "Use Leave Group to remove yourself.");
          return;
        }
        removeMember(userId);
        await route.fulfill({ status: 204 });
        return;
      }
      const role = action === "promote" ? "admin" as const : "member" as const;
      const updated = { ...member, role };
      state.members = state.members.map((item) => item.userId === userId ? updated : item);
      if (userId === state.user.userId) {
        state.groups = state.groups.map((item) => item.groupId === group.groupId ? { ...item, role } : item);
      }
      await reply(200, { data: updated });
      return;
    }

    const bansMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/bans$/);
    if (bansMatch && request.method() === "GET") {
      const group = state.groups.find((item) => item.groupId === decodeURIComponent(bansMatch[1]));
      if (!group) {
        await error(404, "group_not_found", "The requested Group was not found.");
      } else if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
      } else {
        await reply(200, { data: state.bans, nextCursor: null });
      }
      return;
    }

    const banMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/bans\/actions\/ban$/);
    if (banMatch && request.method() === "POST") {
      const group = state.groups.find((item) => item.groupId === decodeURIComponent(banMatch[1]));
      const { userId } = request.postDataJSON() as { userId?: string };
      const member = state.members.find((item) => item.userId === userId);
      if (!group || !userId || !state.knownUsers.has(userId)) {
        await error(404, "user_not_found", "User was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      if (userId === state.user.userId) {
        await error(409, "self_removal", "Admins cannot ban themselves.");
        return;
      }
      const ban = { userId, username: state.knownUsers.get(userId) ?? null, bannedAt: "2026-07-16T17:00:00.000Z" };
      state.bans.push(ban);
      if (member) removeMember(userId);
      await reply(201, { data: ban });
      return;
    }

    const unbanMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/bans\/([^/]+)\/actions\/unban$/);
    if (unbanMatch && request.method() === "POST") {
      const group = state.groups.find((item) => item.groupId === decodeURIComponent(unbanMatch[1]));
      const userId = decodeURIComponent(unbanMatch[2]);
      if (!group || !state.bans.some((ban) => ban.userId === userId)) {
        await error(404, "ban_not_found", "Ban was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      state.bans = state.bans.filter((ban) => ban.userId !== userId);
      await route.fulfill({ status: 204 });
      return;
    }

    const membersMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/members$/);
    if (membersMatch && request.method() === "GET") {
      await reply(200, { data: state.members, nextCursor: null });
      return;
    }

    const tasksMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/tasks$/);
    if (tasksMatch && request.method() === "GET") {
      if (state.hangTasks) return await new Promise<void>(() => undefined);
      if (state.failTaskNetwork) {
        await route.abort("failed");
        return;
      }
      if (state.taskFailureStatus) {
        const code = state.taskFailureStatus === 401
          ? "authentication_required"
          : state.taskFailureStatus === 403
            ? "forbidden"
            : "internal_error";
        await error(state.taskFailureStatus, code, "The Task List is unavailable.");
        return;
      }
      state.taskQueries.push(url.searchParams.toString());
      const status = url.searchParams.get("status") ?? "open";
      const assignee = url.searchParams.get("assignee");
      const tasks = state.tasks.filter((task) => {
        if (status !== "all" && task.state !== status) return false;
        if (assignee === null) return true;
        return assignee === "unassigned"
          ? task.assignee.state === "unassigned"
          : task.assignee.state === "assigned" && task.assignee.username === assignee;
      });
      await reply(200, { data: tasks, nextCursor: null });
      return;
    }
    if (tasksMatch && request.method() === "POST") {
      if (await handleMockTaskMutationPreflight()) return;
      const input = request.postDataJSON() as {
        text?: unknown;
        assigneeUsername?: unknown;
        priority?: unknown;
        dueDate?: unknown;
      };
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text) {
        await error(400, "invalid_request", "One or more fields are invalid.", {
          text: "Use 1 to 2,000 characters.",
        });
        return;
      }
      const member = state.members.find((item) => item.username === input.assigneeUsername);
      if (!member || member.username === null) {
        await error(409, "assignee_not_member", "The assignee is not a current Member.");
        return;
      }
      const task: Task = {
        taskId: `task_${String(state.tasks.length + 1).padStart(4, "0")}`,
        groupId: decodeURIComponent(tasksMatch[1]),
        text,
        assignee: { state: "assigned", userId: member.userId, username: member.username },
        priority: ["high", "normal", "low"].includes(String(input.priority))
          ? input.priority as "high" | "normal" | "low"
          : "normal",
        dueDate: typeof input.dueDate === "string" ? input.dueDate : null,
        state: "open",
        createdAt: "2026-07-16T18:00:00.000Z",
        completedAt: null,
      };
      state.tasks.push(task);
      await reply(201, { data: task });
      return;
    }

    const taskMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/tasks\/([^/]+)$/);
    if (taskMatch && request.method() === "PATCH") {
      if (await handleMockTaskMutationPreflight()) return;
      const taskId = decodeURIComponent(taskMatch[2]);
      const task = state.tasks.find((item) => item.taskId === taskId);
      if (!task) {
        await error(404, "not_found", "The requested resource was not found.");
        return;
      }
      if (task.state === "done") {
        await error(409, "task_done", "Reopen the Task before editing it.");
        return;
      }
      const input = request.postDataJSON() as {
        text?: string;
        assigneeUsername?: string;
        priority?: "high" | "normal" | "low";
        dueDate?: string | null;
      };
      let nextAssignee = task.assignee;
      if (input.assigneeUsername !== undefined) {
        const member = state.members.find((item) => item.username === input.assigneeUsername);
        if (!member || member.username === null) {
          await error(409, "assignee_not_member", "The assignee is not a current Member.");
          return;
        }
        nextAssignee = { state: "assigned", userId: member.userId, username: member.username };
      }
      const updated = {
        ...task,
        ...(input.text !== undefined ? { text: input.text.trim() } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        assignee: nextAssignee,
      };
      state.tasks = state.tasks.map((item) => item.taskId === taskId ? updated : item);
      await reply(200, { data: updated });
      return;
    }
    if (taskMatch && request.method() === "DELETE") {
      if (await handleMockTaskMutationPreflight()) return;
      const taskId = decodeURIComponent(taskMatch[2]);
      state.tasks = state.tasks.filter((item) => item.taskId !== taskId);
      await route.fulfill({ status: 204 });
      return;
    }

    const taskStateMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/tasks\/([^/]+)\/state$/);
    if (taskStateMatch && request.method() === "PUT") {
      const taskId = decodeURIComponent(taskStateMatch[2]);
      const desired = (request.postDataJSON() as { state: "open" | "done" }).state;
      state.taskStateRequests.push({ state: desired, taskId });
      if (await handleMockTaskMutationPreflight()) return;
      const task = state.tasks.find((item) => item.taskId === taskId);
      if (!task) {
        await error(404, "not_found", "The requested resource was not found.");
        return;
      }
      const updated: Task = {
        ...task,
        state: desired,
        completedAt: desired === "done" ? task.completedAt ?? "2026-07-16T18:30:00.000Z" : null,
      };
      state.tasks = state.tasks.map((item) => item.taskId === taskId ? updated : item);
      await reply(200, { data: updated });
      return;
    }

    const groupId = decodeURIComponent(url.pathname.slice("/api/v1/groups/".length));
    if (request.method() === "GET" && groupId) {
      if (state.getGroupDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, state.getGroupDelayMs)
        );
      }
      if (state.getGroupFailureStatus) {
        await error(
          state.getGroupFailureStatus,
          "authentication_required",
          "Authentication is required.",
        );
        return;
      }
      const group = state.groups.find((item) => item.groupId === groupId);
      if (!group || state.concealedGroupIds.has(groupId)) {
        await error(404, "not_found", "The requested resource was not found.");
        return;
      }
      await reply(200, { data: group });
      return;
    }

    await error(404, "not_found", "The requested resource was not found.");
  });

  return state;
}

test("runs the production sign-in, Username, Group creation, persistence, and sign-out path", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Your team. One clear list." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Claim your Username" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toHaveCount(0);

  await page.getByLabel("Username").fill("Shane");
  await page.getByRole("button", { name: "Claim Username" }).click();
  await expect(page.getByRole("alert")).toContainText("lowercase letters");
  await page.getByLabel("Username").fill("shane");
  await page.getByRole("button", { name: "Claim Username" }).click();

  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toHaveCount(0);
  await openGroupMenu(page);
  await page.getByRole("button", { name: "New Group" }).click();
  await expect(page.getByLabel("Group Name")).toBeFocused();
  await page.getByLabel("Group Name").fill("Walker Labs");
  await page.getByRole("button", { name: "Create Group" }).click();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("openjob-test:firebase-persistence"))).toBe("LOCAL");
  expect(state.authorizationHeaders.every((header) => header === "Bearer browser-test-token")).toBe(true);

  await signOut(page);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("public account deletion works without the installed app and clears browser state", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    signInMethods: ["google"],
    user: signedInUser,
  });
  await installDeletionReceiptStorageFailures(page, {});
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await expect(page.getByRole("heading", {
    name: "Delete your OpenJob User",
  })).toBeVisible();
  await expect(page.getByText("You do not need the app or support.")).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await seedDeletionNotificationState(page);
  await page.getByRole("button", { name: "Authenticate Google" }).click();
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "prepared"),
  );
  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete User" }).click();

  await expect(page.getByRole("status")).toContainText("were deleted");
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionPreparationBodies).toEqual([null]);
  expect(state.deletionRequests).toHaveLength(1);
  expect(state.deletionSubmissionHeaders).toEqual([state.deletionStatusToken]);
  expect(await page.evaluate(() => {
    const controls = (window as typeof window & {
      __openjobDeletionReceiptStorageFailures: {
        secondarySignedInAtSet: boolean[];
        values: string[];
      };
    }).__openjobDeletionReceiptStorageFailures;
    return {
      phases: controls.values.map((value) => JSON.parse(value).phase),
      secondarySignedInAtSet: controls.secondarySignedInAtSet,
    };
  })).toEqual({
    phases: ["prepared", "submitting", "completed"],
    secondarySignedInAtSet: [false, true, false],
  });
  const body = structuredClone(state.deletionRequests[0]) as {
    confirmation: string;
    credentials: Array<{
      credentialToken: string;
      provider: string;
      revocation: { idToken?: string; kind: string; value: string };
    }>;
  };
  expect(body.confirmation).toBe("delete");
  expect(body.credentials.map(({ provider }) => provider)).toEqual(["google"]);
  expect(body.credentials[0].revocation.kind).toBe("access_token");
  expect(body.credentials[0].credentialToken).toBeTruthy();
  expect(body.credentials[0].revocation.idToken).toBe(
    "browser-google-id-token",
  );
  expect(body.credentials[0].revocation.value).toBeTruthy();
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    receipt: JSON.parse(window.localStorage.getItem(
      "openjob:account-deletion-status-receipt",
    ) ?? "null"),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({
    draft: null,
    receipt: deletionReceipt(state.deletionStatusToken, "completed"),
    selectedGroup: null,
    session: null,
  });
  await expect.poll(() => deletionNotificationState(page)).toEqual({
    current: null,
    installation: null,
    pending: null,
    pushSubscription: null,
    unsubscribeCalls: 1,
  });

  await page.reload();

  await expect(page.getByRole("status")).toContainText("were deleted");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "completed"),
  );
  expect(state.deletionStatusRequests).toBe(0);

  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
});

test("pending account deletion survives reload and fails closed until completion", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    deletionRequestStatus: "pending",
    deletionStatus: "pending",
    signInMethods: ["google"],
    user: signedInUser,
  });
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await seedDeletionNotificationState(page);
  await page.getByRole("button", { name: "Authenticate Google" }).click();
  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete User" }).click();

  await expect(page.getByRole("status")).toContainText("Deletion is in progress");
  await expect(page.getByRole("button", {
    name: "Refresh deletion status",
  })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    receipt: JSON.parse(window.localStorage.getItem(
      "openjob:account-deletion-status-receipt",
    ) ?? "null"),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({
    draft: null,
    receipt: deletionReceipt(state.deletionStatusToken),
    selectedGroup: null,
    session: null,
  });
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionRequests).toHaveLength(1);
  expect(state.deletionSubmissionHeaders).toEqual([state.deletionStatusToken]);
  await expect.poll(() => deletionNotificationState(page)).toEqual({
    current: null,
    installation: null,
    pending: null,
    pushSubscription: null,
    unsubscribeCalls: 1,
  });

  await page.evaluate(() => {
    window.localStorage.setItem("openjob-test:firebase-session", "google");
  });
  const authorizationCount = state.authorizationHeaders.length;
  await page.reload();

  await expect(page.getByRole("status")).toContainText(
    "Deletion is in progress and will finish by",
  );
  await expect.poll(() => state.deletionStatusRequests).toBe(1);
  expect(state.authorizationHeaders.slice(authorizationCount)).toEqual([
    `Bearer ${state.deletionStatusToken}`,
  ]);

  state.deletionStatusFailureStatus = 503;
  await page.getByRole("button", { name: "Refresh deletion status" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "could not refresh deletion status",
  );
  await expect(page.getByRole("status")).toContainText("Deletion is in progress");
  await expect(page.getByText("were deleted")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken),
  );

  state.deletionStatusFailureStatus = null;
  state.deletionStatus = "completed";
  await page.getByRole("button", { name: "Refresh deletion status" }).click();

  await expect(page.getByRole("status")).toContainText("were deleted");
  await expect(page.getByRole("button", { name: "Refresh deletion status" })).toHaveCount(0);
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "completed"),
  );
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  expect(state.deletionRequests).toHaveLength(1);

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
});

test("pending account deletion recovers its capability when this browser has no receipt", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    meFailureStatus: 410,
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionPreparePayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: [],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
      statusToken: state.deletionStatusToken,
    },
  };
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByRole("status")).toContainText(
    "Deletion is in progress",
  );
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "submitting", null),
  );
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionPreparationBodies).toEqual([{
    credential: {
      credentialToken: "browser-test-token",
      provider: "google",
      revocation: {
        idToken: "browser-google-id-token",
        kind: "access_token",
        value: "browser-google-access",
      },
    },
  }]);
  expect(state.deletionStatusRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({ draft: null, selectedGroup: null, session: null });
});

test("pending deletion with only a restored Firebase session requires a fresh provider popup", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    meFailureStatus: 410,
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionPreparePayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: [],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
      statusToken: state.deletionStatusToken,
    },
  };
  await installDeletionPrivateState(page, { signedIn: true });
  await page.goto("/account-deletion");

  await expect(page.getByText(
    "Deletion is already in progress. Sign in again with the same provider",
  )).toBeVisible();
  expect(state.deletionPreparationRequests).toBe(0);
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBeNull();

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Deletion is in progress",
  );
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionPreparationBodies).toHaveLength(1);
  expect(state.deletionPreparationBodies[0]).toMatchObject({
    credential: {
      credentialToken: "browser-test-token",
      provider: "google",
    },
  });
});

test("pending deletion recovery purges a fresh provider proof when finalization already won", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    meFailureStatus: 410,
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionPreparePayload = {
    data: {
      completedAt: "2026-07-28T12:01:00.000Z",
      status: "completed",
    },
  };
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByRole("status")).toContainText("were deleted");
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionPreparationBodies).toHaveLength(1);
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBeNull();
  expect(await page.evaluate(() => (
    window as typeof window & {
      __openjobFirebaseTest: { secondarySignedIn(): boolean };
    }
  ).__openjobFirebaseTest.secondarySignedIn())).toBe(false);
});

test("the public deletion page removes a recreated Firebase identity after finalization", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    credentialRecognized: false,
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionPreparePayload = {
    data: {
      completedAt: "2026-07-28T12:01:00.000Z",
      status: "completed",
    },
  };
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByRole("status")).toContainText("were deleted");
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionPreparationBodies).toEqual([{
    credential: {
      credentialToken: "browser-test-token",
      provider: "google",
      revocation: {
        idToken: "browser-google-id-token",
        kind: "access_token",
        value: "browser-google-access",
      },
    },
  }]);
  expect(state.identityRequests).toEqual([]);
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBeNull();
});

test("pending deletion recovery retries the exact in-memory proof across transient failures while access stays blocked", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    meFailureStatus: 410,
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionPreparationFailureStatuses.push(0, 429, 503);
  state.deletionPreparePayload = {
    data: {
      completedAt: "2026-07-28T12:01:00.000Z",
      status: "completed",
    },
  };
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect.poll(() => state.deletionPreparationRequests).toBeGreaterThan(0);
  await expect(page.getByRole("status")).toContainText(
    "Access is blocked while OpenJob retries",
  );
  await expect(page.getByRole("button", {
    name: "Continue with Google",
  })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({ draft: null, selectedGroup: null, session: null });

  await expect(page.getByRole("status")).toContainText("were deleted");
  expect(state.deletionPreparationRequests).toBe(4);
  expect(state.deletionPreparationBodies).toEqual(Array.from(
    { length: 4 },
    () => ({
      credential: {
        credentialToken: "browser-test-token",
        provider: "google",
        revocation: {
          idToken: "browser-google-id-token",
          kind: "access_token",
          value: "browser-google-access",
        },
      },
    }),
  ));
  expect(await page.evaluate(() => JSON.stringify({
    local: { ...window.localStorage },
    session: { ...window.sessionStorage },
  }))).not.toContain("browser-google-access");
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
});

test("pending deletion recovery clears its proof after the transient retry bound", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    meFailureStatus: 410,
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionPreparationFailureStatuses.push(503, 503, 503, 503, 503);
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "retry limit was reached",
  );
  await expect(page.getByRole("button", {
    name: "Continue with Google",
  })).toBeVisible();
  expect(state.deletionPreparationRequests).toBe(4);
  await page.waitForTimeout(750);
  expect(state.deletionPreparationRequests).toBe(4);
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBeNull();
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
});

test("pending deletion recovery clears an expired in-memory proof without another PUT", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeNow = Date.now.bind(Date);
    let offset = 0;
    Date.now = () => nativeNow() + offset;
    Object.defineProperty(window, "__openjobRecoveryClock", {
      configurable: true,
      value: {
        expire() {
          offset += 5 * 60 * 1_000;
        },
      },
    });
  });
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    meFailureStatus: 410,
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionPreparationFailureStatuses.push(503, 503);
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => state.deletionPreparationRequests).toBe(1);
  await page.evaluate(() => (
    window as typeof window & {
      __openjobRecoveryClock: { expire(): void };
    }
  ).__openjobRecoveryClock.expire());

  await expect(page.getByRole("alert")).toContainText(
    "provider proof expired",
  );
  await expect(page.getByRole("button", {
    name: "Continue with Google",
  })).toBeVisible();
  expect(state.deletionPreparationRequests).toBe(1);
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
});

test("pending account deletion refreshes only the requested provider through its status capability", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    deletionStatus: "pending",
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionStatusPayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: ["google"],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  };
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await installDeletionPrivateState(page, { signedIn: true });
  await page.goto("/account-deletion");

  await expect(page.getByRole("button", {
    name: "Reauthenticate Google",
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Reauthenticate Apple",
  })).toHaveCount(0);
  await page.getByRole("button", { name: "Reauthenticate Google" }).click();

  await expect(page.getByRole("status")).toContainText("were deleted");
  expect(state.deletionRefreshRequests).toEqual([{
    credential: {
      credentialToken: "browser-fresh-google-token",
      provider: "google",
      revocation: {
        idToken: "browser-google-id-token",
        kind: "access_token",
        value: "browser-google-access",
      },
    },
  }]);
  expect(state.authorizationHeaders.filter(
    (header) => header === `Bearer ${state.deletionStatusToken}`,
  )).toHaveLength(2);
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "completed"),
  );
  expect(await page.evaluate(() => (
    window as typeof window & {
      __openjobFirebaseTest: { secondarySignedIn(): boolean };
    }
  ).__openjobFirebaseTest.secondarySignedIn())).toBe(false);
});

test("provider refresh keeps completed deletion blocked until failed secondary cleanup is retried", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, { deletionStatus: "pending" });
  state.deletionRefreshDelayMs = 500;
  state.deletionStatusPayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: ["google"],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  };
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Reauthenticate Google" }).click();
  await expect.poll(() => state.deletionRefreshRequests.length).toBe(1);
  await expect(page.getByRole("button", {
    name: "Refreshing provider…",
  })).toBeDisabled();
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "openjob-test:secondary-signout-failure",
      "once",
    );
  });

  await expect(page.getByRole("status")).toContainText("needs local cleanup");
  await expect(page.getByRole("alert")).toContainText(
    "could not finish clearing this browser",
  );
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken),
  );
  await expect(page.getByRole("button", { name: "Retry local cleanup" })).toBeVisible();

  await page.getByRole("button", { name: "Retry local cleanup" }).click();

  await expect(page.getByRole("status")).toContainText("were deleted");
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "completed"),
  );
});

test("pending account deletion transitions exact Apple and Google reauthentication proofs", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, { deletionStatus: "pending" });
  state.deletionStatusPayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: ["apple", "google"],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  };
  state.deletionRefreshPayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: ["google"],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
      statusToken: state.deletionStatusToken,
    },
  };
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Reauthenticate Apple" }).click();

  await expect.poll(() => state.deletionRefreshRequests.length).toBe(1);
  expect(state.deletionRefreshRequests[0]).toEqual({
    credential: {
      credentialToken: "browser-fresh-apple-token",
      provider: "apple",
      revocation: {
        clientId: "dev.openjob.auth.nonprod",
        kind: "access_token",
        value: "browser-apple-access",
      },
    },
  });
  await expect(page.getByRole("button", {
    name: "Reauthenticate Apple",
  })).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: "Reauthenticate Google",
  })).toBeVisible();

  state.deletionRefreshPayload = undefined;
  await page.getByRole("button", { name: "Reauthenticate Google" }).click();

  await expect(page.getByRole("status")).toContainText("were deleted");
  expect(state.deletionRefreshRequests[1]).toEqual({
    credential: {
      credentialToken: "browser-fresh-google-token",
      provider: "google",
      revocation: {
        idToken: "browser-google-id-token",
        kind: "access_token",
        value: "browser-google-access",
      },
    },
  });
});

test("provider refresh rejects a mismatched pending status capability response", async ({ page }) => {
  const state = await installApi(page, { deletionStatus: "pending" });
  state.deletionStatusPayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: ["google"],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  };
  state.deletionRefreshPayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: [],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
      statusToken: "v1.wrong-capability.wrong-capability-signature",
    },
  };
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Reauthenticate Google" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "unexpected account-deletion response",
  );
  await expect(page.getByRole("status")).toContainText(
    "Deletion is in progress",
  );
  await expect(page.getByText("were deleted")).toHaveCount(0);
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken),
  );
});

test("pending provider refresh exposes failed local cleanup as retryable", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, { deletionStatus: "pending" });
  state.deletionRefreshDelayMs = 500;
  state.deletionStatusPayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: ["google"],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  };
  state.deletionRefreshPayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: [],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
      statusToken: state.deletionStatusToken,
    },
  };
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Reauthenticate Google" }).click();
  await expect.poll(() => state.deletionRefreshRequests.length).toBe(1);
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "openjob-test:secondary-signout-failure",
      "once",
    );
  });

  await expect(page.getByRole("alert")).toContainText(
    "Refresh deletion status to retry local cleanup",
  );
  await expect(page.getByRole("status")).toContainText(
    "Deletion is in progress",
  );
  await expect(page.getByRole("button", {
    name: "Reauthenticate Google",
  })).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: "Refresh deletion status",
  })).toBeVisible();
});

test("pending account deletion preflight blocks before fresh provider authentication", async ({ page }) => {
  await installNotificationEnvironment(page);
  const state = await installApi(page, {
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionPreparePayload = {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: [],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
      statusToken: state.deletionStatusToken,
    },
  };
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await seedDeletionNotificationState(page);
  await page.getByRole("button", { name: "Authenticate Google" }).click();

  await expect(page.getByRole("status")).toContainText("Deletion is in progress");
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "submitting", null),
  );
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionRequests).toHaveLength(0);
  expect(await page.evaluate(() => (
    window as typeof window & {
      __openjobFirebaseTest: { secondarySignedIn(): boolean };
    }
  ).__openjobFirebaseTest.secondarySignedIn())).toBe(false);
  await expect.poll(() => deletionNotificationState(page)).toEqual({
    current: null,
    installation: null,
    pending: null,
    pushSubscription: null,
    unsubscribeCalls: 1,
  });
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({ draft: null, selectedGroup: null, session: null });
});

test("account deletion does not POST when the prepared receipt cannot be saved", async ({ page }) => {
  const state = await installApi(page, {
    deletionRequestStatus: "pending",
    deletionStatus: "pending",
    signInMethods: ["google"],
    user: signedInUser,
  });
  await installDeletionReceiptStorageFailures(page, { failSet: true });
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await page.getByRole("button", { name: "Authenticate Google" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Fresh authentication did not start",
  );
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Permanently delete User" })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    receipt: window.localStorage.getItem(
      "openjob:account-deletion-status-receipt",
    ),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({
    draft: "private draft",
    receipt: null,
    selectedGroup: "grp_private",
    session: "google",
  });
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionRequests).toHaveLength(0);
  expect(await page.evaluate(() => (
    window as typeof window & {
      __openjobFirebaseTest: { secondarySignedIn(): boolean };
    }
  ).__openjobFirebaseTest.secondarySignedIn())).toBe(false);
});

test("account deletion does not POST when submitting phase cannot be saved", async ({ page }) => {
  const state = await installApi(page, {
    deletionStatus: "not_started",
    signInMethods: ["google"],
    user: signedInUser,
  });
  await installDeletionReceiptStorageFailures(page, { failSetAt: 2 });
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await page.getByRole("button", { name: "Authenticate Google" }).click();
  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete User" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "prepared but not submitted",
  );
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "prepared"),
  );
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionRequests).toHaveLength(0);
  expect(await page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({
    draft: "private draft",
    selectedGroup: "grp_private",
    session: "google",
  });

  await page.reload();

  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
  expect(state.deletionStatusRequests).toBe(1);
  expect(state.deletionRequests).toHaveLength(0);
});

test("completed deletion retains submitting status when final confirmation cannot be saved", async ({ page }) => {
  const state = await installApi(page, {
    signInMethods: ["google"],
    user: signedInUser,
  });
  await installDeletionReceiptStorageFailures(page, { failSetAt: 3 });
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await page.getByRole("button", { name: "Authenticate Google" }).click();
  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete User" }).click();

  await expect(page.getByRole("status")).toContainText("needs local cleanup");
  await expect(page.getByRole("alert")).toContainText(
    "could not save final confirmation",
  );
  await expect(page.getByText("were deleted")).toHaveCount(0);
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken),
  );

  await page.evaluate(() => {
    const controls = (window as typeof window & {
      __openjobDeletionReceiptStorageFailures: { failSetAt: number | null };
    }).__openjobDeletionReceiptStorageFailures;
    controls.failSetAt = null;
  });
  await page.getByRole("button", { name: "Retry local cleanup" }).click();

  await expect(page.getByRole("status")).toContainText("were deleted");
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "completed"),
  );
  expect(state.deletionRequests).toHaveLength(1);
});

for (const cleanupFailure of ["localStorage", "indexedDB", "push"] as const) {
  test(`notification ${cleanupFailure} purge failure blocks completed deletion confirmation`, async ({ page }) => {
    await installNotificationEnvironment(page);
    const state = await installApi(page, {
      signInMethods: ["google"],
      user: signedInUser,
    });
    await page.goto("/account-deletion");

    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByText("Deleting @shane.")).toBeVisible();
    await seedDeletionNotificationState(page);
    await page.getByRole("button", { name: "Authenticate Google" }).click();
    await page.evaluate(async (failure) => {
      if (failure === "localStorage") {
        const nativeRemoveItem = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function (key) {
          if (
            this === window.localStorage &&
            key === "openjob:notification-installation"
          ) {
            throw new Error("Test notification localStorage failure.");
          }
          return nativeRemoveItem.call(this, key);
        };
      } else if (failure === "indexedDB") {
        Object.defineProperty(window.indexedDB, "open", {
          configurable: true,
          value() {
            throw new Error("Test notification IndexedDB failure.");
          },
        });
      } else {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) throw new Error("Test Push subscription was not seeded.");
        subscription.unsubscribe = async () => {
          throw new Error("Test Push unsubscribe failure.");
        };
      }
    }, cleanupFailure);
    await page.getByLabel(/Type DELETE/).fill("DELETE");
    await page.getByRole("button", { name: "Permanently delete User" }).click();

    await expect(page.getByRole("status")).toContainText("needs local cleanup");
    await expect(page.getByRole("alert")).toContainText(
      cleanupFailure === "localStorage"
        ? "Test notification localStorage failure"
        : cleanupFailure === "indexedDB"
          ? "Test notification IndexedDB failure"
          : "Test Push unsubscribe failure",
    );
    await expect(page.getByText("were deleted")).toHaveCount(0);
    await expect.poll(() => storedDeletionReceipt(page)).toEqual(
      deletionReceipt(state.deletionStatusToken),
    );
  });
}

test("completed account deletion requires explicit acknowledgement and retains a failed clear", async ({ page }) => {
  const state = await installApi(page, {
    deletionStatus: "completed",
  });
  await installDeletionReceiptStorageFailures(page, {
    failRemove: true,
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await installDeletionPrivateState(page, { signedIn: true });
  await page.goto("/account-deletion");

  await expect(page.getByRole("status")).toContainText("were deleted");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    receipt: window.localStorage.getItem(
      "openjob:account-deletion-status-receipt",
    ),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({
    draft: null,
    receipt: JSON.stringify(deletionReceipt(state.deletionStatusToken, "completed")),
    selectedGroup: null,
    session: null,
  });

  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(
    "could not acknowledge final deletion status",
  );
  await expect(page.getByRole("status")).toContainText("were deleted");
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "completed"),
  );

  await page.evaluate(() => {
    const controls = (window as typeof window & {
      __openjobDeletionReceiptStorageFailures: { failRemove: boolean };
    }).__openjobDeletionReceiptStorageFailures;
    controls.failRemove = false;
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
  expect(state.deletionStatusRequests).toBe(1);
});

test("completed account deletion retries failed sign-out before final confirmation", async ({ page }) => {
  const state = await installApi(page, {
    deletionStatus: "completed",
  });
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await installDeletionPrivateState(page, { signedIn: true });
  await page.goto("/account-deletion?scenario=signout-failure");

  await expect(page.getByRole("status")).toContainText(
    "needs local cleanup",
  );
  await expect(page.getByRole("button", { name: "Retry local cleanup" })).toBeVisible();
  await expect(page.getByText("were deleted")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    receipt: window.localStorage.getItem(
      "openjob:account-deletion-status-receipt",
    ),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({
    draft: null,
    receipt: JSON.stringify(deletionReceipt(state.deletionStatusToken)),
    selectedGroup: null,
    session: "google",
  });

  await page.getByRole("button", { name: "Retry local cleanup" }).click();

  await expect(page.getByRole("status")).toContainText("were deleted");
  await expect(page.getByRole("button", { name: "Retry local cleanup" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    receipt: window.localStorage.getItem(
      "openjob:account-deletion-status-receipt",
    ),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({
    receipt: JSON.stringify(deletionReceipt(state.deletionStatusToken, "completed")),
    session: null,
  });
  expect(state.deletionStatusRequests).toBe(1);
});

test("immediate completed account deletion blocks on failed local sign-out", async ({ page }) => {
  const state = await installApi(page, {
    signInMethods: ["google"],
    user: signedInUser,
  });
  await installDeletionPrivateState(page);
  await page.goto("/account-deletion?scenario=signout-failure");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await page.getByRole("button", { name: "Authenticate Google" }).click();
  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete User" }).click();

  await expect(page.getByRole("status")).toContainText("needs local cleanup");
  await expect(page.getByRole("button", { name: "Retry local cleanup" })).toBeVisible();
  await expect(page.getByText("were deleted")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    receipt: window.localStorage.getItem(
      "openjob:account-deletion-status-receipt",
    ),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({
    draft: null,
    receipt: JSON.stringify(deletionReceipt(state.deletionStatusToken)),
    selectedGroup: null,
    session: "google",
  });
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionRequests).toHaveLength(1);
  expect(state.deletionSubmissionHeaders).toEqual([state.deletionStatusToken]);

  await page.getByRole("button", { name: "Retry local cleanup" }).click();

  await expect(page.getByRole("status")).toContainText("were deleted");
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBeNull();
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken, "completed"),
  );
  expect(state.deletionRequests).toHaveLength(1);
});

test("prepared account deletion receipt recovers safely in a new process", async ({ page }) => {
  const state = await installApi(page, {
    deletionStatus: "not_started",
    user: signedInUser,
  });
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken, "prepared"),
  });
  await installDeletionPrivateState(page, { signedIn: true });
  await page.goto("/account-deletion");

  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
  expect(await page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({
    draft: "private draft",
    selectedGroup: "grp_private",
    session: "google",
  });
  expect(state.deletionStatusRequests).toBe(1);
  expect(state.deletionRequests).toHaveLength(0);
});

test("submitting prepared-intent receipt clears only after atomic cancellation", async ({ page }) => {
  const state = await installApi(page, {
    deletionStatus: "not_started",
  });
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await installDeletionPrivateState(page, { signedIn: true });
  await page.goto("/account-deletion");

  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({ draft: null, selectedGroup: null, session: null });
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  expect(state.deletionStatusRequests).toBe(1);
  expect(state.deletionRequests).toHaveLength(0);
});

test("prepared account deletion recovery does not clear a concurrent submitting phase", async ({ page }) => {
  const state = await installApi(page, {
    deletionStatus: "not_started",
  });
  state.deletionStatusDelayMs = 250;
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken, "prepared"),
  });
  await installDeletionPrivateState(page, { signedIn: true });
  await page.goto("/account-deletion");
  await expect.poll(() => state.deletionStatusRequests).toBe(1);

  await page.evaluate((receipt) => {
    window.localStorage.setItem(
      "openjob:account-deletion-status-receipt",
      JSON.stringify(receipt),
    );
  }, deletionReceipt(state.deletionStatusToken));

  await expect(page.getByRole("alert")).toContainText(
    "changed in another tab",
  );
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken),
  );
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({ draft: null, selectedGroup: null, session: null });
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  expect(state.deletionRequests).toHaveLength(0);
});

test("root account deletion guard redirects before authenticated bootstrap", async ({ page }) => {
  const state = await installApi(page, {
    deletionStatus: "not_started",
  });
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("openjob-test:firebase-session", "google");
  });

  await page.goto("/");

  await expect(page).toHaveURL(/\/account-deletion$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
  expect(state.authorizationHeaders).toEqual([
    `Bearer ${state.deletionStatusToken}`,
  ]);
});

test("root account deletion guard redirects on a cross-tab receipt write", async ({ page }) => {
  const state = await installApi(page, {
    deletionStatus: "not_started",
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  const otherPage = await page.context().newPage();
  await otherPage.goto("/");

  await otherPage.evaluate((receipt) => {
    window.localStorage.setItem(
      "openjob:account-deletion-status-receipt",
      JSON.stringify(receipt),
    );
  }, deletionReceipt(state.deletionStatusToken, "prepared"));

  await expect(page).toHaveURL(/\/account-deletion$/);
  await otherPage.close();
});

test("a sibling tab blocks without canceling the owner's prepared deletion", async ({ page }) => {
  await installNotificationEnvironment(page);
  const ownerState = await installApi(page, {
    signInMethods: ["google"],
    user: signedInUser,
  });
  ownerState.deletionSubmissionExpiresAt = "2099-07-28T12:05:00.000Z";
  ownerState.deletionPostDelayMs = 250;
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await page.getByRole("button", { name: "Authenticate Google" }).click();

  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(
      ownerState.deletionStatusToken,
      "prepared",
      ownerState.deletionSubmissionExpiresAt,
    ),
  );
  const ownerTabId = await page.evaluate(() =>
    window.sessionStorage.getItem("openjob:account-deletion-tab-id")
  );
  if (!ownerTabId) throw new Error("The owner tab ID was not saved.");

  const sibling = await page.context().newPage();
  await sibling.addInitScript((clonedOwnerId) => {
    window.sessionStorage.setItem(
      "openjob:account-deletion-tab-id",
      clonedOwnerId,
    );
  }, ownerTabId);
  await installNotificationEnvironment(sibling);
  const siblingState = await installApi(sibling, {
    signInMethods: ["google"],
    user: signedInUser,
  });
  siblingState.deletionSubmissionExpiresAt =
    ownerState.deletionSubmissionExpiresAt;
  await sibling.goto("/");
  await expect(sibling).toHaveURL(/\/account-deletion$/);
  await expect(sibling.getByRole("status")).toContainText(
    "Another tab is completing deletion",
  );
  expect(await sibling.evaluate(() =>
    window.sessionStorage.getItem("openjob:account-deletion-tab-id")
  )).not.toBe(ownerTabId);
  expect(siblingState.deletionStatusRequests).toBe(0);

  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page.getByRole("button", {
    name: "Permanently delete User",
  }).click();
  await expect.poll(() => ownerState.deletionRequests.length).toBe(1);
  expect(siblingState.deletionStatusRequests).toBe(0);

  await expect(page.getByRole("status")).toContainText("were deleted");
  expect(ownerState.deletionPreparationRequests).toBe(1);
  expect(ownerState.deletionSubmissionHeaders).toEqual([
    ownerState.deletionStatusToken,
  ]);
  await sibling.close();
});

test("past-deadline deletion requires operator completion without a false promise", async ({ page }) => {
  const state = await installApi(page, { deletionStatus: "pending" });
  state.deletionStatusPayload = {
    data: {
      deadline: "2026-07-28T12:00:00.000Z",
      reauthenticationProviders: ["google"],
      requestedAt: "2026-07-21T12:00:00.000Z",
      status: "pending",
    },
  };
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await page.goto("/account-deletion");

  await expect(page.getByRole("status")).toContainText(
    "Operator completion is required",
  );
  await expect(page.getByRole("status")).toContainText(
    "Complete the fresh provider prompt, then check again",
  );
  await expect(page.getByRole("status")).not.toContainText("will finish by");
});

test("account deletion rejects a near-valid preflight timestamp before fresh authentication", async ({ page }) => {
  const state = await installApi(page, {
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionPreparePayload = {
    data: {
      status: "not_started",
      statusToken: state.deletionStatusToken,
      submissionExpiresAt: "2026-07-28 12:05:00.000Z",
    },
  };
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await page.getByRole("button", { name: "Authenticate Google" }).click();

  await expect(page.getByRole("alert")).toContainText("unexpected account-deletion response");
  expect(state.deletionPreparationRequests).toBe(1);
  expect(state.deletionRequests).toHaveLength(0);
  await expect.poll(() => storedDeletionReceipt(page)).toBeNull();
  expect(await page.evaluate(() => (
    window as typeof window & {
      __openjobFirebaseTest: { secondarySignedIn(): boolean };
    }
  ).__openjobFirebaseTest.secondarySignedIn())).toBe(false);
});

test("account deletion rejects an invalid POST response and remains blocked", async ({ page }) => {
  const state = await installApi(page, {
    signInMethods: ["google"],
    user: signedInUser,
  });
  state.deletionPostPayload = {
    data: { completedAt: "2026-07-28T12:00:00.00Z", status: "completed" },
  };
  await page.goto("/account-deletion");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Deleting @shane.")).toBeVisible();
  await page.getByRole("button", { name: "Authenticate Google" }).click();
  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete User" }).click();

  await expect(page.getByRole("status")).toContainText(
    "status could not be confirmed",
  );
  await expect(page.getByRole("alert")).toContainText(
    "unexpected account-deletion response",
  );
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken),
  );
  expect(state.deletionRequests).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});

test("account deletion rejects an invalid GET response and remains blocked", async ({ page }) => {
  const state = await installApi(page);
  state.deletionStatusPayload = {
    data: {
      deadline: "2026-02-30T12:00:00.000Z",
      reauthenticationProviders: [],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  };
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(state.deletionStatusToken),
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("openjob-test:firebase-session", "google");
  });
  await page.goto("/account-deletion");

  await expect(page.getByRole("status")).toContainText(
    "status could not be confirmed",
  );
  await expect(page.getByRole("alert")).toContainText(
    "unexpected account-deletion response",
  );
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(state.deletionStatusToken),
  );
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBeNull();
  await expect(page.getByText("were deleted")).toHaveCount(0);
});

test("account deletion retains a fresh prepared receipt after a status read", async ({ page }) => {
  const state = await installApi(page);
  state.deletionSubmissionExpiresAt = "2099-07-28T12:05:00.000Z";
  state.deletionStatusPayload = {
    data: {
      status: "not_started",
      submissionExpired: false,
      submissionExpiresAt: state.deletionSubmissionExpiresAt,
    },
  };
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: deletionReceipt(
      state.deletionStatusToken,
      "prepared",
      state.deletionSubmissionExpiresAt,
    ),
  });
  await installDeletionPrivateState(page, { signedIn: true });
  await page.goto("/account-deletion");

  await expect(page.getByRole("status")).toContainText(
    "remains available until",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(
    deletionReceipt(
      state.deletionStatusToken,
      "prepared",
      state.deletionSubmissionExpiresAt,
    ),
  );
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBe("google");
  await expect(page.getByText("were deleted")).toHaveCount(0);
});

test("account deletion rejects a near-valid saved receipt timestamp and purges access", async ({ page }) => {
  const state = await installApi(page);
  const invalidReceipt = deletionReceipt(
    state.deletionStatusToken,
    "submitting",
    "2026-02-30T12:05:00.000Z",
  );
  await installDeletionReceiptStorageFailures(page, {
    initialReceipt: invalidReceipt,
  });
  await installDeletionPrivateState(page, { signedIn: true });
  await page.goto("/account-deletion");

  await expect(page.getByRole("alert")).toContainText(
    "could not read deletion status",
  );
  await expect(page.getByText("were deleted")).toHaveCount(0);
  await expect.poll(() => storedDeletionReceipt(page)).toEqual(invalidReceipt);
  await expect.poll(() => page.evaluate(() => ({
    draft: window.sessionStorage.getItem("openjob:pending-task-editor"),
    selectedGroup: window.localStorage.getItem("openjob:selected-group-id"),
    session: window.localStorage.getItem("openjob-test:firebase-session"),
  }))).toEqual({ draft: null, selectedGroup: null, session: null });
  expect(state.deletionStatusRequests).toBe(0);
});

test("offers Google and Apple and restores either linked web session", async ({ page }) => {
  await installNotificationEnvironment(page);
  await installApi(page, { user: signedInUser });
  await page.goto("/");

  const google = page.getByRole("button", { name: "Continue with Google" });
  const apple = page.getByRole("button", { name: "Continue with Apple" });
  await expect(google).toBeVisible();
  await expect(apple).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await google.focus();
  await page.keyboard.press("Tab");
  await expect(apple).toBeFocused();
  for (const button of [google, apple]) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() =>
      window.localStorage.getItem("openjob-test:firebase-session")
    )
  ).toBe("apple");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
});

test("offers the Preview QA tenant password path without retaining credentials", async ({ page }) => {
  await installNotificationEnvironment(page);
  await installApi(page, { user: signedInUser });
  await page.goto("/?scenario=qa-password-loading");

  const qaForm = page.getByRole("form", { name: "Preview QA sign-in" });
  const email = qaForm.getByLabel("QA email");
  const password = qaForm.getByLabel("QA password");
  await expect(qaForm).toBeVisible();
  await expect(email).toHaveAttribute("autocomplete", "email");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await expect(password).toHaveAttribute("type", "password");

  await email.fill("fixture@example.invalid");
  await password.fill("fixture-input");
  await qaForm.getByRole("button", { name: "Sign in as QA Two" }).click();
  await expect(
    qaForm.getByRole("button", { name: "Signing in…" }),
  ).toBeDisabled();
  await expect(email).toBeDisabled();
  await expect(password).toBeDisabled();

  await expect(
    page.getByRole("heading", { name: "Create your first Group" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "User menu" }).click();
  await expect(
    page.getByRole("button", { name: "Sign-in methods" }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => ({
    session: window.localStorage.getItem("openjob-test:firebase-session"),
    tenantId: (window as typeof window & {
      __openjobFirebaseTest: { primaryTenantId(): string | null };
    }).__openjobFirebaseTest.primaryTenantId(),
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
  }))).toEqual(expect.objectContaining({
    session: "qa-password",
    tenantId: null,
  }));
  const browserStorage = await page.evaluate(() => JSON.stringify({
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
  }));
  expect(browserStorage).not.toContain("fixture@example.invalid");
  expect(browserStorage).not.toContain("fixture-input");
});

test("keeps an unknown Preview QA credential from self-registering or linking", async ({ page }) => {
  const state = await installApi(page, { credentialRecognized: false });
  await page.goto("/");

  const qaForm = page.getByRole("form", { name: "Preview QA sign-in" });
  await qaForm.getByLabel("QA email").fill("fixture@example.invalid");
  await qaForm.getByLabel("QA password").fill("fixture-input");
  await qaForm.getByRole("button", { name: "Sign in as QA Two" }).click();

  await expect(page.getByRole("heading", {
    name: "This sign-in is not linked yet",
  })).toBeVisible();
  await expect(page.getByText(/Preview QA credential is not provisioned/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create new User" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Link existing" })).toHaveCount(0);
  expect(state.identityRequests).toEqual([]);

  await page.getByRole("button", { name: "Use a different sign-in" }).click();
  await expect(
    page.getByRole("form", { name: "Preview QA sign-in" }),
  ).toBeVisible();
  expect(state.identityRequests).toEqual([]);
});

test("reports an invalid Preview QA credential without leaking it", async ({ page }) => {
  await installApi(page);
  await page.goto("/?scenario=qa-password-error");

  const qaForm = page.getByRole("form", { name: "Preview QA sign-in" });
  await qaForm.getByLabel("QA email").fill("fixture@example.invalid");
  await qaForm.getByLabel("QA password").fill("fixture-input");
  await qaForm.getByRole("button", { name: "Sign in as QA Two" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "That Preview QA email or password is not valid.",
  );
  await expect(
    qaForm.getByRole("button", { name: "Sign in as QA Two" }),
  ).toBeEnabled();
  await expect(page.locator("body")).not.toContainText("fixture-input");
  expect(await page.evaluate(() =>
    (window as typeof window & {
      __openjobFirebaseTest: { primaryTenantId(): string | null };
    }).__openjobFirebaseTest.primaryTenantId()
  )).toBeNull();
});

test("requires an explicit choice before an unknown credential creates a User", async ({ page }) => {
  const state = await installApi(page, { credentialRecognized: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByRole("heading", {
    name: "This sign-in is not linked yet",
  })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create new User" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Link existing" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  for (const name of ["Create new User", "Link existing"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(state.identityRequests).toEqual([]);

  await page.getByRole("button", { name: "Create new User" }).click();
  await expect(page.getByRole("heading", { name: "Claim your Username" })).toBeVisible();
  expect(state.identityRequests).toEqual([
    { path: "/api/v1/me", body: { confirmation: "create" } },
  ]);
  const browserSurface = await page.evaluate(() => ({
    url: window.location.href,
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
  }));
  expect(JSON.stringify(browserSurface)).not.toContain("browser-test-token");
  expect(JSON.stringify(browserSurface)).not.toContain("browser-fresh");
});

test("links an unknown credential only after fresh provider auth and confirmation", async ({ page }) => {
  const state = await installApi(page, {
    credentialRecognized: false,
    groups: [walkerLabs],
    signInMethods: ["apple"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: "Link existing" }).click();

  await expect(page.getByRole("heading", { name: "Link an existing User" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Apple" }).click();
  await expect(page.getByRole("heading", { name: "Confirm linking" })).toBeVisible();
  await expect(page.getByText(/existing User @shane/u)).toBeVisible();
  expect(state.identityRequests).toEqual([]);

  const confirmLink = page.getByRole("button", { name: "Confirm link" });
  await expect(confirmLink).toHaveAccessibleDescription(/@shane/u);
  await confirmLink.click();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  expect(state.identityRequests).toEqual([
    {
      path: "/api/v1/me/sign-in-methods",
      body: {
        confirmation: "link",
        credentialToken: "browser-fresh-apple-token",
        expectedTargetUserId: "user_shane",
      },
    },
  ]);
  expect(state.linkAuthorizationHeaders).toEqual([
    "Bearer browser-test-token",
  ]);
  expect(state.user.userId).toBe("user_shane");
});

test("refuses an unrecognized existing-provider proof before confirmation", async ({ page }) => {
  const state = await installApi(page, {
    credentialRecognized: false,
    freshCredentialRecognized: false,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: "Link existing" }).click();
  await page.getByRole("button", { name: "Continue with Apple" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "not linked to an existing User",
  );
  await expect(
    page.getByRole("button", { name: "Confirm link" }),
  ).toHaveCount(0);
  expect(state.identityRequests).toEqual([]);
});

test("uses the actual auth event when a Firebase User has both providers", async ({ page }) => {
  await installApi(page, {
    credentialRecognized: false,
    signInMethods: ["apple"],
    user: signedInUser,
  });
  await page.goto("/?scenario=multi-provider");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: "Link existing" }).click();

  await expect(
    page.getByRole("button", { name: "Continue with Apple" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toHaveCount(0);
});

test("lets a signed-in User add a missing provider without leaving the User", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    groups: [walkerLabs],
    signInMethods: ["google"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();

  await expect(page.getByRole("dialog", { name: "Sign-in methods" })).toBeVisible();
  await expect(page.getByText("Google — Linked")).toBeVisible();
  await page.getByRole("button", { name: "Link Apple" }).click();
  await expect(page.getByRole("heading", { name: "Confirm linking" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm link" }),
  ).toBeFocused();
  expect(state.identityRequests).toEqual([]);
  await page.getByRole("button", { name: "Confirm link" }).click();

  await expect(page.getByRole("dialog", { name: "Sign-in methods" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  expect(state.user.userId).toBe("user_shane");
  expect(state.signInMethods).toEqual(["apple", "google"]);
});

test("traps method-dialog focus and restores it to the User menu", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    groups: [walkerLabs],
    signInMethods: ["google"],
    user: signedInUser,
  });
  await page.goto("/");
  const userMenu = page.getByRole("button", { name: "User menu" });
  await userMenu.click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();

  const dialog = page.getByRole("dialog", { name: "Sign-in methods" });
  const close = dialog.getByRole("button", { name: "Close" });
  const linkApple = dialog.getByRole("button", { name: "Link Apple" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(linkApple).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(userMenu).toBeFocused();
});

test("keeps a secondary provider proof until failed disposal can be retried", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    groups: [walkerLabs],
    signInMethods: ["google"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();
  await page.getByRole("button", { name: "Link Apple" }).click();
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "openjob-test:secondary-signout-failure",
      "once",
    );
  });

  await page.getByRole("button", { name: "Cancel linking" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "could not safely discard that provider sign-in",
  );
  await expect(
    page.getByRole("dialog", { name: "Confirm linking" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel linking" }).click();
  await expect(
    page.getByRole("dialog", { name: "Confirm linking" }),
  ).toHaveCount(0);
});

test("clears a secondary provider when fresh credential validation fails", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    groups: [walkerLabs],
    signInMethods: ["google"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "openjob-test:fresh-token-result-error",
      "auth/network-request-failed",
    );
  });

  await page.getByRole("button", { name: "Link Apple" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "You appear to be offline",
  );
  expect(await page.evaluate(() =>
    (window as typeof window & {
      __openjobFirebaseTest: { secondarySignedIn(): boolean };
    }).__openjobFirebaseTest.secondarySignedIn()
  )).toBe(false);

  await page.evaluate(() => {
    window.sessionStorage.removeItem(
      "openjob-test:fresh-token-result-error",
    );
  });
  await page.getByRole("button", { name: "Link Apple" }).click();
  await expect(
    page.getByRole("dialog", { name: "Confirm linking" }),
  ).toBeVisible();
});

test("discards a deferred secondary popup after an external sign-out", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    groups: [walkerLabs],
    signInMethods: ["google"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "openjob-test:defer-secondary-popup",
      "true",
    );
  });
  await page.getByRole("button", { name: "Link Apple" }).click();
  await expect(page.getByRole("button", { name: "Opening Apple…" })).toBeVisible();

  await page.evaluate(() => {
    (window as typeof window & {
      __openjobFirebaseTest: {
        emitPrimarySignedOut(): void;
        releaseSecondaryPopup(): void;
      };
    }).__openjobFirebaseTest.emitPrimarySignedOut();
  });
  await page.evaluate(() => {
    (window as typeof window & {
      __openjobFirebaseTest: { releaseSecondaryPopup(): void };
    }).__openjobFirebaseTest.releaseSecondaryPopup();
  });

  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Confirm linking" }),
  ).toHaveCount(0);
  expect(await page.evaluate(() =>
    (window as typeof window & {
      __openjobFirebaseTest: { secondarySignedIn(): boolean };
    }).__openjobFirebaseTest.secondarySignedIn()
  )).toBe(false);
});

test("does not let a delayed link restore an exited User over a new session", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    groups: [walkerLabs],
    linkDelayMs: 500,
    signInMethods: ["google"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();
  await page.getByRole("button", { name: "Link Apple" }).click();
  await page.getByRole("button", { name: "Confirm link" }).click();
  await expect.poll(() => state.identityRequests.length).toBe(1);

  await page.evaluate(() => {
    (window as typeof window & {
      __openjobFirebaseTest: { emitPrimarySignedOut(): void };
    }).__openjobFirebaseTest.emitPrimarySignedOut();
  });
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  state.user = {
    userId: "user_morgan",
    username: "morgan",
    usernameRequired: false,
  };
  state.groups = [];
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your first Group" }),
  ).toBeVisible();
  await page.waitForTimeout(600);

  await page.getByRole("button", { name: "User menu" }).click();
  await expect(page.getByText("Signed in as @morgan")).toBeVisible();
  expect(await page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBe("google");
});

test("keeps cancellation, offline auth, and identity conflicts recoverable", async ({ page }) => {
  const state = await installApi(page, { user: signedInUser });
  await page.goto("/?scenario=auth-cancel");
  await page.getByRole("button", { name: "Continue with Apple" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Sign-in was canceled. You can try again.",
  );
  await expect(page.getByRole("button", { name: "Continue with Apple" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Apple" }).click();
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();

  await signOut(page);
  state.groups = [walkerLabs];
  state.linkFailureCode = "sign_in_method_conflict";
  state.signInMethods = ["google"];
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  await page.goto("/?scenario=auth-offline");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();
  await page.getByRole("button", { name: "Link Apple" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "You appear to be offline. Check your connection and try again.",
  );
  await page.getByRole("button", { name: "Link Apple" }).click();
  await page.getByRole("button", { name: "Confirm link" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "belongs to another User and cannot be linked",
  );
  await expect(page.getByRole("button", { name: "Link Apple" })).toBeVisible();
  expect(state.user.userId).toBe("user_shane");
});

test("re-authenticates an expired linking proof without signing out the User", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    groups: [walkerLabs],
    linkFailureCode: "fresh_authentication_required",
    signInMethods: ["google"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();
  await page.getByRole("button", { name: "Link Apple" }).click();
  await page.getByRole("button", { name: "Confirm link" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "provider confirmation expired",
  );
  await expect(page.getByRole("button", { name: "Link Apple" })).toBeVisible();
  expect(await page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBe("signed-in");

  state.linkFailureCode = null;
  await page.getByRole("button", { name: "Link Apple" }).click();
  await page.getByRole("button", { name: "Confirm link" }).click();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  expect(state.signInMethods).toEqual(["apple", "google"]);
});

test("discards an expired secondary token without expiring the primary session", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    groups: [walkerLabs],
    signInMethods: ["google"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();
  await page.getByRole("button", { name: "Link Apple" }).click();
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "openjob-test:fresh-token-error",
      "auth/user-token-expired",
    );
  });
  await page.getByRole("button", { name: "Confirm link" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "provider confirmation expired",
  );
  await expect(page.getByRole("button", { name: "Link Apple" })).toBeVisible();
  expect(await page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBe("signed-in");
  expect(await page.evaluate(() =>
    (window as typeof window & {
      __openjobFirebaseTest: { secondarySignedIn(): boolean };
    }).__openjobFirebaseTest.secondarySignedIn()
  )).toBe(false);
  expect(state.identityRequests).toEqual([]);

  await page.evaluate(() => {
    window.sessionStorage.removeItem("openjob-test:fresh-token-error");
  });
  await page.getByRole("button", { name: "Link Apple" }).click();
  await page.getByRole("button", { name: "Confirm link" }).click();
  await expect(
    page.getByRole("heading", { name: "Walker Labs", exact: true }),
  ).toBeVisible();
  expect(state.signInMethods).toEqual(["apple", "google"]);
});

test("retains an expired secondary proof until it can be safely discarded", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    groups: [walkerLabs],
    signInMethods: ["google"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();
  await page.getByRole("button", { name: "Link Apple" }).click();
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "openjob-test:fresh-token-error",
      "auth/user-token-expired",
    );
    window.sessionStorage.setItem(
      "openjob-test:secondary-signout-failure",
      "once",
    );
  });
  await page.getByRole("button", { name: "Confirm link" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "could not safely discard that provider sign-in",
  );
  await expect(
    page.getByRole("dialog", { name: "Confirm linking" }),
  ).toBeVisible();
  expect(await page.evaluate(() =>
    (window as typeof window & {
      __openjobFirebaseTest: { secondarySignedIn(): boolean };
    }).__openjobFirebaseTest.secondarySignedIn()
  )).toBe(true);
  expect(state.identityRequests).toEqual([]);

  await page.getByRole("button", { name: "Confirm link" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "provider confirmation expired",
  );
  await expect(page.getByRole("button", { name: "Link Apple" })).toBeVisible();
  expect(await page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBe("signed-in");
  expect(state.identityRequests).toEqual([]);
});

test("restarts linking when the explicitly confirmed target changes", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    groups: [walkerLabs],
    linkFailureCode: "link_target_changed",
    signInMethods: ["google"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();
  await page.getByRole("button", { name: "Link Apple" }).click();
  await page.getByRole("button", { name: "Confirm link" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "That User changed. Authenticate again",
  );
  await expect(page.getByRole("button", { name: "Link Apple" })).toBeVisible();

  state.linkFailureCode = null;
  await page.getByRole("button", { name: "Link Apple" }).click();
  await page.getByRole("button", { name: "Confirm link" }).click();
  await expect(
    page.getByRole("heading", { name: "Walker Labs", exact: true }),
  ).toBeVisible();
  expect(state.identityRequests).toHaveLength(2);
});

test("re-authenticates an expired additional proof in an unknown-first link", async ({ page }) => {
  const state = await installApi(page, {
    credentialRecognized: false,
    linkFailureCode: "fresh_authentication_required",
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: "Link existing" }).click();
  await page.getByRole("button", { name: "Continue with Apple" }).click();
  await page.getByRole("button", { name: "Confirm link" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "provider confirmation expired",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Apple" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("openjob-test:firebase-session")
    ),
  ).toBe("google");
  expect(state.identityRequests).toHaveLength(1);

  state.linkFailureCode = null;
  await page.getByRole("button", { name: "Continue with Apple" }).click();
  await page.getByRole("button", { name: "Confirm link" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your first Group" }),
  ).toBeVisible();
  expect(state.identityRequests).toHaveLength(2);
});

test("forces account selection when leaving an unknown credential", async ({ page }) => {
  await installApi(page, {
    credentialRecognized: false,
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: "Use a different sign-in" }).click();
  await page.getByRole("button", { name: "Continue with Google" }).click();

  expect(
    await page.evaluate(() =>
      window.sessionStorage.getItem("openjob-test:provider-prompt")
    ),
  ).toBe("select_account");
});

test("blocks on failed expired-session cleanup instead of claiming sign-out", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    meFailureStatus: 401,
    user: signedInUser,
  });
  await page.goto("/?scenario=signout-failure");

  await expect(page.getByRole("alert")).toContainText(
    "OpenJob could not safely sign out",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("openjob-test:firebase-session")
    ),
  ).toBe("signed-in");

  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "OpenJob could not safely sign out",
  );
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("openjob-test:firebase-session")
    ),
  ).toBe("signed-in");

  state.meFailureStatus = null;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("openjob-test:firebase-session")
    ),
  ).toBeNull();
});

test("finishes local sign-out when notification pause cannot refresh an expired token", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    groups: [walkerLabs],
    user: signedInUser,
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Walker Labs", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.localStorage.setItem(
      "openjob:notification-installation",
      JSON.stringify({
        enabled: true,
        installationId: "installation_expired_1234567890",
        invitationSettled: true,
        ownerUserId: "user_shane",
      }),
    );
    window.sessionStorage.setItem(
      "openjob-test:token-error",
      "auth/user-token-expired",
    );
  });

  await signOut(page);

  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("openjob-test:firebase-session")
    ),
  ).toBeNull();
  expect(
    await page.evaluate(() =>
      JSON.parse(
        window.localStorage.getItem(
          "openjob:notification-installation",
        ) ?? "null",
      )
    ),
  ).toMatchObject({
    enabled: true,
    ownerUserId: null,
  });
});

test("removes a terminal Firebase credential during restoration", async ({ page }) => {
  await startSignedIn(page);
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "openjob-test:token-error",
      "auth/user-token-expired",
    );
  });
  await installApi(page, { user: signedInUser });
  await page.goto("/");

  await expect(page.getByRole("alert")).toContainText(
    "Your session expired. Sign in again.",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("openjob-test:firebase-session")
    ),
  ).toBeNull();
});

test("cleans a terminal Firebase observer failure before showing sign-in", async ({ page }) => {
  await startSignedIn(page);
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "openjob-test:token-result-error",
      "auth/invalid-user-token",
    );
  });
  await installApi(page, { user: signedInUser });
  await page.goto("/");

  await expect(page.getByRole("alert")).toContainText(
    "Your session expired. Sign in again.",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("openjob-test:firebase-session")
    ),
  ).toBeNull();
});

test("keeps a network-failed Firebase observer session retryable", async ({ page }) => {
  await startSignedIn(page);
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "openjob-test:token-result-error",
      "auth/network-request-failed",
    );
  });
  await installApi(page, { user: signedInUser });
  await page.goto("/");

  await expect(page.getByRole("alert")).toContainText(
    "could not restore your sign-in",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("openjob-test:firebase-session")
    ),
  ).toBe("signed-in");

  await page.evaluate(() => {
    window.sessionStorage.removeItem(
      "openjob-test:token-result-error",
    );
  });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your first Group" }),
  ).toBeVisible();
});

test("removes a terminal Firebase credential during an authenticated action", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    groups: [],
    user: signedInUser,
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "User menu" }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "openjob-test:token-error",
      "auth/user-disabled",
    );
  });
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Sign-in methods" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Your session expired. Sign in again.",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Apple" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("openjob-test:firebase-session")
    ),
  ).toBeNull();
});

test("lets an authenticated empty shell link existing before Username claim", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    groups: [walkerLabs],
    signInMethods: ["google"],
    user: {
      userId: "user_empty_shell",
      username: null,
      usernameRequired: true,
    },
  });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Claim your Username" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Link an existing User" }).click();
  state.user = signedInUser;
  await page.getByRole("button", { name: "Link Apple" }).click();
  await expect(page.getByText(/@shane/u)).toBeVisible();
  await page.getByRole("button", { name: "Confirm link" }).click();

  await expect(
    page.getByRole("heading", { name: "Walker Labs", exact: true }),
  ).toBeVisible();
  expect(state.identityRequests).toEqual([
    {
      path: "/api/v1/me/sign-in-methods",
      body: {
        confirmation: "link",
        credentialToken: "browser-fresh-apple-token",
        expectedTargetUserId: "user_shane",
      },
    },
  ]);
});

test("lets an empty shell link a genuinely unknown second provider", async ({ page }) => {
  await startSignedIn(page);
  const emptyShell = {
    userId: "user_empty_shell",
    username: null,
    usernameRequired: true,
  };
  const state = await installApi(page, {
    freshCredentialRecognized: false,
    signInMethods: ["google"],
    user: emptyShell,
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Link an existing User" }).click();
  await page.getByRole("button", { name: "Link Apple" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Confirm linking",
    }),
  ).toBeVisible();
  await expect(page.getByText(/user_empty_shell/u)).toBeVisible();
  await page.getByRole("button", { name: "Confirm link" }).click();

  await expect(
    page.getByRole("heading", { name: "Claim your Username" }),
  ).toBeVisible();
  expect(state.identityRequests).toEqual([
    {
      path: "/api/v1/me/sign-in-methods",
      body: {
        confirmation: "link",
        credentialToken: "browser-fresh-apple-token",
        expectedTargetUserId: "user_empty_shell",
      },
    },
  ]);
});

test("does not relink after a committed link is followed by Group-load failure", async ({ page }) => {
  const state = await installApi(page, {
    credentialRecognized: false,
    failGroups: true,
    groups: [walkerLabs],
    signInMethods: ["apple"],
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: "Link existing" }).click();
  await page.getByRole("button", { name: "Continue with Apple" }).click();
  await page.getByRole("button", { name: "Confirm link" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "OpenJob could not load right now",
  );
  expect(state.identityRequests).toHaveLength(1);

  state.failGroups = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Walker Labs", exact: true }),
  ).toBeVisible();
  expect(state.identityRequests).toHaveLength(1);
});

test("switches Users by purging the primary session before another provider starts", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    groups: [walkerLabs],
    user: signedInUser,
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Walker Labs", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No open Tasks.")).toBeVisible();
  await page.evaluate(async (groupId) => {
    window.localStorage.setItem("openjob:selected-group-id", groupId);
    window.sessionStorage.setItem(
      "openjob:pending-task-editor",
      JSON.stringify({
        groupId,
        input: {
          assigneeUsername: "shane",
          dueDate: "",
          priority: "normal",
          text: "Private unfinished Task",
        },
        mode: "new",
        taskId: null,
      }),
    );
    window.localStorage.setItem(
      "openjob:notification-installation",
      JSON.stringify({
        enabled: true,
        installationId: "installation_private_1234567890",
        invitationSettled: true,
        ownerUserId: "user_shane",
      }),
    );
    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.open("openjob-notifications", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("installation-state")) {
          request.result.createObjectStore("installation-state");
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          "installation-state",
          "readwrite",
        );
        const store = transaction.objectStore("installation-state");
        store.put(
          {
            active: true,
            installationId: "installation_private_1234567890",
            ownerUserId: "user_shane",
          },
          "current",
        );
        store.put({ groupId }, "pending-launch");
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, walkerLabs.groupId);
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Switch User" }).click();

  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  expect(await page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBeNull();
  expect(await page.evaluate(async () => {
    const installation = JSON.parse(
      window.localStorage.getItem(
        "openjob:notification-installation",
      ) ?? "null",
    );
    const indexed = await new Promise<{
      current: unknown;
      pending: unknown;
    }>((resolve, reject) => {
      const request = window.indexedDB.open("openjob-notifications", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          "installation-state",
          "readonly",
        );
        const store = transaction.objectStore("installation-state");
        const current = store.get("current");
        const pending = store.get("pending-launch");
        transaction.oncomplete = () => {
          database.close();
          resolve({
            current: current.result ?? null,
            pending: pending.result ?? null,
          });
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    return {
      draft: window.sessionStorage.getItem(
        "openjob:pending-task-editor",
      ),
      installation,
      selectedGroup: window.localStorage.getItem(
        "openjob:selected-group-id",
      ),
      ...indexed,
    };
  })).toEqual({
    current: {
      active: false,
      installationId: "installation_private_1234567890",
      ownerUserId: null,
    },
    draft: null,
    installation: {
      enabled: true,
      installationId: "installation_private_1234567890",
      invitationSettled: true,
      ownerUserId: null,
    },
    pending: null,
    selectedGroup: null,
  });

  state.user = { userId: "user_eli", username: "eli", usernameRequired: false };
  state.groups = [];
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.sessionStorage.getItem("openjob-test:provider-prompt")
    ),
  ).toBe("select_account");
  await page.getByRole("button", { name: "User menu" }).click();
  await expect(page.getByText("Signed in as @eli")).toBeVisible();
});

test("offers notifications once only after entry into a usable Group", async ({ page }) => {
  await installNotificationEnvironment(page);
  await startSignedIn(page);
  await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toBeVisible();
  expect(await page.evaluate(() =>
    (window as unknown as { __openjobNotificationTest: { permissionCalls: number } })
      .__openjobNotificationTest.permissionCalls
  )).toBe(0);

  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toHaveCount(0);

  await page.getByRole("button", { name: "User menu" }).click();
  await expect(page.getByRole("button", { name: "Notifications — Paused" })).toBeVisible();
});

test("enables, pauses, and re-enables without repeating browser permission or subscription", async ({ page }) => {
  await installNotificationEnvironment(page);
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");

  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect.poll(() => state.notificationSubscription?.state).toBe("active");
  expect(await page.evaluate(() =>
    (window as unknown as {
      __openjobNotificationTest: { permissionCalls: number; subscribeCalls: number };
    }).__openjobNotificationTest
  )).toEqual({
    permissionCalls: 1,
    subscribeCalls: 1,
    unsubscribeCalls: 0,
    subscription: expect.anything(),
  });

  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Notifications — Enabled" }).click();
  await expect(page.getByText("Status: Enabled")).toBeVisible();
  await page.getByRole("button", { name: "Pause notifications" }).click();
  await expect.poll(() => state.notificationSubscription?.state).toBe("paused");
  await expect(page.getByText("Status: Paused")).toBeVisible();

  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect.poll(() => state.notificationSubscription?.state).toBe("active");
  const browserCalls = await page.evaluate(() => {
    const value = (window as unknown as {
      __openjobNotificationTest: { permissionCalls: number; subscribeCalls: number };
    }).__openjobNotificationTest;
    return {
      permissionCalls: value.permissionCalls,
      subscribeCalls: value.subscribeCalls,
    };
  });
  expect(browserCalls).toEqual({ permissionCalls: 1, subscribeCalls: 1 });
});

test("pauses before sign-out, resumes the same User, and protects the installation from a different User", async ({ page }) => {
  await installNotificationEnvironment(page);
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");
  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect.poll(() => state.notificationSubscription?.state).toBe("active");

  await signOut(page);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  expect(state.notificationSubscription?.state).toBe("paused");
  expect(await page.evaluate(async () => {
    const request = indexedDB.open("openjob-notifications", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ active: boolean }>((resolve, reject) => {
      const read = database.transaction("installation-state").objectStore("installation-state").get("current");
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    database.close();
    return record.active;
  })).toBe(false);

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => state.notificationSubscription?.state).toBe("active");
  await page.getByRole("button", { name: "User menu" }).click();
  await expect(page.getByRole("button", { name: "Notifications — Enabled" })).toBeVisible();
  await page.getByRole("button", { name: "User menu" }).click();

  await signOut(page);
  state.user = { userId: "user_eli", username: "eli", usernameRequired: false };
  const requestsBeforeSwitch = state.notificationRequests.length;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Signed in as @eli")).toHaveCount(0);
  await page.getByRole("button", { name: "User menu" }).click();
  await expect(page.getByText("Signed in as @eli")).toBeVisible();
  await expect(page.getByRole("button", { name: "Notifications — Paused" })).toBeVisible();
  expect(state.notificationSubscription?.userId).toBe("user_shane");
  expect(state.notificationRequests.slice(requestsBeforeSwitch).some(
    (entry) => entry.userId === "user_eli" && entry.method === "PUT",
  )).toBe(false);

  await page.getByRole("button", { name: "Notifications — Paused" }).click();
  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect.poll(() => state.notificationSubscription?.userId).toBe("user_eli");
  expect(state.notificationSubscription?.state).toBe("active");
  expect(await page.evaluate(() =>
    (window as unknown as {
      __openjobNotificationTest: { permissionCalls: number };
    }).__openjobNotificationTest.permissionCalls
  )).toBe(1);
});

test("keeps notifications enabled when local pause suppression cannot be persisted", async ({ page }) => {
  await installNotificationEnvironment(page);
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");
  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect.poll(() => state.notificationSubscription?.state).toBe("active");
  await failIndexedDbWrites(page);

  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Notifications — Enabled" }).click();
  await page.getByRole("button", { name: "Pause notifications" }).click();

  await expect(page.getByText("Status: Enabled")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "OpenJob could not update notifications. Try again.",
  );
  expect(state.notificationSubscription?.state).toBe("active");
});

test("keeps the User signed in when local notification suppression cannot be persisted", async ({ page }) => {
  await installNotificationEnvironment(page);
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");
  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect.poll(() => state.notificationSubscription?.state).toBe("active");
  await failIndexedDbWrites(page);
  await signOut(page);

  await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "OpenJob could not safely sign out. Try again.",
  );
  expect(state.notificationSubscription?.state).toBe("active");
});

test("serializes bootstrap registration before the sign-out pause", async ({ page }) => {
  await installNotificationEnvironment(page);
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");
  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect.poll(() => state.notificationSubscription?.state).toBe("active");
  await signOut(page);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  state.notificationRegistrationDelayMs = 200;
  const completedBeforeReturn = state.notificationRegistrationsCompleted;
  const registrationsBeforeReturn = state.notificationRequests.filter(
    (request) => request.method === "PUT",
  ).length;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => state.notificationRequests.filter(
    (request) => request.method === "PUT",
  ).length).toBe(registrationsBeforeReturn + 1);
  await signOut(page);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect.poll(
    () => state.notificationRegistrationsCompleted > completedBeforeReturn,
  ).toBe(true);
  expect(state.notificationSubscription?.state).toBe("paused");
});

test("reports denied permission permanently without automatically returning the invitation", async ({ page }) => {
  await installNotificationEnvironment(page, { permissionResult: "denied" });
  await startSignedIn(page);
  await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");
  await page.getByRole("button", { name: "Enable notifications" }).click();

  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Notifications — Denied" }).click();
  await expect(page.getByText("Status: Denied")).toBeVisible();
  await expect(page.getByText(/Allow them there/)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toHaveCount(0);
});

test("keeps a dismissed browser permission prompt paused without returning the invitation", async ({ page }) => {
  await installNotificationEnvironment(page, { permissionResult: "default" });
  await startSignedIn(page);
  await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");
  await page.getByRole("button", { name: "Enable notifications" }).click();

  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Notifications — Paused" }).click();
  await expect(page.getByText("Status: Paused")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toHaveCount(0);
});

test("reports unsupported browsers without offering permission", async ({ page }) => {
  await installNotificationEnvironment(page, { supported: false });
  await startSignedIn(page);
  await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toHaveCount(0);
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Notifications — Unsupported" }).click();
  await expect(page.getByText("Status: Unsupported")).toBeVisible();
  await expect(page.getByText(/does not support/)).toBeVisible();
});

test("guides iPhone browser Users to install before permission is offered", async ({ page }) => {
  await installNotificationEnvironment(page, {
    ios: true,
    standalone: false,
    supported: false,
  });
  await startSignedIn(page);
  await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Turn on notifications?" })).toHaveCount(0);
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Notifications — Install required" }).click();
  await expect(page.getByText("Status: Install required")).toBeVisible();
  await expect(page.getByText(/add OpenJob to the Home Screen/)).toBeVisible();
  expect(await page.evaluate(() =>
    (window as unknown as {
      __openjobNotificationTest: { permissionCalls: number };
    }).__openjobNotificationTest.permissionCalls
  )).toBe(0);
});

test("reconciles missing, expired, and changed browser subscriptions on authenticated bootstrap", async ({ page }) => {
  await installNotificationEnvironment(page);
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");
  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect.poll(() => state.notificationSubscription?.state).toBe("active");

  await page.evaluate(() => {
    window.localStorage.removeItem("openjob-test:push-subscription");
    (window as unknown as {
      __openjobNotificationTest: { subscription: PushSubscription | null };
    }).__openjobNotificationTest.subscription = null;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as {
      __openjobNotificationTest: { subscribeCalls: number };
    }).__openjobNotificationTest.subscribeCalls
  )).toBe(1);

  await page.evaluate(() => {
    window.localStorage.setItem(
      "openjob-test:push-endpoint",
      "https://push.example.test/subscriptions/changed-capability",
    );
  });
  await page.reload();
  await expect.poll(() => state.notificationSubscription?.capability.endpoint).toBe(
    "https://push.example.test/subscriptions/changed-capability",
  );

  await page.evaluate(() => {
    window.localStorage.setItem("openjob-test:push-expired", "true");
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => {
    const testState = (window as unknown as {
      __openjobNotificationTest: { subscribeCalls: number; unsubscribeCalls: number };
    }).__openjobNotificationTest;
    return {
      subscribeCalls: testState.subscribeCalls,
      unsubscribeCalls: testState.unsubscribeCalls,
    };
  })).toEqual({ subscribeCalls: 1, unsubscribeCalls: 1 });
});

test("shows the signed-in build version and offers a user-controlled refresh for a newer release", async ({ page }) => {
  let deployedVersion = packageMetadata.version;
  let releaseChecks = 0;
  await page.addInitScript(() => {
    let now = Date.now();
    Date.now = () => now;
    Object.defineProperty(window, "advanceOpenJobReleaseClock", {
      value: (milliseconds: number) => {
        now += milliseconds;
      },
    });
  });
  await page.route("**/api/version", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ version: deployedVersion, commit: "fedcba987654" }),
  }).finally(() => {
    releaseChecks += 1;
  }));
  await startSignedIn(page);
  await installApi(page, { user: signedInUser, groups: [walkerLabs] });

  await page.goto("/");
  await expect.poll(() => releaseChecks).toBe(1);
  await page.getByRole("button", { name: "User menu" }).click();
  await expect(page.getByText(`OpenJob v${packageMetadata.version}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
  await page.getByRole("button", { name: "User menu" }).click();

  deployedVersion = "9.0.0-rc.1";
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(50);
  expect(releaseChecks).toBe(1);
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);

  await page.evaluate((milliseconds) => {
    (window as typeof window & { advanceOpenJobReleaseClock(value: number): void })
      .advanceOpenJobReleaseClock(milliseconds);
    document.dispatchEvent(new Event("visibilitychange"));
  }, 15 * 60 * 1000);
  await expect.poll(() => releaseChecks).toBe(2);
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);

  deployedVersion = "9.0.0";
  await page.evaluate((milliseconds) => {
    (window as typeof window & { advanceOpenJobReleaseClock(value: number): void })
      .advanceOpenJobReleaseClock(milliseconds);
    document.dispatchEvent(new Event("visibilitychange"));
  }, 15 * 60 * 1000);
  await expect.poll(() => releaseChecks).toBe(3);

  await expect(page.getByText("OpenJob 9.0.0 is available.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();

  deployedVersion = packageMetadata.version;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
});

test("keeps Task work available when release discovery fails", async ({ page }) => {
  await page.route("**/api/version", (route) => route.abort("failed"));
  await startSignedIn(page);
  await installApi(page, { user: signedInUser, groups: [walkerLabs] });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
});

test("returns a signed-out Invite Link visitor to an explicit Group join confirmation", async ({ page }) => {
  const state = await installApi(page, { user: signedInUser, groups: [openJobCore] });

  await page.goto(`/invites/${state.invite.token}`);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByRole("heading", { name: "Join Walker Labs" })).toBeVisible();
  await expect(page.getByText(walkerLabs.groupId)).toHaveCount(0);
  await page.getByRole("button", { name: "Join Group" }).click();

  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  await openGroupMenu(page);
  await expect(page.getByRole("button", { name: "OpenJob Core", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.pathname)).toBe("/");
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("openjob:selected-group-id")),
  ).toBe(walkerLabs.groupId);
  expect(state.invite.remainingJoins).toBe(24);
});

test("keeps an existing Member's complete Group menu on idempotent Invite Link join", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs, openJobCore],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
  });

  await page.goto(`/invites/${state.invite.token}`);
  await page.getByRole("button", { name: "Join Group" }).click();

  await openGroupMenu(page);
  await expect(page.getByRole("button", { name: "Walker Labs", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "OpenJob Core", exact: true })).toBeVisible();
  expect(state.invite.remainingJoins).toBe(25);
});

test("keeps invalid and membership-denied Invite Link results generic", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser });

  await page.goto("/invites/ivt_unknown");
  await expect(page.getByRole("heading", { name: "Invite Link unavailable" })).toBeVisible();
  await expect(page.getByText("Walker Labs")).toHaveCount(0);

  state.membershipDenied = true;
  await page.goto(`/invites/${state.invite.token}`);
  await expect(page.getByRole("heading", { name: "Join Walker Labs" })).toBeVisible();
  await page.getByRole("button", { name: "Join Group" }).click();
  await expect(page.getByRole("alert")).toHaveText("Membership could not be granted.");
  await expect(page.getByText(/ban/i)).toHaveCount(0);
});

test("lets Admins govern Invite Links, Members, bans, and forced-removal recovery", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
      { userId: "user_elijah", username: "elijah", role: "member", joinedAt: "2026-07-03T00:00:00.000Z" },
      { userId: "user_avery", username: "avery", role: "admin", joinedAt: "2026-07-04T00:00:00.000Z" },
    ],
    bans: [
      { userId: "user_zora", username: "zora", bannedAt: "2026-07-10T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_removed_member",
        groupId: walkerLabs.groupId,
        text: "Recover removed Member work",
        assignee: { state: "assigned", userId: "user_morgan", username: "morgan" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-15T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");
  await openGroupManagement(page, "Manage Group");

  await expect(page.getByRole("heading", { name: "Manage Walker Labs" })).toBeVisible();
  for (const control of await page.getByTestId("governance-surface").locator("button:visible, input:visible").all()) {
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByLabel("Invite Link")).toHaveValue(state.invite.url);
  await expect(page.getByText("25 joins remaining")).toBeVisible();
  await expect(page.locator("time").filter({ hasText: /Expires/ })).toHaveAttribute("datetime", state.invite.expiresAt);

  await expectConfirmation(
    page,
    "current link will stop working immediately",
    () => page.getByRole("button", { name: "Rotate Invite Link" }).click(),
    false,
  );
  await expect(page.getByLabel("Invite Link")).toHaveValue(state.invite.url);
  await expectConfirmation(
    page,
    "current link will stop working immediately",
    () => page.getByRole("button", { name: "Rotate Invite Link" }).click(),
  );
  await expect(page.getByLabel("Invite Link")).toHaveValue(/_rotated$/);

  const elijah = page.getByTestId("member-row").filter({ hasText: "@elijah" });
  const formerMemberUserId = await elijah.getByLabel("@elijah User ID").textContent();
  await elijah.getByRole("button", { name: "Promote" }).click();
  await expect(elijah.getByText("Admin", { exact: true })).toBeVisible();
  await expectConfirmation(
    page,
    "Demote @elijah to Member",
    () => elijah.getByRole("button", { name: "Demote" }).click(),
  );
  await expect(elijah.getByText("Member", { exact: true })).toBeVisible();
  await expectConfirmation(
    page,
    "Their open Tasks will become Unassigned",
    () => elijah.getByRole("button", { name: "Kick" }).click(),
  );
  await expect(elijah).toHaveCount(0);

  const morgan = page.getByTestId("member-row").filter({ hasText: "@morgan" });
  await expectConfirmation(
    page,
    "cannot rejoin until unbanned",
    () => morgan.getByRole("button", { name: "Ban" }).click(),
  );
  await expect(morgan).toHaveCount(0);
  await expect(page.getByTestId("ban-row").filter({ hasText: "@morgan" })).toBeVisible();

  const zoraBan = page.getByTestId("ban-row").filter({ hasText: "@zora" });
  await expectConfirmation(
    page,
    "still need an Invite Link to rejoin",
    () => zoraBan.getByRole("button", { name: "Unban" }).click(),
  );
  await expect(zoraBan).toHaveCount(0);

  await page.getByLabel("Former Member User ID").fill(formerMemberUserId!);
  await expectConfirmation(
    page,
    "former Member",
    () => page.getByRole("button", { name: "Ban former Member" }).click(),
  );
  await expect(page.getByTestId("ban-row").filter({ hasText: "@elijah" })).toBeVisible();

  await page.getByRole("button", { name: "Back to Task List" }).click();
  const unassigned = page.getByTestId("member-section").filter({
    has: page.getByRole("heading", { name: "Unassigned" }),
  });
  await expect(unassigned.getByText("Recover removed Member work")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await openGroupManagement(page, "Manage Group");
  const governanceSurface = await page.getByTestId("governance-surface").boundingBox();
  expect(governanceSurface!.width).toBeLessThanOrEqual(354);

  const shane = page.getByTestId("member-row").filter({ hasText: "@shane" });
  await expectConfirmation(
    page,
    "Demote @shane to Member",
    () => shane.getByRole("button", { name: "Demote" }).click(),
  );
  await expect(page.getByRole("heading", { name: "Walker Labs settings" })).toBeVisible();
  await expect(page.getByLabel("Invite Link")).toHaveCount(0);
});

test("keeps Admin controls private and enforces guarded Member departure", async ({ page }) => {
  await startSignedIn(page);
  const memberGroup = { ...openJobCore, role: "member" as const };
  const state = await installApi(page, {
    user: signedInUser,
    groups: [memberGroup],
    members: [
      { userId: "user_shane", username: "shane", role: "member", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "admin", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_leave_guard",
        groupId: memberGroup.groupId,
        text: "Finish before leaving",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-15T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");
  await openGroupManagement(page, "Group settings");

  await expect(page.getByRole("heading", { name: "OpenJob Core settings" })).toBeVisible();
  await expect(page.getByLabel("Invite Link")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Bans" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Promote|Demote|Kick|Ban/ })).toHaveCount(0);

  await expectConfirmation(
    page,
    "lose access immediately",
    () => page.getByRole("button", { name: "Leave Group" }).click(),
  );
  await expect(page.getByRole("alert")).toContainText("Reassign or complete your open Tasks");

  state.tasks = [];
  await expectConfirmation(
    page,
    "lose access immediately",
    () => page.getByRole("button", { name: "Leave Group" }).click(),
  );
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("openjob:selected-group-id"))).toBeNull();
});

test("lets the sole Admin rename and explicitly End Group", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
  });
  await page.goto("/");
  await openGroupManagement(page, "Manage Group");

  await page.getByLabel("Group Name").fill("Walker Studio");
  await page.getByRole("button", { name: "Rename Group" }).click();
  await expect(page.getByRole("heading", { name: "Manage Walker Studio" })).toBeVisible();

  const endButton = page.getByRole("button", { name: "End Group" });
  await expect(endButton).toBeDisabled();
  await page.getByLabel("Type Walker Studio to confirm").fill("Walker Studio");
  await expect(endButton).toBeEnabled();
  await expectConfirmation(
    page,
    "cannot be undone",
    () => endButton.click(),
  );
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
});

test("auto-selects one Group but requires and remembers a choice among multiple Groups", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();

  state.groups.push(openJobCore);
  await page.evaluate(() => window.localStorage.removeItem("openjob:selected-group-id"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose a Group" })).toBeVisible();
  await openGroupMenu(page);
  await page.getByRole("button", { name: "OpenJob Core", exact: true }).click();
  await expect(page.getByRole("heading", { name: "OpenJob Core", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "OpenJob Core", exact: true })).toBeVisible();
});

test("clears stale or concealed Group access without exposing private details", async ({ page }) => {
  await startSignedIn(page);
  await page.addInitScript(() => window.localStorage.setItem("openjob:selected-group-id", "grp_retired"));
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs, openJobCore] });
  await page.goto("/");
  await expect(page.getByText("That Group is no longer accessible. Choose another.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("openjob:selected-group-id"))).toBeNull();

  const concealed = { ...walkerLabs, groupId: "grp_concealed", name: "Retired Operations" };
  state.groups = [concealed];
  state.concealedGroupIds.add(concealed.groupId);
  await page.reload();
  await expect(page.getByText("That Group is no longer accessible.")).toBeVisible();
  await expect(page.getByText("Retired Operations")).toHaveCount(0);

  await signOut(page);
  state.groups = [walkerLabs, openJobCore];
  state.concealedGroupIds.clear();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Choose a Group" })).toBeVisible();
  await expect(page.getByText("That Group is no longer accessible.")).toHaveCount(0);
});

test("notification selection opens only an accessible Group and uses a generic stale fallback", async ({ page }) => {
  await installNotificationEnvironment(page);
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs, openJobCore],
  });

  await page.goto(`/?notification-group=${openJobCore.groupId}`);
  await expect(page.getByRole("heading", { name: "OpenJob Core", exact: true })).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("openjob:selected-group-id")),
  ).toBe(openJobCore.groupId);
  await expect.poll(() => page.evaluate(() => window.location.search)).toBe("");

  await page.evaluate((groupId) => {
    const testState = (window as typeof window & {
      __openjobNotificationTest: {
        serviceWorkerMessageListener: ((event: MessageEvent) => void) | null;
      };
    }).__openjobNotificationTest;
    testState.serviceWorkerMessageListener?.({
      data: { type: "openjob:select-notification-group", groupId },
    } as MessageEvent);
  }, walkerLabs.groupId);
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();

  const newlyAccessible = {
    ...openJobCore,
    groupId: "grp_newly-accessible",
    name: "Newly Accessible",
  };
  state.groups.push(newlyAccessible);
  await page.evaluate((groupId) => {
    const testState = (window as typeof window & {
      __openjobNotificationTest: {
        serviceWorkerMessageListener: ((event: MessageEvent) => void) | null;
      };
    }).__openjobNotificationTest;
    testState.serviceWorkerMessageListener?.({
      data: { type: "openjob:select-notification-group", groupId },
    } as MessageEvent);
  }, newlyAccessible.groupId);
  await expect(page.getByRole("heading", { name: "Newly Accessible", exact: true })).toBeVisible();

  state.concealedGroupIds.add(openJobCore.groupId);
  state.groups = [walkerLabs];
  await page.goto("/?notification-group=grp_private-retired");
  await expect(page.getByText("That Group is no longer accessible.")).toBeVisible();
  await expect(page.getByText("grp_private-retired")).toHaveCount(0);
  await expect(page.getByText("OpenJob Core")).toHaveCount(0);
});

test("notification selection survives an installed app cold launch or resume", async ({ page }) => {
  await installNotificationEnvironment(page);
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs, openJobCore],
  });

  await page.goto("/");
  await openGroupMenu(page);
  await page.getByRole("button", { name: "Walker Labs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();

  const savePendingLaunch = (groupId: string) => page.evaluate(async (pendingGroupId) => {
    const request = indexedDB.open("openjob-notifications", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("installation-state", "readwrite");
      transaction.objectStore("installation-state").put(
        { groupId: pendingGroupId },
        "pending-launch",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, groupId);

  await savePendingLaunch(openJobCore.groupId);
  await page.reload();
  await expect(page.getByRole("heading", { name: "OpenJob Core", exact: true })).toBeVisible();

  await savePendingLaunch(walkerLabs.groupId);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
});

test("accepts an 80-character Unicode Group Name from the service", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, { user: signedInUser });
  await page.goto("/");
  const name = "🚀".repeat(80);
  await page.getByLabel("Group Name").fill(name);
  await page.getByRole("button", { name: "Create Group" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});

test("switches Groups and exposes role-appropriate actions from compact signed-in menus", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs, openJobCore] });
  await page.goto("/");

  await expect(page.getByTestId("group-rail")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Group menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();

  await openGroupMenu(page);
  await page.getByRole("button", { name: "Walker Labs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  await expect(page.getByRole("heading")).toHaveCount(1);

  await openGroupMenu(page);
  await expect(page.getByRole("button", { name: "New Group" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage Group" })).toBeVisible();
  await page.getByRole("button", { name: "New Group" }).click();
  const groupDialog = page.getByRole("dialog", { name: "Create a Group" });
  for (const control of await groupDialog.locator("button:visible, input:visible").all()) {
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await groupDialog.getByRole("button", { name: "Cancel" }).click();
  state.getGroupFailureStatus = 500;
  await openGroupMenu(page);
  await page.getByRole("button", { name: "OpenJob Core", exact: true }).click();
  const retry = page.getByRole("alert").getByRole("button", { name: "Try again" });
  const retryBox = await retry.boundingBox();
  expect(retryBox!.width).toBeGreaterThanOrEqual(44);
  expect(retryBox!.height).toBeGreaterThanOrEqual(44);
  state.getGroupFailureStatus = null;
  await retry.click();
  await openGroupMenu(page);
  await page.getByRole("button", { name: "OpenJob Core", exact: true }).click();

  await expect(page.getByRole("heading", { name: "OpenJob Core", exact: true })).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("openjob:selected-group-id")),
  ).toBe(openJobCore.groupId);
  await openGroupMenu(page);
  await expect(page.getByRole("button", { name: "Group settings" })).toBeVisible();
});

test("keeps compact navigation keyboard-visible and overflow-free at desktop and narrow widths", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, { user: signedInUser, groups: [walkerLabs, openJobCore] });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const groupMenu = page.getByRole("button", { name: "Group menu" });
  const userMenu = page.getByRole("button", { name: "User menu" });
  for (const control of [groupMenu, userMenu]) {
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);

  await page.keyboard.press("Tab");
  await expect(groupMenu).toBeFocused();
  expect(await groupMenu.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth)))
    .toBeGreaterThanOrEqual(3);
  await page.keyboard.press("Enter");
  const groupPanel = page.getByTestId("group-menu-panel");
  await expect(groupPanel).toBeVisible();
  const groupControls = groupPanel.getByRole("button");
  for (const control of await groupControls.all()) {
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Tab");
  await expect(groupControls.nth(0)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(groupControls.nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(groupPanel).toHaveCount(0);
  await expect(groupMenu).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await expect.poll(() => groupMenu.evaluate((element) => ({
    animationDuration: getComputedStyle(element).animationDuration,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }))).toEqual({ animationDuration: "0s", transitionDuration: "0s" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("group-rail")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const control of [groupMenu, userMenu]) {
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("distinguishes loading and failures from a User with no Groups", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, hangMe: true });
  await page.goto("/");
  await expect(page.getByText("Loading your OpenJob…")).toBeVisible();

  state.hangMe = false;
  state.meFailureStatus = 500;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("OpenJob could not load right now.");

  state.meFailureStatus = null;
  state.failGroups = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("OpenJob could not load right now.");
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toHaveCount(0);
});

test("turns Firebase initialization failure into an understandable auth state", async ({ page }) => {
  await installApi(page);
  await page.goto("/?scenario=auth-error");
  await expect(page.getByRole("alert")).toContainText("Sign-in could not start. Try again.");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Claim your Username" })).toBeVisible();
});

test("returns an expired session to a working sign-in path", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    meFailureStatus: 401,
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Your session expired. Sign in again.");
  state.meFailureStatus = null;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
});

test("does not restore private Group state after sign-out interrupts bootstrap", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    groups: [walkerLabs],
    meDelayMs: 250,
    user: signedInUser,
  });
  await page.goto("/");
  await expect.poll(() => state.authorizationHeaders.length).toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as typeof window & {
      __openjobFirebaseTest: { emitPrimarySignedOut(): void };
    }).__openjobFirebaseTest.emitPrimarySignedOut();
  });

  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await page.waitForTimeout(350);
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  expect(await page.evaluate(() =>
    window.localStorage.getItem("openjob:selected-group-id")
  )).toBeNull();
});

test("does not restore a selected Group after sign-out interrupts selection", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    getGroupDelayMs: 250,
    groups: [walkerLabs, openJobCore],
    user: signedInUser,
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Choose a Group" }),
  ).toBeVisible();
  await openGroupMenu(page);
  await page.getByRole("button", { name: "Walker Labs", exact: true }).click();
  await page.evaluate(() => {
    (window as typeof window & {
      __openjobFirebaseTest: { emitPrimarySignedOut(): void };
    }).__openjobFirebaseTest.emitPrimarySignedOut();
  });

  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await page.waitForTimeout(350);
  expect(await page.evaluate(() =>
    window.localStorage.getItem("openjob:selected-group-id")
  )).toBeNull();
});

test("ignores an old Group failure after a different User signs in", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    getGroupDelayMs: 500,
    groups: [walkerLabs, openJobCore],
    user: signedInUser,
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Choose a Group" }),
  ).toBeVisible();
  const requestsBeforeSelection = state.authorizationHeaders.length;
  await openGroupMenu(page);
  await page.getByRole("button", { name: "Walker Labs", exact: true }).click();
  await expect.poll(
    () => state.authorizationHeaders.length,
  ).toBeGreaterThan(requestsBeforeSelection);
  state.getGroupFailureStatus = 401;
  await page.evaluate(() => {
    (window as typeof window & {
      __openjobFirebaseTest: { emitPrimarySignedOut(): void };
    }).__openjobFirebaseTest.emitPrimarySignedOut();
  });
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();

  state.user = {
    userId: "user_morgan",
    username: "morgan",
    usernameRequired: false,
  };
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a Group" }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await expect(
    page.getByRole("heading", { name: "Choose a Group" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "User menu" }).click();
  await expect(page.getByText("Signed in as @morgan")).toBeVisible();
  expect(await page.evaluate(() =>
    window.localStorage.getItem("openjob-test:firebase-session")
  )).toBe("google");
});

test("does not restore a created Group after sign-out interrupts creation", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    createGroupDelayMs: 250,
    user: signedInUser,
  });
  await page.goto("/");
  await page.getByLabel("Group name").fill("Private after sign-out");
  await page.getByRole("button", { name: "Create Group" }).click();
  await expect.poll(() => state.groups.length).toBe(1);
  await page.evaluate(() => {
    (window as typeof window & {
      __openjobFirebaseTest: { emitPrimarySignedOut(): void };
    }).__openjobFirebaseTest.emitPrimarySignedOut();
  });

  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await page.waitForTimeout(350);
  expect(await page.evaluate(() =>
    window.localStorage.getItem("openjob:selected-group-id")
  )).toBeNull();
});

test("recovers when a session expires during a mutation", async ({ page }) => {
  const state = await installApi(page, { claimFailureStatus: 401 });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("Username").fill("shane");
  await page.getByRole("button", { name: "Claim Username" }).click();
  await expect(page.getByRole("alert")).toContainText("Your session expired. Sign in again.");

  state.claimFailureStatus = null;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Claim your Username" })).toBeVisible();
});

test("recovers when a session expires while selecting a Group", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs, openJobCore],
    getGroupFailureStatus: 401,
  });
  await page.goto("/");
  await openGroupMenu(page);
  await page.getByRole("button", { name: "Walker Labs", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your session expired. Sign in again.");

  state.getGroupFailureStatus = null;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Choose a Group" })).toBeVisible();
});

test("renders status-filtered Member sections with truthful counts and ordering", async ({ page }) => {
  await startSignedIn(page);
  await page.clock.setFixedTime(new Date("2026-07-16T17:00:00-05:00"));
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-03T00:00:00.000Z" },
      { userId: "user_elijah", username: "elijah", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
      { userId: "user_all", username: "all", role: "member", joinedAt: "2026-07-04T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_elijah",
        groupId: walkerLabs.groupId,
        text: "Confirm patio measurements",
        assignee: { state: "assigned", userId: "user_elijah", username: "elijah" },
        dueDate: "2026-07-15",
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_morgan_open",
        groupId: walkerLabs.groupId,
        text: "Order menu stands",
        assignee: { state: "assigned", userId: "user_morgan", username: "morgan" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-02T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_morgan_done",
        groupId: walkerLabs.groupId,
        text: "Archive spring campaign",
        assignee: { state: "assigned", userId: "user_morgan", username: "morgan" },
        dueDate: null,
        state: "done",
        createdAt: "2026-07-03T10:00:00.000Z",
        completedAt: "2026-07-15T15:00:00.000Z",
      },
      {
        taskId: "task_shane",
        groupId: walkerLabs.groupId,
        text: "Publish lunch specials",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: "2026-07-18",
        state: "open",
        createdAt: "2026-07-04T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_former_done",
        groupId: walkerLabs.groupId,
        text: "Document former campaign owner",
        assignee: { state: "assigned", userId: "user_zora", username: "zora" },
        dueDate: null,
        state: "done",
        createdAt: "2026-07-04T12:00:00.000Z",
        completedAt: "2026-07-14T15:00:00.000Z",
      },
      {
        taskId: "task_unassigned",
        groupId: walkerLabs.groupId,
        text: "Recover payroll handoff",
        assignee: { state: "unassigned" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-05T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });

  await page.goto("/");

  const sections = page.getByTestId("member-section");
  await expect(page.getByRole("button", { name: "Open 4", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Done 2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "All 6", exact: true })).toBeVisible();
  await expect(page.getByLabel("Assignee filter")).toHaveCount(0);
  await expect(sections).toHaveCount(4);
  await expect(sections.nth(0).getByRole("heading")).toHaveText("@elijah");
  await expect(sections.nth(1).getByRole("heading")).toHaveText("@morgan");
  await expect(sections.nth(2).getByRole("heading")).toHaveText("@shane");
  await expect(sections.nth(3).getByRole("heading")).toHaveText("Unassigned");
  await expect(page.getByRole("heading", { name: "@all" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "People" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Task List by owner" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Task" })).toBeVisible();
  await expect(page.getByText("Archive spring campaign")).toHaveCount(0);
  await expect(page.getByText("Document former campaign owner")).toHaveCount(0);
  await expect(page.getByText("Confirm patio measurements").locator("..")).toContainText("Overdue");

  await page.getByRole("button", { name: "Done 2", exact: true }).click();
  await expect(sections).toHaveCount(2);
  await expect(sections.nth(0).getByRole("heading")).toHaveText("@morgan");
  await expect(sections.nth(1).getByRole("heading")).toHaveText("@zora");
  await expect(sections.nth(1).getByText("Former Member")).toBeVisible();

  await page.getByRole("button", { name: "All 6", exact: true }).click();
  await expect(sections).toHaveCount(5);
  await expect(sections.nth(0).getByRole("heading")).toHaveText("@elijah");
  await expect(sections.nth(1).getByRole("heading")).toHaveText("@morgan");
  await expect(sections.nth(2).getByRole("heading")).toHaveText("@shane");
  await expect(sections.nth(3).getByRole("heading")).toHaveText("@zora");
  await expect(sections.nth(4).getByRole("heading")).toHaveText("Unassigned");
  const morganCards = sections.nth(1).getByTestId("task-card");
  await expect(morganCards.nth(0)).toContainText("Order menu stands");
  await expect(morganCards.nth(1)).toContainText("Archive spring campaign");
  expect(state.taskQueries.every((query) => {
    const params = new URLSearchParams(query);
    return params.get("status") === "all" && !params.has("assignee");
  })).toBe(true);
});

test("opens one shared Task editor from global and Member actions", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [visibleMorganTask("2026-07-01T10:00:00.000Z")],
  });
  await page.goto("/");

  const globalNewTask = page.getByRole("button", { name: "New Task" });
  await globalNewTask.click();
  let editor = page.getByRole("dialog", { name: "New Task" });
  await expect(editor).toBeVisible();
  const desktopEditor = await editor.boundingBox();
  expect(desktopEditor!.width).toBeLessThanOrEqual(560);
  expect(Math.abs(desktopEditor!.x + desktopEditor!.width / 2 - 640)).toBeLessThanOrEqual(1);
  await expect.poll(async () => {
    const box = await editor.boundingBox();
    return box ? Math.abs(box.y + box.height / 2 - 360) : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(1);
  await expect(editor.getByLabel("Task text")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(editor.getByRole("button", { name: "Close Task Editor" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(editor.getByLabel("Task text")).toBeFocused();
  await expect(editor.getByLabel("Assignee")).toHaveValue("");
  await expect(editor.getByRole("radio", { name: "Normal" })).toBeChecked();
  await expect(editor.getByLabel("Assignee").getByRole("option")).toHaveText([
    "Choose a Member",
    "@morgan",
    "@shane",
  ]);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(globalNewTask).toBeFocused();

  const morganSection = page.getByTestId("member-section").filter({
    has: page.getByRole("heading", { name: "@morgan" }),
  });
  const memberAddTask = morganSection.getByRole("button", { name: "Add Task" });
  await memberAddTask.click();
  editor = page.getByRole("dialog", { name: "New Task" });
  await expect(editor.getByLabel("Assignee")).toHaveValue("morgan");
  await editor.getByLabel("Task text").fill("Keep focus trapped while saving");
  state.taskMutationDelayMs = 300;
  await editor.getByRole("button", { name: "Create", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await page.keyboard.press("Tab");
  await expect(editor.getByLabel("Task text")).toBeFocused();
  await expect(editor).toHaveCount(0);
  await expect(memberAddTask).toBeFocused();
  expect(state.tasks.find((task) => task.text === "Keep focus trapped while saving")?.dueDate).toBeNull();
});

test("opens a zoom-safe half-height Task sheet on narrow screens", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "New Task" }).click();
  const editor = page.getByRole("dialog", { name: "New Task" });
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(editor.getByText("New Task", { exact: true })).toHaveCount(1);
  await expect(editor.getByRole("button", { name: "Create", exact: true })).toBeVisible();

  await expect.poll(async () => {
    const box = await editor.boundingBox();
    return box ? Math.abs(box.y + box.height - 844) : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(1);
  const sheet = await editor.boundingBox();
  expect(sheet).not.toBeNull();
  expect(sheet!.height).toBeGreaterThanOrEqual(420);
  expect(sheet!.height).toBeLessThanOrEqual(450);

  const taskText = editor.getByLabel("Task text");
  await expect(taskText).not.toBeFocused();
  for (const control of [taskText, editor.getByLabel("Assignee"), editor.getByLabel("Due date")]) {
    expect(Number.parseFloat(await control.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  }

  const close = editor.getByRole("button", { name: "Close Task Editor" });
  const closeBox = await close.boundingBox();
  expect(closeBox).not.toBeNull();
  expect(closeBox!.width).toBeGreaterThanOrEqual(44);
  expect(closeBox!.height).toBeGreaterThanOrEqual(44);
  const createBox = await editor.getByRole("button", { name: "Create", exact: true }).boundingBox();
  expect(createBox!.width).toBeGreaterThanOrEqual(44);
  expect(createBox!.height).toBeGreaterThanOrEqual(44);
  expect(createBox!.y + createBox!.height).toBeLessThanOrEqual(sheet!.y + sheet!.height);

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const box = await editor.boundingBox();
      return box ? Math.abs(box.y + box.height - viewport.height) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(1);
    const resizedSheet = await editor.boundingBox();
    expect(resizedSheet!.height).toBeGreaterThanOrEqual(Math.min(viewport.height * .5, 470));
    expect(resizedSheet!.height).toBeLessThanOrEqual(Math.min(viewport.height * .54, 481));
    await expectNoHorizontalOverflow(page);
  }
});

test("keeps compact Task controls clear and mobile dismissal immediate", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const open = page.getByRole("button", { name: "New Task" });
  await open.click();
  let editor = page.getByRole("dialog", { name: "New Task" });
  await expect(editor.getByLabel("Assignee")).toHaveJSProperty("tagName", "SELECT");
  const dueDate = editor.getByLabel("Due date");
  await expect(dueDate).toHaveAttribute("type", "date");
  await expect(editor.getByText("None", { exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Clear selected date" })).toHaveCount(0);
  await dueDate.fill("2026-07-30");
  const selectedDate = editor.getByText("Jul 30", { exact: true });
  await expect(selectedDate).toBeVisible();
  expect(await selectedDate.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await editor.getByRole("button", { name: "Clear selected date" }).click();
  await expect(dueDate).toHaveValue("");
  await expect(editor.getByText("None", { exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Clear selected date" })).toHaveCount(0);
  await expect(editor.getByRole("radio")).toHaveCount(3);
  await expect(editor.getByRole("radio", { name: "Normal" })).toBeChecked();
  const priorityBoxes = [];
  for (const priority of ["High", "Normal", "Low"]) {
    const choice = editor.getByRole("radio", { name: priority }).locator("..");
    const choiceBox = await choice.boundingBox();
    expect(Math.round(choiceBox!.height)).toBeGreaterThanOrEqual(44);
    priorityBoxes.push(choiceBox!);
  }
  expect(priorityBoxes[1].x - (priorityBoxes[0].x + priorityBoxes[0].width)).toBeGreaterThanOrEqual(8);
  expect(priorityBoxes[2].x - (priorityBoxes[1].x + priorityBoxes[1].width)).toBeGreaterThanOrEqual(8);

  await editor.getByLabel("Task text").fill("Discard this draft");
  await editor.getByLabel("Assignee").selectOption("morgan");
  await editor.getByRole("radio", { name: "Low" }).check();
  await page.mouse.click(12, 80);
  await expect(editor).toHaveCount(0);

  await open.click();
  editor = page.getByRole("dialog", { name: "New Task" });
  await expect(editor.getByLabel("Task text")).toHaveValue("");
  await expect(editor.getByLabel("Assignee")).toHaveValue("");
  await expect(editor.getByRole("radio", { name: "Normal" })).toBeChecked();

  await expect.poll(async () => {
    const box = await editor.boundingBox();
    return box ? Math.abs(box.y + box.height - 844) : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(1);
  const sheet = await editor.boundingBox();
  const handle = editor.getByTestId("task-sheet-handle");
  let handleBox = await handle.boundingBox();
  expect(handleBox!.width).toBeGreaterThanOrEqual(44);
  expect(handleBox!.height).toBeGreaterThanOrEqual(44);
  let handleCenterY = handleBox!.y + handleBox!.height / 2;
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleCenterY);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleCenterY - 90, { steps: 4 });
  await page.mouse.up();
  await expect(editor).toBeVisible();
  await expect.poll(async () => (await editor.boundingBox())?.y).toBeCloseTo(sheet!.y, 0);

  handleBox = await handle.boundingBox();
  handleCenterY = handleBox!.y + handleBox!.height / 2;
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleCenterY);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleCenterY + 90, { steps: 4 });
  await page.mouse.up();
  await expect(editor).toHaveCount(0);
});

test("keeps Task text fully visible when iOS resizes both viewports for the keyboard", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [],
  });
  await page.addInitScript(() => {
    const viewportState = { height: 844, width: 390 };
    const visualViewport = new EventTarget();
    Object.defineProperties(visualViewport, {
      height: { get: () => viewportState.height },
      offsetTop: { get: () => 0 },
      width: { get: () => viewportState.width },
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      get: () => viewportState.height,
    });
    const testWindow = window as typeof window & {
      __setTestVisualViewportHeight: (height: number) => void;
    };
    testWindow.__setTestVisualViewportHeight = (height) => {
      viewportState.height = height;
      visualViewport.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "New Task" }).click();
  const editor = page.getByRole("dialog", { name: "New Task" });
  const taskText = editor.getByLabel("Task text");
  await taskText.click();
  await page.evaluate(() => {
    (window as typeof window & {
      __setTestVisualViewportHeight: (height: number) => void;
    }).__setTestVisualViewportHeight(420);
  });

  await expect.poll(async () => (await editor.boundingBox())?.height).toBeGreaterThanOrEqual(400);
  const editorBox = await editor.boundingBox();
  const textBox = await taskText.boundingBox();
  const actionBox = await editor.getByRole("button", { name: "Create", exact: true }).boundingBox();
  expect(editorBox!.y).toBeGreaterThanOrEqual(0);
  expect(editorBox!.y + editorBox!.height).toBeLessThanOrEqual(420);
  expect(textBox!.height).toBeGreaterThanOrEqual(76);
  expect(textBox!.y).toBeGreaterThanOrEqual(editorBox!.y);
  expect(textBox!.y + textBox!.height).toBeLessThanOrEqual(actionBox!.y);
  expect(await editor.evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration))).toBeGreaterThan(0);
});

test("keeps the reduced-motion Task sheet immediately operable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "New Task" }).click();
  const editor = page.getByRole("dialog", { name: "New Task" });
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await editor.getByLabel("Task text").fill("Reduced motion remains usable");
  await editor.getByRole("button", { name: "Close Task Editor" }).click();
  await expect(editor).toHaveCount(0);
});

test("separates the touch-first completion control from keyboard Task editing", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_touch_open",
        groupId: walkerLabs.groupId,
        text: "Publish the touch menu",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: "2026-07-20",
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_touch_done",
        groupId: walkerLabs.groupId,
        text: "Archive the old menu",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "done",
        createdAt: "2026-07-01T09:00:00.000Z",
        completedAt: "2026-07-16T18:30:00.000Z",
      },
    ],
  });
  await page.goto("/");

  const openTask = page.getByTestId("task-card").filter({ hasText: "Publish the touch menu" });
  const completion = openTask.getByRole("checkbox", { name: "Complete Publish the touch menu" });
  const taskBody = openTask.getByRole("button", { name: "Edit Task: Publish the touch menu" });
  for (const control of [completion, taskBody]) {
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await taskBody.focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Edit Task" });
  await expect(editor).toBeVisible();
  for (const control of await editor.locator('button, input:not([type="radio"]), select, textarea').all()) {
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(state.taskMutationRequests).toBe(0);
  await page.keyboard.press("Escape");
  await expect(taskBody).toBeFocused();

  await page.getByRole("button", { name: "Done 1", exact: true }).click();
  const doneTask = page.getByTestId("task-card").filter({ hasText: "Archive the old menu" });
  await expect(doneTask.getByRole("button", { name: /^Edit Task:/ })).toHaveCount(0);
  const reopen = doneTask.getByRole("button", { name: "Reopen Archive the old menu" });
  const reopenBox = await reopen.boundingBox();
  expect(reopenBox!.width).toBeGreaterThanOrEqual(44);
  expect(reopenBox!.height).toBeGreaterThanOrEqual(44);
  state.taskMutationDelayMs = 150;
  await reopen.click();
  const pendingReopen = doneTask.getByRole("button", { name: "Reopening Archive the old menu" });
  await expect(doneTask).toBeVisible();
  await expect(pendingReopen).toBeDisabled();
  await expect(page.getByRole("status", { name: "Task state update: Archive the old menu" })).toContainText("Reopening");
  await expect(page.getByRole("button", { name: "Open 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Done 1", exact: true })).toBeVisible();
  await expect(doneTask).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open 2", exact: true })).toBeVisible();
  const emptyDoneFilter = page.getByRole("button", { name: "Done 0", exact: true });
  await expect(emptyDoneFilter).toBeFocused();
  await page.getByRole("button", { name: "Open 2", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Task: Archive the old menu" })).toBeVisible();
  expect(state.taskStateRequests).toEqual([{ state: "open", taskId: "task_touch_done" }]);
});

test("keeps completion busy until success and restores the active filtered view with five-second Undo", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_undo",
        groupId: walkerLabs.groupId,
        text: "Publish the Undo menu",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_stays_open",
        groupId: walkerLabs.groupId,
        text: "Keep one Task open",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T09:00:00.000Z",
        completedAt: null,
      },
    ],
    taskMutationDelayMs: 500,
  });
  await page.goto("/");

  let task = page.getByTestId("task-card").filter({ hasText: "Publish the Undo menu" });
  await task.getByRole("checkbox", { name: "Complete Publish the Undo menu" }).click();
  const pendingCompletion = task.getByRole("checkbox", { name: "Completing Publish the Undo menu" });
  await expect(task).toBeVisible();
  await expect(pendingCompletion).toBeChecked();
  await expect(pendingCompletion).toBeDisabled();
  await expect(page.getByRole("status", { name: "Task state update: Publish the Undo menu" })).toContainText("Completing");
  await expect(page.getByRole("button", { name: "Open 2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Done 0", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "All 2", exact: true })).toBeVisible();

  const undoNotice = page.getByRole("status").filter({ hasText: "Publish the Undo menu" });
  await expect(undoNotice).toContainText("Undo available for 5 seconds");
  await expect(task).toHaveCount(0);
  const undo = undoNotice.getByRole("button", { name: "Undo completion of Publish the Undo menu" });
  await expect(undo).toBeFocused();
  await expect(page.getByRole("button", { name: "Open 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Done 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done 1", exact: true }).click();
  task = page.getByTestId("task-card").filter({ hasText: "Publish the Undo menu" });
  await expect(task).toBeVisible();

  state.taskMutationDelayMs = 150;
  await undo.click();
  await expect(undo).toBeDisabled();
  await expect(undoNotice).toContainText("Undoing…");
  await expect(task).toBeVisible();
  await expect(page.getByRole("button", { name: "Open 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Done 1", exact: true })).toBeVisible();
  await expect(task).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open 2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Done 0", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open 2", exact: true }).click();
  await expect(undoNotice).toHaveCount(0);
  await expect(page.getByTestId("task-card").filter({ hasText: "Publish the Undo menu" })).toBeVisible();
  expect(state.taskStateRequests).toEqual([
    { state: "done", taskId: "task_undo" },
    { state: "open", taskId: "task_undo" },
  ]);
});

test("scopes visible state-action busy controls to the affected Task", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_busy_first",
        groupId: walkerLabs.groupId,
        text: "Complete the first order",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_busy_second",
        groupId: walkerLabs.groupId,
        text: "Complete the second order",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T09:00:00.000Z",
        completedAt: null,
      },
    ],
    taskMutationDelayMs: 300,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "All 2", exact: true }).click();

  const firstTask = page.getByTestId("task-card").filter({ hasText: "Complete the first order" });
  const secondTask = page.getByTestId("task-card").filter({ hasText: "Complete the second order" });
  await firstTask.getByRole("checkbox", { name: "Complete Complete the first order" }).click();
  const firstBusyControl = firstTask.getByRole("checkbox", { name: "Completing Complete the first order" });
  await expect(firstBusyControl).toBeDisabled();
  await expect(firstTask.getByText("Completing…")).toBeVisible();

  const secondControl = secondTask.getByRole("checkbox", { name: "Complete Complete the second order" });
  await expect(secondControl).toBeEnabled();
  await secondControl.click();
  await expect.poll(() => state.taskMutationRequests).toBe(2);
  await expect(secondTask.getByRole("checkbox", { name: "Completing Complete the second order" })).toBeDisabled();

  await expect(page.getByRole("button", { name: "Undo completion of Complete the first order" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo completion of Complete the second order" })).toBeVisible();
  expect(state.taskMutationRequests).toBe(2);
});

test("keeps a failed completion truthful and offers a direct retry", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_retry",
        groupId: walkerLabs.groupId,
        text: "Retry the failed completion",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
    ],
    taskMutationDelayMs: 150,
    taskMutationFailureStatus: 500,
  });
  await page.goto("/");

  const task = page.getByTestId("task-card").filter({ hasText: "Retry the failed completion" });
  await task.getByRole("checkbox", { name: "Complete Retry the failed completion" }).click();
  await expect(task).toBeVisible();
  const pendingCompletion = task.getByRole("checkbox", { name: "Completing Retry the failed completion" });
  await expect(pendingCompletion).toBeChecked();
  await expect(pendingCompletion).toBeDisabled();
  const error = page.getByRole("alert").filter({ hasText: "could not apply that change" });
  await expect(error).toBeVisible();
  const completion = task.getByRole("checkbox", { name: "Complete Retry the failed completion" });
  await expect(completion).not.toBeChecked();
  await expect(completion).toBeEnabled();
  const retry = error.getByRole("button", { name: "Retry completion of Retry the failed completion" });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("button", { name: "Open 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Done 0", exact: true })).toBeVisible();

  state.taskMutationFailureStatus = null;
  await retry.click();
  await expect(task).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo completion of Retry the failed completion" })).toBeVisible();
  expect(state.taskMutationRequests).toBe(2);
});

test("keeps independent recovery actions when concurrent Task state changes fail", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_fail_first",
        groupId: walkerLabs.groupId,
        text: "Recover first failure",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_fail_second",
        groupId: walkerLabs.groupId,
        text: "Recover second failure",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T09:00:00.000Z",
        completedAt: null,
      },
    ],
    taskMutationDelayMs: 150,
    taskMutationFailureStatus: 500,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "All 2", exact: true }).click();

  await page.getByRole("checkbox", { name: "Complete Recover first failure" }).click();
  await page.getByRole("checkbox", { name: "Complete Recover second failure" }).click();
  const firstRetry = page.getByRole("button", { name: "Retry completion of Recover first failure" });
  const secondRetry = page.getByRole("button", { name: "Retry completion of Recover second failure" });
  await expect(firstRetry).toBeVisible();
  await expect(secondRetry).toBeVisible();
  expect(state.taskMutationRequests).toBe(2);

  state.taskMutationFailureStatus = null;
  await firstRetry.click();
  await expect(firstRetry).toHaveCount(0);
  await expect(secondRetry).toBeVisible();
});

test("expires completion Undo after five seconds without changing the completed Task", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-17T12:00:00-05:00") });
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_undo_expiry",
        groupId: walkerLabs.groupId,
        text: "Let Undo expire",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");

  const completion = page.getByRole("checkbox", { name: "Complete Let Undo expire" });
  await expect(completion).toBeVisible();
  await page.clock.pauseAt(new Date("2026-07-17T12:00:01-05:00"));
  await completion.click();
  const undo = page.getByRole("button", { name: "Undo completion of Let Undo expire" });
  await expect(undo).toBeVisible();
  await page.clock.fastForward(4_999);
  await expect(undo).toBeVisible();
  await undo.focus();
  await page.clock.fastForward(1);
  await expect(undo).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open 0", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Done 1", exact: true })).toBeVisible();
  expect(state.taskStateRequests).toEqual([{ state: "done", taskId: "task_undo_expiry" }]);
});

test("runs the complete Task lifecycle through the shared editor", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [
      visibleMorganTask("2026-07-01T09:00:00.000Z"),
      {
        taskId: "task_existing",
        groupId: walkerLabs.groupId,
        text: "Publish lunch specials",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_unassigned",
        groupId: walkerLabs.groupId,
        text: "Recover payroll handoff",
        assignee: { state: "unassigned" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-02T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");

  const morganSection = page.getByTestId("member-section").filter({ has: page.getByRole("heading", { name: "@morgan" }) });
  const unassignedSection = page.getByTestId("member-section").filter({ has: page.getByRole("heading", { name: "Unassigned" }) });
  await expect(morganSection.getByRole("button", { name: "Add Task" })).toBeVisible();
  await expect(unassignedSection.getByRole("button", { name: "Add Task" })).toHaveCount(0);

  await morganSection.getByRole("button", { name: "Add Task" }).click();
  let editor = page.getByRole("dialog", { name: "New Task" });
  await expect(editor.getByLabel("Assignee")).toHaveValue("morgan");
  await editor.getByLabel("Task text").fill("Order replacement menu stands");
  await editor.getByRole("radio", { name: "High" }).check();
  await editor.getByLabel("Due date").fill("2026-07-20");
  state.taskMutationDelayMs = 150;
  await editor.getByRole("button", { name: "Create", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(page.getByText("Order replacement menu stands")).toBeVisible();
  state.taskMutationDelayMs = 0;

  let card = page.getByTestId("task-card").filter({ hasText: "Order replacement menu stands" });
  await expect(card.getByText("High", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Edit" }).click();
  editor = page.getByRole("dialog", { name: "Edit Task" });
  await expect(editor.getByRole("radio", { name: "High" })).toBeChecked();
  await expect(editor.getByLabel("Due date")).toHaveValue("2026-07-20");
  await editor.getByRole("button", { name: "Clear selected date" }).click();
  await expect(editor.getByLabel("Due date")).toHaveValue("");
  await editor.getByLabel("Task text").fill("Order two menu stands");
  await editor.getByLabel("Assignee").selectOption("shane");
  await editor.getByRole("radio", { name: "Low" }).check();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  card = page.getByTestId("task-card").filter({ hasText: "Order two menu stands" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Low", { exact: true })).toBeVisible();
  expect(state.tasks.find((task) => task.text === "Order two menu stands")?.dueDate).toBeNull();

  await card.getByRole("checkbox", { name: "Complete Order two menu stands" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Done 1", exact: true }).click();
  card = page.getByTestId("task-card").filter({ hasText: "Order two menu stands" });
  await expect(card.getByText("Low", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await card.getByRole("button", { name: "Reopen" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Open 4", exact: true }).click();
  card = page.getByTestId("task-card").filter({ hasText: "Order two menu stands" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Low", { exact: true })).toBeVisible();

  const unassignedCard = page.getByTestId("task-card").filter({ hasText: "Recover payroll handoff" });
  await unassignedCard.getByRole("button", { name: "Assign" }).click();
  editor = page.getByRole("dialog", { name: "Assign Task" });
  await expect(editor.getByLabel("Assignee")).toHaveValue("");
  const requestsBeforeRequiredSelection = state.taskMutationRequests;
  await editor.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("alert")).toContainText("Choose a current Member");
  expect(state.taskMutationRequests).toBe(requestsBeforeRequiredSelection);
  await editor.getByLabel("Assignee").selectOption("morgan");
  await editor.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(morganSection.getByText("Recover payroll handoff")).toBeVisible();

  await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await card.getByRole("button", { name: "Edit" }).click();
  editor = page.getByRole("dialog", { name: "Edit Task" });
  await expectConfirmation(page, "permanently delete", () =>
    editor.getByRole("button", { name: "Delete Task" }).click(), false);
  await expect(editor).toBeVisible();
  state.taskMutationDelayMs = 150;
  const confirmation = page.waitForEvent("dialog").then(async (dialog) => {
    await dialog.accept();
  });
  await editor.getByRole("button", { name: "Delete Task" }).click();
  await confirmation;
  await expect(editor.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  await expect(page.getByText("Order two menu stands")).toHaveCount(0);
});

test("uses one narrow column and two desktop columns without horizontal overflow", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_mobile_shane",
        groupId: walkerLabs.groupId,
        text: "Keep the first section visible",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T09:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_mobile",
        groupId: walkerLabs.groupId,
        text: "Check the narrow layout",
        assignee: { state: "assigned", userId: "user_morgan", username: "morgan" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const sections = page.getByTestId("member-section");
  let first = await sections.nth(0).boundingBox();
  let second = await sections.nth(1).boundingBox();
  expect(first!.width).toBeGreaterThanOrEqual(315);
  expect(first!.width).toBeLessThan(375);
  expect(Math.abs(second!.x - first!.x)).toBeLessThanOrEqual(1);
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
  await expectNoHorizontalOverflow(page);

  for (const viewport of [
    { width: 667, height: 375 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  first = await sections.nth(0).boundingBox();
  second = await sections.nth(1).boundingBox();
  expect(Math.abs(second!.y - first!.y)).toBeLessThanOrEqual(1);
  expect(second!.x).toBeGreaterThan(first!.x + first!.width);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 375, height: 812 });
  const morganSection = sections.filter({ has: page.getByRole("heading", { name: "@morgan" }) });
  await morganSection.scrollIntoViewIfNeeded();
  await morganSection.getByRole("checkbox", { name: "Complete Check the narrow layout" }).click();
  await expect(page.getByTestId("task-card").filter({ hasText: "Check the narrow layout" })).toHaveCount(0);

  await page.getByRole("button", { name: "New Task" }).click();
  const editor = page.getByRole("dialog", { name: "New Task" });
  await expect.poll(async () => {
    const box = await editor.boundingBox();
    return box ? Math.abs(box.y + box.height - 812) : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(1);
  const narrowEditor = await editor.boundingBox();
  expect(narrowEditor!.x).toBe(0);
  expect(narrowEditor!.width).toBe(375);
  await editor.getByLabel("Task text").fill("Created from the bottom sheet");
  await editor.getByLabel("Assignee").selectOption("shane");
  await editor.getByRole("button", { name: "Create", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText("Created from the bottom sheet")).toBeVisible();
});

test("runs edit, recovery, failure, focus, and delete flows in the narrow Task sheet", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_narrow_edit",
        groupId: walkerLabs.groupId,
        text: "Edit this narrow Task",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_narrow_unassigned",
        groupId: walkerLabs.groupId,
        text: "Recover this narrow Task",
        assignee: { state: "unassigned" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-02T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const globalNewTask = page.getByRole("button", { name: "New Task" });
  let editButton = page.getByTestId("task-card")
    .filter({ hasText: "Edit this narrow Task" })
    .getByRole("button", { name: "Edit" });
  await editButton.click();
  let editor = page.getByRole("dialog", { name: "Edit Task" });
  await expect(editor).toBeFocused();
  await editor.getByLabel("Task text").fill("Preserve this narrow draft");
  await editor.getByLabel("Assignee").selectOption("morgan");
  await editor.getByLabel("Due date").fill("2026-07-30");
  state.taskMutationFailureStatus = 409;
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Task changed");
  await expect(editor.getByLabel("Task text")).toHaveValue("Preserve this narrow draft");
  state.taskMutationFailureStatus = null;

  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(editButton).toBeFocused();
  await editButton.click();
  editor = page.getByRole("dialog", { name: "Edit Task" });
  await editor.getByRole("button", { name: "Close Task Editor" }).click();
  await expect(editor).toHaveCount(0);
  await expect(editButton).toBeFocused();

  await editButton.click();
  editor = page.getByRole("dialog", { name: "Edit Task" });
  await editor.getByLabel("Task text").fill("Narrow edited Task");
  await editor.getByLabel("Assignee").selectOption("morgan");
  await editor.getByLabel("Due date").fill("2026-07-30");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText("Narrow edited Task")).toBeVisible();
  await expect(globalNewTask).toBeFocused();

  const unassignedCard = page.getByTestId("task-card").filter({ hasText: "Recover this narrow Task" });
  await unassignedCard.getByRole("button", { name: "Assign" }).click();
  editor = page.getByRole("dialog", { name: "Assign Task" });
  await editor.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Choose a current Member");
  await editor.getByLabel("Assignee").selectOption("morgan");
  await editor.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId("task-card").filter({ hasText: "Recover this narrow Task" })).toBeVisible();

  const editedCard = page.getByTestId("task-card").filter({ hasText: "Narrow edited Task" });
  editButton = editedCard.getByRole("button", { name: "Edit" });
  await editButton.click();
  editor = page.getByRole("dialog", { name: "Edit Task" });
  await expectConfirmation(page, "permanently delete", () =>
    editor.getByRole("button", { name: "Delete Task" }).click(), false);
  await expect(editor).toBeVisible();
  await expectConfirmation(page, "permanently delete", () =>
    editor.getByRole("button", { name: "Delete Task" }).click());
  await expect(page.getByText("Narrow edited Task")).toHaveCount(0);
  await expect(globalNewTask).toBeFocused();
});

test("shows loading and empty Task List states", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    hangTasks: true,
  });
  await page.goto("/");
  await expect(page.getByText("Loading Task List…")).toBeVisible();

  state.hangTasks = false;
  await page.reload();
  await expect(page.getByTestId("member-section")).toHaveCount(0);
  await expect(page.getByText("No open Tasks.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New Task" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Task" })).toHaveCount(0);
});

test("recovers Task List permission and network failures", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    taskFailureStatus: 403,
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("no longer have permission");

  state.taskFailureStatus = null;
  state.failTaskNetwork = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toContainText("Check your connection");

  state.failTaskNetwork = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("member-section")).toHaveCount(0);
  await expect(page.getByText("No open Tasks.")).toBeVisible();
});

test("keeps validation and conflict failures visible and recoverable", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_conflict",
        groupId: walkerLabs.groupId,
        text: "Resolve the conflict",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Add Task" }).click();
  let editor = page.getByRole("dialog", { name: "New Task" });
  await editor.getByLabel("Task text").fill("   ");
  await editor.getByRole("button", { name: "Create", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("1 to 2,000 characters");
  await expect(editor.getByLabel("Task text")).toHaveValue("   ");
  await editor.getByLabel("Task text").fill("x".repeat(2_001));
  await editor.getByRole("button", { name: "Create", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("1 to 2,000 characters");
  expect(state.taskMutationRequests).toBe(0);
  await editor.getByLabel("Task text").fill("A valid Task");
  await editor.getByRole("button", { name: "Create", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText("A valid Task")).toBeVisible();

  state.taskMutationFailureStatus = 409;
  const conflictCard = page.getByTestId("task-card").filter({ hasText: "Resolve the conflict" });
  await conflictCard.getByRole("button", { name: "Edit" }).click();
  editor = page.getByRole("dialog", { name: "Edit Task" });
  await editor.getByLabel("Task text").fill("Keep this recovered draft");
  await editor.getByLabel("Due date").fill("2026-07-25");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Task changed");
  await expect(editor.getByLabel("Task text")).toHaveValue("Keep this recovered draft");
  await expect(editor.getByLabel("Due date")).toHaveValue("2026-07-25");
  state.taskMutationFailureStatus = 403;
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("no longer have permission");
  await expect(editor.getByLabel("Task text")).toHaveValue("Keep this recovered draft");
  state.taskMutationFailureStatus = null;
  state.failTaskMutationNetwork = true;
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Check your connection");
  await expect(editor.getByLabel("Task text")).toHaveValue("Keep this recovered draft");
  state.failTaskMutationNetwork = false;
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText("Keep this recovered draft")).toBeVisible();
});

test("closes a committed editor mutation when the Task List refresh fails", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
  });
  await page.goto("/");

  await page.getByRole("button", { name: "New Task" }).click();
  const editor = page.getByRole("dialog", { name: "New Task" });
  await editor.getByLabel("Task text").fill("Created before refresh failed");
  await editor.getByLabel("Assignee").selectOption("shane");
  state.failTaskNetwork = true;
  await editor.getByRole("button", { name: "Create", exact: true }).click();

  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("saved, but the Task List could not refresh");
  state.failTaskNetwork = false;
  await page.getByRole("button", { name: "Reload Task List" }).click();
  await expect(page.getByText("Created before refresh failed")).toHaveCount(1);
});

test("restores a Task editor draft after authentication recovery", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_auth_draft",
        groupId: walkerLabs.groupId,
        text: "Keep the original text",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");

  await page.getByTestId("task-card").getByRole("button", { name: "Edit" }).click();
  let editor = page.getByRole("dialog", { name: "Edit Task" });
  await editor.getByLabel("Task text").fill("Restore this exact draft");
  await editor.getByLabel("Due date").fill("2026-07-29");
  state.taskMutationFailureStatus = 401;
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your session expired. Sign in again.");

  state.taskMutationFailureStatus = null;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  editor = page.getByRole("dialog", { name: "Edit Task" });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Task text")).toHaveValue("Restore this exact draft");
  await expect(editor.getByLabel("Assignee")).toHaveValue("shane");
  await expect(editor.getByLabel("Due date")).toHaveValue("2026-07-29");
});

test("returns Task List authentication failures to a working sign-in path", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    taskFailureStatus: 401,
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Your session expired. Sign in again.");

  state.taskFailureStatus = null;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByTestId("member-section")).toHaveCount(0);
  await expect(page.getByText("No open Tasks.")).toBeVisible();
});

test("renders a Member whose valid Username is all", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_all", username: "all", role: "member", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_all",
        groupId: walkerLabs.groupId,
        text: "Work assigned to all",
        assignee: { state: "assigned", userId: "user_all", username: "all" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_shane",
        groupId: walkerLabs.groupId,
        text: "Work assigned to shane",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-02T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");

  const sections = page.getByTestId("member-section");
  await expect(sections).toHaveCount(2);
  await expect(sections.nth(0).getByRole("heading")).toHaveText("@all");
  await expect(sections.nth(1).getByRole("heading")).toHaveText("@shane");
  await expect(page.getByText("Work assigned to all")).toBeVisible();
  await expect(page.getByText("Work assigned to shane")).toBeVisible();
});

test("removes the Unassigned section after its final Task is recovered", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_unassigned_last",
        groupId: walkerLabs.groupId,
        text: "Recover the last Task",
        assignee: { state: "unassigned" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Assign" }).click();
  const editor = page.getByRole("dialog", { name: "Assign Task" });
  await editor.getByLabel("Assignee").selectOption("shane");
  await editor.getByRole("button", { name: "Assign", exact: true }).click();

  const section = page.getByTestId("member-section");
  await expect(section).toHaveCount(1);
  await expect(section.getByRole("heading")).toHaveText("@shane");
  await expect(section.getByText("Recover the last Task")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unassigned" })).toHaveCount(0);
});

test("keeps done Tasks visible in Former Member sections", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_departed",
        groupId: walkerLabs.groupId,
        text: "Completed before departure",
        assignee: { state: "assigned", userId: "user_zora", username: "zora" },
        dueDate: null,
        state: "done",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: "2026-07-15T10:00:00.000Z",
      },
    ],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Done 1", exact: true }).click();

  const departedSection = page.getByTestId("member-section").filter({ has: page.getByRole("heading", { name: "@zora" }) });
  await expect(departedSection.getByText("Former Member")).toBeVisible();
  await expect(departedSection.getByText("Completed before departure")).toBeVisible();
  await expect(departedSection.getByRole("button", { name: "Add Task" })).toHaveCount(0);
  await expect(page.getByText("Completed before departure")).toBeVisible();
});

test("keeps the approved Variant B visual hierarchy at phone and desktop sizes", async ({ page }) => {
  await startSignedIn(page);
  await page.clock.setFixedTime(new Date("2026-07-17T12:00:00-05:00"));
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_elijah", username: "elijah", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-03T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_shane_photo",
        groupId: walkerLabs.groupId,
        text: "Confirm the July photo schedule",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: "2026-07-17",
        state: "open",
        createdAt: "2026-07-01T09:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_shane_specials",
        groupId: walkerLabs.groupId,
        text: "Publish this week's lunch specials",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: "2026-07-18",
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_elijah_patio",
        groupId: walkerLabs.groupId,
        text: "Send final patio measurements",
        assignee: { state: "assigned", userId: "user_elijah", username: "elijah" },
        dueDate: "2026-07-17",
        state: "open",
        createdAt: "2026-07-01T11:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_elijah_vendor",
        groupId: walkerLabs.groupId,
        text: "Review vendor renewal",
        assignee: { state: "assigned", userId: "user_elijah", username: "elijah" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T12:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_morgan_stands",
        groupId: walkerLabs.groupId,
        text: "Order replacement menu stands",
        assignee: { state: "assigned", userId: "user_morgan", username: "morgan" },
        dueDate: "2026-07-20",
        state: "open",
        createdAt: "2026-07-01T13:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_unassigned_payroll",
        groupId: walkerLabs.groupId,
        text: "Reassign the payroll handoff",
        assignee: { state: "unassigned" },
        dueDate: "2026-07-16",
        state: "open",
        createdAt: "2026-07-01T14:00:00.000Z",
        completedAt: null,
      },
    ],
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Walker Labs" })).toBeVisible();
  await expect(page.getByTestId("member-section")).toHaveCount(4);
  await expect(page).toHaveScreenshot("variant-b-phone.png", {
    animations: "disabled",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page).toHaveScreenshot("variant-b-desktop.png", {
    animations: "disabled",
    fullPage: true,
  });
});
