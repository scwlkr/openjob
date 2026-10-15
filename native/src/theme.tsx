import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { useColorScheme } from "react-native";
import type { Theme as NavigationTheme } from "@react-navigation/native";
import type { AppearancePreference } from "./storage";
import { brandDark, brandLight } from "./brand-tokens";

// Semantic colors are generated from docs/brand/tokens.css for both clients.
export type OpenJobPalette = {
  action: string;
  actionHover: string;
  actionText: string;
  background: string;
  card: string;
  controlLine: string;
  focus: string;
  ink: string;
  line: string;
  link: string;
  muted: string;
  paper: string;
  positive: string;
  positiveFill: string;
  selected: string;
  selectedText: string;
};

function paletteFromBrand(brand: typeof brandLight | typeof brandDark): OpenJobPalette {
  return {
    action: brand.action,
    actionHover: brand.actionHover,
    actionText: brand.actionText,
    background: brand.surface,
    card: brand.panel,
    controlLine: brand.controlLine,
    focus: brand.focus,
    ink: brand.text,
    line: brand.line,
    link: brand.link,
    muted: brand.muted,
    paper: brand.panel,
    positive: brand.positive,
    positiveFill: brand.positiveFill,
    selected: brand.selected,
    selectedText: brand.selectedText,
  };
}

const lightPalette = paletteFromBrand(brandLight);
const darkPalette = paletteFromBrand(brandDark);

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
          notification: palette.action,
          primary: palette.link,
          text: palette.ink,
        },
        fonts: {
          bold: {
            fontFamily: "Inter_700Bold",
            fontWeight: "700",
          },
          heavy: {
            fontFamily: "Inter_700Bold",
            fontWeight: "700",
          },
          medium: {
            fontFamily: "Inter_600SemiBold",
            fontWeight: "600",
          },
          regular: {
            fontFamily: "Inter_400Regular",
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
