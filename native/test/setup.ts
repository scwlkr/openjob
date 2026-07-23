import mockAsyncStorage from "@react-native-async-storage/async-storage/jest/async-storage-mock";

jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage);
jest.mock("react-native-safe-area-context", () => {
  const mock = jest.requireActual("react-native-safe-area-context/jest/mock");
  return mock.default;
});

jest.mock("@expo-google-fonts/geist", () => ({
  Geist_400Regular: 400,
  Geist_600SemiBold: 600,
  Geist_700Bold: 700,
  Geist_900Black: 900,
  useFonts: () => [true, null],
}));

jest.mock("expo-splash-screen", () => ({
  hideAsync: jest.fn(async () => undefined),
  preventAutoHideAsync: jest.fn(async () => undefined),
}));

jest.mock("expo-updates", () => ({
  channel: "",
  isEmbeddedLaunch: false,
  isEnabled: false,
  isUsingEmbeddedAssets: true,
  updateId: null,
}));
