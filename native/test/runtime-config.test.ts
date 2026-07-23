jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        openjob: {
          apiBasePath: "/api/v1",
          apiBaseUrl: "https://openjob.dev/api/v1",
          appleRedirectUri:
            "https://openjob-dev.firebaseapp.com/__/auth/handler",
          appleServiceId: "dev.openjob.auth",
          environment: "production",
          firebaseApiKey: "public-key",
          firebaseAuthDomain: "openjob-dev.firebaseapp.com",
          googleIosClientId: "ios.apps.googleusercontent.com",
          googleWebClientId: "web.apps.googleusercontent.com",
          keychainService: "dev.openjob.app.auth",
          releaseVersion: "0.3.3",
          sessionStorageKey: "openjob.native.auth.production.v1",
        },
      },
    },
  },
}));

import { readRuntimeConfig } from "../src/runtime-config";

test("normalizes an omitted production badge from the embedded manifest", () => {
  expect(readRuntimeConfig()).toEqual({
    apiBasePath: "/api/v1",
    apiBaseUrl: "https://openjob.dev/api/v1",
    appleRedirectUri:
      "https://openjob-dev.firebaseapp.com/__/auth/handler",
    appleServiceId: "dev.openjob.auth",
    environment: "production",
    environmentBadge: null,
    firebaseApiKey: "public-key",
    firebaseAuthDomain: "openjob-dev.firebaseapp.com",
    googleIosClientId: "ios.apps.googleusercontent.com",
    googleWebClientId: "web.apps.googleusercontent.com",
    keychainService: "dev.openjob.app.auth",
    releaseVersion: "0.3.3",
    sessionStorageKey: "openjob.native.auth.production.v1",
  });
});
