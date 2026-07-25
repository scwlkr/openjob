import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AccessibilityInfo,
  AppState,
  Dimensions,
  type AppStateStatus,
} from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { OpenJobNativeApp } from "../App";
import { resolveAppearanceKey } from "../src/appearance-keyboard";
import type { NativeAuthController } from "../src/auth/AuthGate";
import * as authDependencies from "../src/auth/dependencies";
import {
  OpenJobApiError,
  ProviderSignInError,
} from "../src/auth/coordinator";
import type { NativeDiagnosticsController } from "../src/diagnostics";
import * as runtimeConfigModule from "../src/runtime-config";
import type { OpenJobRuntimeConfig } from "../src/runtime-config";
import type {
  NativeCachedTaskList,
  NativeGroup,
  NativeTaskListSnapshot,
} from "../src/task-list-contracts";

const previewConfig: OpenJobRuntimeConfig = {
  apiBasePath: "/api/v1",
  apiBaseUrl:
    "https://openjob-preview.walkerworlddiscord.workers.dev/api/v1",
  appleRedirectUri:
    "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
  appleServiceId: "dev.openjob.auth.nonprod",
  diagnosticsDsn: null,
  diagnosticsStartupCrashVerificationEnabled: false,
  diagnosticsVerificationEnabled: false,
  environment: "preview",
  environmentBadge: "Preview",
  firebaseApiKey: "public-key",
  firebaseAuthDomain: "openjob-nonprod.firebaseapp.com",
  googleIosClientId: "ios.apps.googleusercontent.com",
  googleWebClientId: "web.apps.googleusercontent.com",
  keychainService: "dev.openjob.app.preview.auth",
  qaPasswordTenantId: "OpenJob-QA-Two-mvz9m",
  releaseVersion: "0.3.3",
  sessionStorageKey: "openjob.native.auth.preview.v1",
};

const productionConfig: OpenJobRuntimeConfig = {
  ...previewConfig,
  apiBaseUrl: "https://openjob.dev/api/v1",
  appleRedirectUri:
    "https://openjob-dev.firebaseapp.com/__/auth/handler",
  appleServiceId: "dev.openjob.auth",
  environment: "production",
  environmentBadge: null,
  firebaseAuthDomain: "openjob-dev.firebaseapp.com",
  keychainService: "dev.openjob.app.auth",
  qaPasswordTenantId: null,
  sessionStorageKey: "openjob.native.auth.production.v1",
};

const signedIn = {
  kind: "signed-in" as const,
  methods: ["google" as const],
  user: {
    userId: "usr_one",
    username: "walker",
    usernameRequired: false,
  },
};

function authController(
  overrides: Partial<NativeAuthController> = {},
): NativeAuthController {
  const readTaskList =
    overrides.readTaskList ??
    jest.fn(async () => ({ members: [], tasks: [] }));
  const syncTaskList =
    overrides.syncTaskList ??
    jest.fn(async (groupId: string) => ({
      freshAt: "2026-07-25T12:00:00.000Z",
      kind: "changed" as const,
      snapshot: await readTaskList(groupId),
      validator: '"task-list"',
    }));
  return {
    authenticateExistingUser: jest.fn(async () => signedIn),
    authenticateNewMethod: jest.fn(async () => signedIn),
    cancelPending: jest.fn(async () => signedIn),
    claimUsername: jest.fn(async () => signedIn),
    confirmLink: jest.fn(async () => signedIn),
    createUser: jest.fn(async () => signedIn),
    listGroups: jest.fn(async () => []),
    loadCachedTaskList: jest.fn(async () => null),
    purgeCachedTaskList: jest.fn(async () => undefined),
    readTaskList,
    revokeSession: jest.fn(async () => ({
      kind: "signed-out" as const,
      reason: "revoked" as const,
    })),
    restore: jest.fn(async () => signedIn),
    restoreCachedSession: jest.fn(async () => null),
    saveCachedTaskList: jest.fn(async () => undefined),
    signIn: jest.fn(async () => signedIn),
    signInWithQaPassword: jest.fn(async () => signedIn),
    signOut: jest.fn(async () => ({ kind: "signed-out" as const })),
    subscribeToCredentialRevocation: jest.fn(() => () => undefined),
    syncTaskList,
    switchUser: jest.fn(async () => ({ kind: "signed-out" as const })),
    ...overrides,
  };
}

function renderNativeApp(
  runtimeConfig: OpenJobRuntimeConfig,
  controller = authController(),
  diagnosticsController?: NativeDiagnosticsController,
) {
  return render(
    <OpenJobNativeApp
      authController={controller}
      diagnosticsController={diagnosticsController}
      runtimeConfig={runtimeConfig}
    />,
  );
}

function diagnosticsController(
  initial = true,
): NativeDiagnosticsController & {
  captureException: jest.Mock;
  flush: jest.Mock;
  initialize: jest.Mock;
  setSharingEnabled: jest.Mock;
  triggerNativeCrashVerification: jest.Mock;
} {
  let enabled = initial;
  return {
    captureException: jest.fn(() => "diagnostic-event"),
    flush: jest.fn(async () => true),
    initialize: jest.fn(async () => enabled),
    isSharingEnabled: jest.fn(() => enabled),
    setSharingEnabled: jest.fn(async (next: boolean) => {
      enabled = next;
      return enabled;
    }),
    triggerNativeCrashVerification: jest.fn(() => true),
  };
}

const adaptiveGroups: NativeGroup[] = [
  {
    groupId: "grp_one",
    name: "Walker Workshop",
    role: "admin",
    createdAt: "2026-07-20T12:00:00.000Z",
  },
  {
    groupId: "grp_two",
    name: "Field Notes",
    role: "member",
    createdAt: "2026-07-21T12:00:00.000Z",
  },
];

function oneTaskSnapshot(
  groupId: string,
  text: string,
): NativeTaskListSnapshot {
  return {
    members: [
      {
        userId: "usr_one",
        username: "walker",
        role: "admin",
        joinedAt: "2026-07-20T12:00:00.000Z",
      },
    ],
    tasks: [
      {
        taskId: `task_${groupId}`,
        groupId,
        text,
        assignee: {
          state: "assigned",
          userId: "usr_one",
          username: "walker",
        },
        priority: "normal",
        dueDate: null,
        state: "open",
        createdAt: "2026-07-20T12:01:00.000Z",
        completedAt: null,
      },
    ],
  };
}

function cachedTaskList(
  snapshot = oneTaskSnapshot("grp_one", "Cached Task"),
): NativeCachedTaskList {
  return {
    freshAt: "2026-07-25T12:00:00.000Z",
    group: adaptiveGroups[0]!,
    snapshot,
    status: "open",
    validator: '"cached-validator"',
  };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  AppState.currentState = "active";
  await AsyncStorage.clear();
});

test("bootstraps the branded preview shell from its embedded bundle", async () => {
  await renderNativeApp(previewConfig);

  expect(
    await screen.findByRole("header", { name: "Choose a Group" }),
  ).toBeOnTheScreen();
  expect(screen.getByText("Preview build")).toBeOnTheScreen();
  expect(screen.getByText("No Groups yet")).toBeOnTheScreen();
  expect(screen.getByLabelText("OpenJob")).toBeOnTheScreen();
  expect(screen.getByTestId("openjob-wordmark-canonical")).toBeOnTheScreen();
  expect(
    screen.getByTestId("openjob-brandmark-canonical", {
      includeHiddenElements: true,
    }),
  ).toBeOnTheScreen();
  expect(screen.queryByText("OPENJOB")).not.toBeOnTheScreen();
});

test("offers Retry and sign out when bootstrap fails fatally", async () => {
  const controller = authController();
  const diagnostics = diagnosticsController();
  diagnostics.initialize
    .mockRejectedValueOnce(new Error("storage unavailable"))
    .mockResolvedValue(true);

  await renderNativeApp(previewConfig, controller, diagnostics);

  expect(
    await screen.findByRole("alert", { name: "OpenJob could not start safely" }),
  ).toBeOnTheScreen();
  const signOut = screen.getByRole("button", { name: "Sign out safely" });
  const retry = screen.getByRole("button", { name: "Retry OpenJob" });
  const stopDiagnostics = screen.getByRole("button", {
    name: "Stop sharing diagnostics",
  });

  await fireEvent.press(stopDiagnostics);
  await waitFor(() =>
    expect(diagnostics.setSharingEnabled).toHaveBeenCalledWith(false),
  );
  expect(screen.getByText("Diagnostics are off.")).toBeOnTheScreen();
  await fireEvent.press(signOut);
  await waitFor(() => expect(controller.signOut).toHaveBeenCalledTimes(1));
  await fireEvent.press(retry);

  expect(
    await screen.findByRole("header", { name: "Choose a Group" }),
  ).toBeOnTheScreen();
  expect(diagnostics.initialize).toHaveBeenCalledTimes(2);
});

test("keeps bootstrap sign-out in recovery when cleanup is incomplete", async () => {
  const controller = authController({
    signOut: jest.fn(async () => ({ kind: "cleanup-retry" as const })),
  });
  const diagnostics = diagnosticsController();
  diagnostics.initialize.mockRejectedValueOnce(
    new Error("storage unavailable"),
  );

  await renderNativeApp(previewConfig, controller, diagnostics);
  await fireEvent.press(
    await screen.findByRole("button", { name: "Sign out safely" }),
  );

  expect(
    await screen.findByText("Sign out cleanup is incomplete. Retry it."),
  ).toBeOnTheScreen();
  expect(screen.queryByText("Signed out safely.")).not.toBeOnTheScreen();
});

test("recovers when embedded runtime configuration initially cannot be read", async () => {
  jest
    .spyOn(runtimeConfigModule, "readRuntimeConfig")
    .mockImplementationOnce(() => {
      throw new Error("invalid embedded configuration");
    })
    .mockReturnValue(previewConfig);

  await render(
    <OpenJobNativeApp
      authController={authController()}
      diagnosticsController={diagnosticsController()}
    />,
  );
  expect(
    await screen.findByRole("alert", {
      name: "OpenJob could not start safely",
    }),
  ).toBeOnTheScreen();

  await fireEvent.press(
    screen.getByRole("button", { name: "Retry OpenJob" }),
  );

  expect(
    await screen.findByRole("header", { name: "Choose a Group" }),
  ).toBeOnTheScreen();
});

test("purges local authentication state without runtime configuration or an injected controller", async () => {
  jest
    .spyOn(runtimeConfigModule, "readRuntimeConfig")
    .mockImplementation(() => {
      throw new Error("invalid embedded configuration");
    });
  const purge = jest
    .spyOn(authDependencies, "purgeNativeAuthStateWithoutRuntimeConfig")
    .mockResolvedValue();

  await render(
    <OpenJobNativeApp diagnosticsController={diagnosticsController()} />,
  );
  expect(
    await screen.findByRole("alert", {
      name: "OpenJob could not start safely",
    }),
  ).toBeOnTheScreen();

  await fireEvent.press(
    screen.getByRole("button", { name: "Sign out safely" }),
  );

  await waitFor(() => expect(purge).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Signed out safely.")).toBeOnTheScreen();
});

test.each([
  {
    heading: "Sign in to your shared Task Lists",
    result: { kind: "signed-out" as const },
  },
  {
    heading: "Reconnect to OpenJob",
    result: { kind: "restore-retry" as const, reason: "offline" as const },
  },
])("keeps diagnostics opt-out reachable from $heading", async ({ heading, result }) => {
  const diagnostics = diagnosticsController();
  const controller = authController({
    restore: jest.fn(async () => result),
  });

  await renderNativeApp(previewConfig, controller, diagnostics);

  expect(
    await screen.findByRole("header", { name: heading }),
  ).toBeOnTheScreen();
  const sharing = screen.getByRole("switch", { name: "Share diagnostics" });
  expect(sharing).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ checked: true }),
  );

  await fireEvent.press(sharing);

  await waitFor(() =>
    expect(diagnostics.setSharingEnabled).toHaveBeenCalledWith(false),
  );
  expect(sharing).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ checked: false }),
  );
});

test("covers background snapshots with a branded curtain while active screenshots stay available", async () => {
  const appStateListeners: Array<(state: AppStateStatus) => void> = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((event, listener) => {
    if (event === "change") {
      appStateListeners.push(listener as (state: AppStateStatus) => void);
    }
    return { remove: jest.fn() };
  });
  const controller = authController({
    listGroups: jest.fn(async () => adaptiveGroups),
    readTaskList: jest.fn(async () =>
      oneTaskSnapshot("grp_one", "Private Task text"),
    ),
  });

  await renderNativeApp(previewConfig, controller);
  await fireEvent.press(
    await screen.findByRole("button", { name: "Open Walker Workshop" }),
  );
  expect(await screen.findByText("Private Task text")).toBeOnTheScreen();
  expect(screen.queryByTestId("openjob-privacy-curtain")).not.toBeOnTheScreen();

  await act(() => {
    for (const listener of appStateListeners) listener("background");
  });
  expect(screen.getByTestId("openjob-privacy-curtain")).toBeOnTheScreen();
  expect(screen.getByText("OpenJob is private in the app switcher.")).toBeOnTheScreen();

  await act(() => {
    for (const listener of appStateListeners) listener("active");
  });
  expect(screen.queryByTestId("openjob-privacy-curtain")).not.toBeOnTheScreen();
  expect(screen.getByText("Private Task text")).toBeOnTheScreen();
});

test("production omits the non-production build badge", async () => {
  await renderNativeApp(productionConfig);

  expect(
    await screen.findByRole("header", { name: "Choose a Group" }),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/build$/iu)).not.toBeOnTheScreen();
});

test("lets the User stop later diagnostics and guards verification controls from production", async () => {
  const diagnostics = diagnosticsController();
  const rendered = await renderNativeApp(
    {
      ...previewConfig,
      diagnosticsDsn: "https://public@example.ingest.sentry.io/1",
      diagnosticsVerificationEnabled: true,
    },
    authController(),
    diagnostics,
  );
  await fireEvent.press(
    await screen.findByRole("button", { name: "Open appearance settings" }),
  );

  const sharing = await screen.findByRole("switch", {
    name: "Share diagnostics",
  });
  expect(sharing).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ checked: true }),
  );
  expect(screen.getByText("Crashes and hangs only")).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Send diagnostic verification" }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Crash this verification build" }),
  ).toBeOnTheScreen();

  await fireEvent.press(
    screen.getByRole("button", { name: "Send diagnostic verification" }),
  );
  expect(
    await screen.findByText(
      "Scrubbed verification event queued. Confirm it in Sentry.",
    ),
  ).toBeOnTheScreen();

  diagnostics.flush.mockRejectedValueOnce(new Error("transport unavailable"));
  await fireEvent.press(
    screen.getByRole("button", { name: "Send diagnostic verification" }),
  );
  expect(
    await screen.findByText(
      "Verification could not be sent. Nothing private was attached.",
    ),
  ).toBeOnTheScreen();

  await fireEvent.press(sharing);
  await waitFor(() => {
    expect(diagnostics.setSharingEnabled).toHaveBeenCalledWith(false);
  });
  expect(sharing).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ checked: false }),
  );
  expect(await screen.findByText("Diagnostics are off.")).toBeOnTheScreen();

  await rendered.unmount();
  await AsyncStorage.clear();
  await renderNativeApp(productionConfig, authController(), diagnosticsController());
  await fireEvent.press(
    await screen.findByRole("button", { name: "Open appearance settings" }),
  );
  expect(
    screen.queryByRole("button", { name: "Send diagnostic verification" }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "Crash this verification build" }),
  ).not.toBeOnTheScreen();
});

test("keeps diagnostics off in parent state when native cleanup reports a warning", async () => {
  const diagnostics = diagnosticsController();
  diagnostics.setSharingEnabled.mockImplementationOnce(async () => {
    (diagnostics.isSharingEnabled as jest.Mock).mockReturnValue(false);
    throw new Error("native cleanup incomplete");
  });
  await renderNativeApp(
    {
      ...previewConfig,
      diagnosticsDsn: "https://public@example.ingest.sentry.io/1",
    },
    authController(),
    diagnostics,
  );
  await fireEvent.press(
    await screen.findByRole("button", { name: "Open appearance settings" }),
  );
  await fireEvent.press(
    await screen.findByRole("switch", { name: "Share diagnostics" }),
  );
  expect(
    await screen.findByText(
      "Diagnostics are off. Native cleanup was incomplete; try again.",
    ),
  ).toBeOnTheScreen();

  await fireEvent.press(
    screen.getByRole("button", { name: "Back to OpenJob" }),
  );
  await fireEvent.press(
    await screen.findByRole("button", { name: "Open appearance settings" }),
  );
  expect(
    await screen.findByRole("switch", { name: "Share diagnostics" }),
  ).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ checked: false }),
  );
});

test("wraps every User action inside a narrow phone header", async () => {
  const original = Dimensions.get("window");
  await act(() => {
    Dimensions.set({
      window: { ...original, height: 700, width: 320 },
    });
  });
  let rendered: Awaited<ReturnType<typeof renderNativeApp>> | undefined;

  try {
    rendered = await renderNativeApp(previewConfig);

    expect(await screen.findByTestId("openjob-top-bar")).toHaveStyle({
      flexDirection: "column",
    });
    expect(screen.getByTestId("openjob-top-bar-actions")).toHaveStyle({
      flexWrap: "wrap",
      width: "100%",
    });
    for (const label of [
      "Manage Sign-in Methods",
      "Switch User",
      "Sign out",
      "Open appearance settings",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeOnTheScreen();
    }
  } finally {
    await rendered?.unmount();
    await act(() => {
      Dimensions.set({ window: original });
    });
  }
});

test("restores the selected appearance and pushed native-stack screen", async () => {
  const first = await renderNativeApp(previewConfig);

  await fireEvent.press(
    await screen.findByLabelText("Open appearance settings"),
  );
  expect(await screen.findByRole("header", { name: "Appearance" })).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("radio", { name: "Use dark appearance" }),
  );
  expect(await screen.findByText("Dark selected")).toBeOnTheScreen();

  await waitFor(() => {
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });
  await first.unmount();
  await renderNativeApp(previewConfig);

  expect(await screen.findByRole("header", { name: "Appearance" })).toBeOnTheScreen();
  expect(screen.getByText("Dark selected")).toBeOnTheScreen();
});

test("keeps selected dark-mode labels legible and exposes focus and hover states", async () => {
  await renderNativeApp(previewConfig);

  const appearanceButton = await screen.findByRole("button", {
    name: "Open appearance settings",
  });
  await fireEvent(appearanceButton, "focus");
  expect(appearanceButton).toHaveStyle({
    borderColor: "#1e4ed8",
    borderWidth: 3,
  });
  await fireEvent(appearanceButton, "blur");
  await fireEvent(appearanceButton, "hoverIn");
  expect(appearanceButton).toHaveStyle({
    backgroundColor: "#f8f8f3",
    borderColor: "#1e4ed8",
  });

  await fireEvent.press(appearanceButton);
  const darkOption = await screen.findByRole("radio", {
    name: "Use dark appearance",
  });
  await fireEvent.press(darkOption);
  expect(await screen.findByText("Dark selected")).toHaveStyle({
    color: "#11141a",
  });

  await fireEvent(darkOption, "focus");
  expect(darkOption).toHaveStyle({ borderWidth: 3 });
});

test("maps iOS and Android hardware-key codes without cross-platform collisions", () => {
  expect(resolveAppearanceKey("ios", 79)).toBe("next");
  expect(resolveAppearanceKey("ios", 81)).toBe("next");
  expect(resolveAppearanceKey("ios", 80)).toBe("previous");
  expect(resolveAppearanceKey("ios", 82)).toBe("previous");
  expect(resolveAppearanceKey("ios", 41)).toBe("escape");
  expect(resolveAppearanceKey("ios", 20)).toBeNull();

  expect(resolveAppearanceKey("android", 20)).toBe("next");
  expect(resolveAppearanceKey("android", 22)).toBe("next");
  expect(resolveAppearanceKey("android", 19)).toBe("previous");
  expect(resolveAppearanceKey("android", 21)).toBe("previous");
  expect(resolveAppearanceKey("android", 111)).toBe("escape");
  expect(resolveAppearanceKey("android", 81)).toBeNull();
});

test("moves radio selection and focus with arrows and handles Enter, Space, and Escape", async () => {
  await renderNativeApp(previewConfig);

  await fireEvent.press(
    await screen.findByRole("button", { name: "Open appearance settings" }),
  );
  const systemOption = await screen.findByRole("radio", {
    name: "Use system appearance",
  });
  const lightOption = screen.getByRole("radio", {
    name: "Use light appearance",
  });
  const darkOption = screen.getByRole("radio", {
    name: "Use dark appearance",
  });

  await fireEvent(systemOption, "keyDownPress", {
    nativeEvent: { keyCode: 81 },
  });
  expect(await screen.findByText("Light selected")).toBeOnTheScreen();
  await waitFor(() => {
    expect(lightOption).toHaveStyle({ borderWidth: 3 });
  });

  await fireEvent(lightOption, "keyDownPress", {
    nativeEvent: { keyCode: 81 },
  });
  expect(await screen.findByText("Dark selected")).toBeOnTheScreen();
  await waitFor(() => {
    expect(darkOption).toHaveStyle({ borderWidth: 3 });
  });

  await fireEvent(darkOption, "keyDownPress", {
    nativeEvent: { keyCode: 81 },
  });
  expect(await screen.findByText("System selected")).toBeOnTheScreen();

  await fireEvent(darkOption, "keyUpPress", {
    nativeEvent: { keyCode: 44 },
  });
  expect(await screen.findByText("Dark selected")).toBeOnTheScreen();

  await fireEvent(systemOption, "keyUpPress", {
    nativeEvent: { keyCode: 40 },
  });
  expect(await screen.findByText("System selected")).toBeOnTheScreen();

  await fireEvent(systemOption, "keyDownPress", {
    nativeEvent: { keyCode: 41 },
  });
  expect(
    await screen.findByRole("header", { name: "Choose a Group" }),
  ).toBeOnTheScreen();
});

test("survives lifecycle changes and respects system Reduced Motion", async () => {
  let appStateListener: ((state: AppStateStatus) => void) | undefined;
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(true);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });

  await renderNativeApp(previewConfig);

  expect(
    await screen.findByRole("header", { name: "Choose a Group" }),
  ).toBeOnTheScreen();
  await act(() => appStateListener?.("active"));
  expect(screen.getByText("Choose a Group")).toBeOnTheScreen();
  await act(() => appStateListener?.("background"));
  expect(screen.getByText("Choose a Group")).toBeOnTheScreen();
  await act(() => appStateListener?.("active"));
  expect(screen.getByText("Choose a Group")).toBeOnTheScreen();
});

test("moves from authentication to a real service-ordered read-only Task List", async () => {
  const controller = authController({
    listGroups: jest.fn(async (): Promise<NativeGroup[]> => [
      {
        groupId: "grp_one",
        name: "Walker Workshop",
        role: "admin",
        createdAt: "2026-07-20T12:00:00.000Z",
      },
      {
        groupId: "grp_two",
        name: "Field Notes",
        role: "member",
        createdAt: "2026-07-21T12:00:00.000Z",
      },
    ]),
    readTaskList: jest.fn(async (): Promise<NativeTaskListSnapshot> => ({
      members: [
        {
          userId: "usr_one",
          username: "walker",
          role: "admin",
          joinedAt: "2026-07-20T12:00:00.000Z",
        },
        {
          userId: "usr_two",
          username: "qa-two",
          role: "member",
          joinedAt: "2026-07-20T12:01:00.000Z",
        },
      ],
      tasks: [
        {
          taskId: "task_open",
          groupId: "grp_one",
          text: "Ship the native Task List",
          assignee: {
            state: "assigned",
            userId: "usr_two",
            username: "qa-two",
          },
          priority: "high",
          dueDate: "2026-07-24",
          state: "open",
          createdAt: "2026-07-20T12:02:00.000Z",
          completedAt: null,
        },
        {
          taskId: "task_done",
          groupId: "grp_one",
          text: "Prove service ordering",
          assignee: {
            state: "assigned",
            userId: "usr_former",
            username: "former",
          },
          priority: "normal",
          dueDate: null,
          state: "done",
          createdAt: "2026-07-20T12:03:00.000Z",
          completedAt: "2026-07-22T12:00:00.000Z",
        },
        {
          taskId: "task_unassigned",
          groupId: "grp_one",
          text: "Recover this Task",
          assignee: { state: "unassigned" },
          priority: "low",
          dueDate: null,
          state: "open",
          createdAt: "2026-07-20T12:04:00.000Z",
          completedAt: null,
        },
      ],
    })),
  });

  await renderNativeApp(previewConfig, controller);

  expect(
    await screen.findByRole("header", { name: "Choose a Group" }),
  ).toBeOnTheScreen();
  const firstGroup = screen.getByRole("button", {
    name: "Open Walker Workshop",
  });
  const secondGroup = screen.getByRole("button", {
    name: "Open Field Notes",
  });
  await fireEvent(firstGroup, "keyDownPress", {
    nativeEvent: { keyCode: 81 },
  });
  await waitFor(() => {
    expect(secondGroup).toHaveStyle({ borderWidth: 3 });
  });
  await fireEvent.press(
    firstGroup,
  );

  expect(
    await screen.findByRole("header", { name: "Walker Workshop Task List" }),
  ).toBeOnTheScreen();
  expect(screen.getByText("Ship the native Task List")).toBeOnTheScreen();
  expect(screen.getByText("Recover this Task")).toBeOnTheScreen();
  expect(screen.queryByText("Prove service ordering")).not.toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "@qa-two" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Unassigned" })).toBeOnTheScreen();
  expect(
    screen.getByLabelText(
      "Open Task. Ship the native Task List. Assigned to @qa-two. High priority. Overdue, due Jul 24.",
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByText("Normal")).not.toBeOnTheScreen();

  const openTab = screen.getByRole("tab", { name: "Open 2" });
  const doneTab = screen.getByRole("tab", { name: "Done 1" });
  await fireEvent(openTab, "keyDownPress", {
    nativeEvent: { keyCode: 81 },
  });
  expect(await screen.findByText("Prove service ordering")).toBeOnTheScreen();
  expect(screen.queryByText("Ship the native Task List")).not.toBeOnTheScreen();
  await waitFor(() => {
    expect(doneTab).toHaveStyle({ borderWidth: 3 });
  });
  expect(
    screen.getByRole("header", { name: "Former Member, @former" }),
  ).toBeOnTheScreen();

  await fireEvent(openTab, "keyUpPress", {
    nativeEvent: { keyCode: 40 },
  });
  expect(await screen.findByText("Ship the native Task List")).toBeOnTheScreen();
  await fireEvent(
    screen.getByRole("tab", { name: "All 3" }),
    "keyUpPress",
    { nativeEvent: { keyCode: 44 } },
  );
  expect(await screen.findByText("Ship the native Task List")).toBeOnTheScreen();
  expect(screen.getByText("Prove service ordering")).toBeOnTheScreen();
  expect(screen.getByText("Recover this Task")).toBeOnTheScreen();
  expect(controller.readTaskList).toHaveBeenCalledWith("grp_one");
  expect(
    screen.queryByRole("button", { name: /Ship the native Task List/iu }),
  ).not.toBeOnTheScreen();
});

test("clears the prior Group immediately while a switched Group loads", async () => {
  const original = Dimensions.get("window");
  await act(() => {
    Dimensions.set({
      window: { ...original, height: 800, width: 390 },
    });
  });
  let resolveSecond:
    | ((snapshot: NativeTaskListSnapshot) => void)
    | undefined;
  const second = new Promise<NativeTaskListSnapshot>((resolve) => {
    resolveSecond = resolve;
  });
  const controller = authController({
    listGroups: jest.fn(async () => adaptiveGroups),
    readTaskList: jest.fn(async (groupId) =>
      groupId === "grp_one"
        ? oneTaskSnapshot("grp_one", "First Group Task")
        : second,
    ),
  });
  let rendered: Awaited<ReturnType<typeof renderNativeApp>> | undefined;

  try {
    rendered = await renderNativeApp(previewConfig, controller);
    await fireEvent.press(
      await screen.findByRole("button", { name: "Open Walker Workshop" }),
    );
    expect(await screen.findByText("First Group Task")).toBeOnTheScreen();

    const switcher = screen.getByRole("button", {
      name: "Switch Group, currently Walker Workshop",
    });
    await fireEvent(switcher, "focus");
    expect(switcher).toHaveStyle({ borderWidth: 3 });
    await fireEvent.press(switcher);
    await fireEvent(
      screen.getByRole("button", { name: "Open Walker Workshop" }),
      "keyDownPress",
      { nativeEvent: { keyCode: 41 } },
    );
    expect(await screen.findByText("First Group Task")).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Switch Group, currently Walker Workshop",
      }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open Field Notes" }),
    );

    expect(screen.queryByText("First Group Task")).not.toBeOnTheScreen();
    expect(
      screen.getByLabelText("Loading Field Notes Task List"),
    ).toBeOnTheScreen();

    await act(() => {
      resolveSecond?.(oneTaskSnapshot("grp_two", "Second Group Task"));
    });
    expect(await screen.findByText("Second Group Task")).toBeOnTheScreen();
  } finally {
    await rendered?.unmount();
    await act(() => {
      Dimensions.set({ window: original });
    });
  }
});

test("adapts one Task List between wide sidebar and narrow large-text layouts", async () => {
  const original = Dimensions.get("window");
  await act(() => {
    Dimensions.set({
      window: { ...original, height: 900, width: 900 },
    });
  });
  const controller = authController({
    listGroups: jest.fn(async () => adaptiveGroups),
    readTaskList: jest.fn(async (groupId) =>
      oneTaskSnapshot(groupId, "Responsive Task"),
    ),
  });
  let rendered: Awaited<ReturnType<typeof renderNativeApp>> | undefined;

  try {
    rendered = await renderNativeApp(previewConfig, controller);
    await fireEvent.press(
      await screen.findByRole("button", { name: "Open Walker Workshop" }),
    );
    expect(await screen.findByText("Responsive Task")).toBeOnTheScreen();
    const taskList = screen.getByTestId("openjob-task-list");
    expect(screen.getByTestId("openjob-adaptive-layout")).toHaveStyle({
      flexDirection: "row",
    });
    expect(screen.getByRole("header", { name: "Groups" })).toBeOnTheScreen();
    expect(screen.getByTestId("openjob-group-sidebar-scroll")).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Open Walker Workshop" }),
    ).toHaveProp("accessibilityState", { selected: true });
    expect(
      screen.queryByRole("button", {
        name: "Switch Group, currently Walker Workshop",
      }),
    ).not.toBeOnTheScreen();

    await act(() => {
      Dimensions.set({
        window: { ...original, fontScale: 2, height: 900, width: 500 },
      });
    });

    expect(screen.queryByRole("header", { name: "Groups" })).not.toBeOnTheScreen();
    expect(screen.getByTestId("openjob-task-list")).toBe(taskList);
    expect(screen.getByTestId("openjob-adaptive-layout")).not.toHaveStyle({
      flexDirection: "row",
    });
    expect(
      screen.getByRole("button", {
        name: "Switch Group, currently Walker Workshop",
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Responsive Task")).toBeOnTheScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Open appearance settings" }),
    );
    await fireEvent.press(
      await screen.findByRole("radio", { name: "Use dark appearance" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Back to OpenJob" }),
    );
    expect(
      await screen.findByLabelText(
        "Open Task. Responsive Task. Assigned to @walker. Normal priority.",
      ),
    ).toHaveStyle({ backgroundColor: "#151b28" });
  } finally {
    await rendered?.unmount();
    await act(() => {
      Dimensions.set({ window: original });
    });
  }
});

test("recovers from retryable Group and Task List failures", async () => {
  const controller = authController({
    listGroups: jest
      .fn()
      .mockRejectedValueOnce(new ProviderSignInError("offline"))
      .mockResolvedValueOnce(adaptiveGroups),
    readTaskList: jest
      .fn()
      .mockRejectedValueOnce(new ProviderSignInError("offline"))
      .mockResolvedValueOnce({ members: [], tasks: [] }),
  });

  await renderNativeApp(previewConfig, controller);

  expect(
    await screen.findByText(
      "OpenJob is offline. Check your connection and retry.",
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByText("No Groups yet")).not.toBeOnTheScreen();
  expect(
    screen.getAllByRole("button", { name: "Retry Groups" }),
  ).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Retry Groups" }));
  await fireEvent.press(
    await screen.findByRole("button", { name: "Open Walker Workshop" }),
  );
  expect(
    await screen.findByRole("button", { name: "Retry Task List" }),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Retry Task List" }),
  );
  expect(await screen.findByText("No open Tasks")).toBeOnTheScreen();
});

test("removes an inaccessible Group and offers the remaining accessible Groups", async () => {
  const controller = authController({
    listGroups: jest
      .fn()
      .mockResolvedValueOnce(adaptiveGroups)
      .mockResolvedValueOnce([adaptiveGroups[1]]),
    readTaskList: jest.fn(async () => {
      throw new OpenJobApiError(
        404,
        "group_not_found",
        "Group was not found.",
      );
    }),
  });

  await renderNativeApp(previewConfig, controller);
  await fireEvent.press(
    await screen.findByRole("button", { name: "Open Walker Workshop" }),
  );

  expect(
    await screen.findByText(
      "Walker Workshop is no longer accessible. Choose another Group.",
    ),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "Open Walker Workshop" }),
  ).not.toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Open Field Notes" }),
  ).toBeOnTheScreen();
});

test("returns a revoked Task List session to the stable sign-in screen", async () => {
  const controller = authController({
    listGroups: jest.fn(async () => adaptiveGroups),
    readTaskList: jest.fn(async () => {
      throw new OpenJobApiError(
        401,
        "authentication_required",
        "Authentication is required.",
      );
    }),
  });

  await renderNativeApp(previewConfig, controller);
  await fireEvent.press(
    await screen.findByRole("button", { name: "Open Walker Workshop" }),
  );

  expect(
    await screen.findByRole("header", {
      name: "Sign in to your shared Task Lists",
    }),
  ).toBeOnTheScreen();
  expect(
    screen.getByText("That saved sign-in expired. Sign in again."),
  ).toBeOnTheScreen();
  expect(controller.revokeSession).toHaveBeenCalledTimes(1);
  expect(controller.signOut).not.toHaveBeenCalled();
});

test("paints the owner-bound cached Task List while network restore is still pending", async () => {
  let finishRestore: ((result: typeof signedIn) => void) | undefined;
  const restoring = new Promise<typeof signedIn>((resolve) => {
    finishRestore = resolve;
  });
  const controller = authController({
    listGroups: jest.fn(async () => adaptiveGroups),
    loadCachedTaskList: jest.fn(async () => cachedTaskList()),
    restore: jest.fn(async () => restoring),
    restoreCachedSession: jest.fn(async () => ({
      kind: "signed-in" as const,
      methods: [],
      provisional: true,
      user: {
        userId: "usr_one",
        username: null,
        usernameRequired: false,
      },
    })),
  });

  await renderNativeApp(previewConfig, controller);

  expect(await screen.findByText("Cached Task")).toBeOnTheScreen();
  expect(screen.getByText(/Saved copy · Read-only/iu)).toBeOnTheScreen();
  expect(controller.listGroups).not.toHaveBeenCalled();
  expect(controller.syncTaskList).not.toHaveBeenCalled();

  await act(() => finishRestore?.(signedIn));
});

test("labels a protected cold-start snapshot offline when session restore cannot reach OpenJob", async () => {
  const controller = authController({
    loadCachedTaskList: jest.fn(async () => cachedTaskList()),
    restore: jest.fn(async () => ({
      kind: "restore-retry" as const,
      reason: "offline" as const,
    })),
    restoreCachedSession: jest.fn(async () => ({
      kind: "signed-in" as const,
      methods: [],
      provisional: true,
      user: {
        userId: "usr_one",
        username: null,
        usernameRequired: false,
      },
    })),
  });

  await renderNativeApp(previewConfig, controller);

  expect(await screen.findByText("Cached Task")).toBeOnTheScreen();
  expect(
    await screen.findByText(/Offline · Read-only · Last updated/iu),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Retry Task List" }),
  ).toBeOnTheScreen();
  expect(controller.listGroups).not.toHaveBeenCalled();
  expect(controller.syncTaskList).not.toHaveBeenCalled();
});

test("retains a cached Task List offline with freshness and retry affordances", async () => {
  const syncTaskList = jest.fn(async () => {
    throw new ProviderSignInError("offline");
  });
  const controller = authController({
    listGroups: jest.fn(async () => adaptiveGroups),
    loadCachedTaskList: jest.fn(async () => cachedTaskList()),
    syncTaskList,
  });

  await renderNativeApp(previewConfig, controller);

  expect(await screen.findByText("Cached Task")).toBeOnTheScreen();
  expect(await screen.findByText(/Offline · Read-only · Last updated/iu)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Retry Task List" })).toBeOnTheScreen();
  expect(syncTaskList).toHaveBeenCalledWith(
    "grp_one",
    '"cached-validator"',
  );
  expect(screen.queryByText(/Updates available/iu)).not.toBeOnTheScreen();
});

test("advances cached freshness on 304 without replacing the rendered Task", async () => {
  const cached = cachedTaskList();
  const syncTaskList = jest.fn(async () => ({
    freshAt: "2026-07-25T12:05:00.000Z",
    kind: "not-modified" as const,
    validator: cached.validator,
  }));
  const controller = authController({
    listGroups: jest.fn(async () => adaptiveGroups),
    loadCachedTaskList: jest.fn(async () => cached),
    syncTaskList,
  });

  await renderNativeApp(previewConfig, controller);

  expect(await screen.findByText("Cached Task")).toBeOnTheScreen();
  expect(await screen.findByText(/Fresh · Last checked/iu)).toBeOnTheScreen();
  expect(controller.saveCachedTaskList).toHaveBeenCalledWith({
    ...cached,
    freshAt: "2026-07-25T12:05:00.000Z",
  });
  expect(screen.getByTestId("openjob-row-task_grp_one")).not.toHaveProp(
    "nativeID",
  );
});

test("stops Task List polling outside active state and checks immediately on foreground", async () => {
  const appStateListeners: Array<(state: AppStateStatus) => void> = [];
  AppState.currentState = "unknown";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    appStateListeners.push(listener);
    return { remove: jest.fn() };
  });
  const syncTaskList = jest.fn(async () => ({
    freshAt: "2026-07-25T12:05:00.000Z",
    kind: "not-modified" as const,
    validator: '"cached-validator"',
  }));
  const controller = authController({
    listGroups: jest.fn(async () => adaptiveGroups),
    loadCachedTaskList: jest.fn(async () => cachedTaskList()),
    syncTaskList,
  });
  const rendered = await renderNativeApp(previewConfig, controller);
  expect(
    await screen.findByText("Cached Task", { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  expect(syncTaskList).not.toHaveBeenCalled();
  await act(() => {
    for (const listener of appStateListeners) listener("active");
  });
  expect(await screen.findByText(/Fresh · Last checked/iu)).toBeOnTheScreen();

  await act(() => {
    for (const listener of appStateListeners) listener("background");
  });
  const callsWhileVisible = syncTaskList.mock.calls.length;
  jest.useFakeTimers();
  try {
    await act(async () => {
      jest.advanceTimersByTime(120_000);
      await Promise.resolve();
    });
    expect(syncTaskList).toHaveBeenCalledTimes(callsWhileVisible);

    await act(async () => {
      for (const listener of appStateListeners) listener("unknown");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(syncTaskList).toHaveBeenCalledTimes(callsWhileVisible);
    await act(async () => {
      jest.advanceTimersByTime(120_000);
      await Promise.resolve();
    });
    expect(syncTaskList).toHaveBeenCalledTimes(callsWhileVisible);

    await act(async () => {
      for (const listener of appStateListeners) listener("active");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(syncTaskList).toHaveBeenCalledTimes(callsWhileVisible + 1);
  } finally {
    rendered.unmount();
    jest.useRealTimers();
  }
});

test("defers a remote row change during drag and animates only that Task", async () => {
  const initial = oneTaskSnapshot("grp_one", "Before remote edit");
  initial.tasks.push({
    ...initial.tasks[0]!,
    taskId: "task_unchanged",
    text: "Unchanged Task",
  });
  const next: NativeTaskListSnapshot = {
    members: initial.members.map((member) => ({ ...member })),
    tasks: [
      { ...initial.tasks[0]!, text: "After remote edit" },
      { ...initial.tasks[1]! },
    ],
  };
  let returnChange = false;
  let finishChange:
    | ((result: {
        freshAt: string;
        kind: "changed";
        snapshot: NativeTaskListSnapshot;
        validator: string;
      }) => void)
    | undefined;
  const changed = new Promise<{
    freshAt: string;
    kind: "changed";
    snapshot: NativeTaskListSnapshot;
    validator: string;
  }>((resolve) => {
    finishChange = resolve;
  });
  const syncTaskList = jest.fn(async () =>
    returnChange
      ? changed
      : {
          freshAt: "2026-07-25T12:01:00.000Z",
          kind: "not-modified" as const,
          validator: '"cached-validator"',
        },
  );
  const controller = authController({
    listGroups: jest.fn(async () => adaptiveGroups),
    loadCachedTaskList: jest.fn(async () => cachedTaskList(initial)),
    syncTaskList,
  });
  await renderNativeApp(previewConfig, controller);
  expect(await screen.findByText("Before remote edit")).toBeOnTheScreen();
  expect(await screen.findByText(/Fresh · Last checked/iu)).toBeOnTheScreen();

  const list = screen.getByTestId("openjob-task-list");
  await fireEvent(list, "scrollBeginDrag");
  returnChange = true;
  await fireEvent(list, "refresh");
  await act(() =>
    finishChange?.({
      freshAt: "2026-07-25T12:02:00.000Z",
      kind: "changed",
      snapshot: next,
      validator: '"changed-validator"',
    }),
  );

  expect(screen.getByText("Before remote edit")).toBeOnTheScreen();
  expect(screen.queryByText("After remote edit")).not.toBeOnTheScreen();

  await fireEvent(list, "scrollEndDrag", { nativeEvent: {} });
  expect(await screen.findByText("After remote edit")).toBeOnTheScreen();
  expect(
    screen.getByTestId("openjob-row-task_grp_one-affected"),
  ).toBeOnTheScreen();
  expect(
    screen.getByTestId("openjob-row-task_unchanged"),
  ).toBeOnTheScreen();
});

test("animates only a removed row before applying the final stable Task order", async () => {
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false);
  const initial = oneTaskSnapshot("grp_one", "Removed remotely");
  initial.tasks.push({
    ...initial.tasks[0]!,
    taskId: "task_kept",
    text: "Kept Task",
  });
  const next: NativeTaskListSnapshot = {
    members: initial.members,
    tasks: [initial.tasks[1]!],
  };
  let removeTask = false;
  let finishRemoval:
    | ((result: {
        freshAt: string;
        kind: "changed";
        snapshot: NativeTaskListSnapshot;
        validator: string;
      }) => void)
    | undefined;
  const removal = new Promise<{
    freshAt: string;
    kind: "changed";
    snapshot: NativeTaskListSnapshot;
    validator: string;
  }>((resolve) => {
    finishRemoval = resolve;
  });
  const syncTaskList = jest.fn(async () =>
    removeTask
      ? removal
      : {
          freshAt: "2026-07-25T12:01:00.000Z",
          kind: "not-modified" as const,
          validator: '"cached-validator"',
        },
  );
  const controller = authController({
    listGroups: jest.fn(async () => adaptiveGroups),
    loadCachedTaskList: jest.fn(async () => cachedTaskList(initial)),
    syncTaskList,
  });
  const rendered = await renderNativeApp(previewConfig, controller);
  expect(await screen.findByText("Removed remotely")).toBeOnTheScreen();
  expect(await screen.findByText(/Fresh · Last checked/iu)).toBeOnTheScreen();

  jest.useFakeTimers();
  try {
    removeTask = true;
    await fireEvent(screen.getByTestId("openjob-task-list"), "refresh");
    await act(() =>
      finishRemoval?.({
        freshAt: "2026-07-25T12:03:00.000Z",
        kind: "changed",
        snapshot: next,
        validator: '"removed-validator"',
      }),
    );

    expect(
      screen.getByTestId("openjob-row-task_grp_one-affected"),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("openjob-row-task_kept")).toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(181);
      await Promise.resolve();
    });
    expect(screen.queryByText("Removed remotely")).not.toBeOnTheScreen();
    expect(screen.getByText("Kept Task")).toBeOnTheScreen();
  } finally {
    rendered.unmount();
    jest.useRealTimers();
  }
});
