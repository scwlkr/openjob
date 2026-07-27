import { readFileSync } from "node:fs";

const identities = JSON.parse(
  readFileSync(new URL("../config/native-identities.json", import.meta.url), "utf8"),
);
const rootPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const releasePrivacy = JSON.parse(
  readFileSync(
    new URL(
      "../config/generated/native-privacy.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const names = {
  development: "OpenJob Dev",
  preview: "OpenJob Preview",
  production: "OpenJob",
};
const environmentBadges = {
  development: "Development",
  preview: "Preview",
  production: null,
};
const sentrySlugPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

function optionalEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function isPublicSentryDsn(value) {
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

function readDiagnosticsDsn() {
  const dsn = optionalEnvironmentValue("EXPO_PUBLIC_SENTRY_DSN");
  if (!dsn) return null;
  if (!isPublicSentryDsn(dsn)) {
    throw new Error(
      "EXPO_PUBLIC_SENTRY_DSN must be a valid HTTPS Sentry DSN.",
    );
  }
  return dsn;
}

function sentryPluginOptions() {
  const organization = optionalEnvironmentValue("SENTRY_ORG");
  const project = optionalEnvironmentValue("SENTRY_PROJECT");
  for (const [name, value] of [
    ["SENTRY_ORG", organization],
    ["SENTRY_PROJECT", project],
  ]) {
    if (value && !sentrySlugPattern.test(value)) {
      throw new Error(`${name} must be a valid Sentry slug.`);
    }
  }
  if (Boolean(organization) !== Boolean(project)) {
    throw new Error("SENTRY_ORG and SENTRY_PROJECT must be set together.");
  }
  return {
    experimental_android: {
      autoUploadNativeSymbols: true,
      autoUploadProguardMapping: true,
      dexguardEnabled: false,
      enableAndroidGradlePlugin: true,
      includeNativeSources: false,
      includeProguardMapping: true,
      includeSourceContext: false,
      uploadNativeSymbols: true,
    },
    ...(organization ? { organization } : {}),
    ...(project ? { project } : {}),
    url: "https://sentry.io/",
  };
}

function assertInventoryControlledConfiguration(config) {
  const declaredAndroidPermissions = new Set(
    releasePrivacy.nativeConfiguration.android.permissions,
  );
  const declaredAndroidBlockedPermissions = new Set(
    releasePrivacy.nativeConfiguration.android.blockedPermissions,
  );
  const declaredIosEntitlements =
    releasePrivacy.nativeConfiguration.ios.entitlements;

  for (const permission of config.android?.permissions ?? []) {
    if (!declaredAndroidPermissions.has(permission)) {
      throw new Error(
        `${permission} is not declared by the Release Privacy Inventory.`,
      );
    }
  }
  for (const permission of config.android?.blockedPermissions ?? []) {
    if (!declaredAndroidBlockedPermissions.has(permission)) {
      throw new Error(
        `${permission} is not declared by the Release Privacy Inventory.`,
      );
    }
  }
  for (const [key, value] of Object.entries(config.ios?.entitlements ?? {})) {
    if (!Object.hasOwn(declaredIosEntitlements, key)) {
      throw new Error(
        `${key} is not declared by the Release Privacy Inventory.`,
      );
    }
    if (JSON.stringify(value) !== JSON.stringify(declaredIosEntitlements[key])) {
      throw new Error(
        `${key} manually diverges from the Release Privacy Inventory.`,
      );
    }
  }
  if (
    config.ios?.privacyManifests &&
    JSON.stringify(config.ios.privacyManifests) !==
      JSON.stringify(releasePrivacy.applePrivacyManifest)
  ) {
    throw new Error(
      "The authored Apple privacy manifest manually diverges from the Release Privacy Inventory.",
    );
  }
  if (
    config.ios?.usesAppleSignIn !== undefined &&
    config.ios.usesAppleSignIn !==
      releasePrivacy.nativeConfiguration.ios.usesAppleSignIn
  ) {
    throw new Error(
      "usesAppleSignIn manually diverges from the Release Privacy Inventory.",
    );
  }
}

export default function createAppConfig({ config = {} } = {}) {
  assertInventoryControlledConfiguration(config);
  const environment = process.env.OPENJOB_NATIVE_ENV ?? "development";
  const identity = identities.environments[environment];
  if (!identity) {
    throw new Error(`Unsupported OpenJob native environment: ${environment}`);
  }
  const diagnosticsDsn = readDiagnosticsDsn();
  const diagnosticsVerificationEnabled =
    environment === "preview" &&
    diagnosticsDsn !== null &&
    process.env.OPENJOB_DIAGNOSTICS_VERIFICATION === "1";
  const diagnosticsStartupCrashVerificationEnabled =
    diagnosticsVerificationEnabled &&
    process.env.OPENJOB_DIAGNOSTICS_STARTUP_CRASH_VERIFICATION === "1";

  return {
    ...config,
    name: names[environment],
    slug: identities.expo.slug,
    owner: identities.expo.account,
    version: rootPackage.version,
    platforms: ["ios", "android"],
    orientation: "default",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    icon: "../public/icon-512.png",
    scheme: identity.auth.appScheme,
    plugins: [
      ["@sentry/react-native/expo", sentryPluginOptions()],
      "./plugins/with-sentry-android-privacy.cjs",
      "expo-font",
      [
        "expo-secure-store",
        {
          configureAndroidBackup: true,
          faceIDPermission:
            releasePrivacy.nativeConfiguration.plugins["expo-secure-store"]
              .faceIDPermission,
        },
      ],
      ["expo-sqlite", { useSQLCipher: true }],
      [
        "@react-native-google-signin/google-signin",
        {
          iosUrlScheme: identity.ios.googleReversedClientId,
        },
      ],
      "./plugins/with-ios-scene-lifecycle.cjs",
      "./plugins/with-google-signin-modular-headers.cjs",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#eef0ea",
          dark: {
            backgroundColor: "#11141a",
            image: "../public/icon-512.png",
          },
          image: "../public/icon-512.png",
          imageWidth: 156,
          resizeMode: "contain",
        },
      ],
    ],
    ios: {
      ...config.ios,
      bundleIdentifier: identity.ios.bundleId,
      entitlements: {
        ...config.ios?.entitlements,
        ...releasePrivacy.nativeConfiguration.ios.entitlements,
      },
      googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST,
      infoPlist: {
        ...config.ios?.infoPlist,
        ITSAppUsesNonExemptEncryption: false,
        OpenJobSentryDSN: diagnosticsDsn ?? "",
        OpenJobSentryEnvironment: environment,
      },
      privacyManifests: releasePrivacy.applePrivacyManifest,
      supportsTablet: true,
      usesAppleSignIn:
        releasePrivacy.nativeConfiguration.ios.usesAppleSignIn,
    },
    android: {
      ...config.android,
      adaptiveIcon: {
        backgroundColor: "#eef0ea",
        foregroundImage: "../public/icon-maskable-512.png",
        monochromeImage: "../public/icon-maskable-512.png",
      },
      blockedPermissions: [
        ...new Set([
          ...releasePrivacy.nativeConfiguration.android.blockedPermissions,
          ...(config.android?.blockedPermissions ?? []),
        ]),
      ],
      permissions: [
        ...new Set([
          ...releasePrivacy.nativeConfiguration.android.permissions,
          ...(config.android?.permissions ?? []),
        ]),
      ],
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
      package: identity.android.applicationId,
    },
    updates: {
      checkAutomatically: "NEVER",
      enabled: identities.delivery.updates.enabled,
      useEmbeddedUpdate: true,
    },
    extra: {
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        projectId: identities.expo.projectId,
      },
      openjobEnvironment: environment,
      openjob: {
        apiBasePath: "/api/v1",
        apiBaseUrl: identity.api.baseUrl,
        appleRedirectUri: identity.auth.firebaseHandlerUrl,
        appleServiceId:
          identities.apple.signInServices[identity.tier].serviceId,
        diagnosticsDsn: diagnosticsDsn ?? "",
        diagnosticsStartupCrashVerificationEnabled,
        diagnosticsVerificationEnabled,
        environment,
        firebaseApiKey: identity.firebase.apiKey,
        firebaseAuthDomain: identity.firebase.authDomain,
        googleIosClientId: identity.ios.googleClientId,
        googleWebClientId: identity.firebase.googleWebClientId,
        ...(environmentBadges[environment]
          ? { environmentBadge: environmentBadges[environment] }
          : {}),
        keychainService: `${identity.ios.bundleId}.auth`,
        qaPasswordTenantId:
          environment === "preview"
            ? identity.firebase.qaPasswordTenantId
            : null,
        releasePrivacy: {
          inventoryFingerprint:
            releasePrivacy.metadata.inventoryFingerprint,
          inventorySchemaVersion:
            releasePrivacy.metadata.inventorySchemaVersion,
          inventoryVersion: releasePrivacy.metadata.inventoryVersion,
        },
        releaseVersion: rootPackage.version,
        sessionStorageKey: `openjob.native.auth.${environment}.v1`,
      },
    },
  };
}
