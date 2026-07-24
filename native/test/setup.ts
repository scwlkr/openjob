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

jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({ type: "cancelled" })),
    signOut: jest.fn(async () => undefined),
  },
  isErrorWithCode: (error: unknown) =>
    Boolean(error && typeof error === "object" && "code" in error),
  isSuccessResponse: (response: { type?: string }) =>
    response.type === "success",
  statusCodes: {
    IN_PROGRESS: "IN_PROGRESS",
    PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
    SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED",
  },
}));

jest.mock("@invertase/react-native-apple-authentication", () => ({
  appleAuth: {
    Error: { CANCELED: "1001" },
    isSupported: true,
    Operation: { LOGIN: 1 },
    performRequest: jest.fn(),
    Scope: { EMAIL: 0, FULL_NAME: 1 },
  },
  // The package exports an empty object when its Android native module is
  // unavailable, including on iOS.
  appleAuthAndroid: {},
}));
