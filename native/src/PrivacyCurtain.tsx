import { StyleSheet, Text, View } from "react-native";
import { OpenJobBrandmark, OpenJobWordmark } from "./brand-marks";
import { useAppLifecycle } from "./device-state";

export function PrivacyProtectedSurface({ children }: { children: React.ReactNode }) {
  const appState = useAppLifecycle();
  const protectedSnapshot = appState !== "active";

  return (
    <View style={styles.root}>
      <View
        accessibilityElementsHidden={protectedSnapshot}
        importantForAccessibility={
          protectedSnapshot ? "no-hide-descendants" : "auto"
        }
        style={styles.root}
      >
        {children}
      </View>
      {protectedSnapshot ? (
        <View
          accessibilityLabel="OpenJob privacy curtain"
          accessibilityRole="summary"
          style={styles.curtain}
          testID="openjob-privacy-curtain"
        >
          <OpenJobBrandmark inverse />
          <OpenJobWordmark inverse />
          <Text style={styles.message}>
            OpenJob is private in the app switcher.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  curtain: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: "#11141a",
    gap: 22,
    justifyContent: "center",
    padding: 32,
    zIndex: 10_000,
  },
  message: {
    color: "#aab2c3",
    fontFamily: "Geist_600SemiBold",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  root: {
    flex: 1,
  },
});
