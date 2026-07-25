import AsyncStorage from "@react-native-async-storage/async-storage";
import { registerRootComponent as registerExpoRootComponent } from "expo";
import * as SplashScreen from "expo-splash-screen";
import {
  createElement,
  useEffect,
  useState,
  type ComponentType,
} from "react";
import {
  nativeDiagnosticsController,
  sentryNativeDiagnosticsSdk,
} from "./src/diagnostics-native";
import {
  readNativeBinaryVersion,
  readRuntimeConfig,
  type OpenJobRuntimeConfig,
} from "./src/runtime-config";
import {
  claimStartupCrashVerification,
  reportNativeStartupFatal,
  startNativeApp,
} from "./src/startup";

let runtimeConfig: OpenJobRuntimeConfig | null = null;
function getRuntimeConfig(): OpenJobRuntimeConfig {
  runtimeConfig ??= readRuntimeConfig();
  return runtimeConfig;
}

void SplashScreen.preventAutoHideAsync();

function NativeStartupRoot() {
  const [AppComponent, setAppComponent] =
    useState<ComponentType | null>(null);

  useEffect(() => {
    let mounted = true;
    void startNativeApp<ComponentType>({
      initializeDiagnostics: () =>
        nativeDiagnosticsController.initialize(getRuntimeConfig()),
      loadApp: () => import("./App"),
      registerRootComponent: (component) => {
        if (mounted) setAppComponent(() => component);
      },
      reportFatal: reportNativeStartupFatal,
      shouldTriggerStartupCrash: async () => {
        const config = getRuntimeConfig();
        if (!config.diagnosticsStartupCrashVerificationEnabled) return false;
        const diagnosticsSharingEnabled =
          await sentryNativeDiagnosticsSdk.getSharingPreference();
        const { buildVersion } = readNativeBinaryVersion();
        return claimStartupCrashVerification({
          enabled: diagnosticsSharingEnabled,
          markerKey: `${config.sessionStorageKey}.startup-crash.${config.releaseVersion}.${buildVersion ?? "unknown"}`,
          readMarker: (key) => AsyncStorage.getItem(key),
          writeMarker: (key, value) => AsyncStorage.setItem(key, value),
        });
      },
    });
    return () => {
      mounted = false;
    };
  }, []);

  return AppComponent ? createElement(AppComponent) : null;
}

registerExpoRootComponent(NativeStartupRoot);
