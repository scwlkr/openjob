import { Feather } from "@expo/vector-icons";
import {
  NavigationContainer,
  type NavigationState,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef } from "react";
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
  signedInUser: SignedInUser;
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
  runtimeConfig,
  signedInUser,
  taskListController,
}: ShellProps) {
  const { width } = useWindowDimensions();
  const { palette } = useOpenJobTheme();
  const compactHeader = width < 520;

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
          ]}
          testID="openjob-top-bar-actions"
        >
          {runtimeConfig.environmentBadge ? (
            <BuildBadge label={runtimeConfig.environmentBadge} />
          ) : null}
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
      <ReadOnlyTaskList
        controller={taskListController}
        onSessionRevoked={signedInUser.onSessionRevoked}
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
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Appearance">) {
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
      </ScrollView>
    </SafeAreaView>
  );
}

export function OpenJobShell({
  initialState,
  reducedMotion,
  runtimeConfig,
  signedInUser,
  taskListController,
}: {
  initialState: Parameters<typeof NavigationContainer>[0]["initialState"];
  reducedMotion: boolean;
  runtimeConfig: OpenJobRuntimeConfig;
  signedInUser: SignedInUser;
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
              runtimeConfig={runtimeConfig}
              signedInUser={signedInUser}
              taskListController={taskListController}
            />
          )}
        </Stack.Screen>
        <Stack.Screen component={AppearanceScreen} name="Appearance" />
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
  topBarCompact: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: 12,
    paddingVertical: 12,
  },
});
