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
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import { OpenJobShell } from "./src/OpenJobShell";
import { PrivacyProtectedSurface } from "./src/PrivacyCurtain";
import { OpenJobBrandmark, OpenJobWordmark } from "./src/brand-marks";
import {
  NativeAuthGate,
  type NativeAuthController,
} from "./src/auth/AuthGate";
import {
  createNativeAuthController,
  purgeNativeAuthStateWithoutRuntimeConfig,
} from "./src/auth/dependencies";
import {
  type NativeDiagnosticsController,
} from "./src/diagnostics";
import { nativeDiagnosticsController } from "./src/diagnostics-native";
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

type BootstrapState = {
  appearance: AppearancePreference;
  diagnosticsEnabled: boolean;
  navigationState: InitialState | undefined;
};

type AppDiagnosticsSettings = {
  enabled: boolean;
  onCrashVerification: () => boolean;
  onSendVerification: () => Promise<boolean>;
  onSetEnabled: (enabled: boolean) => Promise<boolean>;
  verificationEnabled: boolean;
};

function BootstrapRecovery({
  busy,
  message,
  onDisableDiagnostics,
  onRetry,
  onSignOut,
}: {
  busy: boolean;
  message: string | null;
  onDisableDiagnostics: () => void;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <PrivacyProtectedSurface>
      <SafeAreaView style={bootstrapStyles.safeArea}>
        <View
          accessibilityLabel="OpenJob could not start safely"
          accessibilityRole="alert"
          accessible
          style={bootstrapStyles.card}
        >
          <OpenJobBrandmark inverse={false} />
          <OpenJobWordmark inverse={false} />
          <Text style={bootstrapStyles.title}>OpenJob could not start safely</Text>
          <Text style={bootstrapStyles.body}>
            Your data was not changed. Retry startup, or sign out safely before
            trying again.
          </Text>
          {message ? <Text style={bootstrapStyles.status}>{message}</Text> : null}
          <View style={bootstrapStyles.actions}>
            <Pressable
              accessibilityLabel="Retry OpenJob"
              accessibilityRole="button"
              disabled={busy}
              onPress={onRetry}
              style={bootstrapStyles.primaryButton}
            >
              <Text style={bootstrapStyles.primaryButtonText}>Retry</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Sign out safely"
              accessibilityRole="button"
              disabled={busy}
              onPress={onSignOut}
              style={bootstrapStyles.secondaryButton}
            >
              <Text style={bootstrapStyles.secondaryButtonText}>Sign out</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Stop sharing diagnostics"
              accessibilityRole="button"
              disabled={busy}
              onPress={onDisableDiagnostics}
              style={bootstrapStyles.secondaryButton}
            >
              <Text style={bootstrapStyles.secondaryButtonText}>
                Stop sharing diagnostics
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </PrivacyProtectedSurface>
  );
}

function AuthDiagnosticsSetting({
  diagnostics,
}: {
  diagnostics: AppDiagnosticsSettings;
}) {
  const { palette } = useOpenJobTheme();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const toggle = async () => {
    const next = !diagnostics.enabled;
    setBusy(true);
    setStatus(null);
    try {
      const stored = await diagnostics.onSetEnabled(next);
      setStatus(stored ? "Diagnostics are on." : "Diagnostics are off.");
    } catch {
      setStatus(
        next
          ? "Diagnostics remain off. Try again."
          : "Diagnostics are off. Native cleanup was incomplete; try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[
        bootstrapStyles.authDiagnostics,
        { borderTopColor: palette.line },
      ]}
    >
      <Text style={[bootstrapStyles.authDiagnosticsTitle, { color: palette.ink }]}>
        Diagnostics
      </Text>
      <Text style={[bootstrapStyles.authDiagnosticsBody, { color: palette.muted }]}>
        Crashes and hangs only. No Task content or identity.
      </Text>
      <Pressable
        accessibilityLabel="Share diagnostics"
        accessibilityRole="switch"
        accessibilityState={{ checked: diagnostics.enabled, disabled: busy }}
        disabled={busy}
        onPress={() => void toggle()}
        style={({ pressed }) => [
          bootstrapStyles.authDiagnosticsSwitch,
          {
            backgroundColor: pressed ? palette.background : palette.card,
            borderColor: diagnostics.enabled ? palette.blue : palette.line,
          },
        ]}
      >
        <Text style={[bootstrapStyles.authDiagnosticsLabel, { color: palette.ink }]}>
          Share diagnostics
        </Text>
        <Text style={[bootstrapStyles.authDiagnosticsValue, { color: palette.blue }]}>
          {diagnostics.enabled ? "On" : "Off"}
        </Text>
      </Pressable>
      {status ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[bootstrapStyles.authDiagnosticsBody, { color: palette.muted }]}
        >
          {status}
        </Text>
      ) : null}
    </View>
  );
}

function AppSurface({
  authController,
  bootstrap,
  diagnosticsController,
  runtimeConfig,
}: {
  authController?: NativeAuthController;
  bootstrap: BootstrapState;
  diagnosticsController: NativeDiagnosticsController;
  runtimeConfig: OpenJobRuntimeConfig;
}) {
  const [appearance, setAppearance] = useState(bootstrap.appearance);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(
    bootstrap.diagnosticsEnabled,
  );
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
        authController={authController}
        bootstrap={bootstrap}
        diagnostics={{
          enabled: diagnosticsEnabled,
          onCrashVerification: () =>
            diagnosticsController.triggerNativeCrashVerification(),
          onSendVerification: async () => {
            const captured = diagnosticsController.captureException(
              new Error("OpenJob diagnostic verification"),
              { operation: "diagnostic_verification" },
            );
            return captured ? diagnosticsController.flush() : false;
          },
          onSetEnabled: async (enabled) => {
            try {
              return await diagnosticsController.setSharingEnabled(enabled);
            } finally {
              setDiagnosticsEnabled(
                diagnosticsController.isSharingEnabled(),
              );
            }
          },
          verificationEnabled: runtimeConfig.diagnosticsVerificationEnabled,
        }}
        reducedMotion={reducedMotion}
        runtimeConfig={runtimeConfig}
      />
    </OpenJobThemeProvider>
  );
}

function ThemedSurface({
  authController,
  bootstrap,
  diagnostics,
  reducedMotion,
  runtimeConfig,
}: {
  authController?: NativeAuthController;
  bootstrap: BootstrapState;
  diagnostics: AppDiagnosticsSettings;
  reducedMotion: boolean;
  runtimeConfig: OpenJobRuntimeConfig;
}) {
  const { isDark } = useOpenJobTheme();
  return (
    <PrivacyProtectedSurface>
      <StatusBar style={isDark ? "light" : "dark"} />
      <NativeAuthGate
        controller={authController}
        diagnosticsSetting={
          <AuthDiagnosticsSetting diagnostics={diagnostics} />
        }
        renderSignedIn={({
          onManageSignInMethods,
          onRestoreSession,
          onSessionRevoked,
          onSignOut,
          onSwitchUser,
          result,
          restoreReason,
          sessionReady,
          taskListController,
        }) => (
          <OpenJobShell
            diagnostics={diagnostics}
            signedInUser={{
              onManageSignInMethods,
              onSessionRevoked,
              onSignOut,
              onSwitchUser,
            }}
            initialState={bootstrap.navigationState}
            onRestoreSession={onRestoreSession}
            ownerUserId={result.user.userId}
            reducedMotion={reducedMotion}
            runtimeConfig={runtimeConfig}
            restoreReason={restoreReason}
            taskListController={taskListController}
            sessionReady={sessionReady}
          />
        )}
        runtimeConfig={runtimeConfig}
      />
    </PrivacyProtectedSurface>
  );
}

export function OpenJobNativeApp({
  authController,
  diagnosticsController = nativeDiagnosticsController,
  runtimeConfig: providedRuntimeConfig,
}: {
  authController?: NativeAuthController;
  diagnosticsController?: NativeDiagnosticsController;
  runtimeConfig?: OpenJobRuntimeConfig;
}) {
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_600SemiBold,
    Geist_700Bold,
    Geist_900Black,
  });
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  const [bootstrapMessage, setBootstrapMessage] = useState<string | null>(null);
  const [discoveredRuntimeConfig, setDiscoveredRuntimeConfig] =
    useState<OpenJobRuntimeConfig | null>(() => {
      if (providedRuntimeConfig) return providedRuntimeConfig;
      try {
        return readRuntimeConfig();
      } catch {
        return null;
      }
    });
  const runtimeConfig = providedRuntimeConfig ?? discoveredRuntimeConfig;

  useEffect(() => {
    let mounted = true;
    void (async () => {
      if (!runtimeConfig) {
        await Promise.resolve();
        if (mounted) {
          setBootstrap(null);
          setBootstrapFailed(true);
        }
        return;
      }
      try {
        const [appearance, navigationState, diagnosticsEnabled] =
          await Promise.all([
            loadAppearance(),
            loadNavigationState(),
            diagnosticsController.initialize(runtimeConfig),
          ]);
        if (mounted) {
          setBootstrap({ appearance, diagnosticsEnabled, navigationState });
          setBootstrapFailed(false);
          setBootstrapMessage(null);
        }
      } catch {
        if (mounted) setBootstrapFailed(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [bootstrapAttempt, diagnosticsController, runtimeConfig]);

  const ready =
    (fontsLoaded || Boolean(fontError)) &&
    (bootstrap !== null || bootstrapFailed);
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  if (bootstrapFailed || !bootstrap || !runtimeConfig) {
    const disableDiagnostics = async () => {
      setBootstrapBusy(true);
      setBootstrapMessage(null);
      try {
        await diagnosticsController.setSharingEnabled(false);
        setBootstrapMessage("Diagnostics are off.");
      } catch {
        setBootstrapMessage(
          diagnosticsController.isSharingEnabled()
            ? "Diagnostics could not be turned off. Retry it."
            : "Diagnostics are off. Native cleanup was incomplete; retry it.",
        );
      } finally {
        setBootstrapBusy(false);
      }
    };
    const signOutSafely = async () => {
      setBootstrapBusy(true);
      setBootstrapMessage(null);
      try {
        let signedOut = true;
        if (authController) {
          signedOut = (await authController.signOut()).kind === "signed-out";
        } else if (runtimeConfig) {
          signedOut =
            (await createNativeAuthController(runtimeConfig).signOut()).kind ===
            "signed-out";
        } else {
          await purgeNativeAuthStateWithoutRuntimeConfig();
        }
        setBootstrapMessage(
          signedOut
            ? "Signed out safely."
            : "Sign out cleanup is incomplete. Retry it.",
        );
      } catch {
        setBootstrapMessage("Sign out could not finish. Retry it.");
      } finally {
        setBootstrapBusy(false);
      }
    };
    return (
      <SafeAreaProvider>
        <BootstrapRecovery
          busy={bootstrapBusy}
          message={bootstrapMessage}
          onDisableDiagnostics={() => void disableDiagnostics()}
          onRetry={() => {
            setBootstrap(null);
            setBootstrapMessage(null);
            if (!providedRuntimeConfig) {
              try {
                setDiscoveredRuntimeConfig(readRuntimeConfig());
              } catch {
                setDiscoveredRuntimeConfig(null);
              }
            }
            setBootstrapAttempt((attempt) => attempt + 1);
          }}
          onSignOut={() => void signOutSafely()}
        />
      </SafeAreaProvider>
    );
  }
  return (
    <SafeAreaProvider>
      <AppSurface
        authController={authController}
        bootstrap={bootstrap}
        diagnosticsController={diagnosticsController}
        runtimeConfig={runtimeConfig}
      />
    </SafeAreaProvider>
  );
}

export default function App() {
  return <OpenJobNativeApp />;
}

const bootstrapStyles = StyleSheet.create({
  authDiagnostics: {
    borderTopWidth: 1,
    gap: 10,
    marginTop: 18,
    paddingTop: 18,
    width: "100%",
  },
  authDiagnosticsBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  authDiagnosticsLabel: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "700",
    marginRight: 12,
  },
  authDiagnosticsSwitch: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  authDiagnosticsTitle: {
    fontSize: 18,
    fontWeight: "900",
  },
  authDiagnosticsValue: {
    flexShrink: 0,
    fontSize: 14,
    fontWeight: "900",
  },
  actions: {
    gap: 12,
    marginTop: 8,
    width: "100%",
  },
  body: {
    color: "#62675e",
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  card: {
    alignItems: "center",
    backgroundColor: "#f8f8f3",
    borderColor: "#c6cac1",
    borderWidth: 1,
    gap: 18,
    maxWidth: 480,
    padding: 28,
    width: "100%",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#1e4ed8",
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  safeArea: {
    alignItems: "center",
    backgroundColor: "#eef0ea",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#1e4ed8",
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: "#1e4ed8",
    fontSize: 16,
    fontWeight: "700",
  },
  status: {
    color: "#62675e",
    fontSize: 14,
    fontWeight: "600",
  },
  title: {
    color: "#151713",
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 34,
    textAlign: "center",
  },
});
