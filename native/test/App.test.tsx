import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AccessibilityInfo,
  AppState,
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
import { confirmsEmbeddedBundle } from "../src/OpenJobShell";
import type { OpenJobRuntimeConfig } from "../src/runtime-config";

const previewConfig: OpenJobRuntimeConfig = {
  apiBasePath: "/api/v1",
  environment: "preview",
  environmentBadge: "Preview",
  releaseVersion: "0.3.3",
};

const productionConfig: OpenJobRuntimeConfig = {
  ...previewConfig,
  environment: "production",
  environmentBadge: null,
};

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

test("confirms an OTA-disabled Release bundle when Expo's asset hint is false", () => {
  expect(
    confirmsEmbeddedBundle({
      isDevelopment: false,
      updatesEnabled: false,
      usingEmbeddedAssets: false,
    }),
  ).toBe(true);
});

test("does not confirm Metro or OTA-enabled launches as embedded", () => {
  expect(
    confirmsEmbeddedBundle({
      isDevelopment: true,
      updatesEnabled: false,
      usingEmbeddedAssets: false,
    }),
  ).toBe(false);
  for (const usingEmbeddedAssets of [false, true]) {
    expect(
      confirmsEmbeddedBundle({
        isDevelopment: false,
        updatesEnabled: true,
        usingEmbeddedAssets,
      }),
    ).toBe(false);
  }
});

test("bootstraps the branded preview shell from its embedded bundle", async () => {
  await render(<OpenJobNativeApp runtimeConfig={previewConfig} />);

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
  expect(screen.getByTestId("openjob-wordmark-period")).toHaveStyle({
    backgroundColor: "#6387ff",
  });
});

test("production omits the non-production build badge", async () => {
  await render(<OpenJobNativeApp runtimeConfig={productionConfig} />);

  expect(
    await screen.findByText("One clear list for your team."),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/build$/iu)).not.toBeOnTheScreen();
});

test("restores the selected appearance and pushed native-stack screen", async () => {
  const first = await render(<OpenJobNativeApp runtimeConfig={previewConfig} />);

  await fireEvent.press(
    await screen.findByLabelText("Open appearance settings"),
  );
  expect(await screen.findByRole("header", { name: "Appearance" })).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Use dark appearance" }),
  );
  expect(await screen.findByText("Dark selected")).toBeOnTheScreen();

  await waitFor(() => {
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });
  await first.unmount();
  await render(<OpenJobNativeApp runtimeConfig={previewConfig} />);

  expect(await screen.findByRole("header", { name: "Appearance" })).toBeOnTheScreen();
  expect(screen.getByText("Dark selected")).toBeOnTheScreen();
});

test("keeps selected dark-mode labels legible and exposes focus and hover states", async () => {
  await render(<OpenJobNativeApp runtimeConfig={previewConfig} />);

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
  const darkOption = await screen.findByRole("button", {
    name: "Use dark appearance",
  });
  await fireEvent.press(darkOption);
  expect(await screen.findByText("Dark selected")).toHaveStyle({
    color: "#11141a",
  });

  await fireEvent(darkOption, "focus");
  expect(darkOption).toHaveStyle({ borderWidth: 3 });
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

  await render(<OpenJobNativeApp runtimeConfig={previewConfig} />);

  expect(await screen.findByText("Reduced Motion on")).toBeOnTheScreen();
  await act(() => appStateListener?.("active"));
  expect(screen.getByText("Ready for work")).toBeOnTheScreen();
  await act(() => appStateListener?.("background"));
  expect(await screen.findByText("Paused safely")).toBeOnTheScreen();
  await act(() => appStateListener?.("active"));
  expect(await screen.findByText("Ready for work")).toBeOnTheScreen();
});
