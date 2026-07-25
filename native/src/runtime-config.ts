import Constants from "expo-constants";
import { Platform } from "react-native";

export type OpenJobEnvironment = "development" | "preview" | "production";

export type OpenJobRuntimeConfig = {
  apiBasePath: "/api/v1";
  apiBaseUrl: string;
  appleRedirectUri: string;
  appleServiceId: string;
  diagnosticsDsn: string | null;
  diagnosticsStartupCrashVerificationEnabled: boolean;
  diagnosticsVerificationEnabled: boolean;
  environment: OpenJobEnvironment;
  environmentBadge: "Development" | "Preview" | null;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  googleIosClientId: string;
  googleWebClientId: string;
  keychainService: string;
  qaPasswordTenantId: string | null;
  releaseVersion: string;
  sessionStorageKey: string;
};

const TENANT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]{3,63}$/u;

export function readNativeApplicationId(): string | null {
  const applicationId =
    Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.bundleIdentifier
      : Platform.OS === "android"
        ? Constants.expoConfig?.android?.package
        : undefined;
  return typeof applicationId === "string" && applicationId.length > 0
    ? applicationId
    : null;
}

export function readNativeBinaryVersion(): {
  appVersion: string;
  buildVersion: string | null;
} {
  const appVersion = Constants.expoConfig?.version;
  const rawBuildVersion =
    Platform.OS === "ios"
      ? Constants.platform?.ios?.buildNumber
      : Platform.OS === "android"
        ? Constants.platform?.android?.versionCode
        : null;
  return {
    appVersion:
      typeof appVersion === "string" && appVersion.length > 0
        ? appVersion
        : "unknown",
    buildVersion:
      typeof rawBuildVersion === "string" ||
      typeof rawBuildVersion === "number"
        ? String(rawBuildVersion)
        : null,
  };
}

function isEnvironment(value: unknown): value is OpenJobEnvironment {
  return (
    value === "development" ||
    value === "preview" ||
    value === "production"
  );
}

function isPublicSentryDsn(value: string): boolean {
  try {
    const dsn = new URL(value);
    return (
      dsn.protocol === "https:" &&
      dsn.username.length > 0 &&
      dsn.password.length === 0 &&
      dsn.hostname.length > 0 &&
      /^\/\d+$/u.test(dsn.pathname) &&
      dsn.search.length === 0 &&
      dsn.hash.length === 0
    );
  } catch {
    return false;
  }
}

function normalizeDiagnosticsDsn(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && isPublicSentryDsn(value)) return value;
  throw new Error("OpenJob native configuration is incomplete.");
}

export function readRuntimeConfig(): OpenJobRuntimeConfig {
  const openjob = Constants.expoConfig?.extra?.openjob;
  const diagnosticsDsn = normalizeDiagnosticsDsn(openjob?.diagnosticsDsn);
  if (
    !openjob ||
    openjob.apiBasePath !== "/api/v1" ||
    typeof openjob.apiBaseUrl !== "string" ||
    !openjob.apiBaseUrl.endsWith("/api/v1") ||
    typeof openjob.appleRedirectUri !== "string" ||
    typeof openjob.appleServiceId !== "string" ||
    typeof openjob.diagnosticsStartupCrashVerificationEnabled !== "boolean" ||
    typeof openjob.diagnosticsVerificationEnabled !== "boolean" ||
    (openjob.diagnosticsStartupCrashVerificationEnabled &&
      !openjob.diagnosticsVerificationEnabled) ||
    (openjob.environment === "production" &&
      openjob.diagnosticsVerificationEnabled) ||
    !isEnvironment(openjob.environment) ||
    typeof openjob.firebaseApiKey !== "string" ||
    typeof openjob.firebaseAuthDomain !== "string" ||
    typeof openjob.googleIosClientId !== "string" ||
    typeof openjob.googleWebClientId !== "string" ||
    typeof openjob.keychainService !== "string" ||
    !(
      (openjob.environment === "preview" &&
        typeof openjob.qaPasswordTenantId === "string" &&
        TENANT_ID_PATTERN.test(openjob.qaPasswordTenantId)) ||
      (openjob.environment !== "preview" &&
        openjob.qaPasswordTenantId === null)
    ) ||
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
    diagnosticsDsn,
    diagnosticsStartupCrashVerificationEnabled:
      openjob.diagnosticsStartupCrashVerificationEnabled,
    diagnosticsVerificationEnabled: openjob.diagnosticsVerificationEnabled,
    environment: openjob.environment,
    environmentBadge: expectedBadge,
    firebaseApiKey: openjob.firebaseApiKey,
    firebaseAuthDomain: openjob.firebaseAuthDomain,
    googleIosClientId: openjob.googleIosClientId,
    googleWebClientId: openjob.googleWebClientId,
    keychainService: openjob.keychainService,
    qaPasswordTenantId: openjob.qaPasswordTenantId,
    releaseVersion: openjob.releaseVersion,
    sessionStorageKey: openjob.sessionStorageKey,
  };
}
