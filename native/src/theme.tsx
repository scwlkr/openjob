import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { useColorScheme } from "react-native";
import type { Theme as NavigationTheme } from "@react-navigation/native";
import type { AppearancePreference } from "./storage";

export type OpenJobPalette = {
  background: string;
  blue: string;
  blueStrong: string;
  card: string;
  ink: string;
  line: string;
  muted: string;
  paper: string;
  wordmarkPeriod: string;
};

const lightPalette: OpenJobPalette = {
  background: "#eef0ea",
  blue: "#1e4ed8",
  blueStrong: "#153caf",
  card: "#f8f8f3",
  ink: "#151713",
  line: "#c6cac1",
  muted: "#62675e",
  paper: "#ffffff",
  wordmarkPeriod: "#6387ff",
};

const darkPalette: OpenJobPalette = {
  background: "#11141a",
  blue: "#6387ff",
  blueStrong: "#86a1ff",
  card: "#1a2030",
  ink: "#f4f5ef",
  line: "#3a4358",
  muted: "#aab2c3",
  paper: "#151b28",
  wordmarkPeriod: "#6387ff",
};

type ThemeContextValue = {
  isDark: boolean;
  navigationTheme: NavigationTheme;
  palette: OpenJobPalette;
  preference: AppearancePreference;
  setPreference: (preference: AppearancePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function OpenJobThemeProvider({
  children,
  preference,
  setPreference,
}: PropsWithChildren<{
  preference: AppearancePreference;
  setPreference: (preference: AppearancePreference) => void;
}>) {
  const systemAppearance = useColorScheme();
  const isDark =
    preference === "dark" ||
    (preference === "system" && systemAppearance === "dark");
  const palette = isDark ? darkPalette : lightPalette;
  const value = useMemo<ThemeContextValue>(
    () => ({
      isDark,
      navigationTheme: {
        dark: isDark,
        colors: {
          background: palette.background,
          border: palette.line,
          card: palette.card,
          notification: palette.blue,
          primary: palette.blue,
          text: palette.ink,
        },
        fonts: {
          bold: {
            fontFamily: "Geist_700Bold",
            fontWeight: "700",
          },
          heavy: {
            fontFamily: "Geist_900Black",
            fontWeight: "900",
          },
          medium: {
            fontFamily: "Geist_600SemiBold",
            fontWeight: "600",
          },
          regular: {
            fontFamily: "Geist_400Regular",
            fontWeight: "400",
          },
        },
      },
      palette,
      preference,
      setPreference,
    }),
    [isDark, palette, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useOpenJobTheme(): ThemeContextValue {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("OpenJob theme is unavailable.");
  return theme;
}
