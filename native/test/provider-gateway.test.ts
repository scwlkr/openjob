import { GoogleSignin } from "@react-native-google-signin/google-signin";
import {
  clearNativeProviderSessionWithoutConfiguration,
  createProviderGateway,
  type ProviderNativeModules,
} from "../src/auth/provider-gateway";
import { ProviderSignInError } from "../src/auth/coordinator";

const config = {
  appleIosClientId: "dev.openjob.app.preview",
  appleRedirectUri:
    "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
  appleServiceId: "dev.openjob.auth.nonprod",
  googleIosClientId: "ios-client.apps.googleusercontent.com",
  googleWebClientId: "web-client.apps.googleusercontent.com",
};

function nativeModules(
  overrides: Partial<ProviderNativeModules> = {},
): ProviderNativeModules & {
  appleAndroid: ProviderNativeModules["appleAndroid"] & {
    configure: jest.Mock;
    signIn: jest.Mock;
  };
  appleIos: ProviderNativeModules["appleIos"] & {
    performRequest: jest.Mock;
  };
  google: ProviderNativeModules["google"] & {
    configure: jest.Mock;
    hasPlayServices: jest.Mock;
    signIn: jest.Mock;
    signOut: jest.Mock;
  };
  randomUuid: jest.Mock;
} {
  return {
    appleAndroid: {
      configure: jest.fn(),
      errorCancelled: "APPLE_CANCELLED",
      isSupported: true,
      onCredentialRevoked: jest.fn(() => () => undefined),
      responseTypeAll: "ALL",
      scopeAll: "ALL",
      signIn: jest.fn(async () => ({
        authorizationCode: "apple-android-code",
        idToken: "apple-android-id",
      })),
    },
    appleIos: {
      errorCancelled: "1001",
      isSupported: true,
      operationLogin: 1,
      performRequest: jest.fn(async () => ({
        authorizationCode: "apple-ios-code",
        identityToken: "apple-ios-id",
      })),
    },
    google: {
      configure: jest.fn(),
      errorCancelled: "GOOGLE_CANCELLED",
      errorInProgress: "GOOGLE_IN_PROGRESS",
      errorPlayServices: "GOOGLE_PLAY_SERVICES",
      hasPlayServices: jest.fn(async () => true),
      getTokens: jest.fn(async () => ({ accessToken: "google-access" })),
      signIn: jest.fn(async () => ({
        idToken: "google-id",
        kind: "success" as const,
      })),
      signOut: jest.fn(async () => undefined),
    },
    platform: "ios",
    randomUuid: jest
      .fn()
      .mockReturnValueOnce("raw-nonce")
      .mockReturnValueOnce("csrf-state"),
    ...overrides,
  } as unknown as ProviderNativeModules & {
    appleAndroid: ProviderNativeModules["appleAndroid"] & {
      configure: jest.Mock;
      signIn: jest.Mock;
    };
    appleIos: ProviderNativeModules["appleIos"] & {
      performRequest: jest.Mock;
    };
    google: ProviderNativeModules["google"] & {
      configure: jest.Mock;
      hasPlayServices: jest.Mock;
      signIn: jest.Mock;
      signOut: jest.Mock;
    };
    randomUuid: jest.Mock;
  };
}

test("constructs the iOS gateway without an Android Apple native module", () => {
  expect(() => createProviderGateway(config)).not.toThrow();
});

test("configures the native Google client before bootstrap cleanup", async () => {
  await clearNativeProviderSessionWithoutConfiguration();

  expect(GoogleSignin.configure).toHaveBeenCalledWith({
    offlineAccess: false,
    scopes: [],
  });
  expect(
    (GoogleSignin.configure as jest.Mock).mock.invocationCallOrder[0],
  ).toBeLessThan(
    (GoogleSignin.signOut as jest.Mock).mock.invocationCallOrder[0]!,
  );
});

test("hands Google system UI output to Firebase without profile or email data", async () => {
  const native = nativeModules();
  const gateway = createProviderGateway(config, native);

  await expect(gateway.signIn("google")).resolves.toEqual({
    idToken: "google-id",
    provider: "google",
    revocation: {
      idToken: "google-id",
      kind: "access_token",
      value: "google-access",
    },
  });
  expect(native.google.configure).toHaveBeenCalledWith({
    iosClientId: "ios-client.apps.googleusercontent.com",
    offlineAccess: false,
    scopes: [],
    webClientId: "web-client.apps.googleusercontent.com",
  });
  expect(native.google.signIn).toHaveBeenCalledTimes(1);
});

test("uses native Apple authorization on iOS with a raw replay nonce", async () => {
  const native = nativeModules();
  const gateway = createProviderGateway(config, native);

  await expect(gateway.signIn("apple")).resolves.toEqual({
    idToken: "apple-ios-id",
    nonce: "raw-nonce",
    provider: "apple",
    revocation: {
      clientId: "dev.openjob.app.preview",
      idToken: "apple-ios-id",
      kind: "authorization_code",
      value: "apple-ios-code",
    },
  });
  expect(native.appleIos.performRequest).toHaveBeenCalledWith({
    nonce: "raw-nonce",
    requestedOperation: 1,
    requestedScopes: [],
    state: "csrf-state",
  });
});

test("clears the Google SDK session before OpenJob sign-out or User switching", async () => {
  const native = nativeModules();
  const gateway = createProviderGateway(config, native);

  await gateway.clearSession();

  expect(native.google.configure).toHaveBeenCalledTimes(1);
  expect(native.google.signOut).toHaveBeenCalledTimes(1);
});

test("reports Google SDK cleanup failure so OpenJob can block sign-out", async () => {
  const native = nativeModules();
  native.google.signOut.mockRejectedValueOnce(
    new Error("Google session is still active"),
  );
  const gateway = createProviderGateway(config, native);

  await expect(gateway.clearSession()).rejects.toThrow(
    "Google session is still active",
  );
  await gateway.signIn("google");
  expect(native.google.signOut).toHaveBeenCalledTimes(2);
});

test("uses the registered Apple Service ID and exact HTTPS return URL on Android", async () => {
  const native = nativeModules({ platform: "android" });
  const gateway = createProviderGateway(config, native);

  await expect(gateway.signIn("apple")).resolves.toEqual({
    idToken: "apple-android-id",
    nonce: "raw-nonce",
    provider: "apple",
    revocation: {
      clientId: "dev.openjob.auth.nonprod",
      idToken: "apple-android-id",
      kind: "authorization_code",
      redirectUri:
        "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
      value: "apple-android-code",
    },
  });
  expect(native.appleAndroid.configure).toHaveBeenCalledWith({
    clientId: "dev.openjob.auth.nonprod",
    nonce: "raw-nonce",
    redirectUri:
      "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
    responseType: "ALL",
    scope: "ALL",
    state: "csrf-state",
  });
});

test("normalizes cancellation, interruption, and provider unavailability", async () => {
  for (const [code, expected] of [
    ["GOOGLE_CANCELLED", "cancelled"],
    ["GOOGLE_IN_PROGRESS", "interrupted"],
    ["GOOGLE_PLAY_SERVICES", "unavailable"],
  ] as const) {
    const native = nativeModules();
    native.google.signIn.mockRejectedValueOnce(Object.assign(new Error(), { code }));
    await expect(
      createProviderGateway(config, native).signIn("google"),
    ).rejects.toEqual(new ProviderSignInError(expected));
  }

  const cancelledApple = nativeModules({ platform: "android" });
  cancelledApple.appleAndroid.signIn.mockRejectedValueOnce(
    Object.assign(new Error(), { code: "APPLE_CANCELLED" }),
  );
  await expect(
    createProviderGateway(config, cancelledApple).signIn("apple"),
  ).rejects.toEqual(new ProviderSignInError("cancelled"));
});
