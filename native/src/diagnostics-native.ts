import * as Device from "expo-device";
import * as Updates from "expo-updates";
import parseErrorStack from "react-native/Libraries/Core/Devtools/parseErrorStack";
import {
  AppState,
  Platform,
  TurboModuleRegistry,
  type AppStateStatus,
  type TurboModule,
} from "react-native";
import {
  createNativeDiagnosticsController,
  type DiagnosticEvent,
  type DiagnosticRuntimeContext,
  isCanonicalSentryDebugId,
  type NativeDiagnosticsSdk,
  type NativeDiagnosticsSdkOptions,
} from "./diagnostics";

type NativeSentryBridge = TurboModule & {
  captureEnvelope(
    bytes: string,
    options: { hardCrashed: boolean },
  ): Promise<boolean>;
  closeNativeSdk(): Promise<void>;
  crash(): void;
  fetchNativeRelease(): Promise<{
    build: string;
    id: string;
    version: string;
  }>;
  initNativeSdk(options: Record<string, unknown>): Promise<boolean>;
  getOpenJobDiagnosticsEnabled(): Promise<boolean>;
  setOpenJobDiagnosticsEnabled(enabled: boolean): Promise<boolean>;
  setContext(key: string, value: Record<string, unknown> | null): void;
};

type ErrorHandler = (error: Error, isFatal?: boolean) => void;
type ErrorUtilsApi = {
  getGlobalHandler(): ErrorHandler | undefined;
  setGlobalHandler(handler: ErrorHandler): void;
};

const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const pendingEnvelopes = new Set<Promise<boolean>>();
const fatalStoreTimeoutMs = 2_000;
const javascriptHangHeartbeatMs = 1_000;
const javascriptHangThresholdMs = 5_000;
const javascriptHangConfirmationMs = 250;
const javascriptHangCooldownMs = 5 * 60_000;
const javascriptHangMaximumMs = 60_000;
let beforeSend: NativeDiagnosticsSdkOptions["beforeSend"] | null = null;
let installedErrorHandler: ErrorHandler | null = null;
let previousErrorHandler: ErrorHandler | undefined;
let handlingFatal = false;
let javascriptHangState: AppStateStatus | null = AppState.currentState;
let javascriptHangGeneration = 0;
let javascriptHangExpectedAt = 0;
let javascriptHangCooldownUntil = 0;
let javascriptHangWarmedUp = false;
let javascriptHangTimer: ReturnType<typeof setTimeout> | null = null;
let javascriptHangConfirmationTimer: ReturnType<typeof setTimeout> | null = null;
let javascriptHangSubscription: { remove(): void } | null = null;

function sentryBridge(): NativeSentryBridge {
  return TurboModuleRegistry.getEnforcing<NativeSentryBridge>("RNSentry");
}

function errorUtils(): ErrorUtilsApi | null {
  const value = (globalThis as typeof globalThis & { ErrorUtils?: ErrorUtilsApi })
    .ErrorUtils;
  return value ?? null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    result += base64Alphabet[(combined >> 18) & 63];
    result += base64Alphabet[(combined >> 12) & 63];
    result +=
      index + 1 < bytes.length ? base64Alphabet[(combined >> 6) & 63] : "=";
    result += index + 2 < bytes.length ? base64Alphabet[combined & 63] : "=";
  }
  return result;
}

function createEventId(): string {
  let eventId = "";
  for (let index = 0; index < 32; index += 1) {
    eventId += Math.floor(Math.random() * 16).toString(16);
  }
  return eventId;
}

function parseStack(stack: string | undefined) {
  const hermesEnabled = Boolean(
    (globalThis as typeof globalThis & { HermesInternal?: object })
      .HermesInternal,
  );
  return parseErrorStack(stack)
    .map((frame) => ({
      ...(frame.methodName ? { function: frame.methodName } : {}),
      ...(frame.file ? { filename: frame.file } : {}),
      ...(frame.lineNumber === null || frame.lineNumber === undefined
        ? {}
        : { lineno: frame.lineNumber }),
      ...(frame.column === null || frame.column === undefined
        ? {}
        : {
            colno:
              hermesEnabled && frame.lineNumber === 1
                ? frame.column + 1
                : frame.column,
          }),
    }))
    .reverse();
}

function currentDebugMeta(): DiagnosticEvent["debug_meta"] | undefined {
  const debugIds = (
    globalThis as typeof globalThis & {
      _sentryDebugIds?: Record<string, string>;
    }
  )._sentryDebugIds;
  const debugIdsInBundle = new Set(
    debugIds
      ? Object.values(debugIds).filter(isCanonicalSentryDebugId)
      : [],
  );
  if (debugIdsInBundle.size !== 1) return undefined;
  const [debugId] = debugIdsInBundle;
  if (!debugId) return undefined;
  return {
    images: [
      {
        code_file:
          Platform.OS === "android"
            ? "app:///index.android.bundle"
            : "app:///main.jsbundle",
        debug_id: debugId,
        type: "sourcemap",
      },
    ],
  };
}

function envelopeFor(event: DiagnosticEvent): string {
  const payload = JSON.stringify(event);
  const payloadBytes = new TextEncoder().encode(payload);
  const header = JSON.stringify({
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
  });
  const item = JSON.stringify({
    content_type: "application/json",
    length: payloadBytes.length,
    type: "event",
  });
  return bytesToBase64(
    new TextEncoder().encode(`${header}\n${item}\n${payload}\n`),
  );
}

function queueException(
  error: unknown,
  hardCrashed: boolean,
): { eventId: string; stored: Promise<boolean> } | undefined {
  if (!beforeSend) return undefined;
  const source = error instanceof Error ? error : new Error("OpenJob failure");
  const eventId = createEventId();
  const event = beforeSend({
    ...(currentDebugMeta() ? { debug_meta: currentDebugMeta() } : {}),
    event_id: eventId,
    exception: {
      values: [
        {
          mechanism: { handled: !hardCrashed, type: hardCrashed ? "onerror" : "generic" },
          stacktrace: { frames: parseStack(source.stack) },
          type: source.name,
          value: source.message,
        },
      ],
    },
    platform: "javascript",
    sdk: { settings: { infer_ip: "never" } },
    timestamp: Date.now() / 1_000,
  });
  if (!event) return undefined;
  const capture = sentryBridge()
    .captureEnvelope(envelopeFor(event), { hardCrashed })
    .catch(() => false)
    .finally(() => pendingEnvelopes.delete(capture));
  pendingEnvelopes.add(capture);
  return { eventId: event.event_id ?? eventId, stored: capture };
}

function installGlobalErrorHandler() {
  const api = errorUtils();
  if (!api || installedErrorHandler) return;
  previousErrorHandler = api.getGlobalHandler();
  installedErrorHandler = (error, isFatal = false) => {
    if (!isFatal) {
      previousErrorHandler?.(error, false);
      return;
    }
    if (handlingFatal) return;
    handlingFatal = true;

    let queued: ReturnType<typeof queueException>;
    try {
      queued = queueException(error, true);
    } catch {
      queued = undefined;
    }
    if (!queued) {
      try {
        previousErrorHandler?.(error, true);
      } finally {
        handlingFatal = false;
      }
      return;
    }

    let propagated = false;
    const propagate = () => {
      if (propagated) return;
      propagated = true;
      try {
        previousErrorHandler?.(error, true);
      } finally {
        handlingFatal = false;
      }
    };
    const fallback = setTimeout(propagate, fatalStoreTimeoutMs);
    void queued.stored.finally(() => {
      clearTimeout(fallback);
      propagate();
    });
  };
  api.setGlobalHandler(installedErrorHandler);
}

function removeGlobalErrorHandler() {
  const api = errorUtils();
  if (api && installedErrorHandler && api.getGlobalHandler() === installedErrorHandler) {
    api.setGlobalHandler(previousErrorHandler ?? (() => undefined));
  }
  installedErrorHandler = null;
  previousErrorHandler = undefined;
  handlingFatal = false;
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function cancelJavaScriptHangTimers() {
  if (javascriptHangTimer) clearTimeout(javascriptHangTimer);
  javascriptHangTimer = null;
  if (javascriptHangConfirmationTimer) {
    clearTimeout(javascriptHangConfirmationTimer);
  }
  javascriptHangConfirmationTimer = null;
}

function removeJavaScriptHangMonitor() {
  javascriptHangGeneration += 1;
  cancelJavaScriptHangTimers();
  javascriptHangSubscription?.remove();
  javascriptHangSubscription = null;
  javascriptHangExpectedAt = 0;
  javascriptHangCooldownUntil = 0;
  javascriptHangWarmedUp = false;
}

function scheduleJavaScriptHangHeartbeat(generation: number) {
  javascriptHangExpectedAt = monotonicNow() + javascriptHangHeartbeatMs;
  javascriptHangTimer = setTimeout(() => {
    javascriptHangTimer = null;
    if (
      generation !== javascriptHangGeneration ||
      javascriptHangState !== "active" ||
      AppState.currentState !== "active"
    ) {
      return;
    }
    const now = monotonicNow();
    const lateBy = Math.max(0, now - javascriptHangExpectedAt);
    if (!javascriptHangWarmedUp) {
      javascriptHangWarmedUp = true;
      scheduleJavaScriptHangHeartbeat(generation);
      return;
    }
    if (lateBy < javascriptHangThresholdMs || now < javascriptHangCooldownUntil) {
      scheduleJavaScriptHangHeartbeat(generation);
      return;
    }
    const durationMs = Math.max(
      javascriptHangThresholdMs,
      Math.min(
        javascriptHangMaximumMs,
        Math.floor(lateBy / 1_000) * 1_000,
      ),
    );
    javascriptHangConfirmationTimer = setTimeout(() => {
      javascriptHangConfirmationTimer = null;
      if (
        generation !== javascriptHangGeneration ||
        javascriptHangState !== "active" ||
        AppState.currentState !== "active"
      ) {
        return;
      }
      javascriptHangCooldownUntil = monotonicNow() + javascriptHangCooldownMs;
      sentryNativeDiagnosticsSdk.captureException(
        new Error("OpenJob JavaScript hang"),
        {
          contexts: { openjob: { duration_ms: durationMs } },
          tags: { operation: "javascript_hang" },
        },
      );
      scheduleJavaScriptHangHeartbeat(generation);
    }, javascriptHangConfirmationMs);
  }, javascriptHangHeartbeatMs);
}

function resetJavaScriptHangHeartbeat(state: AppStateStatus | null) {
  javascriptHangGeneration += 1;
  cancelJavaScriptHangTimers();
  javascriptHangState = state;
  javascriptHangWarmedUp = false;
  if (state === "active") {
    scheduleJavaScriptHangHeartbeat(javascriptHangGeneration);
  }
}

function installJavaScriptHangMonitor() {
  removeJavaScriptHangMonitor();
  javascriptHangSubscription = AppState.addEventListener("change", (state) => {
    resetJavaScriptHangHeartbeat(state);
  });
  resetJavaScriptHangHeartbeat(AppState.currentState);
}

function deviceClass(
  type: Device.DeviceType | null,
): DiagnosticRuntimeContext["deviceClass"] {
  switch (type) {
    case Device.DeviceType.DESKTOP:
      return "desktop";
    case Device.DeviceType.PHONE:
      return "phone";
    case Device.DeviceType.TABLET:
      return "tablet";
    case Device.DeviceType.TV:
      return "tv";
    default:
      return "unknown";
  }
}

export async function readDiagnosticRuntimeContext(): Promise<DiagnosticRuntimeContext> {
  const otaLaunch = Updates.isEnabled && !Updates.isEmbeddedLaunch;
  const nativeRelease = await sentryBridge().fetchNativeRelease();
  const applicationId = nativeRelease.id;
  const appVersion = nativeRelease.version;
  const buildVersion = nativeRelease.build;
  const embeddedRuntimeVersion = `${applicationId}@${appVersion}${buildVersion ? `+${buildVersion}` : ""}`;
  const otaRuntimeVersion =
    otaLaunch && typeof Updates.runtimeVersion === "string"
      ? Updates.runtimeVersion.trim()
      : "";
  return {
    applicationId,
    appVersion,
    buildVersion,
    deviceClass: deviceClass(await Device.getDeviceTypeAsync()),
    osName:
      Platform.OS === "ios"
        ? "iOS"
        : Platform.OS === "android"
          ? "Android"
          : "unknown",
    osVersion: Device.osVersion ?? String(Platform.Version),
    runtimeVersion: otaRuntimeVersion || embeddedRuntimeVersion,
    updateId: otaLaunch ? Updates.updateId : null,
    updateSource: otaLaunch ? "signed-ota" : "embedded",
  };
}

export const sentryNativeDiagnosticsSdk: NativeDiagnosticsSdk = {
  captureException(error, context) {
    if (!beforeSend) return undefined;
    const originalBeforeSend = beforeSend;
    beforeSend = (event) =>
      originalBeforeSend({
        ...event,
        contexts: { ...event.contexts, ...context.contexts },
        tags: { ...event.tags, ...context.tags },
      });
    try {
      return queueException(error, false)?.eventId;
    } finally {
      beforeSend = originalBeforeSend;
    }
  },

  async close() {
    beforeSend = null;
    removeGlobalErrorHandler();
    removeJavaScriptHangMonitor();
    pendingEnvelopes.clear();
    await sentryBridge().closeNativeSdk();
    return true;
  },

  async flush(timeout) {
    if (pendingEnvelopes.size === 0) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeout);
    });
    const drained = Promise.all([...pendingEnvelopes]).then((results) =>
      results.every(Boolean),
    );
    const result = await Promise.race([drained, timedOut]);
    if (timer) clearTimeout(timer);
    return result;
  },

  async init(options) {
    beforeSend = options.beforeSend;
    const started = await sentryBridge().initNativeSdk({
      attachScreenshot: false,
      attachThreads: true,
      attachViewHierarchy: false,
      autoInitializeNativeSdk: true,
      debug: false,
      dsn: options.dsn,
      enableAppHangTracking: true,
      enableAutoActivityLifecycleTracing: false,
      enableAutoBreadcrumbTracking: false,
      enableAppStartTracking: false,
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
      environment: options.environment,
      maxBreadcrumbs: 0,
      sendClientReports: false,
      sendDefaultPii: false,
      shutdownTimeInterval: 0,
      shutdownTimeout: 0,
    });
    if (!started) {
      beforeSend = null;
      throw new Error("OpenJob native diagnostics failed to initialize.");
    }
    installGlobalErrorHandler();
    installJavaScriptHangMonitor();
  },

  nativeCrash() {
    sentryBridge().crash();
  },

  async getSharingPreference() {
    return sentryBridge().getOpenJobDiagnosticsEnabled();
  },

  async setSharingPreference(enabled) {
    return sentryBridge().setOpenJobDiagnosticsEnabled(enabled);
  },

  setRuntimeContext(context) {
    sentryBridge().setContext("openjob", {
      app_version: context.appVersion,
      ...(context.buildVersion
        ? { build_version: context.buildVersion }
        : {}),
      device_class: context.deviceClass,
      os_name: context.osName,
      os_version: context.osVersion,
      runtime_version: context.runtimeVersion,
      ...(context.updateId ? { update_id: context.updateId } : {}),
      update_source: context.updateSource,
    });
  },
};

export const nativeDiagnosticsController = createNativeDiagnosticsController({
  readRuntimeContext: readDiagnosticRuntimeContext,
  sdk: sentryNativeDiagnosticsSdk,
});
