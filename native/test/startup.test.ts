import {
  claimStartupCrashVerification,
  reportNativeStartupFatal,
  startNativeApp,
} from "../src/startup";

test("initializes diagnostics before loading and registering the app", async () => {
  const order: string[] = [];
  const App = () => null;

  await startNativeApp({
    initializeDiagnostics: async () => {
      order.push("diagnostics");
      return true;
    },
    loadApp: async () => {
      order.push("load");
      return { default: App };
    },
    registerRootComponent: (component) => {
      expect(component).toBe(App);
      order.push("register");
    },
    reportFatal: jest.fn(),
    shouldTriggerStartupCrash: async () => false,
  });

  expect(order).toEqual(["diagnostics", "load", "register"]);
});

test("retains app recovery when diagnostics initialization fails", async () => {
  const registerRootComponent = jest.fn();
  const reportFatal = jest.fn();
  const App = () => null;

  await startNativeApp({
    initializeDiagnostics: async () => {
      throw new Error("diagnostics failed");
    },
    loadApp: async () => ({ default: App }),
    registerRootComponent,
    reportFatal,
    shouldTriggerStartupCrash: async () => false,
  });

  expect(registerRootComponent).toHaveBeenCalledWith(App);
  expect(reportFatal).not.toHaveBeenCalled();
});

test("provides a guarded pre-render startup crash verification path", async () => {
  const order: string[] = [];
  const initializeDiagnostics = jest.fn(async () => true);
  const loadApp = jest.fn();
  const registerRootComponent = jest.fn();
  const reportFatal = jest.fn(() => order.push("fatal"));

  await startNativeApp({
    initializeDiagnostics,
    loadApp,
    registerRootComponent,
    reportFatal,
    shouldTriggerStartupCrash: async () => {
      order.push("guard");
      return true;
    },
  });

  expect(initializeDiagnostics).not.toHaveBeenCalled();
  expect(loadApp).not.toHaveBeenCalled();
  expect(registerRootComponent).not.toHaveBeenCalled();
  expect(order).toEqual(["guard", "fatal"]);
  expect(reportFatal).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "OpenJob guarded startup crash verification.",
    }),
  );
});

test("reports app module evaluation failures as fatal", async () => {
  const failure = new Error("module evaluation failed");
  const reportFatal = jest.fn();

  await startNativeApp({
    initializeDiagnostics: async () => true,
    loadApp: async () => {
      throw failure;
    },
    registerRootComponent: jest.fn(),
    reportFatal,
    shouldTriggerStartupCrash: async () => false,
  });

  expect(reportFatal).toHaveBeenCalledWith(failure);
});

test("claims startup crash verification once before normal relaunch", async () => {
  let marker: string | null = null;
  const readMarker = jest.fn(async () => marker);
  const writeMarker = jest.fn(async (_key: string, value: string) => {
    marker = value;
  });

  await expect(
    claimStartupCrashVerification({
      enabled: true,
      markerKey: "preview.0.3.3.42",
      readMarker,
      writeMarker,
    }),
  ).resolves.toBe(true);
  await expect(
    claimStartupCrashVerification({
      enabled: true,
      markerKey: "preview.0.3.3.42",
      readMarker,
      writeMarker,
    }),
  ).resolves.toBe(false);
  expect(writeMarker).toHaveBeenCalledTimes(1);
});

test("continues normal startup on the relaunch after verification", async () => {
  let marker: string | null = null;
  const shouldTriggerStartupCrash = () =>
    claimStartupCrashVerification({
      enabled: true,
      markerKey: "preview.0.3.3.42",
      readMarker: async () => marker,
      writeMarker: async (_key, value) => {
        marker = value;
      },
    });
  const initializeDiagnostics = jest.fn(async () => true);
  const loadApp = jest.fn(async () => ({ default: () => null }));
  const registerRootComponent = jest.fn();
  const reportFatal = jest.fn();
  const dependencies = {
    initializeDiagnostics,
    loadApp,
    registerRootComponent,
    reportFatal,
    shouldTriggerStartupCrash,
  };

  await startNativeApp(dependencies);
  expect(reportFatal).toHaveBeenCalledTimes(1);
  expect(initializeDiagnostics).not.toHaveBeenCalled();

  await startNativeApp(dependencies);
  expect(initializeDiagnostics).toHaveBeenCalledTimes(1);
  expect(loadApp).toHaveBeenCalledTimes(1);
  expect(registerRootComponent).toHaveBeenCalledTimes(1);
});

test("delegates startup failures to the current React Native fatal handler", () => {
  const globals = globalThis as typeof globalThis & {
    ErrorUtils?: {
      getGlobalHandler(): (error: Error, isFatal?: boolean) => void;
    };
  };
  const original = globals.ErrorUtils;
  const handler = jest.fn();
  globals.ErrorUtils = { getGlobalHandler: () => handler };
  const failure = new Error("startup failed");
  try {
    reportNativeStartupFatal(failure);
    expect(handler).toHaveBeenCalledWith(failure, true);
  } finally {
    if (original) globals.ErrorUtils = original;
    else delete globals.ErrorUtils;
  }
});
