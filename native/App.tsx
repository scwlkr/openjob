import {
  Geist_400Regular,
  Geist_600SemiBold,
  Geist_700Bold,
  Geist_900Black,
  useFonts,
} from "@expo-google-fonts/geist";
import type { InitialState } from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OpenJobShell } from "./src/OpenJobShell";
import { useReducedMotion } from "./src/device-state";
import {
  readRuntimeConfig,
  type OpenJobRuntimeConfig,
} from "./src/runtime-config";
import {
  type AppearancePreference,
  loadAppearance,
  loadNavigationState,
  saveAppearance,
} from "./src/storage";
import { OpenJobThemeProvider, useOpenJobTheme } from "./src/theme";

void SplashScreen.preventAutoHideAsync();

type BootstrapState = {
  appearance: AppearancePreference;
  navigationState: InitialState | undefined;
};

function AppSurface({
  bootstrap,
  runtimeConfig,
}: {
  bootstrap: BootstrapState;
  runtimeConfig: OpenJobRuntimeConfig;
}) {
  const [appearance, setAppearance] = useState(bootstrap.appearance);
  const reducedMotion = useReducedMotion();
  const selectAppearance = useCallback((next: AppearancePreference) => {
    setAppearance(next);
    void saveAppearance(next);
  }, []);

  return (
    <OpenJobThemeProvider
      preference={appearance}
      setPreference={selectAppearance}
    >
      <ThemedSurface
        bootstrap={bootstrap}
        reducedMotion={reducedMotion}
        runtimeConfig={runtimeConfig}
      />
    </OpenJobThemeProvider>
  );
}

function ThemedSurface({
  bootstrap,
  reducedMotion,
  runtimeConfig,
}: {
  bootstrap: BootstrapState;
  reducedMotion: boolean;
  runtimeConfig: OpenJobRuntimeConfig;
}) {
  const { isDark } = useOpenJobTheme();
  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <OpenJobShell
        initialState={bootstrap.navigationState}
        reducedMotion={reducedMotion}
        runtimeConfig={runtimeConfig}
      />
    </>
  );
}

export function OpenJobNativeApp({
  runtimeConfig = readRuntimeConfig(),
}: {
  runtimeConfig?: OpenJobRuntimeConfig;
}) {
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_600SemiBold,
    Geist_700Bold,
    Geist_900Black,
  });
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);

  useEffect(() => {
    let mounted = true;
    void Promise.all([loadAppearance(), loadNavigationState()]).then(
      ([appearance, navigationState]) => {
        if (mounted) setBootstrap({ appearance, navigationState });
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  const ready = (fontsLoaded || Boolean(fontError)) && bootstrap !== null;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready || !bootstrap) return null;
  return (
    <SafeAreaProvider>
      <AppSurface bootstrap={bootstrap} runtimeConfig={runtimeConfig} />
    </SafeAreaProvider>
  );
}

export default function App() {
  return <OpenJobNativeApp />;
}
