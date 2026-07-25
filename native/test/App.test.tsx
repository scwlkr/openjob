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
import {
  OpenJobApiError,
  ProviderSignInError,
} from "../src/auth/coordinator";
import type { OpenJobRuntimeConfig } from "../src/runtime-config";
import type {
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
  return {
    authenticateExistingUser: jest.fn(async () => signedIn),
    authenticateNewMethod: jest.fn(async () => signedIn),
    cancelPending: jest.fn(async () => signedIn),
    claimUsername: jest.fn(async () => signedIn),
    confirmLink: jest.fn(async () => signedIn),
    createUser: jest.fn(async () => signedIn),
    listGroups: jest.fn(async () => []),
    readTaskList: jest.fn(async () => ({ members: [], tasks: [] })),
    revokeSession: jest.fn(async () => ({
      kind: "signed-out" as const,
      reason: "revoked" as const,
    })),
    restore: jest.fn(async () => signedIn),
    signIn: jest.fn(async () => signedIn),
    signInWithQaPassword: jest.fn(async () => signedIn),
    signOut: jest.fn(async () => ({ kind: "signed-out" as const })),
    subscribeToCredentialRevocation: jest.fn(() => () => undefined),
    switchUser: jest.fn(async () => ({ kind: "signed-out" as const })),
    ...overrides,
  };
}

function renderNativeApp(
  runtimeConfig: OpenJobRuntimeConfig,
  controller = authController(),
) {
  return render(
    <OpenJobNativeApp
      authController={controller}
      runtimeConfig={runtimeConfig}
    />,
  );
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

beforeEach(async () => {
  jest.restoreAllMocks();
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

test("production omits the non-production build badge", async () => {
  await renderNativeApp(productionConfig);

  expect(
    await screen.findByRole("header", { name: "Choose a Group" }),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/build$/iu)).not.toBeOnTheScreen();
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
    readTaskList: jest
      .fn()
      .mockResolvedValueOnce(
        oneTaskSnapshot("grp_one", "First Group Task"),
      )
      .mockReturnValueOnce(second),
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
