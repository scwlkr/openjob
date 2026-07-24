import Constants from "expo-constants";

export type OpenJobEnvironment = "development" | "preview" | "production";

export type OpenJobRuntimeConfig = {
  apiBasePath: "/api/v1";
  apiBaseUrl: string;
  appleRedirectUri: string;
  appleServiceId: string;
  environment: OpenJobEnvironment;
  environmentBadge: "Development" | "Preview" | null;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  googleIosClientId: string;
  googleWebClientId: string;
  keychainService: string;
  releaseVersion: string;
  sessionStorageKey: string;
};

function isEnvironment(value: unknown): value is OpenJobEnvironment {
  return (
    value === "development" ||
    value === "preview" ||
    value === "production"
  );
}

export function readRuntimeConfig(): OpenJobRuntimeConfig {
  const openjob = Constants.expoConfig?.extra?.openjob;
  if (
    !openjob ||
    openjob.apiBasePath !== "/api/v1" ||
    typeof openjob.apiBaseUrl !== "string" ||
    !openjob.apiBaseUrl.endsWith("/api/v1") ||
    typeof openjob.appleRedirectUri !== "string" ||
    typeof openjob.appleServiceId !== "string" ||
    !isEnvironment(openjob.environment) ||
    typeof openjob.firebaseApiKey !== "string" ||
    typeof openjob.firebaseAuthDomain !== "string" ||
    typeof openjob.googleIosClientId !== "string" ||
    typeof openjob.googleWebClientId !== "string" ||
    typeof openjob.keychainService !== "string" ||
    typeof openjob.sessionStorageKey !== "string" ||
    typeof openjob.releaseVersion !== "string"
  ) {
    throw new Error("OpenJob native configuration is incomplete.");
  }

  const expectedBadge =
    openjob.environment === "development"
      ? "Development"
      : openjob.environment === "preview"
        ? "Preview"
        : null;
  if (
    (expectedBadge === null && openjob.environmentBadge != null) ||
    (expectedBadge !== null && openjob.environmentBadge !== expectedBadge)
  ) {
    throw new Error("OpenJob native environment badge is inconsistent.");
  }

  return {
    apiBasePath: "/api/v1",
    apiBaseUrl: openjob.apiBaseUrl,
    appleRedirectUri: openjob.appleRedirectUri,
    appleServiceId: openjob.appleServiceId,
    environment: openjob.environment,
    environmentBadge: expectedBadge,
    firebaseApiKey: openjob.firebaseApiKey,
    firebaseAuthDomain: openjob.firebaseAuthDomain,
    googleIosClientId: openjob.googleIosClientId,
    googleWebClientId: openjob.googleWebClientId,
    keychainService: openjob.keychainService,
    releaseVersion: openjob.releaseVersion,
    sessionStorageKey: openjob.sessionStorageKey,
  };
}
