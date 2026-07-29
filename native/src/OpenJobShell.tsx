import { Feather } from "@expo/vector-icons";
import {
  NavigationContainer,
  type NavigationState,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  K,
  type KeyboardFocus,
  type OnKeyPress,
} from "react-native-external-keyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  type AppearanceKeyboardAction,
  resolveAppearanceKey,
} from "./appearance-keyboard";
import { ReadOnlyTaskList } from "./ReadOnlyTaskList";
import type { OpenJobRuntimeConfig } from "./runtime-config";
import type { NativeTaskListController } from "./task-list-contracts";
import {
  type AppearancePreference,
  saveNavigationState,
} from "./storage";
import { useOpenJobTheme } from "./theme";
import { OpenJobWordmark } from "./brand-marks";
import { useControlInteraction } from "./use-control-interaction";

type RootStackParamList = {
  Shell: undefined;
  Appearance: undefined;
};

type ShellProps = NativeStackScreenProps<RootStackParamList, "Shell"> & {
  onRestoreSession: () => void;
  ownerUserId: string;
  reducedMotion: boolean;
  restoreReason?: "offline" | "unavailable";
  signedInUser: SignedInUser;
  sessionReady: boolean;
  taskListController: NativeTaskListController;
  runtimeConfig: OpenJobRuntimeConfig;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const appearancePreferences: AppearancePreference[] = [
  "system",
  "light",
  "dark",
];

type SignedInUser = {
  onManageSignInMethods?: () => void;
  onSessionRevoked: () => void;
  onSignOut: () => void;
  onSwitchUser: () => void;
};

type DiagnosticsSettings = {
  enabled: boolean;
  onCrashVerification: () => boolean;
  onSendVerification: () => Promise<boolean>;
  onSetEnabled: (enabled: boolean) => Promise<boolean>;
  verificationEnabled: boolean;
};

function Wordmark() {
  const { isDark } = useOpenJobTheme();
  return <OpenJobWordmark inverse={isDark} />;
}

function BuildBadge({ label }: { label: string }) {
  const { palette } = useOpenJobTheme();
  return (
    <View
      accessibilityLabel={`${label} build`}
      style={[
        styles.buildBadge,
        { backgroundColor: palette.blue, borderColor: palette.blue },
      ]}
    >
      <Text style={[styles.buildBadgeText, { color: palette.onBlue }]}>
        {label} build
      </Text>
    </View>
  );
}

function IconButton({
  accessibilityLabel,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
}) {
  const { palette } = useOpenJobTheme();
  const { focused, hovered, interactionProps } = useControlInteraction();

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      {...interactionProps}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor:
            pressed || hovered ? palette.card : "transparent",
          borderColor:
            focused || hovered ? palette.blue : palette.line,
          borderWidth: focused ? 3 : 1,
        },
      ]}
    >
      <Feather color={palette.ink} name={icon} size={21} />
    </Pressable>
  );
}

function ShellScreen({
  navigation,
  onRestoreSession,
  ownerUserId,
  reducedMotion,
  restoreReason,
  runtimeConfig,
  sessionReady,
  signedInUser,
  taskListController,
}: ShellProps) {
  const { fontScale, width } = useWindowDimensions();
  const { palette } = useOpenJobTheme();
  const compactHeader = width < 520;
  const largeTextHeader = compactHeader && fontScale >= 1.2;

  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <View
        style={[
          styles.topBar,
          compactHeader && styles.topBarCompact,
          { borderBottomColor: palette.ink },
        ]}
        testID="openjob-top-bar"
      >
        <Wordmark />
        <View
          style={[
            styles.topBarActions,
            compactHeader && styles.topBarActionsCompact,
            largeTextHeader && styles.topBarActionsLargeText,
          ]}
          testID="openjob-top-bar-actions"
        >
          {runtimeConfig.environmentBadge ? (
            <BuildBadge label={runtimeConfig.environmentBadge} />
          ) : null}
          <View
            style={[
              styles.topBarButtons,
              largeTextHeader && styles.topBarButtonsLargeText,
            ]}
            testID="openjob-top-bar-buttons"
          >
            {signedInUser.onManageSignInMethods ? (
              <IconButton
                accessibilityLabel="Manage Sign-in Methods"
                icon="link"
                onPress={signedInUser.onManageSignInMethods}
              />
            ) : null}
            <IconButton
              accessibilityLabel="Switch User"
              icon="repeat"
              onPress={signedInUser.onSwitchUser}
            />
            <IconButton
              accessibilityLabel="Sign out"
              icon="log-out"
              onPress={signedInUser.onSignOut}
            />
            <IconButton
              accessibilityLabel="Open appearance settings"
              icon="sliders"
              onPress={() => navigation.push("Appearance")}
            />
          </View>
        </View>
      </View>
      <ReadOnlyTaskList
        controller={taskListController}
        key={ownerUserId}
        onRestoreSession={onRestoreSession}
        onSessionRevoked={signedInUser.onSessionRevoked}
        ownerUserId={ownerUserId}
        reducedMotion={reducedMotion}
        restoreReason={restoreReason}
        sessionReady={sessionReady}
      />
    </SafeAreaView>
  );
}

function AppearanceOption({
  focusRef,
  isSelected,
  label,
  onKeyboardAction,
  onSelect,
  preference,
}: {
  focusRef: (instance: KeyboardFocus | null) => void;
  isSelected: boolean;
  label: string;
  onKeyboardAction: (
    preference: AppearancePreference,
    action: AppearanceKeyboardAction,
  ) => void;
  onSelect: (preference: AppearancePreference) => void;
  preference: AppearancePreference;
}) {
  const { palette } = useOpenJobTheme();
  const { focused, hovered, interactionProps } = useControlInteraction();

  return (
    <K.Pressable
      accessibilityLabel={`Use ${label.toLowerCase()} appearance`}
      accessibilityRole="radio"
      accessibilityState={{ checked: isSelected }}
      focusable={isSelected}
      onKeyDownPress={(event: OnKeyPress) => {
        const action = resolveAppearanceKey(
          Platform.OS,
          event.nativeEvent.keyCode,
        );
        if (action) onKeyboardAction(preference, action);
      }}
      onPress={() => onSelect(preference)}
      ref={focusRef}
      {...interactionProps}
      style={({ pressed }) => [
        styles.appearanceOption,
        {
          backgroundColor: isSelected
            ? hovered
              ? palette.blueStrong
              : palette.blue
            : pressed || hovered
              ? palette.background
              : palette.card,
          borderColor:
            focused || hovered || isSelected ? palette.blue : palette.line,
          borderWidth: focused ? 3 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.appearanceOptionText,
          { color: isSelected ? palette.onBlue : palette.ink },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.appearanceSelection,
          { color: isSelected ? palette.onBlue : palette.muted },
        ]}
      >
        {isSelected ? `${label} selected` : "Select"}
      </Text>
    </K.Pressable>
  );
}

function AppearanceScreen({
  diagnostics,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Appearance"> & {
  diagnostics: DiagnosticsSettings;
}) {
  const {
    palette,
    preference: selected,
    setPreference,
  } = useOpenJobTheme();
  const optionRefs = useRef<Record<AppearancePreference, KeyboardFocus | null>>({
    dark: null,
    light: null,
    system: null,
  });
  const pendingKeyboardFocus = useRef<AppearancePreference | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (pendingKeyboardFocus.current !== selected) return;
    const frame = requestAnimationFrame(() => {
      optionRefs.current[selected]?.keyboardFocus();
      pendingKeyboardFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [selected]);

  const handleKeyboardAction = (
    preference: AppearancePreference,
    action: AppearanceKeyboardAction,
  ) => {
    if (action === "escape") {
      navigation.goBack();
      return;
    }
    const direction = action === "next" ? 1 : -1;
    const currentIndex = appearancePreferences.indexOf(preference);
    const nextIndex =
      (currentIndex + direction + appearancePreferences.length) %
      appearancePreferences.length;
    const nextPreference = appearancePreferences[nextIndex]!;
    pendingKeyboardFocus.current = nextPreference;
    setPreference(nextPreference);
  };

  const toggleDiagnostics = async () => {
    const next = !diagnostics.enabled;
    setDiagnosticsBusy(true);
    setDiagnosticsStatus(null);
    try {
      const stored = await diagnostics.onSetEnabled(next);
      setDiagnosticsStatus(
        stored ? "Diagnostics are on." : "Diagnostics are off.",
      );
    } catch {
      if (!next) {
        setDiagnosticsStatus(
          "Diagnostics are off. Native cleanup was incomplete; try again.",
        );
      } else {
        setDiagnosticsStatus("Diagnostics remain off. Try again.");
      }
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  const sendVerification = async () => {
    setDiagnosticsBusy(true);
    setDiagnosticsStatus("Sending a scrubbed verification event…");
    try {
      const sent = await diagnostics.onSendVerification();
      setDiagnosticsStatus(
        sent
          ? "Scrubbed verification event queued. Confirm it in Sentry."
          : "Verification could not be sent. Nothing private was attached.",
      );
    } catch {
      setDiagnosticsStatus(
        "Verification could not be sent. Nothing private was attached.",
      );
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <View style={[styles.settingsHeader, { borderBottomColor: palette.ink }]}>
        <IconButton
          accessibilityLabel="Back to OpenJob"
          icon="arrow-left"
          onPress={() => navigation.goBack()}
        />
        <Wordmark />
      </View>
      <ScrollView contentContainerStyle={styles.settingsContent}>
        <Text style={[styles.kicker, { color: palette.blue }]}>APPEARANCE</Text>
        <Text
          accessibilityRole="header"
          style={[styles.settingsTitle, { color: palette.ink }]}
        >
          Appearance
        </Text>
        <Text style={[styles.settingsLede, { color: palette.muted }]}>
          System is the default. Your choice is restored on this device without
          storing credentials or Task data.
        </Text>
        <View
          accessibilityLabel="Appearance preference"
          accessibilityRole="radiogroup"
          style={styles.appearanceOptions}
        >
          {appearancePreferences.map((preference) => (
            <AppearanceOption
              focusRef={(instance) => {
                optionRefs.current[preference] = instance;
              }}
              isSelected={preference === selected}
              key={preference}
              label={`${preference[0]!.toUpperCase()}${preference.slice(1)}`}
              onKeyboardAction={handleKeyboardAction}
              onSelect={setPreference}
              preference={preference}
            />
          ))}
        </View>
        <View
          style={[styles.privacySection, { borderTopColor: palette.line }]}
        >
          <Text style={[styles.kicker, { color: palette.blue }]}>PRIVACY</Text>
          <Text style={[styles.privacyTitle, { color: palette.ink }]}>Diagnostics</Text>
          <Text style={[styles.settingsLede, { color: palette.muted }]}>
            Crashes and hangs only. OpenJob sends scrubbed technical versions,
            timing, OS version, coarse device class, and a safe operation name—
            never Task text, Group details, User identity, credentials, URLs,
            request bodies, screenshots, or a permanent device identity.
          </Text>
          <Pressable
            accessibilityLabel="Share diagnostics"
            accessibilityRole="switch"
            accessibilityState={{
              checked: diagnostics.enabled,
              disabled: diagnosticsBusy,
            }}
            disabled={diagnosticsBusy}
            onPress={() => void toggleDiagnostics()}
            style={({ pressed }) => [
              styles.diagnosticsSwitch,
              {
                backgroundColor: pressed ? palette.background : palette.card,
                borderColor: diagnostics.enabled ? palette.blue : palette.line,
              },
            ]}
          >
            <View style={styles.diagnosticsCopy}>
              <Text style={[styles.diagnosticsLabel, { color: palette.ink }]}>
                Share diagnostics
              </Text>
              <Text style={[styles.diagnosticsDetail, { color: palette.muted }]}>
                Crashes and hangs only
              </Text>
            </View>
            <Text style={[styles.diagnosticsValue, { color: palette.blue }]}>
              {diagnostics.enabled ? "On" : "Off"}
            </Text>
          </Pressable>
          {diagnosticsStatus ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.diagnosticsStatus, { color: palette.muted }]}
            >
              {diagnosticsStatus}
            </Text>
          ) : null}
          {diagnostics.verificationEnabled && diagnostics.enabled ? (
            <View style={styles.verificationActions}>
              <Pressable
                accessibilityLabel="Send diagnostic verification"
                accessibilityRole="button"
                disabled={diagnosticsBusy}
                onPress={() => void sendVerification()}
                style={({ pressed }) => [
                  styles.verificationButton,
                  {
                    backgroundColor: pressed ? palette.blueStrong : palette.blue,
                    borderColor: palette.blue,
                  },
                ]}
              >
                <Text style={[styles.verificationButtonText, { color: palette.onBlue }]}>
                  Send verification
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Crash this verification build"
                accessibilityRole="button"
                disabled={diagnosticsBusy}
                onPress={diagnostics.onCrashVerification}
                style={({ pressed }) => [
                  styles.verificationButton,
                  {
                    backgroundColor: pressed ? palette.background : palette.card,
                    borderColor: palette.line,
                  },
                ]}
              >
                <Text style={[styles.verificationButtonText, { color: palette.ink }]}>
                  Native crash verification
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function OpenJobShell({
  diagnostics,
  initialState,
  onRestoreSession,
  ownerUserId,
  reducedMotion,
  restoreReason,
  runtimeConfig,
  signedInUser,
  sessionReady,
  taskListController,
}: {
  diagnostics: DiagnosticsSettings;
  initialState: Parameters<typeof NavigationContainer>[0]["initialState"];
  onRestoreSession: () => void;
  ownerUserId: string;
  reducedMotion: boolean;
  restoreReason?: "offline" | "unavailable";
  runtimeConfig: OpenJobRuntimeConfig;
  signedInUser: SignedInUser;
  sessionReady: boolean;
  taskListController: NativeTaskListController;
}) {
  const { navigationTheme, palette } = useOpenJobTheme();
  const screenOptions = useMemo(
    () => ({
      animation: reducedMotion ? ("none" as const) : ("simple_push" as const),
      contentStyle: { backgroundColor: palette.background },
      headerShown: false,
    }),
    [palette.background, reducedMotion],
  );

  return (
    <NavigationContainer
      initialState={initialState}
      onStateChange={(state) => {
        if (state) void saveNavigationState(state as NavigationState);
      }}
      theme={navigationTheme}
    >
      <Stack.Navigator initialRouteName="Shell" screenOptions={screenOptions}>
        <Stack.Screen name="Shell">
          {(props) => (
            <ShellScreen
              {...props}
              onRestoreSession={onRestoreSession}
              ownerUserId={ownerUserId}
              reducedMotion={reducedMotion}
              restoreReason={restoreReason}
              runtimeConfig={runtimeConfig}
              sessionReady={sessionReady}
              signedInUser={signedInUser}
              taskListController={taskListController}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Appearance">
          {(props) => <AppearanceScreen {...props} diagnostics={diagnostics} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  appearanceOption: {
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 17,
  },
  appearanceOptionText: {
    fontFamily: "Geist_700Bold",
    fontSize: 16,
  },
  appearanceOptions: {
    gap: 10,
    marginTop: 32,
  },
  appearanceSelection: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 12,
  },
  diagnosticsDetail: {
    fontFamily: "Geist_400Regular",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  diagnosticsCopy: {
    flexShrink: 1,
    marginRight: 12,
  },
  diagnosticsLabel: {
    fontFamily: "Geist_700Bold",
    fontSize: 16,
  },
  diagnosticsStatus: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 13,
    lineHeight: 19,
  },
  diagnosticsSwitch: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  diagnosticsValue: {
    flexShrink: 0,
    fontFamily: "Geist_900Black",
    fontSize: 14,
    textTransform: "uppercase",
  },
  buildBadge: {
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 11,
  },
  buildBadgeText: {
    fontFamily: "Geist_700Bold",
    fontSize: 11,
    textTransform: "uppercase",
  },
  iconButton: {
    alignItems: "center",
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  kicker: {
    fontFamily: "Geist_700Bold",
    fontSize: 11,
    letterSpacing: 1.6,
  },
  privacySection: {
    borderTopWidth: 1,
    gap: 12,
    marginTop: 44,
    paddingTop: 36,
  },
  privacyTitle: {
    fontFamily: "Geist_900Black",
    fontSize: 32,
    letterSpacing: -1.3,
    lineHeight: 38,
  },
  safeArea: {
    flex: 1,
  },
  settingsContent: {
    alignSelf: "center",
    maxWidth: 680,
    padding: 24,
    paddingTop: 58,
    width: "100%",
  },
  settingsHeader: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 18,
    minHeight: 74,
    paddingHorizontal: 18,
  },
  settingsLede: {
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    lineHeight: 25,
    marginTop: 16,
  },
  settingsTitle: {
    fontFamily: "Geist_900Black",
    fontSize: 46,
    letterSpacing: -2.3,
    lineHeight: 50,
    marginTop: 10,
  },
  topBar: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 74,
    paddingHorizontal: 18,
  },
  topBarActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  topBarActionsCompact: {
    flexWrap: "wrap",
    justifyContent: "flex-end",
    width: "100%",
  },
  topBarActionsLargeText: {
    alignItems: "flex-start",
    flexDirection: "column",
    flexWrap: "nowrap",
    justifyContent: "flex-start",
  },
  topBarButtons: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  topBarButtonsLargeText: {
    flexWrap: "wrap",
    justifyContent: "flex-end",
    width: "100%",
  },
  topBarCompact: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: 12,
    paddingVertical: 12,
  },
  verificationActions: {
    gap: 10,
    marginTop: 4,
  },
  verificationButton: {
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  verificationButtonText: {
    fontFamily: "Geist_700Bold",
    fontSize: 14,
  },
});
