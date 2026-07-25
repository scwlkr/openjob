type NativeStartupDependencies<AppComponent> = {
  initializeDiagnostics(): Promise<boolean>;
  loadApp(): Promise<{ default: AppComponent }>;
  registerRootComponent(component: AppComponent): void;
  reportFatal(error: Error): void;
  shouldTriggerStartupCrash(): Promise<boolean>;
};

type ErrorHandler = (error: Error, isFatal?: boolean) => void;

function normalizeStartupError(error: unknown): Error {
  return error instanceof Error ? error : new Error("OpenJob startup failed.");
}

export function reportNativeStartupFatal(error: Error): void {
  const errorUtils = (
    globalThis as typeof globalThis & {
      ErrorUtils?: { getGlobalHandler(): ErrorHandler | undefined };
    }
  ).ErrorUtils;
  const handler = errorUtils?.getGlobalHandler();
  if (!handler) throw error;
  handler(error, true);
}

export async function claimStartupCrashVerification({
  enabled,
  markerKey,
  readMarker,
  writeMarker,
}: {
  enabled: boolean;
  markerKey: string;
  readMarker(key: string): Promise<string | null>;
  writeMarker(key: string, value: string): Promise<void>;
}): Promise<boolean> {
  if (!enabled || (await readMarker(markerKey)) === "attempted") return false;
  await writeMarker(markerKey, "attempted");
  return true;
}

export async function startNativeApp<AppComponent>({
  initializeDiagnostics,
  loadApp,
  registerRootComponent,
  reportFatal,
  shouldTriggerStartupCrash,
}: NativeStartupDependencies<AppComponent>): Promise<void> {
  let verifyStartupCrash = false;
  try {
    verifyStartupCrash = await shouldTriggerStartupCrash();
  } catch {
    // A verification marker must never prevent normal startup.
  }
  if (verifyStartupCrash) {
    reportFatal(new Error("OpenJob guarded startup crash verification."));
    return;
  }

  try {
    await initializeDiagnostics();
  } catch {
    // Native bootstrap remains the fallback and app recovery must stay reachable.
  }

  try {
    const { default: App } = await loadApp();
    registerRootComponent(App);
  } catch (error) {
    reportFatal(normalizeStartupError(error));
  }
}
