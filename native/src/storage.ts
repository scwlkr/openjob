import AsyncStorage from "@react-native-async-storage/async-storage";
import type { InitialState, NavigationState } from "@react-navigation/native";

export type AppearancePreference = "system" | "light" | "dark";

const appearanceKey = "openjob.native.appearance.v1";
const navigationKey = "openjob.native.navigation.v1";
const allowedRoutes = new Set(["Shell", "Appearance"]);

export async function loadAppearance(): Promise<AppearancePreference> {
  try {
    const value = await AsyncStorage.getItem(appearanceKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export async function saveAppearance(
  preference: AppearancePreference,
): Promise<void> {
  await AsyncStorage.setItem(appearanceKey, preference);
}

export async function loadNavigationState(): Promise<InitialState | undefined> {
  try {
    const value = await AsyncStorage.getItem(navigationKey);
    if (!value) return undefined;
    const state = JSON.parse(value) as InitialState;
    if (
      !Array.isArray(state.routes) ||
      state.routes.some((route) => !allowedRoutes.has(route.name))
    ) {
      return undefined;
    }
    return state;
  } catch {
    return undefined;
  }
}

export async function saveNavigationState(
  state: NavigationState,
): Promise<void> {
  await AsyncStorage.setItem(navigationKey, JSON.stringify(state));
}
