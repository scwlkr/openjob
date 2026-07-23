import { readFileSync } from "node:fs";

const identities = JSON.parse(
  readFileSync(new URL("../config/native-identities.json", import.meta.url), "utf8"),
);
const rootPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
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

export default function createAppConfig({ config = {} } = {}) {
  const environment = process.env.OPENJOB_NATIVE_ENV ?? "development";
  const identity = identities.environments[environment];
  if (!identity) {
    throw new Error(`Unsupported OpenJob native environment: ${environment}`);
  }

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
      "expo-font",
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
      googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST,
      supportsTablet: true,
    },
    android: {
      ...config.android,
      adaptiveIcon: {
        backgroundColor: "#eef0ea",
        foregroundImage: "../public/icon-maskable-512.png",
        monochromeImage: "../public/icon-maskable-512.png",
      },
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
        environment,
        ...(environmentBadges[environment]
          ? { environmentBadge: environmentBadges[environment] }
          : {}),
        releaseVersion: rootPackage.version,
      },
    },
  };
}
