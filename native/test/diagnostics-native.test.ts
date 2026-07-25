jest.mock("expo-device", () => ({
  DeviceType: { DESKTOP: 1, PHONE: 2, TABLET: 3, TV: 4, UNKNOWN: 0 },
  getDeviceTypeAsync: jest.fn(async () => 3),
  osVersion: "18.5",
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      ios: { bundleIdentifier: "dev.openjob.app.preview" },
      sdkVersion: "57.0.0",
      version: "0.3.3",
    },
    platform: { ios: { buildNumber: "42" } },
  },
}));

jest.mock("expo-updates", () => ({
  isEmbeddedLaunch: false,
  isEnabled: false,
  runtimeVersion: null,
  updateId: "forbidden-while-updates-disabled",
}));

const mockNativeBridge = {
  captureEnvelope: jest.fn(async () => true),
  closeNativeSdk: jest.fn(async () => undefined),
  crash: jest.fn(),
  getOpenJobDiagnosticsEnabled: jest.fn(async () => true),
  initNativeSdk: jest.fn(async () => true),
  setOpenJobDiagnosticsEnabled: jest.fn(async () => true),
  setContext: jest.fn(),
};

import * as Updates from "expo-updates";
import { AppState, TurboModuleRegistry, type AppStateStatus } from "react-native";
import {
  readDiagnosticRuntimeContext,
  sentryNativeDiagnosticsSdk,
} from "../src/diagnostics-native";
import type {
  DiagnosticEvent,
  NativeDiagnosticsSdkOptions,
} from "../src/diagnostics";

function nativeSdkOptions(
  beforeSend: (event: DiagnosticEvent) => DiagnosticEvent | null,
): NativeDiagnosticsSdkOptions {
  return {
    attachScreenshot: false,
    attachThreads: true,
    attachViewHierarchy: false,
    autoInitializeNativeSdk: true,
    beforeBreadcrumb: () => null,
    beforeSend,
    beforeSendTransaction: () => null,
    dsn: "https://public@example.ingest.sentry.io/1",
    enableAppHangTracking: true,
    enableAutoActivityLifecycleTracing: false,
    enableAutoBreadcrumbTracking: false,
    enableAutoPerformanceTracing: false,
    enableAutoSessionTracking: false,
    enableCaptureFailedRequests: false,
    enableCoreDataTracing: false,
    enableFileIOTracing: false,
    enableFramesTracking: false,
    enableLogs: false,
    enableNativeCrashHandling: true,
    enableNativeFramesTracking: false,
    enableNetworkBreadcrumbs: false,
    enableNetworkTracking: false,
    enableNdk: false,
    enableNdkScopeSync: false,
    enablePerformanceV2: false,
    enablePreWarmedAppStartTracing: false,
    enableProfiling: false,
    enableScreenTracking: false,
    enableStallTracking: false,
    enableTimeToFullDisplayTracing: false,
    enableUIViewControllerTracing: false,
    enableUserInteractionBreadcrumbs: false,
    enableUserInteractionTracing: false,
    enableWatchdogTerminationTracking: true,
    environment: "preview",
    integrationMode: "crash-only",
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sendDefaultPii: false,
  };
}

function installErrorUtilsFixture() {
  type TestErrorHandler = (error: Error, isFatal?: boolean) => void;
  const globals = globalThis as typeof globalThis & {
    ErrorUtils?: {
      getGlobalHandler(): TestErrorHandler;
      setGlobalHandler(handler: TestErrorHandler): void;
    };
    HermesInternal?: object;
  };
  const originalErrorUtils = globals.ErrorUtils;
  const originalHermes = globals.HermesInternal;
  const previousHandler = jest.fn();
  let installedHandler: TestErrorHandler = previousHandler;
  globals.ErrorUtils = {
    getGlobalHandler: () => installedHandler,
    setGlobalHandler: (handler) => {
      installedHandler = handler;
    },
  };
  globals.HermesInternal = {};
  return {
    invoke: (error: Error, isFatal = true) => installedHandler(error, isFatal),
    previousHandler,
    restore() {
      if (originalErrorUtils) globals.ErrorUtils = originalErrorUtils;
      else delete globals.ErrorUtils;
      if (originalHermes) globals.HermesInternal = originalHermes;
      else delete globals.HermesInternal;
    },
  };
}

function capturedEvent(index = 0): DiagnosticEvent {
  const encoded = (mockNativeBridge.captureEnvelope as jest.Mock).mock.calls[index]?.[0] as
    | string
    | undefined;
  if (!encoded) throw new Error("Diagnostic envelope was not captured");
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const [, , payload] = new TextDecoder().decode(bytes).trim().split("\n");
  if (!payload) throw new Error("Diagnostic envelope payload was missing");
  return JSON.parse(payload) as DiagnosticEvent;
}

function installJavaScriptHangFixture() {
  const originalState = AppState.currentState;
  let listener: ((state: AppStateStatus) => void) | undefined;
  let monotonicTime = 0;
  const remove = jest.fn();
  AppState.currentState = "active";
  const appStateSpy = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((event, nextListener) => {
      if (event === "change") {
        listener = nextListener as (state: AppStateStatus) => void;
      }
      return { remove };
    });
  const monotonicSpy = jest
    .spyOn(globalThis.performance, "now")
    .mockImplementation(() => monotonicTime);
  return {
    changeState(state: AppStateStatus) {
      AppState.currentState = state;
      listener?.(state);
    },
    remove,
    restore() {
      appStateSpy.mockRestore();
      monotonicSpy.mockRestore();
      AppState.currentState = originalState;
    },
    setMonotonicTime(next: number) {
      monotonicTime = next;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(TurboModuleRegistry, "getEnforcing")
    .mockReturnValue(mockNativeBridge as never);
});

afterEach(async () => {
  await sentryNativeDiagnosticsSdk.close(0);
  jest.restoreAllMocks();
});

test("reports only coarse embedded runtime context while OTA is disabled", async () => {
  await expect(readDiagnosticRuntimeContext()).resolves.toMatchObject({
    applicationId: "dev.openjob.app.preview",
    appVersion: "0.3.3",
    buildVersion: "42",
    deviceClass: "tablet",
    osVersion: "18.5",
    runtimeVersion: "dev.openjob.app.preview@0.3.3+42",
    updateId: null,
    updateSource: "embedded",
  });
});

test("reports the signed OTA runtime and update identity when Updates launched it", async () => {
  const updates = Updates as unknown as Record<string, unknown>;
  const original = { ...updates };
  try {
    Object.assign(updates, {
      isEmbeddedLaunch: false,
      isEnabled: true,
      runtimeVersion: "openjob-runtime-57",
      updateId: "12345678-1234-1234-1234-123456789abc",
    });
    await expect(readDiagnosticRuntimeContext()).resolves.toMatchObject({
      runtimeVersion: "openjob-runtime-57",
      updateId: "12345678-1234-1234-1234-123456789abc",
      updateSource: "signed-ota",
    });
  } finally {
    for (const key of Object.keys(updates)) delete updates[key];
    Object.assign(updates, original);
  }
});

test("initializes only the native crash and hang bridge", async () => {
  await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));

  expect(mockNativeBridge.initNativeSdk).toHaveBeenCalledWith(
    expect.objectContaining({
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableAppHangTracking: true,
      enableAutoActivityLifecycleTracing: false,
      enableAutoBreadcrumbTracking: false,
      enableAutoPerformanceTracing: false,
      enableAutoSessionTracking: false,
      enableCaptureFailedRequests: false,
      enableCoreDataTracing: false,
      enableFileIOTracing: false,
      enableFramesTracking: false,
      enableLogs: false,
      enableNativeCrashHandling: true,
      enableNativeFramesTracking: false,
      enableNetworkBreadcrumbs: false,
      enableNetworkTracking: false,
      enableNdk: false,
      enablePerformanceV2: false,
      enablePreWarmedAppStartTracing: false,
      enableProfiling: false,
      enableScreenTracking: false,
      enableStallTracking: false,
      enableTimeToFullDisplayTracing: false,
      enableUIViewControllerTracing: false,
      enableUserInteractionBreadcrumbs: false,
      enableUserInteractionTracing: false,
      enableWatchdogTerminationTracking: true,
      maxBreadcrumbs: 0,
      sendClientReports: false,
      sendDefaultPii: false,
      shutdownTimeInterval: 0,
      shutdownTimeout: 0,
    }),
  );
  const options = (mockNativeBridge.initNativeSdk as jest.Mock).mock.calls[0]?.[0];
  expect(options).not.toHaveProperty("beforeSend");
  expect(options).not.toHaveProperty("beforeBreadcrumb");
  expect(options).not.toHaveProperty("integrations");
  expect(options).not.toHaveProperty("integrationMode");
  expect(options).not.toHaveProperty("replaysSessionSampleRate");
  expect(options).not.toHaveProperty("replaysOnErrorSampleRate");
  expect(options).not.toHaveProperty("tracesSampleRate");
  expect(options).not.toHaveProperty("profilesSampleRate");
});

test("emits a scrub-ready JavaScript event envelope through the native bridge", async () => {
  await sentryNativeDiagnosticsSdk.init(
    nativeSdkOptions((event) => ({
      ...event,
      environment: "preview",
      message: "OpenJob native failure",
    })),
  );

  const eventId = sentryNativeDiagnosticsSdk.captureException(
    new Error("must be scrubbed"),
    { contexts: {}, tags: { operation: "diagnostic_verification" } },
  );
  await expect(sentryNativeDiagnosticsSdk.flush(2_000)).resolves.toBe(true);

  expect(eventId).toMatch(/^[0-9a-f]{32}$/u);
  const encoded = (mockNativeBridge.captureEnvelope as jest.Mock).mock.calls[0]?.[0] as
    | string
    | undefined;
  expect(encoded).toBeDefined();
  if (!encoded) throw new Error("native event envelope was not captured");
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const [, item, payload] = new TextDecoder().decode(bytes).trim().split("\n");
  expect(JSON.parse(item!)).toMatchObject({ type: "event" });
  expect(JSON.parse(payload!)).toMatchObject({
    environment: "preview",
    event_id: eventId,
    message: "OpenJob native failure",
    platform: "javascript",
    sdk: { settings: { infer_ip: "never" } },
  });
});

test("reports only confirmed five-second recovered JavaScript hangs", async () => {
  jest.useFakeTimers();
  const fixture = installJavaScriptHangFixture();
  try {
    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));

    fixture.setMonotonicTime(1_000);
    jest.advanceTimersByTime(1_000);
    fixture.setMonotonicTime(6_999);
    jest.advanceTimersByTime(1_000);
    expect(mockNativeBridge.captureEnvelope).not.toHaveBeenCalled();

    fixture.setMonotonicTime(12_999);
    jest.advanceTimersByTime(1_000);
    jest.advanceTimersByTime(249);
    expect(mockNativeBridge.captureEnvelope).not.toHaveBeenCalled();
    fixture.setMonotonicTime(13_249);
    jest.advanceTimersByTime(1);

    expect(capturedEvent()).toMatchObject({
      contexts: { openjob: { duration_ms: 5_000 } },
      tags: { operation: "javascript_hang" },
    });
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    fixture.restore();
    jest.useRealTimers();
  }
  expect(fixture.remove).toHaveBeenCalled();
});

test("uses a monotonic clock for JavaScript hang detection", async () => {
  jest.useFakeTimers();
  const fixture = installJavaScriptHangFixture();
  try {
    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));
    fixture.setMonotonicTime(1_000);
    jest.advanceTimersByTime(1_000);
    jest.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    fixture.setMonotonicTime(2_000);
    jest.advanceTimersByTime(1_000);
    jest.advanceTimersByTime(250);

    expect(mockNativeBridge.captureEnvelope).not.toHaveBeenCalled();
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    fixture.restore();
    jest.useRealTimers();
  }
});

test("excludes suspended time and warms up after foregrounding", async () => {
  jest.useFakeTimers();
  const fixture = installJavaScriptHangFixture();
  try {
    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));
    fixture.setMonotonicTime(1_000);
    jest.advanceTimersByTime(1_000);

    fixture.changeState("background");
    fixture.setMonotonicTime(30_000);
    jest.advanceTimersByTime(30_000);
    expect(mockNativeBridge.captureEnvelope).not.toHaveBeenCalled();

    fixture.changeState("active");
    fixture.setMonotonicTime(36_000);
    jest.advanceTimersByTime(1_000);
    fixture.setMonotonicTime(37_000);
    jest.advanceTimersByTime(1_000);
    jest.advanceTimersByTime(250);

    expect(mockNativeBridge.captureEnvelope).not.toHaveBeenCalled();
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    fixture.restore();
    jest.useRealTimers();
  }
});

test("cancels a recovered-hang candidate during a lifecycle transition", async () => {
  jest.useFakeTimers();
  const fixture = installJavaScriptHangFixture();
  try {
    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));
    fixture.setMonotonicTime(1_000);
    jest.advanceTimersByTime(1_000);
    fixture.setMonotonicTime(7_000);
    jest.advanceTimersByTime(1_000);
    fixture.changeState("inactive");
    jest.advanceTimersByTime(250);

    expect(mockNativeBridge.captureEnvelope).not.toHaveBeenCalled();
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    fixture.restore();
    jest.useRealTimers();
  }
});

test("rate-limits recovered hangs and clamps their reported duration", async () => {
  jest.useFakeTimers();
  const fixture = installJavaScriptHangFixture();
  try {
    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));
    fixture.setMonotonicTime(1_000);
    jest.advanceTimersByTime(1_000);
    fixture.setMonotonicTime(7_000);
    jest.advanceTimersByTime(1_000);
    fixture.setMonotonicTime(7_250);
    jest.advanceTimersByTime(250);

    fixture.setMonotonicTime(13_250);
    jest.advanceTimersByTime(1_000);
    expect(mockNativeBridge.captureEnvelope).toHaveBeenCalledTimes(1);

    fixture.setMonotonicTime(307_250);
    jest.advanceTimersByTime(1_000);
    fixture.setMonotonicTime(307_500);
    jest.advanceTimersByTime(250);

    expect(mockNativeBridge.captureEnvelope).toHaveBeenCalledTimes(2);
    expect(capturedEvent(1)).toMatchObject({
      contexts: { openjob: { duration_ms: 60_000 } },
      tags: { operation: "javascript_hang" },
    });
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    fixture.restore();
    jest.useRealTimers();
  }
});

test("close removes all recovered-hang monitoring and reinit starts fresh", async () => {
  jest.useFakeTimers();
  const fixture = installJavaScriptHangFixture();
  try {
    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));
    await sentryNativeDiagnosticsSdk.close(0);
    fixture.setMonotonicTime(30_000);
    jest.advanceTimersByTime(30_000);
    expect(mockNativeBridge.captureEnvelope).not.toHaveBeenCalled();

    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));
    fixture.setMonotonicTime(31_000);
    jest.advanceTimersByTime(1_000);
    fixture.setMonotonicTime(37_000);
    jest.advanceTimersByTime(1_000);
    fixture.setMonotonicTime(37_250);
    jest.advanceTimersByTime(250);
    expect(mockNativeBridge.captureEnvelope).toHaveBeenCalledTimes(1);
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    fixture.restore();
    jest.useRealTimers();
  }
  expect(fixture.remove).toHaveBeenCalledTimes(2);
});

test("does not install recovered-hang monitoring after native init fails", async () => {
  const fixture = installJavaScriptHangFixture();
  mockNativeBridge.initNativeSdk.mockResolvedValueOnce(false);
  try {
    await expect(
      sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event)),
    ).rejects.toThrow("failed to initialize");
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    fixture.restore();
  }
});

test("emits Debug ID metadata only when the loaded bundle identity is unambiguous", async () => {
  const globals = globalThis as typeof globalThis & {
    _sentryDebugIds?: Record<string, string>;
  };
  const originalDebugIds = globals._sentryDebugIds;
  const firstDebugId = "12345678-1234-4abc-8abc-123456789abc";
  const secondDebugId = "87654321-4321-4cba-acde-cba987654321";
  const observed: DiagnosticEvent[] = [];
  try {
    await sentryNativeDiagnosticsSdk.init(
      nativeSdkOptions((event) => {
        observed.push(event);
        return event;
      }),
    );
    globals._sentryDebugIds = { first: firstDebugId, duplicate: firstDebugId };
    sentryNativeDiagnosticsSdk.captureException(new Error("safe"), {
      contexts: {},
      tags: { operation: "diagnostic_verification" },
    });
    globals._sentryDebugIds = {
      malformed: "12345678---------------------------",
      short: "deadbeef",
    };
    sentryNativeDiagnosticsSdk.captureException(new Error("safe"), {
      contexts: {},
      tags: { operation: "diagnostic_verification" },
    });
    globals._sentryDebugIds = { first: firstDebugId, second: secondDebugId };
    sentryNativeDiagnosticsSdk.captureException(new Error("safe"), {
      contexts: {},
      tags: { operation: "diagnostic_verification" },
    });
    await expect(sentryNativeDiagnosticsSdk.flush(2_000)).resolves.toBe(true);

    expect(observed[0]?.debug_meta).toEqual({
      images: [
        {
          code_file: "app:///main.jsbundle",
          debug_id: firstDebugId,
          type: "sourcemap",
        },
      ],
    });
    expect(observed[1]?.debug_meta).toBeUndefined();
    expect(observed[2]?.debug_meta).toBeUndefined();
  } finally {
    if (originalDebugIds) globals._sentryDebugIds = originalDebugIds;
    else delete globals._sentryDebugIds;
  }
});

test("stores a fatal Hermes envelope before propagating the release error handler", async () => {
  let resolveStore: ((stored: boolean) => void) | undefined;
  mockNativeBridge.captureEnvelope.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        resolveStore = resolve;
      }),
  );
  const errors = installErrorUtilsFixture();
  const observed: DiagnosticEvent[] = [];

  try {
    await sentryNativeDiagnosticsSdk.init(
      nativeSdkOptions((event) => {
        observed.push(event);
        return event;
      }),
    );
    const failure = new Error("private Task text");
    failure.stack = [
      "Error: private Task text",
      "    at global (address at main.jsbundle:1:4321)",
      "    at renderTask (address at main.jsbundle:1:1234)",
    ].join("\n");

    errors.invoke(failure);

    expect(errors.previousHandler).not.toHaveBeenCalled();
    expect(observed[0]?.exception?.values?.[0]?.stacktrace?.frames).toEqual([
      expect.objectContaining({
        colno: 1235,
        filename: "main.jsbundle",
        function: "renderTask",
        lineno: 1,
      }),
      expect.objectContaining({
        colno: 4322,
        filename: "main.jsbundle",
        function: "global",
        lineno: 1,
      }),
    ]);

    resolveStore?.(true);
    await expect(sentryNativeDiagnosticsSdk.flush(2_000)).resolves.toBe(true);
    await Promise.resolve();
    expect(errors.previousHandler).toHaveBeenCalledWith(failure, true);
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    errors.restore();
  }
});

test("delegates nonfatal global reports without emitting diagnostics", async () => {
  const errors = installErrorUtilsFixture();
  const failure = new Error("private Task text");
  try {
    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));

    errors.invoke(failure, false);

    expect(mockNativeBridge.captureEnvelope).not.toHaveBeenCalled();
    expect(errors.previousHandler).toHaveBeenCalledWith(failure, false);
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    errors.restore();
  }
});

test("always propagates fatal errors when scrubbing or native bridge lookup fails", async () => {
  const errors = installErrorUtilsFixture();
  const failure = new Error("private Task text");
  try {
    await sentryNativeDiagnosticsSdk.init(
      nativeSdkOptions(() => {
        throw new Error("scrubber failed");
      }),
    );
    expect(() => errors.invoke(failure)).not.toThrow();
    expect(errors.previousHandler).toHaveBeenCalledWith(failure, true);

    await sentryNativeDiagnosticsSdk.close(0);
    errors.previousHandler.mockClear();
    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));
    (TurboModuleRegistry.getEnforcing as jest.Mock).mockImplementationOnce(() => {
      throw new Error("native bridge unavailable");
    });
    expect(() => errors.invoke(failure)).not.toThrow();
    expect(errors.previousHandler).toHaveBeenCalledWith(failure, true);
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    errors.restore();
  }
});

test("propagates a fatal error after native durable storage rejects", async () => {
  const errors = installErrorUtilsFixture();
  const failure = new Error("private Task text");
  mockNativeBridge.captureEnvelope.mockRejectedValueOnce(
    new Error("native store failed"),
  );
  try {
    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));
    errors.invoke(failure);
    await expect(sentryNativeDiagnosticsSdk.flush(2_000)).resolves.toBe(false);
    await Promise.resolve();
    expect(errors.previousHandler).toHaveBeenCalledWith(failure, true);
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    errors.restore();
  }
});

test("bounds fatal storage waiting and lets the first fatal own termination", async () => {
  jest.useFakeTimers();
  const errors = installErrorUtilsFixture();
  mockNativeBridge.captureEnvelope.mockImplementationOnce(
    () => new Promise<boolean>(() => undefined),
  );
  const first = new Error("first private Task text");
  const second = new Error("second private Task text");
  try {
    await sentryNativeDiagnosticsSdk.init(nativeSdkOptions((event) => event));
    errors.invoke(first);
    errors.invoke(second);

    expect(mockNativeBridge.captureEnvelope).toHaveBeenCalledTimes(1);
    expect(errors.previousHandler).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_999);
    expect(errors.previousHandler).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(errors.previousHandler).toHaveBeenCalledTimes(1);
    expect(errors.previousHandler).toHaveBeenCalledWith(first, true);
  } finally {
    await sentryNativeDiagnosticsSdk.close(0);
    errors.restore();
    jest.useRealTimers();
  }
});

test("writes only allowlisted runtime values into the native crash scope", async () => {
  const runtime = await readDiagnosticRuntimeContext();

  sentryNativeDiagnosticsSdk.setRuntimeContext(runtime);

  expect(mockNativeBridge.setContext).toHaveBeenCalledWith("openjob", {
    app_version: "0.3.3",
    build_version: "42",
    device_class: "tablet",
    os_name: "iOS",
    os_version: "18.5",
    runtime_version: runtime.runtimeVersion,
    update_source: "embedded",
  });
});

test("persists the launch-time native diagnostics preference", async () => {
  await expect(sentryNativeDiagnosticsSdk.getSharingPreference()).resolves.toBe(
    true,
  );
  expect(mockNativeBridge.getOpenJobDiagnosticsEnabled).toHaveBeenCalledTimes(1);
  await expect(
    sentryNativeDiagnosticsSdk.setSharingPreference(false),
  ).resolves.toBe(true);
  expect(mockNativeBridge.setOpenJobDiagnosticsEnabled).toHaveBeenCalledWith(
    false,
  );
});
