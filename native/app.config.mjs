import { readFileSync } from "node:fs";

const identities = JSON.parse(
  readFileSync(new URL("../config/native-identities.json", import.meta.url), "utf8"),
);
const names = {
  development: "OpenJob Dev",
  preview: "OpenJob Preview",
  production: "OpenJob",
};

export default function createAppConfig({ config = {} } = {}) {
  const environment = process.env.OPENJOB_NATIVE_ENV ?? "development";
  const identity = identities.environments[environment];
  if (!identity) {
    throw new Error(`Unsupported OpenJob native environment: ${environment}`);
  }
  const trustTier =
    identity.tier === "production" ? "production" : "nonproduction";
  const updateTrust = identities.trust.updateSigning[trustTier];

  return {
    ...config,
    name: names[environment],
    slug: identities.expo.slug,
    owner: identities.expo.account,
    scheme: identity.auth.appScheme,
    ios: {
      ...config.ios,
      bundleIdentifier: identity.ios.bundleId,
      googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST,
    },
    android: {
      ...config.android,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
      package: identity.android.applicationId,
    },
    runtimeVersion: {
      policy: "appVersion",
    },
    updates: {
      ...config.updates,
      codeSigningCertificate: `./trust/${trustTier}-update-certificate.crt`,
      codeSigningMetadata: {
        alg: updateTrust.algorithm,
        keyid: updateTrust.keyId,
      },
      url: `https://u.expo.dev/${identities.expo.projectId}`,
    },
    extra: {
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        projectId: identities.expo.projectId,
      },
      openjobEnvironment: environment,
    },
  };
}
