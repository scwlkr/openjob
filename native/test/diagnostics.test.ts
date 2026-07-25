import type { OpenJobRuntimeConfig } from "../src/runtime-config";
import {
  createNativeDiagnosticsController,
  type DiagnosticEvent,
  type NativeDiagnosticsSdk,
} from "../src/diagnostics";

const previewConfig: OpenJobRuntimeConfig = {
  apiBasePath: "/api/v1",
  apiBaseUrl: "https://preview.example/api/v1",
  appleRedirectUri: "https://preview.example/auth",
  appleServiceId: "dev.openjob.auth.nonprod",
  diagnosticsDsn: "https://public@example.ingest.sentry.io/1",
  diagnosticsStartupCrashVerificationEnabled: false,
  diagnosticsVerificationEnabled: true,
  environment: "preview",
  environmentBadge: "Preview",
  firebaseApiKey: "public-key",
  firebaseAuthDomain: "preview.example",
  googleIosClientId: "ios.apps.googleusercontent.com",
  googleWebClientId: "web.apps.googleusercontent.com",
  keychainService: "dev.openjob.app.preview.auth",
  qaPasswordTenantId: "OpenJob-QA-Two-mvz9m",
  releaseVersion: "0.3.3",
  sessionStorageKey: "openjob.native.auth.preview.v1",
};

function capturedSdk(
  dirtyEvent: DiagnosticEvent,
  preference: { value: boolean } = { value: true },
) {
  const events: DiagnosticEvent[] = [];
  let beforeSend:
    | ((event: DiagnosticEvent) => DiagnosticEvent | null)
    | undefined;
  const sdk: NativeDiagnosticsSdk = {
    captureException: jest.fn((_error, context) => {
      const processed = beforeSend?.({
        ...dirtyEvent,
        tags: { ...dirtyEvent.tags, ...context.tags },
        contexts: { ...dirtyEvent.contexts, ...context.contexts },
      });
      if (processed) events.push(processed);
      return processed?.event_id;
    }),
    close: jest.fn(async () => {
      preference.value = false;
      return true;
    }),
    flush: jest.fn(async () => true),
    getSharingPreference: jest.fn(async () => preference.value),
    init: jest.fn((options) => {
      beforeSend = options.beforeSend;
    }),
    nativeCrash: jest.fn(),
    setSharingPreference: jest.fn(async (enabled) => {
      preference.value = enabled;
      return true;
    }),
    setRuntimeContext: jest.fn(),
  };
  return { events, preference, sdk };
}

const hostileEvent: DiagnosticEvent = {
  breadcrumbs: [
    {
      category: "fetch",
      data: {
        body: "Task text: close payroll",
        url: "https://openjob.dev/groups/grp_secret/tasks/task_secret",
      },
      message: "walker@example.com",
    },
  ],
  contexts: {
    device: { name: "Shane's iPhone", uuid: "permanent-install-id" },
    response: { body: "refresh_token=credential-secret" },
  },
  debug_meta: {
    images: [
      {
        code_file:
          "/private/install-uuid/OpenJob.app/main.jsbundle",
        code_id: "deadbeef",
        debug_id: "12345678-1234-4abc-8abc-123456789abc",
        image_addr: "deadbeef",
        image_size: 1234,
        type: "grp_secret",
      },
      {
        code_file: "app:///main.jsbundle",
        debug_id: "12345678---------------------------",
      },
      {
        code_file: "app:///main.jsbundle",
        debug_id: "deadbeef",
      },
    ],
  },
  event_id: "0123456789abcdef0123456789abcdef",
  exception: {
    values: [
      {
        stacktrace: {
          frames: [
            {
              abs_path: "/private/install-uuid/OpenJob.app/main.jsbundle",
              colno: 9,
              filename:
                "/private/install-uuid/OpenJob.app/main.jsbundle",
              function: "Object.task_secret",
              in_app: true,
              lineno: 42,
              module: "grp_secret",
            },
            {
              filename:
                "https://openjob.dev/groups/grp_secret?token=credential-secret",
              function: "walker@example.com",
              lineno: 1,
            },
            {
              filename:
                "/private/var/mobile/Containers/Data/Application/INSTALL-ID/main.ts",
              function: "close payroll",
              module: "Walker Workshop",
            },
            {
              filename: "app:///src/groups/grp_secret.ts",
              function: "renderSettings",
              module: "@openjob/native",
            },
          ],
        },
        type: "walker",
        value:
          "Task close payroll in Walker Workshop for @walker failed with credential-secret",
      },
    ],
  },
  extra: {
    authorization: "Bearer credential-secret",
    groupId: "grp_secret",
    requestBody: { text: "close payroll" },
  },
  message: "walker@example.com could not update Walker Workshop",
  request: {
    data: { text: "close payroll" },
    headers: { authorization: "Bearer credential-secret" },
    url: "https://openjob.dev/groups/grp_secret/tasks/task_secret",
  },
  tags: {
    group_id: "grp_secret",
    username: "walker",
  },
  transaction: "GET /groups/grp_secret/tasks/task_secret",
  user: {
    email: "walker@example.com",
    id: "usr_secret",
    username: "walker",
  },
};

test("sends only scrubbed diagnostic context through the captured transport", async () => {
  const { events, sdk } = capturedSdk(hostileEvent);
  const diagnostics = createNativeDiagnosticsController({
    readRuntimeContext: async () => ({
      applicationId: "dev.openjob.app.preview",
      appVersion: "0.3.3",
      buildVersion: "42",
      deviceClass: "tablet",
      osName: "iOS",
      osVersion: "18.5",
      runtimeVersion: "Expo 57 / React Native 0.86",
      updateId: null,
      updateSource: "embedded",
    }),
    sdk,
  });

  await expect(diagnostics.initialize(previewConfig)).resolves.toBe(true);
  expect(sdk.setRuntimeContext).toHaveBeenCalledWith({
    applicationId: "dev.openjob.app.preview",
    appVersion: "0.3.3",
    buildVersion: "42",
    deviceClass: "tablet",
    osName: "iOS",
    osVersion: "18.5",
    runtimeVersion: "Expo 57 / React Native 0.86",
    updateId: null,
    updateSource: "embedded",
  });
  const options = (sdk.init as jest.Mock).mock.calls[0]?.[0];
  expect(options).toMatchObject({
    attachScreenshot: false,
    attachThreads: true,
    attachViewHierarchy: false,
    autoInitializeNativeSdk: true,
    enableAppHangTracking: true,
    enableAutoPerformanceTracing: false,
    enableAutoSessionTracking: false,
    enableCaptureFailedRequests: false,
    enableLogs: false,
    enableNativeCrashHandling: true,
    enableNativeFramesTracking: false,
    enableNdk: false,
    enableNdkScopeSync: false,
    enableStallTracking: false,
    enableUserInteractionTracing: false,
    enableWatchdogTerminationTracking: true,
    integrationMode: "crash-only",
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sendDefaultPii: false,
  });
  for (const disabledByAbsence of [
    "profilesSampleRate",
    "replaysOnErrorSampleRate",
    "replaysSessionSampleRate",
    "tracesSampleRate",
    "tracesSampler",
  ]) {
    expect(options).not.toHaveProperty(disabledByAbsence);
  }
  expect(
    diagnostics.captureException(new Error("credential-secret"), {
      durationMs: 126.8,
      operation: "diagnostic_verification",
    }),
  ).toBe(hostileEvent.event_id);
  await expect(diagnostics.flush()).resolves.toBe(true);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    contexts: {
      openjob: {
        app_version: "0.3.3",
        build_version: "42",
        device_class: "tablet",
        duration_ms: 127,
        os_name: "iOS",
        os_version: "18.5",
        runtime_version: "Expo 57 / React Native 0.86",
        update_source: "embedded",
      },
    },
    environment: "preview",
    event_id: hostileEvent.event_id,
    exception: {
      values: [
        {
          type: "Error",
          value: "OpenJob native failure",
        },
      ],
    },
    level: "error",
    message: "OpenJob native failure",
    release: "dev.openjob.app.preview@0.3.3+42",
    sdk: { settings: { infer_ip: "never" } },
    dist: "42",
    debug_meta: {
      images: [
        {
          code_file: "app:///main.jsbundle",
          debug_id: "12345678-1234-4abc-8abc-123456789abc",
          type: "sourcemap",
        },
      ],
    },
    tags: {
      operation: "diagnostic_verification",
    },
  });
  expect(events[0]).not.toHaveProperty("breadcrumbs");
  expect(events[0]).not.toHaveProperty("extra");
  expect(events[0]).not.toHaveProperty("request");
  expect(events[0]).not.toHaveProperty("transaction");
  expect(events[0]).not.toHaveProperty("user");
  const frames = events[0]?.exception?.values?.[0]?.stacktrace?.frames;
  expect(frames?.[0]).toEqual({
    colno: 9,
    filename: "app:///main.jsbundle",
    lineno: 42,
  });
  for (const frame of frames ?? []) {
    expect(frame).not.toHaveProperty("function");
    expect(frame).not.toHaveProperty("module");
  }

  const serialized = JSON.stringify(events[0]);
  for (const prohibited of [
    "close payroll",
    "Walker Workshop",
    "grp_secret",
    "task_secret",
    "usr_secret",
    "walker@example.com",
    "credential-secret",
    "deadbeef",
    "permanent-install-id",
    "https://openjob.dev",
    "/private/install-uuid",
    "/private/var/mobile",
    "../users",
  ]) {
    expect(serialized).not.toContain(prohibited);
  }
  expect(serialized).toContain("app:///main.jsbundle");
  expect(serialized).not.toContain("Object.task_secret");
  expect(serialized).not.toContain("@openjob/native");
  expect(serialized).not.toContain('"type":"walker"');
});

test("bounds recovered JavaScript hang timing through the final allowlist", async () => {
  const { events, sdk } = capturedSdk(hostileEvent);
  const diagnostics = createNativeDiagnosticsController({
    readRuntimeContext: async () => ({
      applicationId: "dev.openjob.app.preview",
      appVersion: "0.3.3",
      buildVersion: "42",
      deviceClass: "tablet",
      osName: "iOS",
      osVersion: "18.5",
      runtimeVersion: "Expo 57 / React Native 0.86",
      updateId: null,
      updateSource: "embedded",
    }),
    sdk,
  });

  await diagnostics.initialize(previewConfig);
  diagnostics.captureException(new Error("credential-secret"), {
    durationMs: 9_999_999,
    operation: "javascript_hang",
  });

  expect(events).toHaveLength(1);
  expect(events[0]?.contexts).toEqual({
    openjob: {
      app_version: "0.3.3",
      build_version: "42",
      device_class: "tablet",
      duration_ms: 60_000,
      os_name: "iOS",
      os_version: "18.5",
      runtime_version: "Expo 57 / React Native 0.86",
      update_source: "embedded",
    },
  });
  expect(events[0]?.tags).toEqual({ operation: "javascript_hang" });
  for (const prohibitedField of [
    "breadcrumbs",
    "extra",
    "request",
    "transaction",
    "user",
  ]) {
    expect(events[0]).not.toHaveProperty(prohibitedField);
  }
  expect(JSON.stringify(events[0])).not.toMatch(
    /credential-secret|grp_secret|permanent-install-id|walker@example\.com/u,
  );
});

test("defaults on, treats the native preference as authoritative, and stops capture when disabled", async () => {
  const nativePreference = { value: true };
  const first = capturedSdk(hostileEvent, nativePreference);
  const diagnostics = createNativeDiagnosticsController({
    readRuntimeContext: async () => ({
      applicationId: "dev.openjob.app.preview",
      appVersion: "0.3.3",
      buildVersion: "42",
      deviceClass: "phone",
      osName: "Android",
      osVersion: "16",
      runtimeVersion: "Expo 57 / React Native 0.86",
      updateId: null,
      updateSource: "embedded",
    }),
    sdk: first.sdk,
  });

  await expect(diagnostics.initialize(previewConfig)).resolves.toBe(true);
  expect(first.sdk.setSharingPreference).toHaveBeenCalledWith(true);
  expect(first.sdk.init).toHaveBeenCalledTimes(1);
  await expect(diagnostics.initialize(previewConfig)).resolves.toBe(true);
  expect(first.sdk.init).toHaveBeenCalledTimes(1);
  await expect(diagnostics.setSharingEnabled(false)).resolves.toBe(false);
  expect(nativePreference.value).toBe(false);
  expect(first.sdk.setSharingPreference).toHaveBeenLastCalledWith(false);
  expect(first.sdk.close).toHaveBeenCalledWith(0);
  expect(
    diagnostics.captureException(new Error("later"), {
      operation: "unhandled_exception",
    }),
  ).toBeNull();
  expect(first.sdk.captureException).not.toHaveBeenCalled();

  const restarted = capturedSdk(hostileEvent, nativePreference);
  const disabled = createNativeDiagnosticsController({
    readRuntimeContext: async () => {
      throw new Error("runtime context must not load while disabled");
    },
    sdk: restarted.sdk,
  });
  await expect(disabled.initialize(previewConfig)).resolves.toBe(false);
  expect(restarted.sdk.init).not.toHaveBeenCalled();
  expect(restarted.sdk.setSharingPreference).toHaveBeenCalledWith(false);
  expect(restarted.sdk.close).toHaveBeenCalledWith(0);

  const unreadableSdk = capturedSdk(hostileEvent);
  (unreadableSdk.sdk.getSharingPreference as jest.Mock).mockRejectedValueOnce(
    new Error("native preference unavailable"),
  );
  const unreadable = createNativeDiagnosticsController({
    readRuntimeContext: async () => {
      throw new Error("runtime context must not load while disabled");
    },
    sdk: unreadableSdk.sdk,
  });
  await expect(unreadable.initialize(previewConfig)).resolves.toBe(false);
  expect(unreadableSdk.sdk.setSharingPreference).toHaveBeenCalledWith(false);
  expect(unreadableSdk.sdk.close).toHaveBeenCalledWith(0);
});

test("disable remains off even when native persistence or SDK close reports failure", async () => {
  const closeFailure = capturedSdk(hostileEvent);
  (closeFailure.sdk.close as jest.Mock).mockRejectedValueOnce(
    new Error("close failed"),
  );
  const closeDiagnostics = createNativeDiagnosticsController({
    readRuntimeContext: async () => ({
      applicationId: "dev.openjob.app.preview",
      appVersion: "0.3.3",
      buildVersion: "42",
      deviceClass: "phone",
      osName: "Android",
      osVersion: "16",
      runtimeVersion: "dev.openjob.app.preview@0.3.3+42",
      updateId: null,
      updateSource: "embedded",
    }),
    sdk: closeFailure.sdk,
  });
  await closeDiagnostics.initialize(previewConfig);
  await expect(closeDiagnostics.setSharingEnabled(false)).rejects.toThrow(
    "close failed",
  );
  expect(closeFailure.preference.value).toBe(false);
  expect(closeDiagnostics.isSharingEnabled()).toBe(false);
  expect(
    closeDiagnostics.captureException(new Error("later"), {
      operation: "unhandled_exception",
    }),
  ).toBeNull();
  await expect(closeDiagnostics.setSharingEnabled(true)).resolves.toBe(true);
  expect(closeFailure.sdk.init).toHaveBeenCalledTimes(2);
  expect(closeDiagnostics.isSharingEnabled()).toBe(true);

  const preferenceFailure = capturedSdk(hostileEvent);
  (preferenceFailure.sdk.setSharingPreference as jest.Mock).mockResolvedValueOnce(
    true,
  );
  (preferenceFailure.sdk.setSharingPreference as jest.Mock).mockResolvedValueOnce(
    false,
  );
  const preferenceDiagnostics = createNativeDiagnosticsController({
    readRuntimeContext: async () => ({
      applicationId: "dev.openjob.app.preview",
      appVersion: "0.3.3",
      buildVersion: "42",
      deviceClass: "phone",
      osName: "Android",
      osVersion: "16",
      runtimeVersion: "dev.openjob.app.preview@0.3.3+42",
      updateId: null,
      updateSource: "embedded",
    }),
    sdk: preferenceFailure.sdk,
  });
  await preferenceDiagnostics.initialize(previewConfig);
  await expect(preferenceDiagnostics.setSharingEnabled(false)).rejects.toThrow(
    "native diagnostics preference",
  );
  expect(preferenceFailure.sdk.close).toHaveBeenCalledWith(0);
  expect(preferenceFailure.preference.value).toBe(false);
});

test("rolls the native preference back when re-enabling cannot start diagnostics", async () => {
  const nativePreference = { value: false };
  const failure = capturedSdk(hostileEvent, nativePreference);
  const diagnostics = createNativeDiagnosticsController({
    readRuntimeContext: async () => ({
      applicationId: "dev.openjob.app.preview",
      appVersion: "0.3.3",
      buildVersion: "42",
      deviceClass: "phone",
      osName: "Android",
      osVersion: "16",
      runtimeVersion: "dev.openjob.app.preview@0.3.3+42",
      updateId: null,
      updateSource: "embedded",
    }),
    sdk: failure.sdk,
  });
  await expect(diagnostics.initialize(previewConfig)).resolves.toBe(false);
  (failure.sdk.init as jest.Mock).mockRejectedValueOnce(
    new Error("native startup failed"),
  );

  await expect(diagnostics.setSharingEnabled(true)).rejects.toThrow(
    "native startup failed",
  );

  expect(nativePreference.value).toBe(false);
  expect(diagnostics.isSharingEnabled()).toBe(false);
  expect(failure.sdk.setSharingPreference).toHaveBeenLastCalledWith(false);
  expect(failure.sdk.close).toHaveBeenCalledWith(0);

  const restarted = capturedSdk(hostileEvent, nativePreference);
  const afterRestart = createNativeDiagnosticsController({
    readRuntimeContext: async () => {
      throw new Error("runtime context must not load after failed re-enable");
    },
    sdk: restarted.sdk,
  });
  await expect(afterRestart.initialize(previewConfig)).resolves.toBe(false);
  expect(restarted.sdk.init).not.toHaveBeenCalled();
});

test("does not report diagnostics as enabled when the binary has no DSN", async () => {
  const capture = capturedSdk(hostileEvent);
  const diagnostics = createNativeDiagnosticsController({
    readRuntimeContext: async () => {
      throw new Error("runtime context must not load without a DSN");
    },
    sdk: capture.sdk,
  });
  const noDsnConfig = { ...previewConfig, diagnosticsDsn: null };

  await expect(diagnostics.initialize(noDsnConfig)).resolves.toBe(false);
  expect(diagnostics.isSharingEnabled()).toBe(false);
  expect(capture.sdk.init).not.toHaveBeenCalled();
  await expect(diagnostics.setSharingEnabled(true)).resolves.toBe(false);
  expect(diagnostics.isSharingEnabled()).toBe(false);
});

test("exposes a native crash trigger only to explicitly guarded non-production builds", async () => {
  const preview = capturedSdk(hostileEvent);
  const diagnostics = createNativeDiagnosticsController({
    readRuntimeContext: async () => ({
      applicationId: "dev.openjob.app.preview",
      appVersion: "0.3.3",
      buildVersion: "42",
      deviceClass: "phone",
      osName: "Android",
      osVersion: "16",
      runtimeVersion: "Expo 57 / React Native 0.86",
      updateId: null,
      updateSource: "embedded",
    }),
    sdk: preview.sdk,
  });
  await diagnostics.initialize(previewConfig);
  expect(diagnostics.triggerNativeCrashVerification()).toBe(true);
  expect(preview.sdk.nativeCrash).toHaveBeenCalledTimes(1);

  const production = capturedSdk(hostileEvent);
  const productionDiagnostics = createNativeDiagnosticsController({
    readRuntimeContext: async () => ({
      applicationId: "dev.openjob.app",
      appVersion: "0.3.3",
      buildVersion: "7",
      deviceClass: "phone",
      osName: "iOS",
      osVersion: "18.5",
      runtimeVersion: "Expo 57 / React Native 0.86",
      updateId: null,
      updateSource: "embedded",
    }),
    sdk: production.sdk,
  });
  await productionDiagnostics.initialize({
    ...previewConfig,
    diagnosticsVerificationEnabled: false,
    environment: "production",
    environmentBadge: null,
    qaPasswordTenantId: null,
  });
  expect(productionDiagnostics.triggerNativeCrashVerification()).toBe(false);
  expect(production.sdk.nativeCrash).not.toHaveBeenCalled();
});
