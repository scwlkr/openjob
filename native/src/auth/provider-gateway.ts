import {
  appleAuth,
  appleAuthAndroid,
} from "@invertase/react-native-apple-authentication";
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import {
  type ProviderCredential,
  ProviderSignInError,
  type SignInMethod,
} from "./coordinator";

type ProviderGatewayConfig = {
  appleRedirectUri: string;
  appleServiceId: string;
  googleIosClientId: string;
  googleWebClientId: string;
};

export type ProviderNativeModules = {
  appleAndroid: {
    configure(options: {
      clientId: string;
      nonce: string;
      redirectUri: string;
      responseType: string;
      scope: string;
      state: string;
    }): void;
    errorCancelled: string;
    isSupported: boolean;
    responseTypeAll: string;
    scopeAll: string;
    signIn(): Promise<{ idToken?: string }>;
  };
  appleIos: {
    errorCancelled: string;
    isSupported: boolean;
    onCredentialRevoked(listener: () => void): () => void;
    operationLogin: number;
    performRequest(options: {
      nonce: string;
      requestedOperation: number;
      requestedScopes: never[];
      state: string;
    }): Promise<{ identityToken?: string | null }>;
  };
  google: {
    configure(options: {
      iosClientId: string;
      offlineAccess: false;
      scopes: never[];
      webClientId: string;
    }): void;
    errorCancelled: string;
    errorInProgress: string;
    errorPlayServices: string;
    hasPlayServices(): Promise<boolean>;
    signIn(): Promise<
      { kind: "cancelled" } | { idToken?: string | null; kind: "success" }
    >;
    signOut(): Promise<void>;
  };
  platform: "android" | "ios";
  randomUuid(): string;
};

function defaultNativeModules(): ProviderNativeModules {
  return {
    appleAndroid: {
      configure: (options) =>
        appleAuthAndroid.configure(
          options as Parameters<typeof appleAuthAndroid.configure>[0],
        ),
      errorCancelled: appleAuthAndroid.Error.SIGNIN_CANCELLED,
      isSupported: appleAuthAndroid.isSupported,
      responseTypeAll: appleAuthAndroid.ResponseType.ALL,
      scopeAll: appleAuthAndroid.Scope.ALL,
      signIn: async () => {
        const response = await appleAuthAndroid.signIn();
        return { idToken: response.id_token };
      },
    },
    appleIos: {
      errorCancelled: appleAuth.Error.CANCELED,
      isSupported: appleAuth.isSupported,
      onCredentialRevoked: (listener) =>
        appleAuth.onCredentialRevoked(listener) ?? (() => undefined),
      operationLogin: appleAuth.Operation.LOGIN,
      performRequest: (options) => appleAuth.performRequest(options),
    },
    google: {
      configure: (options) => GoogleSignin.configure(options),
      errorCancelled: statusCodes.SIGN_IN_CANCELLED,
      errorInProgress: statusCodes.IN_PROGRESS,
      errorPlayServices: statusCodes.PLAY_SERVICES_NOT_AVAILABLE,
      hasPlayServices: () =>
        GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true }),
      signIn: async () => {
        const response = await GoogleSignin.signIn();
        if (!isSuccessResponse(response)) return { kind: "cancelled" };
        return {
          idToken: response.data.idToken,
          kind: "success",
        };
      },
      signOut: async () => {
        await GoogleSignin.signOut();
      },
    },
    platform: Platform.OS === "ios" ? "ios" : "android",
    randomUuid: () => Crypto.randomUUID(),
  };
}

function errorCode(error: unknown) {
  if (isErrorWithCode(error)) return error.code;
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

function requiredToken(value: string | null | undefined) {
  if (!value) throw new ProviderSignInError("unavailable");
  return value;
}

export function createProviderGateway(
  config: ProviderGatewayConfig,
  native = defaultNativeModules(),
) {
  let googleConfigured = false;
  let clearBeforeGoogleSignIn = false;

  function configureGoogle() {
    if (googleConfigured) return;
    native.google.configure({
      iosClientId: config.googleIosClientId,
      offlineAccess: false,
      scopes: [],
      webClientId: config.googleWebClientId,
    });
    googleConfigured = true;
  }

  async function signInWithGoogle(): Promise<ProviderCredential> {
    configureGoogle();
    try {
      if (clearBeforeGoogleSignIn) {
        await native.google.signOut();
        clearBeforeGoogleSignIn = false;
      }
      if (
        native.platform === "android" &&
        !(await native.google.hasPlayServices())
      ) {
        throw new ProviderSignInError("unavailable");
      }
      const response = await native.google.signIn();
      if (response.kind === "cancelled") {
        throw new ProviderSignInError("cancelled");
      }
      return {
        idToken: requiredToken(response.idToken),
        provider: "google",
      };
    } catch (error) {
      if (error instanceof ProviderSignInError) throw error;
      const code = errorCode(error);
      if (code === native.google.errorCancelled) {
        throw new ProviderSignInError("cancelled");
      }
      if (code === native.google.errorInProgress) {
        throw new ProviderSignInError("interrupted");
      }
      if (code === native.google.errorPlayServices) {
        throw new ProviderSignInError("unavailable");
      }
      throw new ProviderSignInError("unavailable");
    }
  }

  async function signInWithApple(): Promise<ProviderCredential> {
    const nonce = native.randomUuid();
    const state = native.randomUuid();
    try {
      if (native.platform === "ios") {
        if (!native.appleIos.isSupported) {
          throw new ProviderSignInError("unavailable");
        }
        const response = await native.appleIos.performRequest({
          nonce,
          requestedOperation: native.appleIos.operationLogin,
          requestedScopes: [],
          state,
        });
        return {
          idToken: requiredToken(response.identityToken),
          nonce,
          provider: "apple",
        };
      }

      if (!native.appleAndroid.isSupported) {
        throw new ProviderSignInError("unavailable");
      }
      native.appleAndroid.configure({
        clientId: config.appleServiceId,
        nonce,
        redirectUri: config.appleRedirectUri,
        responseType: native.appleAndroid.responseTypeAll,
        scope: native.appleAndroid.scopeAll,
        state,
      });
      const response = await native.appleAndroid.signIn();
      return {
        idToken: requiredToken(response.idToken),
        nonce,
        provider: "apple",
      };
    } catch (error) {
      if (error instanceof ProviderSignInError) throw error;
      const code = errorCode(error);
      const cancelled =
        native.platform === "ios"
          ? native.appleIos.errorCancelled
          : native.appleAndroid.errorCancelled;
      if (code === cancelled) throw new ProviderSignInError("cancelled");
      throw new ProviderSignInError("unavailable");
    }
  }

  return {
    async clearSession() {
      configureGoogle();
      clearBeforeGoogleSignIn = true;
      await native.google.signOut();
      clearBeforeGoogleSignIn = false;
    },
    signIn(provider: SignInMethod) {
      return provider === "google"
        ? signInWithGoogle()
        : signInWithApple();
    },
    subscribeToCredentialRevocation(listener: () => void) {
      return native.platform === "ios" && native.appleIos.isSupported
        ? native.appleIos.onCredentialRevoked(listener)
        : () => undefined;
    },
  };
}
