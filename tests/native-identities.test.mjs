import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const identitiesUrl = new URL("../config/native-identities.json", import.meta.url);
const documentationUrl = new URL(
  "../docs/native-trust-and-distribution.md",
  import.meta.url,
);
const easUrl = new URL("../native/eas.json", import.meta.url);
const firebaseUrl = new URL("../firebase.json", import.meta.url);
const metroConfigUrl = new URL("../native/metro.config.cjs", import.meta.url);
const nativeReadmeUrl = new URL("../native/README.md", import.meta.url);

const expectedAppleAppPrivacy = {
  NSPrivacyCollectedDataTypes: [
    {
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeName",
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypePurposes: [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      ],
      NSPrivacyCollectedDataTypeTracking: false,
    },
    {
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeEmailAddress",
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypePurposes: [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      ],
      NSPrivacyCollectedDataTypeTracking: false,
    },
    {
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeUserID",
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypePurposes: [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      ],
      NSPrivacyCollectedDataTypeTracking: false,
    },
    {
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeProductInteraction",
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypePurposes: [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      ],
      NSPrivacyCollectedDataTypeTracking: false,
    },
    {
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeCrashData",
      NSPrivacyCollectedDataTypeLinked: false,
      NSPrivacyCollectedDataTypePurposes: [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      ],
      NSPrivacyCollectedDataTypeTracking: false,
    },
    {
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePerformanceData",
      NSPrivacyCollectedDataTypeLinked: false,
      NSPrivacyCollectedDataTypePurposes: [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      ],
      NSPrivacyCollectedDataTypeTracking: false,
    },
    {
      NSPrivacyCollectedDataType:
        "NSPrivacyCollectedDataTypeOtherDiagnosticData",
      NSPrivacyCollectedDataTypeLinked: false,
      NSPrivacyCollectedDataTypePurposes: [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      ],
      NSPrivacyCollectedDataTypeTracking: false,
    },
  ],
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
};

async function readIdentities() {
  return JSON.parse(await readFile(identitiesUrl, "utf8"));
}

test("public Google support metadata never exposes the owner login", async () => {
  const [identities, firebase, documentation] = await Promise.all([
    readIdentities(),
    readFile(firebaseUrl, "utf8").then(JSON.parse),
    readFile(documentationUrl, "utf8"),
  ]);
  const supportGroup = "openjob-support@googlegroups.com";

  assert.deepEqual(identities.googleAuth, {
    appName: "OpenJob",
    developerContactEmail: supportGroup,
    projects: {
      "openjob-dev": {
        verifiedAt: "2026-07-24",
      },
      "openjob-nonprod": {
        verifiedAt: "2026-07-24",
      },
    },
    supportEmail: supportGroup,
  });
  assert.deepEqual(firebase.auth.providers.googleSignIn, {
    oAuthBrandDisplayName: identities.googleAuth.appName,
    supportEmail: identities.googleAuth.supportEmail,
  });
  assert.notEqual(
    identities.googleAuth.supportEmail,
    identities.googlePlay.supportEmail,
  );
  assert.match(documentation, /openjob-support@googlegroups\.com/u);
  assert.match(documentation, /history\s+privacy\s+scrub/iu);
  assert.match(documentation, /GitHub Support ticket `#4599940`/u);
  assert.match(
    documentation,
    /old\s+web\s+and\s+API\s+views\s+return\s+HTTP\s+404/iu,
  );
  assert.doesNotMatch(documentation, /owner explicitly approves/iu);
  assert.doesNotMatch(documentation, /OAuth support address.*eligible/isu);
  assert.doesNotMatch(JSON.stringify(firebase), /@gmail\.com/iu);
});

test("native environments expose stable OpenJob application identities", async () => {
  const identities = await readIdentities();

  assert.equal(identities.apple.teamId, "QP9SJRTA44");
  assert.deepEqual(identities.googlePlay, {
    accountType: "personal",
    appCreation: {
      requiredAccountChecks: ["identity", "android-device", "phone"],
      status: "ready",
      verifiedAt: "2026-07-24",
    },
    apps: {
      preview: {
        appId: "4974862256769283996",
        applicationId: "dev.openjob.app.preview",
        internalTesting: true,
        name: "OpenJob Preview",
        status: "draft",
      },
      production: {
        appId: "4975911521427041995",
        applicationId: "dev.openjob.app",
        internalTesting: true,
        name: "OpenJob",
        status: "draft",
      },
    },
    developerAccountId: "6994653839033844694",
    developerName: "WLKR LABS",
    supportEmail: "dev@wlkrlabs.com",
    supportEmailVerified: true,
    registrationFee: {
      amountUsd: 25,
      cadence: "one-time",
      paid: true,
    },
    website: "https://wlkrlabs.com",
  });
  assert.equal(identities.expo.plan, "Free");
  assert.deepEqual(Object.keys(identities.environments), [
    "development",
    "preview",
    "production",
  ]);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(identities.environments).map(([name, environment]) => [
        name,
        {
          androidApplicationId: environment.android.applicationId,
          firebaseProjectId: environment.firebase.projectId,
          iosBundleId: environment.ios.bundleId,
          tier: environment.tier,
        },
      ]),
    ),
    {
      development: {
        androidApplicationId: "dev.openjob.app.dev",
        firebaseProjectId: "openjob-nonprod",
        iosBundleId: "dev.openjob.app.dev",
        tier: "nonproduction",
      },
      preview: {
        androidApplicationId: "dev.openjob.app.preview",
        firebaseProjectId: "openjob-nonprod",
        iosBundleId: "dev.openjob.app.preview",
        tier: "nonproduction",
      },
      production: {
        androidApplicationId: "dev.openjob.app",
        firebaseProjectId: "openjob-dev",
        iosBundleId: "dev.openjob.app",
        tier: "production",
      },
    },
  );
});

test("provider callbacks and associated Google identifiers are explicit", async () => {
  const identities = await readIdentities();
  const expected = {
    development: {
      appScheme: "openjob-dev",
      firebaseHandlerUrl:
        "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
      googleReversedClientId:
        "com.googleusercontent.apps.550998178053-nek4ph7nn98c7f1r4vjo1jnvd11nvm4q",
      nativeCallbackUrl: "openjob-dev://auth/callback",
    },
    preview: {
      appScheme: "openjob-preview",
      firebaseHandlerUrl:
        "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
      googleReversedClientId:
        "com.googleusercontent.apps.550998178053-5ruvfa2pemb5imm1ke195qrvftrsrm6j",
      nativeCallbackUrl: "openjob-preview://auth/callback",
    },
    production: {
      appScheme: "openjob",
      firebaseHandlerUrl:
        "https://openjob-dev.firebaseapp.com/__/auth/handler",
      googleReversedClientId:
        "com.googleusercontent.apps.1015996869029-tlko5334fhqiodcgebd5hncf41jh2f8m",
      nativeCallbackUrl: "openjob://auth/callback",
    },
  };

  for (const [name, environment] of Object.entries(identities.environments)) {
    assert.deepEqual(environment.auth, {
      appScheme: expected[name].appScheme,
      firebaseHandlerUrl: expected[name].firebaseHandlerUrl,
      nativeCallbackUrl: expected[name].nativeCallbackUrl,
    });
    assert.equal(
      environment.ios.googleReversedClientId,
      expected[name].googleReversedClientId,
    );
    assert.equal(
      environment.ios.googleRedirectUri,
      `${expected[name].googleReversedClientId}:/oauthredirect`,
    );
  }

  assert.equal(
    new Set(
      Object.values(identities.environments).map(
        (environment) => environment.auth.appScheme,
      ),
    ).size,
    3,
  );
});

test("native API and Firebase public runtime config remain isolated by trust tier", async () => {
  const identities = await readIdentities();
  const { development, preview, production } = identities.environments;

  assert.equal(
    development.api.baseUrl,
    "https://openjob-preview.walkerworlddiscord.workers.dev/api/v1",
  );
  assert.equal(preview.api.baseUrl, development.api.baseUrl);
  assert.equal(production.api.baseUrl, "https://openjob.dev/api/v1");
  assert.notEqual(preview.api.baseUrl, production.api.baseUrl);
  assert.match(development.firebase.apiKey, /^AIza/u);
  assert.equal(development.firebase.apiKey, preview.firebase.apiKey);
  assert.notEqual(preview.firebase.apiKey, production.firebase.apiKey);
});

test("Apple sign-in and TestFlight identities are separated by trust tier", async () => {
  const identities = await readIdentities();

  assert.deepEqual(identities.apple.signInKeys, {
    nonproduction: {
      createdAt: "2026-07-23",
      firebase: {
        bundleIds: ["dev.openjob.app.dev", "dev.openjob.app.preview"],
        enabled: true,
        projectId: "openjob-nonprod",
      },
      keyId: "F7H56WDP63",
      owner: "OpenJob",
      primaryAppId: "QP9SJRTA44.dev.openjob.app.preview",
      publicKeySpkiSha256:
        "a59fec3a5f44e0f552c9c1f79562f67587363b99acfe85d2393ffb6bd974e3ac",
      recovery: {
        item: "OpenJob Apple Sign In Nonproduction F7H56WDP63",
        provider: "1password",
        restoreVerifiedAt: "2026-07-23",
      },
      rotationReviewBy: "2027-07-23",
      routineStore: {
        account: "nonproduction-F7H56WDP63",
        provider: "macos-keychain",
        service: "dev.openjob.apple-signin-key",
      },
    },
    production: {
      createdAt: "2026-07-23",
      firebase: {
        bundleIds: ["dev.openjob.app"],
        enabled: true,
        projectId: "openjob-dev",
      },
      keyId: "N926UH3GCY",
      owner: "OpenJob",
      primaryAppId: "QP9SJRTA44.dev.openjob.app",
      publicKeySpkiSha256:
        "389d081a02196e4f40996b1d5f7713387d0910a2a98c3bc4a31e3e8a9a3e0e11",
      recovery: {
        item: "OpenJob Apple Sign In Production N926UH3GCY",
        provider: "1password",
        restoreVerifiedAt: "2026-07-23",
      },
      rotationReviewBy: "2027-07-23",
      routineStore: {
        account: "production-N926UH3GCY",
        provider: "macos-keychain",
        service: "dev.openjob.apple-signin-key",
      },
    },
  });
  assert.deepEqual(identities.apple.signInServices, {
    nonproduction: {
      domain: "openjob-nonprod.firebaseapp.com",
      primaryAppId: "QP9SJRTA44.dev.openjob.app.preview",
      returnUrl: "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
      serviceId: "dev.openjob.auth.nonprod",
    },
    production: {
      domain: "openjob-dev.firebaseapp.com",
      primaryAppId: "QP9SJRTA44.dev.openjob.app",
      returnUrl: "https://openjob-dev.firebaseapp.com/__/auth/handler",
      serviceId: "dev.openjob.auth",
    },
  });
  assert.deepEqual(identities.apple.appStoreConnect, {
    preview: {
      appId: "6793947679",
      name: "OpenJob Preview",
      sku: "openjob-preview",
      testFlight: true,
    },
    production: {
      appId: "6793948276",
      name: "OpenJob: Shared Tasks",
      sku: "openjob",
      testFlight: true,
    },
  });
});

test("Apple distribution signing is isolated and recoverable by environment", async () => {
  const identities = await readIdentities();

  assert.deepEqual(identities.apple.distributionSigning, {
    development: {
      bundleId: "dev.openjob.app.dev",
      certificate: {
        expiresAt: "2027-07-23T13:35:07Z",
        fingerprintSha256:
          "7F:48:FC:58:EA:2B:32:35:4C:7A:15:15:08:8B:22:2A:94:5A:C6:BA:BD:9F:C2:FF:34:BC:A5:A9:60:F9:CC:F3",
        id: "4HJ8JRDS64",
        publicKeySpkiSha256:
          "ddfad8cb61d19cc427fe9a8fd896b27b5f04f4e75b6da6ed1b2618914086cfde",
        serial: "3A53CCED556CE1E14CF644D330B507D5",
      },
      createdAt: "2026-07-23",
      distribution: "internal",
      eas: {
        credentialsSource: "remote",
        syncedAt: "2026-07-23",
      },
      owner: "OpenJob",
      profile: {
        expiresAt: "2027-07-23T13:35:07Z",
        id: "H7H546ZJ9S",
        name: "OpenJob Development Ad Hoc",
        type: "ad-hoc",
        uuid: "d5ff403d-fe4c-4b50-a926-2a936cde3c21",
      },
      provider: "apple-developer",
      recovery: {
        item: "OpenJob iOS Development Signing Recovery",
        provider: "1password",
        restoreVerifiedAt: "2026-07-23",
      },
      rotationReviewBy: "2027-06-23",
      routineStore: {
        identitySha1: "8D899FBFFFDFF917F68AD417E3BF5696E3A605D3",
        provider: "macos-keychain",
      },
    },
    preview: {
      bundleId: "dev.openjob.app.preview",
      certificate: {
        expiresAt: "2027-07-23T13:35:07Z",
        fingerprintSha256:
          "7F:48:FC:58:EA:2B:32:35:4C:7A:15:15:08:8B:22:2A:94:5A:C6:BA:BD:9F:C2:FF:34:BC:A5:A9:60:F9:CC:F3",
        id: "4HJ8JRDS64",
        publicKeySpkiSha256:
          "ddfad8cb61d19cc427fe9a8fd896b27b5f04f4e75b6da6ed1b2618914086cfde",
        serial: "3A53CCED556CE1E14CF644D330B507D5",
      },
      createdAt: "2026-07-23",
      distribution: "store",
      eas: {
        credentialsSource: "remote",
        syncedAt: "2026-07-23",
      },
      owner: "OpenJob",
      profile: {
        expiresAt: "2027-07-23T13:35:07Z",
        id: "22NL2LQWXC",
        name: "OpenJob Preview App Store",
        type: "app-store",
        uuid: "f4101821-a937-44db-ade4-1c2ddc898e1e",
      },
      provider: "apple-developer",
      recovery: {
        item: "OpenJob iOS Preview Signing Recovery",
        provider: "1password",
        restoreVerifiedAt: "2026-07-23",
      },
      rotationReviewBy: "2027-06-23",
      routineStore: {
        identitySha1: "8D899FBFFFDFF917F68AD417E3BF5696E3A605D3",
        provider: "macos-keychain",
      },
    },
    production: {
      bundleId: "dev.openjob.app",
      certificate: {
        expiresAt: "2027-07-23T15:28:11Z",
        fingerprintSha256:
          "EE:E5:BE:22:0B:03:61:05:3E:F6:7D:BF:56:CC:89:97:EC:8B:7B:A6:6A:5C:E7:78:A7:2A:EC:42:69:08:35:94",
        id: "STULDNXC38",
        publicKeySpkiSha256:
          "744a1c7c45b71b31545cc336bae7dc9940369ed3b543280393cbb61d68a4f5b4",
        serial: "3562897CEE5AFFB8C36A325FF383F468",
      },
      createdAt: "2026-07-23",
      distribution: "store",
      eas: {
        credentialsSource: "remote",
        syncedAt: "2026-07-23",
      },
      owner: "OpenJob",
      profile: {
        expiresAt: "2027-07-23T15:28:11Z",
        id: "839CADMWQ4",
        name: "OpenJob Production App Store",
        type: "app-store",
        uuid: "87b91d6e-cfc7-4dea-a808-bfc7a67abc4e",
      },
      provider: "apple-developer",
      recovery: {
        item: "OpenJob iOS Production Signing Recovery",
        provider: "1password",
        restoreVerifiedAt: "2026-07-23",
      },
      rotationReviewBy: "2027-06-23",
      routineStore: {
        identitySha1: "873B2AC0E2169DBF83C288027C3BECAC9372405F",
        provider: "macos-keychain",
      },
    },
  });

  assert.equal(
    new Set(
      Object.values(identities.apple.distributionSigning).map(
        (signing) => signing.certificate.fingerprintSha256,
      ),
    ).size,
    2,
  );
  assert.equal(
    new Set(
      Object.values(identities.apple.distributionSigning).map(
        (signing) => signing.profile.uuid,
      ),
    ).size,
    3,
  );
  assert.equal(
    identities.apple.distributionSigning.development.certificate
      .fingerprintSha256,
    identities.apple.distributionSigning.preview.certificate.fingerprintSha256,
  );
  assert.notEqual(
    identities.apple.distributionSigning.preview.certificate.fingerprintSha256,
    identities.apple.distributionSigning.production.certificate
      .fingerprintSha256,
  );
});

test("EAS build profiles isolate environments while update channels remain dormant", async () => {
  const [identities, eas] = await Promise.all([
    readIdentities(),
    readFile(easUrl, "utf8").then(JSON.parse),
  ]);

  assert.deepEqual(Object.keys(eas.build), [
    "development",
    "preview",
    "production",
  ]);
  const channelIds = {
    development: "019f8d18-f7da-7d12-81e5-fe25f5b6a8fa",
    preview: "019f8d18-fe02-75a8-83a5-19019cc78eef",
    production: "019f8d19-03b3-78b3-8919-62225bfb6cb1",
  };
  for (const name of Object.keys(eas.build)) {
    assert.equal(eas.build[name].environment, name);
    assert.equal(eas.build[name].ios.credentialsSource, "remote");
    assert.equal(Object.hasOwn(eas.build[name], "channel"), false);
    assert.deepEqual(identities.environments[name].eas, {
      buildProfile: name,
      channel: name,
      channelId: channelIds[name],
      environment: name,
    });
  }
  assert.equal(eas.build.development.developmentClient, true);
  assert.equal(eas.build.development.distribution, "internal");
  assert.equal(eas.build.preview.distribution, "store");
  assert.equal(eas.build.production.distribution, "store");
});

test("Android OAuth and signing identities cannot cross environments", async () => {
  const identities = await readIdentities();
  const expected = {
    development: {
      configurationId: "AVLdWoyXls",
      googleClientId:
        "550998178053-5681l7oet4q3rq0okoa2caqkv4bh324t.apps.googleusercontent.com",
      recoveryItem: "OpenJob Android Development Signing Recovery",
      sha1Fingerprint:
        "A9:CF:1E:47:DD:97:32:80:5A:22:36:82:41:08:6F:66:DB:EA:B3:0C",
      sha256Fingerprint:
        "89:29:53:1E:B3:53:49:CD:80:E7:C1:8C:5C:CB:C1:DA:6C:91:26:AF:A9:9D:0E:01:6F:71:3F:E2:0A:F3:D1:08",
    },
    preview: {
      configurationId: "QHMuu9fTQ4",
      googleClientId:
        "550998178053-n1s9vp0cbmqubh5onint23j8415ivkoa.apps.googleusercontent.com",
      recoveryItem: "OpenJob Android Preview Signing Recovery",
      sha1Fingerprint:
        "0B:95:B5:5A:5D:6B:BD:66:3A:12:37:B8:4D:0A:94:72:0A:04:7B:6F",
      sha256Fingerprint:
        "53:EA:CB:C3:A2:CA:24:63:23:9D:34:26:7B:5F:C8:1A:FD:36:80:09:9F:11:45:ED:B9:45:00:12:86:D4:18:43",
    },
    production: {
      configurationId: "SkaVgGHtTd",
      googleClientId:
        "1015996869029-qr0bkpihst84f8coibaotbtpjngicmjq.apps.googleusercontent.com",
      recoveryItem: "OpenJob Android Production Signing Recovery",
      sha1Fingerprint:
        "AA:AA:E2:14:C1:28:97:03:AC:29:7A:19:40:E0:53:6A:63:C8:0B:68",
      sha256Fingerprint:
        "08:57:9F:0C:20:A3:53:DC:D3:C3:88:22:47:41:1E:5F:21:46:7C:24:F2:8B:7D:8C:7B:BC:EA:D8:70:D1:8D:F4",
    },
  };

  for (const [name, environment] of Object.entries(identities.environments)) {
    assert.equal(environment.android.googleClientId, expected[name].googleClientId);
    assert.deepEqual(environment.android.signing, {
      configurationId: expected[name].configurationId,
      createdAt: "2026-07-22",
      owner: "OpenJob",
      provider: "eas-managed",
      recovery: {
        eas: "@openjob/openjob credentials",
        item: expected[name].recoveryItem,
        provider: "1password",
        restoreVerifiedAt: "2026-07-23",
      },
      rotationReviewBy: "2027-07-22",
      sha1Fingerprint: expected[name].sha1Fingerprint,
      sha256Fingerprint: expected[name].sha256Fingerprint,
    });
  }

  assert.equal(
    new Set(
      Object.values(identities.environments).map(
        (environment) => environment.android.googleClientId,
      ),
    ).size,
    3,
  );
});

test("Expo config resolves the public identity for each build environment", async () => {
  const { default: createAppConfig } = await import(
    `../native/app.config.mjs?test=${Date.now()}`
  );
  const identities = await readIdentities();
  const previousEnvironment = process.env.OPENJOB_NATIVE_ENV;
  const previousAndroidConfig = process.env.GOOGLE_SERVICES_JSON;
  const previousIosConfig = process.env.GOOGLE_SERVICE_INFO_PLIST;

  try {
    process.env.GOOGLE_SERVICES_JSON = "/eas/google-services.json";
    process.env.GOOGLE_SERVICE_INFO_PLIST = "/eas/GoogleService-Info.plist";
    for (const name of Object.keys(identities.environments)) {
      process.env.OPENJOB_NATIVE_ENV = name;
      const config = createAppConfig({ config: {} });
      const identity = identities.environments[name];

      assert.equal(config.owner, identities.expo.account);
      assert.equal(config.scheme, identity.auth.appScheme);
      assert.equal(config.slug, identities.expo.slug);
      assert.equal(config.extra.eas.projectId, identities.expo.projectId);
      assert.equal(config.extra.openjobEnvironment, name);
      assert.equal(
        config.extra.openjob.qaPasswordTenantId,
        name === "preview" ? "OpenJob-QA-Two-mvz9m" : null,
      );
      assert.equal(config.ios.bundleIdentifier, identity.ios.bundleId);
      assert.equal(
        config.ios.googleServicesFile,
        "/eas/GoogleService-Info.plist",
      );
      assert.equal(config.android.package, identity.android.applicationId);
      assert.equal(
        config.android.googleServicesFile,
        "/eas/google-services.json",
      );
      assert.equal(Object.hasOwn(config, "runtimeVersion"), false);
      assert.deepEqual(config.updates, {
        checkAutomatically: "NEVER",
        enabled: false,
        useEmbeddedUpdate: true,
      });
    }
  } finally {
    if (previousEnvironment === undefined) delete process.env.OPENJOB_NATIVE_ENV;
    else process.env.OPENJOB_NATIVE_ENV = previousEnvironment;
    if (previousAndroidConfig === undefined) {
      delete process.env.GOOGLE_SERVICES_JSON;
    } else {
      process.env.GOOGLE_SERVICES_JSON = previousAndroidConfig;
    }
    if (previousIosConfig === undefined) {
      delete process.env.GOOGLE_SERVICE_INFO_PLIST;
    } else {
      process.env.GOOGLE_SERVICE_INFO_PLIST = previousIosConfig;
    }
  }
});

test("native diagnostics build is guarded and whole-app privacy-declared", async () => {
  const { default: createAppConfig } = await import(
    `../native/app.config.mjs?diagnostics-test=${Date.now()}`
  );
  const environmentNames = [
    "EXPO_PUBLIC_SENTRY_DSN",
    "OPENJOB_DIAGNOSTICS_STARTUP_CRASH_VERIFICATION",
    "OPENJOB_DIAGNOSTICS_VERIFICATION",
    "OPENJOB_NATIVE_ENV",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
  ];
  const previous = Object.fromEntries(
    environmentNames.map((name) => [name, process.env[name]]),
  );
  const fixtureDsn = "https://public-fixture@diagnostics.invalid/40";
  const fixtureToken = "fixture-auth-token-must-not-be-serialized";

  try {
    Object.assign(process.env, {
      EXPO_PUBLIC_SENTRY_DSN: fixtureDsn,
      OPENJOB_DIAGNOSTICS_STARTUP_CRASH_VERIFICATION: "1",
      OPENJOB_DIAGNOSTICS_VERIFICATION: "1",
      OPENJOB_NATIVE_ENV: "preview",
      SENTRY_AUTH_TOKEN: fixtureToken,
      SENTRY_ORG: "openjob-fixture",
      SENTRY_PROJECT: "openjob-native-fixture",
    });
    const preview = createAppConfig({ config: {} });
    const sentryPlugin = preview.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "@sentry/react-native/expo",
    );
    assert.ok(
      preview.plugins.includes("./plugins/with-sentry-android-privacy.cjs"),
    );

    assert.deepEqual(sentryPlugin, [
      "@sentry/react-native/expo",
      {
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
        organization: "openjob-fixture",
        project: "openjob-native-fixture",
        url: "https://sentry.io/",
      },
    ]);
    assert.equal(preview.extra.openjob.diagnosticsDsn, fixtureDsn);
    assert.equal(
      preview.extra.openjob.diagnosticsStartupCrashVerificationEnabled,
      true,
    );
    assert.equal(preview.extra.openjob.diagnosticsVerificationEnabled, true);
    assert.deepEqual(
      preview.ios.privacyManifests,
      expectedAppleAppPrivacy,
    );
    assert.doesNotMatch(JSON.stringify(preview), new RegExp(fixtureToken, "u"));

    process.env.OPENJOB_NATIVE_ENV = "production";
    assert.equal(
      createAppConfig({ config: {} }).extra.openjob
        .diagnosticsVerificationEnabled,
      false,
    );
    assert.equal(
      createAppConfig({ config: {} }).extra.openjob
        .diagnosticsStartupCrashVerificationEnabled,
      false,
    );

    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    process.env.OPENJOB_NATIVE_ENV = "preview";
    const missingDsn = createAppConfig({ config: {} });
    assert.equal(missingDsn.extra.openjob.diagnosticsDsn, "");
    assert.equal(
      missingDsn.extra.openjob.diagnosticsVerificationEnabled,
      false,
    );
    assert.equal(
      missingDsn.extra.openjob.diagnosticsStartupCrashVerificationEnabled,
      false,
    );

    process.env.EXPO_PUBLIC_SENTRY_DSN = "not-a-sentry-dsn";
    assert.throws(
      () => createAppConfig({ config: {} }),
      /EXPO_PUBLIC_SENTRY_DSN must be a valid HTTPS Sentry DSN/u,
    );

    process.env.EXPO_PUBLIC_SENTRY_DSN = fixtureDsn;
    process.env.SENTRY_ORG = "openjob\nauth.token=unsafe";
    assert.throws(
      () => createAppConfig({ config: {} }),
      /SENTRY_ORG must be a valid Sentry slug/u,
    );

    process.env.SENTRY_ORG = "openjob-fixture";
    delete process.env.SENTRY_PROJECT;
    assert.throws(
      () => createAppConfig({ config: {} }),
      /SENTRY_ORG and SENTRY_PROJECT must be set together/u,
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Metro emits Sentry Debug IDs while excluding replay code", async () => {
  const require = createRequire(import.meta.url);
  const source = await readFile(metroConfigUrl, "utf8");
  const metro = require(metroConfigUrl.pathname);

  assert.match(source, /getSentryExpoConfig/u);
  assert.match(source, /includeWebReplay:\s*false/u);
  assert.match(source, /enableSourceContextInDevelopment:\s*false/u);
  assert.equal(typeof metro.serializer.customSerializer, "function");
  assert.deepEqual(
    metro.resolver.resolveRequest({}, "@sentry-internal/replay", "ios"),
    { type: "empty" },
  );
  assert.doesNotMatch(source, /SENTRY_AUTH_TOKEN|EXPO_PUBLIC_SENTRY_DSN/u);
});

test("native documentation separates app, SDK, and optional diagnostics declarations", async () => {
  const documentation = await readFile(nativeReadmeUrl, "utf8");

  for (const appleType of [
    "Name",
    "Email Address",
    "User ID",
    "Product Interaction",
  ]) {
    assert.match(
      documentation,
      new RegExp(`\\| ${appleType} \\| Yes \\| No \\| Required`, "u"),
    );
  }
  for (const appleType of [
    "Crash Data",
    "Performance Data",
    "Other Diagnostic Data",
  ]) {
    assert.match(
      documentation,
      new RegExp(
        `\\| ${appleType} \\| No \\| No \\| Optional Share diagnostics`,
        "u",
      ),
    );
  }
  for (const playType of [
    "Name",
    "Email address",
    "User IDs",
    "App interactions",
  ]) {
    assert.match(
      documentation,
      new RegExp(`\\| ${playType} \\| Collected, required, not shared;`, "u"),
    );
  }
  assert.match(
    documentation,
    /\| Other user-generated content \| Not collected \|/u,
  );
  assert.match(
    documentation,
    /\| Crash logs \| Collected, optional, not shared;[\s\S]*\| Diagnostics \| Collected, optional, not shared;/u,
  );
  assert.match(
    documentation,
    /provider, Firebase, OpenJob API, and Sentry behavior/iu,
  );
  assert.match(
    documentation,
    /Device or other IDs\s*\|\s*Pending final merged-manifest/iu,
  );
  for (const dataType of [
    "Phone Number",
    "Coarse Location",
    "Other Data Types",
    "Device ID",
    "Other Usage Data",
  ]) {
    assert.match(documentation, new RegExp(dataType, "u"));
  }
  assert.match(documentation, /not OpenJob product analytics/u);
  assert.match(documentation, /Do not infer the Android declaration/u);
  assert.match(documentation, /Play SDK Index/u);
  assert.match(documentation, /SENTRY_AUTH_TOKEN[\s\S]*Sensitive/iu);
  assert.match(documentation, /EXPO_PUBLIC_SENTRY_DSN/iu);
  assert.match(documentation, /store builds only/iu);
  assert.match(documentation, /OTA remains disabled/iu);
});

test("free distribution policy disables OTA delivery", async () => {
  const identities = await readIdentities();

  assert.deepEqual(identities.delivery, {
    updates: {
      enabled: false,
      releasePath: "store-build",
    },
  });
  assert.equal(Object.hasOwn(identities, "trust"), false);
});

test("native handoff documents every public identity and recovery boundary", async () => {
  const identities = await readIdentities();
  const documentation = await readFile(documentationUrl, "utf8");

  for (const environment of Object.values(identities.environments)) {
    assert.match(documentation, new RegExp(environment.firebase.projectId, "u"));
    assert.match(documentation, new RegExp(environment.ios.bundleId, "u"));
    assert.match(documentation, new RegExp(environment.android.applicationId, "u"));
    assert.match(documentation, new RegExp(environment.eas.channelId, "u"));
    assert.match(
      documentation,
      new RegExp(environment.auth.nativeCallbackUrl, "u"),
    );
    assert.match(
      documentation,
      new RegExp(environment.ios.googleReversedClientId, "u"),
    );
  }
  for (const service of Object.values(identities.apple.signInServices)) {
    assert.match(documentation, new RegExp(service.serviceId, "u"));
    assert.match(documentation, new RegExp(service.returnUrl, "u"));
  }
  for (const key of Object.values(identities.apple.signInKeys)) {
    assert.match(documentation, new RegExp(key.keyId, "u"));
    assert.match(documentation, new RegExp(key.publicKeySpkiSha256, "u"));
    assert.match(documentation, new RegExp(key.recovery.item, "u"));
    assert.match(documentation, new RegExp(key.rotationReviewBy, "u"));
  }
  for (const signing of Object.values(identities.apple.distributionSigning)) {
    assert.match(documentation, new RegExp(signing.bundleId, "u"));
    assert.match(documentation, new RegExp(signing.certificate.id, "u"));
    assert.match(
      documentation,
      new RegExp(signing.certificate.fingerprintSha256, "u"),
    );
    assert.match(documentation, new RegExp(signing.profile.id, "u"));
    assert.match(documentation, new RegExp(signing.profile.uuid, "u"));
    assert.match(documentation, new RegExp(signing.recovery.item, "u"));
    assert.match(documentation, new RegExp(signing.rotationReviewBy, "u"));
  }
  for (const app of Object.values(identities.apple.appStoreConnect)) {
    assert.match(documentation, new RegExp(app.appId, "u"));
    assert.match(documentation, new RegExp(app.name, "u"));
  }
  for (const app of Object.values(identities.googlePlay.apps)) {
    assert.match(documentation, new RegExp(app.appId, "u"));
    assert.match(documentation, new RegExp(app.applicationId, "u"));
    assert.equal(app.internalTesting, true);
  }
  assert.match(documentation, /openjob-dev.*production/iu);
  assert.match(documentation, /TestFlight/u);
  assert.match(documentation, /Internal Testing/u);
  assert.match(documentation, /#36/u);
  assert.match(documentation, /#37/u);
  assert.match(documentation, /1Password/u);
  assert.match(documentation, /Expo Free/u);
  assert.match(documentation, /WLKR LABS/u);
  assert.match(documentation, /dev@wlkrlabs\.com/u);
  assert.match(documentation, /6994653839033844694/u);
  assert.match(documentation, /US\$25/u);
  assert.match(documentation, /store builds/iu);
  assert.doesNotMatch(documentation, /Bitwarden/u);
  assert.doesNotMatch(documentation, /@gmail\.com/iu);
  assert.match(documentation, /recovery/iu);
  assert.doesNotMatch(documentation, /BEGIN (?:EC |RSA )?PRIVATE KEY/u);
});
