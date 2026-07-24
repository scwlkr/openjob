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
import { hasEmbeddedBundleOnlyPolicy } from "../src/OpenJobShell";
import type { NativeAuthController } from "../src/auth/AuthGate";
import type { OpenJobRuntimeConfig } from "../src/runtime-config";

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

function authController(): NativeAuthController {
  return {
    authenticateExistingUser: jest.fn(async () => signedIn),
    authenticateNewMethod: jest.fn(async () => signedIn),
    cancelPending: jest.fn(async () => signedIn),
    claimUsername: jest.fn(async () => signedIn),
    confirmLink: jest.fn(async () => signedIn),
    createUser: jest.fn(async () => signedIn),
    restore: jest.fn(async () => signedIn),
    signIn: jest.fn(async () => signedIn),
    signInWithQaPassword: jest.fn(async () => signedIn),
    signOut: jest.fn(async () => ({ kind: "signed-out" as const })),
    subscribeToCredentialRevocation: jest.fn(() => () => undefined),
    switchUser: jest.fn(async () => ({ kind: "signed-out" as const })),
  };
}

function renderNativeApp(runtimeConfig: OpenJobRuntimeConfig) {
  return render(
    <OpenJobNativeApp
      authController={authController()}
      runtimeConfig={runtimeConfig}
    />,
  );
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

test("requires an embedded-only Release bundle when Expo's asset hint is false", () => {
  expect(
    hasEmbeddedBundleOnlyPolicy({
      isDevelopment: false,
      updatesEnabled: false,
      usingEmbeddedAssets: false,
    }),
  ).toBe(true);
});

test("does not report an embedded-only policy for Metro or OTA-enabled launches", () => {
  expect(
    hasEmbeddedBundleOnlyPolicy({
      isDevelopment: true,
      updatesEnabled: false,
      usingEmbeddedAssets: false,
    }),
  ).toBe(false);
  for (const usingEmbeddedAssets of [false, true]) {
    expect(
      hasEmbeddedBundleOnlyPolicy({
        isDevelopment: false,
        updatesEnabled: true,
        usingEmbeddedAssets,
      }),
    ).toBe(false);
  }
});

test("bootstraps the branded preview shell from its embedded bundle", async () => {
  await renderNativeApp(previewConfig);

  expect(
    await screen.findByText("One clear list for your team."),
  ).toBeOnTheScreen();
  expect(screen.getByText("Preview build")).toBeOnTheScreen();
  expect(screen.getByText("Embedded store bundle")).toBeOnTheScreen();
  expect(
    screen.getByText("Launches without update discovery"),
  ).toBeOnTheScreen();
  expect(screen.getByText("OTA disabled")).toBeOnTheScreen();
  expect(screen.getByText("/api/v1 only")).toBeOnTheScreen();
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
    await screen.findByText("One clear list for your team."),
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
    await screen.findByText("One clear list for your team."),
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

  expect(await screen.findByText("Reduced Motion on")).toBeOnTheScreen();
  await act(() => appStateListener?.("active"));
  expect(screen.getByText("Ready for work")).toBeOnTheScreen();
  await act(() => appStateListener?.("background"));
  expect(await screen.findByText("Paused safely")).toBeOnTheScreen();
  await act(() => appStateListener?.("active"));
  expect(await screen.findByText("Ready for work")).toBeOnTheScreen();
});
