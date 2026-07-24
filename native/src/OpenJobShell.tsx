import { Feather } from "@expo/vector-icons";
import {
  NavigationContainer,
  type NavigationState,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import * as Updates from "expo-updates";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppLifecycle, useReducedMotion } from "./device-state";
import type { OpenJobRuntimeConfig } from "./runtime-config";
import type {
  OpenJobUser,
  SignInMethod,
} from "./auth/coordinator";
import {
  type AppearancePreference,
  saveNavigationState,
} from "./storage";
import { useOpenJobTheme } from "./theme";

type RootStackParamList = {
  Shell: undefined;
  Appearance: undefined;
};

type ShellProps = NativeStackScreenProps<RootStackParamList, "Shell"> & {
  signedInUser: SignedInUser;
  runtimeConfig: OpenJobRuntimeConfig;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

type SignedInUser = {
  methods: SignInMethod[];
  onManageSignInMethods: () => void;
  onSignOut: () => void;
  onSwitchUser: () => void;
  user: OpenJobUser;
};

export function confirmsEmbeddedBundle({
  isDevelopment,
  updatesEnabled,
  usingEmbeddedAssets,
}: {
  isDevelopment: boolean;
  updatesEnabled: boolean;
  usingEmbeddedAssets: boolean;
}) {
  return (
    !updatesEnabled && (!isDevelopment || usingEmbeddedAssets)
  );
}

function useControlInteraction() {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  return {
    focused,
    hovered,
    interactionProps: {
      onBlur: () => setFocused(false),
      onFocus: () => setFocused(true),
      onHoverIn: () => setHovered(true),
      onHoverOut: () => setHovered(false),
    },
  };
}

function Wordmark() {
  const { palette } = useOpenJobTheme();
  return (
    <View
      accessibilityLabel="OpenJob"
      accessibilityRole="header"
      style={styles.wordmark}
    >
      <Text style={[styles.wordmarkText, { color: palette.ink }]}>OPENJOB</Text>
      <View
        style={[
          styles.wordmarkPeriod,
          { backgroundColor: palette.wordmarkPeriod },
        ]}
        testID="openjob-wordmark-period"
      />
    </View>
  );
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

function StatusCard({
  detail,
  icon,
  title,
}: {
  detail: string;
  icon: keyof typeof Feather.glyphMap;
  title: string;
}) {
  const { palette } = useOpenJobTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${title}. ${detail}`}
      style={[
        styles.statusCard,
        { backgroundColor: palette.card, borderColor: palette.line },
      ]}
    >
      <View
        style={[styles.statusIcon, { backgroundColor: palette.background }]}
      >
        <Feather color={palette.blue} name={icon} size={20} />
      </View>
      <View style={styles.statusCopy}>
        <Text style={[styles.statusTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.statusDetail, { color: palette.muted }]}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

function ShellScreen({ navigation, runtimeConfig, signedInUser }: ShellProps) {
  const { width } = useWindowDimensions();
  const { palette } = useOpenJobTheme();
  const lifecycle = useAppLifecycle();
  const reducedMotion = useReducedMotion();
  const wide = width >= 720;
  const compactHeader = width < 520;
  const embeddedBundle = confirmsEmbeddedBundle({
    isDevelopment: __DEV__,
    updatesEnabled: Updates.isEnabled,
    usingEmbeddedAssets: Updates.isUsingEmbeddedAssets,
  });

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
          <IconButton
            accessibilityLabel="Manage Sign-in Methods"
            icon="link"
            onPress={signedInUser.onManageSignInMethods}
          />
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
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          wide && styles.scrollContentWide,
        ]}
      >
        <View style={[styles.hero, wide && styles.heroWide]}>
          <View style={styles.heroCopy}>
            <Text style={[styles.kicker, { color: palette.blue }]}>
              SIGNED IN
            </Text>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: palette.ink }]}
            >
              One clear list for your team.
            </Text>
            <Text style={[styles.lede, { color: palette.muted }]}>
              {`Signed in as ${
                signedInUser.user.username
                  ? `@${signedInUser.user.username}`
                  : signedInUser.user.userId
              }. Your User ID, Username, Groups, and Tasks stay anchored to one OpenJob User across ${signedInUser.methods
                .map((method) => method === "apple" ? "Apple" : "Google")
                .join(" and ")}.`}
            </Text>
          </View>
          <View
            style={[
              styles.foundationCard,
              {
                backgroundColor: palette.paper,
                borderColor: palette.ink,
                shadowColor: palette.blue,
              },
            ]}
          >
            <View style={styles.brandmark} accessibilityElementsHidden>
              <View
                style={[styles.brandmarkOuter, { backgroundColor: palette.ink }]}
              >
                <View
                  style={[
                    styles.brandmarkInner,
                    { backgroundColor: palette.paper },
                  ]}
                />
              </View>
              <View
                style={[styles.brandmarkDot, { backgroundColor: palette.blue }]}
              />
            </View>
            <Text style={[styles.cardKicker, { color: palette.muted }]}>
              SHARED TASK LIST
            </Text>
            <Text style={[styles.cardTitle, { color: palette.ink }]}>
              One User. Every linked Sign-in Method.
            </Text>
          </View>
        </View>
        <View style={[styles.statusGrid, wide && styles.statusGridWide]}>
          <StatusCard
            detail={
              embeddedBundle
                ? "Launches without update discovery"
                : "Release verification required"
            }
            icon="package"
            title="Embedded store bundle"
          />
          <StatusCard
            detail="No remote channel, URL, or signing metadata"
            icon="slash"
            title="OTA disabled"
          />
          <StatusCard
            detail="Domain behavior stays on the shared service"
            icon="link"
            title={`${runtimeConfig.apiBasePath} only`}
          />
          <StatusCard
            detail={lifecycle === "active" ? "Ready for work" : "Paused safely"}
            icon={lifecycle === "active" ? "activity" : "pause"}
            title="Lifecycle"
          />
          <StatusCard
            detail={reducedMotion ? "Reduced Motion on" : "System motion"}
            icon="wind"
            title="Motion"
          />
          <StatusCard
            detail={`OpenJob ${runtimeConfig.releaseVersion}`}
            icon="smartphone"
            title="Synchronized release"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AppearanceOption({
  label,
  preference,
}: {
  label: string;
  preference: AppearancePreference;
}) {
  const { palette, preference: selected, setPreference } = useOpenJobTheme();
  const isSelected = preference === selected;
  const { focused, hovered, interactionProps } = useControlInteraction();
  return (
    <Pressable
      accessibilityLabel={`Use ${label.toLowerCase()} appearance`}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      onPress={() => setPreference(preference)}
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
    </Pressable>
  );
}

function AppearanceScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Appearance">) {
  const { palette } = useOpenJobTheme();
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
        <View style={styles.appearanceOptions}>
          <AppearanceOption label="System" preference="system" />
          <AppearanceOption label="Light" preference="light" />
          <AppearanceOption label="Dark" preference="dark" />
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
}: {
  initialState: Parameters<typeof NavigationContainer>[0]["initialState"];
  reducedMotion: boolean;
  runtimeConfig: OpenJobRuntimeConfig;
  signedInUser: SignedInUser;
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
  brandmark: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 7,
    marginBottom: 52,
  },
  brandmarkDot: {
    height: 16,
    width: 16,
  },
  brandmarkInner: {
    height: 36,
    width: 36,
  },
  brandmarkOuter: {
    height: 68,
    padding: 16,
    width: 68,
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
  cardKicker: {
    fontFamily: "Geist_700Bold",
    fontSize: 10,
    letterSpacing: 1.2,
  },
  cardTitle: {
    fontFamily: "Geist_700Bold",
    fontSize: 24,
    letterSpacing: -0.8,
    lineHeight: 28,
    marginTop: 8,
  },
  foundationCard: {
    borderWidth: 1,
    flex: 1,
    minHeight: 320,
    padding: 26,
    shadowOffset: { height: 12, width: 12 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  hero: {
    gap: 44,
  },
  heroCopy: {
    flex: 1.25,
    justifyContent: "center",
  },
  heroWide: {
    alignItems: "stretch",
    flexDirection: "row",
    minHeight: 450,
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
  lede: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 27,
    marginTop: 20,
    maxWidth: 580,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    gap: 52,
    paddingBottom: 44,
    paddingHorizontal: 20,
    paddingTop: 44,
  },
  scrollContentWide: {
    alignSelf: "center",
    maxWidth: 1180,
    paddingHorizontal: 38,
    width: "100%",
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
  statusCard: {
    alignItems: "center",
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 14,
    minHeight: 98,
    minWidth: 230,
    padding: 15,
  },
  statusCopy: {
    flex: 1,
    gap: 4,
  },
  statusDetail: {
    fontFamily: "Geist_400Regular",
    fontSize: 12,
    lineHeight: 17,
  },
  statusGrid: {
    gap: 10,
  },
  statusGridWide: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  statusIcon: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  statusTitle: {
    fontFamily: "Geist_700Bold",
    fontSize: 14,
  },
  title: {
    fontFamily: "Geist_900Black",
    fontSize: 54,
    letterSpacing: -3,
    lineHeight: 57,
    marginTop: 12,
    maxWidth: 620,
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
  wordmark: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 3,
  },
  wordmarkPeriod: {
    height: 6,
    marginBottom: 4,
    width: 6,
  },
  wordmarkText: {
    fontFamily: "Geist_900Black",
    fontSize: 18,
    letterSpacing: -1.2,
  },
});
