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
          qaPasswordTenantId: null,
          releaseVersion: "0.3.3",
          sessionStorageKey: "openjob.native.auth.production.v1",
        },
      },
    },
  },
}));

import Constants from "expo-constants";
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
    qaPasswordTenantId: null,
    releaseVersion: "0.3.3",
    sessionStorageKey: "openjob.native.auth.production.v1",
  });
});

test("accepts the exact Preview QA tenant and rejects it in every other environment", () => {
  const openjob = Constants.expoConfig?.extra?.openjob as Record<
    string,
    unknown
  >;
  const original = { ...openjob };

  try {
    Object.assign(openjob, {
      environment: "preview",
      environmentBadge: "Preview",
      qaPasswordTenantId: "OpenJob-QA-Two-mvz9m",
    });
    expect(readRuntimeConfig()).toMatchObject({
      environment: "preview",
      qaPasswordTenantId: "OpenJob-QA-Two-mvz9m",
    });

    openjob.qaPasswordTenantId = null;
    expect(() => readRuntimeConfig()).toThrow(
      "OpenJob native configuration is incomplete.",
    );

    Object.assign(openjob, {
      environment: "development",
      environmentBadge: "Development",
      qaPasswordTenantId: "OpenJob-QA-Two-mvz9m",
    });
    expect(() => readRuntimeConfig()).toThrow(
      "OpenJob native configuration is incomplete.",
    );
  } finally {
    for (const key of Object.keys(openjob)) delete openjob[key];
    Object.assign(openjob, original);
  }
});
