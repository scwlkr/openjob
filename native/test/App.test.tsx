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
