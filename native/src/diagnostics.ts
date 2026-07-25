import type { OpenJobRuntimeConfig } from "./runtime-config";

export type DiagnosticOperation =
  | "authentication_restore"
  | "bootstrap"
  | "diagnostic_verification"
  | "javascript_hang"
  | "memory_pressure"
  | "task_list_refresh"
  | "unhandled_exception"
  | "update_apply"
  | "update_check"
  | "update_download";

type DiagnosticFrame = {
  abs_path?: string;
  colno?: number;
  filename?: string;
  function?: string;
  image_addr?: string;
  in_app?: boolean;
  instruction_addr?: string;
  lineno?: number;
  module?: string;
  package?: string;
  symbol_addr?: string;
  [key: string]: unknown;
};

type DiagnosticException = {
  mechanism?: Record<string, unknown>;
  stacktrace?: { frames?: DiagnosticFrame[]; [key: string]: unknown };
  type?: string;
  value?: string;
  [key: string]: unknown;
};

export type DiagnosticEvent = {
  breadcrumbs?: unknown[];
  contexts?: Record<string, Record<string, unknown>>;
  debug_meta?: Record<string, unknown>;
  dist?: string;
  environment?: string;
  event_id?: string;
  exception?: { values?: DiagnosticException[] };
  extra?: Record<string, unknown>;
  level?: string;
  message?: string;
  platform?: string;
  release?: string;
  request?: Record<string, unknown>;
  sdk?: Record<string, unknown>;
  tags?: Record<string, string>;
  threads?: Record<string, unknown>;
  timestamp?: number;
  transaction?: string;
  user?: Record<string, unknown>;
  [key: string]: unknown;
};

export type NativeDiagnosticsSdkOptions = {
  attachScreenshot: false;
  attachThreads: true;
  attachViewHierarchy: false;
  autoInitializeNativeSdk: true;
  beforeBreadcrumb: () => null;
  beforeSend: (event: DiagnosticEvent) => DiagnosticEvent | null;
  beforeSendTransaction: () => null;
  dsn: string;
  enableAppHangTracking: true;
  enableAutoBreadcrumbTracking: false;
  enableAutoActivityLifecycleTracing: false;
  enableAutoPerformanceTracing: false;
  enableAutoSessionTracking: false;
  enableCaptureFailedRequests: false;
  enableCoreDataTracing: false;
  enableFileIOTracing: false;
  enableFramesTracking: false;
  enableLogs: false;
  enableNativeCrashHandling: true;
  enableNativeFramesTracking: false;
  enableNetworkBreadcrumbs: false;
  enableNetworkTracking: false;
  enableNdk: false;
  enableNdkScopeSync: false;
  enablePerformanceV2: false;
  enablePreWarmedAppStartTracing: false;
  enableProfiling: false;
  enableScreenTracking: false;
  enableStallTracking: false;
  enableTimeToFullDisplayTracing: false;
  enableUIViewControllerTracing: false;
  enableUserInteractionBreadcrumbs: false;
  enableUserInteractionTracing: false;
  enableWatchdogTerminationTracking: true;
  environment: OpenJobRuntimeConfig["environment"];
  integrationMode: "crash-only";
  maxBreadcrumbs: 0;
  sendClientReports: false;
  sendDefaultPii: false;
};

export type NativeDiagnosticsSdk = {
  captureException(
    error: unknown,
    context: {
      contexts: Record<string, Record<string, unknown>>;
      tags: Record<string, string>;
    },
  ): string | undefined;
  close(timeout: number): Promise<boolean>;
  flush(timeout: number): Promise<boolean>;
  init(options: NativeDiagnosticsSdkOptions): void | Promise<void>;
  nativeCrash(): void;
  getSharingPreference(): Promise<boolean>;
  setSharingPreference(enabled: boolean): Promise<boolean>;
  setRuntimeContext(context: DiagnosticRuntimeContext): void;
};

export type DiagnosticRuntimeContext = {
  applicationId: string;
  appVersion: string;
  buildVersion: string | null;
  deviceClass: "desktop" | "phone" | "tablet" | "tv" | "unknown";
  osName: "Android" | "iOS" | "unknown";
  osVersion: string;
  runtimeVersion: string;
  updateId: string | null;
  updateSource: "embedded" | "signed-ota";
};

const allowedOperations = new Set<DiagnosticOperation>([
  "authentication_restore",
  "bootstrap",
  "diagnostic_verification",
  "javascript_hang",
  "memory_pressure",
  "task_list_refresh",
  "unhandled_exception",
  "update_apply",
  "update_check",
  "update_download",
]);
const safeEventId = /^[0-9a-f]{32}$/iu;

export function isCanonicalSentryDebugId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  );
}

function safeFilename(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/(?:^|\/)main\.jsbundle$/u.test(value)) {
    return "app:///main.jsbundle";
  }
  if (/(?:^|\/)index\.android\.bundle$/u.test(value)) {
    return "app:///index.android.bundle";
  }
  return undefined;
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeFrame(frame: DiagnosticFrame): DiagnosticFrame {
  const filename = safeFilename(frame.filename);
  return {
    ...(filename ? { filename } : {}),
    ...(safeInteger(frame.lineno) !== undefined
      ? { lineno: safeInteger(frame.lineno) }
      : {}),
    ...(safeInteger(frame.colno) !== undefined
      ? { colno: safeInteger(frame.colno) }
      : {}),
  };
}

function safeStacktrace(stacktrace: DiagnosticException["stacktrace"]) {
  if (!stacktrace?.frames || !Array.isArray(stacktrace.frames)) return undefined;
  return { frames: stacktrace.frames.map(safeFrame) };
}

function safeMechanism(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const mechanism = value as Record<string, unknown>;
  return {
    ...(typeof mechanism.handled === "boolean"
      ? { handled: mechanism.handled }
      : {}),
    ...(typeof mechanism.synthetic === "boolean"
      ? { synthetic: mechanism.synthetic }
      : {}),
  };
}

function safeException(value: DiagnosticException): DiagnosticException {
  const stacktrace = safeStacktrace(value.stacktrace);
  const mechanism = safeMechanism(value.mechanism);
  return {
    ...(mechanism ? { mechanism } : {}),
    ...(stacktrace ? { stacktrace } : {}),
    type: "Error",
    value: "OpenJob native failure",
  };
}

function safeDebugMeta(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const images = (value as { images?: unknown }).images;
  if (!Array.isArray(images)) return undefined;
  const safeImages = images.flatMap((image) => {
    if (!image || typeof image !== "object" || Array.isArray(image)) return [];
    const record = image as Record<string, unknown>;
    const debugId = isCanonicalSentryDebugId(record.debug_id)
      ? record.debug_id
      : undefined;
    const codeFile = safeFilename(record.code_file);
    if (!debugId || !codeFile) return [];
    return [
      {
        code_file: codeFile,
        debug_id: debugId,
        type: "sourcemap",
      },
    ];
  });
  return safeImages.length > 0 ? { images: safeImages } : undefined;
}

function finiteDuration(value: unknown, maximum = 3_600_000): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.min(Math.round(value), maximum);
}

function operationFrom(event: DiagnosticEvent): DiagnosticOperation {
  const operation = event.tags?.operation;
  return allowedOperations.has(operation as DiagnosticOperation)
    ? (operation as DiagnosticOperation)
    : "unhandled_exception";
}

function sanitizeDiagnosticEvent(
  event: DiagnosticEvent,
  runtime: DiagnosticRuntimeContext,
  environment: OpenJobRuntimeConfig["environment"],
  enabled: () => boolean,
): DiagnosticEvent | null {
  if (!enabled()) return null;
  const operation = operationFrom(event);
  const duration = finiteDuration(
    event.contexts?.openjob?.duration_ms,
    operation === "javascript_hang" ? 60_000 : undefined,
  );
  const exceptions = event.exception?.values?.map(safeException) ?? [
    { type: "Error", value: "OpenJob native failure" },
  ];
  const debugMeta = safeDebugMeta(event.debug_meta);

  return {
    ...(typeof event.event_id === "string" && safeEventId.test(event.event_id)
      ? { event_id: event.event_id }
      : {}),
    platform: "javascript",
    ...(typeof event.timestamp === "number" &&
    Number.isFinite(event.timestamp) &&
    event.timestamp >= 0
      ? { timestamp: event.timestamp }
      : {}),
    ...(debugMeta ? { debug_meta: debugMeta } : {}),
    contexts: {
      openjob: {
        app_version: runtime.appVersion,
        ...(runtime.buildVersion ? { build_version: runtime.buildVersion } : {}),
        device_class: runtime.deviceClass,
        ...(duration !== undefined ? { duration_ms: duration } : {}),
        os_name: runtime.osName,
        os_version: runtime.osVersion,
        runtime_version: runtime.runtimeVersion,
        ...(runtime.updateId ? { update_id: runtime.updateId } : {}),
        update_source: runtime.updateSource,
      },
    },
    ...(runtime.buildVersion ? { dist: runtime.buildVersion } : {}),
    environment,
    exception: { values: exceptions },
    level: "error",
    message: "OpenJob native failure",
    release: `${runtime.applicationId}@${runtime.appVersion}${runtime.buildVersion ? `+${runtime.buildVersion}` : ""}`,
    sdk: { settings: { infer_ip: "never" } },
    tags: { operation },
  };
}

export function createNativeDiagnosticsController({
  readRuntimeContext,
  sdk,
}: {
  readRuntimeContext: () => Promise<DiagnosticRuntimeContext>;
  sdk: NativeDiagnosticsSdk;
}) {
  let config: OpenJobRuntimeConfig | null = null;
  let enabled = false;
  let initialized = false;
  let initializing: Promise<boolean> | null = null;
  let runtime: DiagnosticRuntimeContext | null = null;

  const stop = async () => {
    enabled = false;
    let failure: unknown;
    try {
      if (!(await sdk.setSharingPreference(false))) {
        failure = new Error(
          "OpenJob could not persist the native diagnostics preference.",
        );
      }
    } catch (error) {
      failure = error;
    }
    try {
      await sdk.close(0);
    } catch (error) {
      failure ??= error;
    }
    initialized = false;
    runtime = null;
    if (failure) throw failure;
  };

  const stopBestEffort = async () => {
    try {
      await stop();
    } catch {
      // Capture remains disabled in memory and native shutdown was attempted.
    }
  };

  const start = async () => {
    if (!config?.diagnosticsDsn) return false;
    runtime = await readRuntimeContext();
    await sdk.init({
      attachScreenshot: false,
      attachThreads: true,
      attachViewHierarchy: false,
      autoInitializeNativeSdk: true,
      beforeBreadcrumb: () => null,
      beforeSend: (event) =>
        runtime && config
          ? sanitizeDiagnosticEvent(event, runtime, config.environment, () => enabled)
          : null,
      beforeSendTransaction: () => null,
      dsn: config.diagnosticsDsn,
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
      environment: config.environment,
      integrationMode: "crash-only",
      maxBreadcrumbs: 0,
      sendClientReports: false,
      sendDefaultPii: false,
    });
    sdk.setRuntimeContext(runtime);
    initialized = true;
    return true;
  };

  return {
    captureException(
      error: unknown,
      {
        durationMs,
        operation,
      }: { durationMs?: number; operation: DiagnosticOperation },
    ) {
      if (!enabled || !initialized || !runtime) return null;
      return (
        sdk.captureException(error, {
          contexts: {
            openjob: {
              ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
            },
          },
          tags: { operation },
        }) ?? null
      );
    },

    async flush(timeout = 2_000) {
      return enabled && initialized ? sdk.flush(timeout) : false;
    },

    isSharingEnabled() {
      return enabled;
    },

    async initialize(nextConfig: OpenJobRuntimeConfig) {
      if (initialized) return enabled;
      if (initializing) return initializing;
      config = nextConfig;
      initializing = (async () => {
        let preference: boolean;
        try {
          preference = await sdk.getSharingPreference();
        } catch {
          await stopBestEffort();
          return false;
        }
        enabled = preference;
        if (!enabled) {
          await stopBestEffort();
          return false;
        }
        try {
          if (!(await sdk.setSharingPreference(true))) {
            throw new Error(
              "OpenJob could not persist the native diagnostics preference.",
            );
          }
          const started = await start();
          if (!started) {
            await stopBestEffort();
            return false;
          }
          return true;
        } catch {
          await stopBestEffort();
          return false;
        }
      })();
      try {
        return await initializing;
      } finally {
        initializing = null;
      }
    },

    async setSharingEnabled(next: boolean) {
      if (!next) {
        await stop();
        return false;
      }
      try {
        if (!(await sdk.setSharingPreference(true))) {
          throw new Error(
            "OpenJob could not persist the native diagnostics preference.",
          );
        }
        enabled = true;
        if (!initialized) enabled = await start();
        if (!enabled) await stopBestEffort();
        return enabled;
      } catch (error) {
        await stopBestEffort();
        throw error;
      }
    },

    triggerNativeCrashVerification() {
      if (
        !enabled ||
        !initialized ||
        !config?.diagnosticsVerificationEnabled ||
        config.environment === "production"
      ) {
        return false;
      }
      sdk.nativeCrash();
      return true;
    },
  };
}

export type NativeDiagnosticsController = ReturnType<
  typeof createNativeDiagnosticsController
>;

export function createNoopNativeDiagnosticsController(): NativeDiagnosticsController {
  let enabled = true;
  return {
    captureException: () => null,
    flush: async () => false,
    initialize: async () => enabled,
    isSharingEnabled: () => enabled,
    setSharingEnabled: async (next) => {
      enabled = next;
      return enabled;
    },
    triggerNativeCrashVerification: () => false,
  };
}
