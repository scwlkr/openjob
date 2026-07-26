import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(nativeRoot, "..");
const expo = join(nativeRoot, "node_modules", ".bin", "expo");
const environments = ["development", "preview", "production"];
const require = createRequire(import.meta.url);
const sentryFixture = {
  authToken: "fixture-auth-token-must-not-be-serialized",
  dsn: "https://public-fixture@diagnostics.invalid/40",
  organization: "openjob-config-fixture",
  project: "openjob-native-config-fixture",
};
const androidBlockedPermissions = [
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];
const appleAppPrivacy = {
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
const identities = JSON.parse(
  await readFile(
    join(repositoryRoot, "config", "native-identities.json"),
    "utf8",
  ),
);

function runExpo(
  args,
  {
    cwd = nativeRoot,
    diagnosticsDsn = sentryFixture.dsn,
    environment = "production",
  } = {},
) {
  const childEnvironment = {
    ...process.env,
    CI: "1",
    OPENJOB_DIAGNOSTICS_STARTUP_CRASH_VERIFICATION: "1",
    OPENJOB_DIAGNOSTICS_VERIFICATION: "1",
    OPENJOB_NATIVE_ENV: environment,
    SENTRY_AUTH_TOKEN: sentryFixture.authToken,
    SENTRY_ORG: sentryFixture.organization,
    SENTRY_PROJECT: sentryFixture.project,
  };
  if (diagnosticsDsn === null) {
    delete childEnvironment.EXPO_PUBLIC_SENTRY_DSN;
  } else {
    childEnvironment.EXPO_PUBLIC_SENTRY_DSN = diagnosticsDsn;
  }
  const result = spawnSync(expo, args, {
    cwd,
    encoding: "utf8",
    env: childEnvironment,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `expo ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function assertPublicConfig(config, environment) {
  assert.equal(config.extra.openjob.environment, environment);
  assert.equal(config.extra.openjob.apiBasePath, "/api/v1");
  assert.equal(config.orientation, "default");
  assert.equal(config.userInterfaceStyle, "automatic");
  assert.equal(config.ios.supportsTablet, true);
  assert.deepEqual(config.ios.privacyManifests, appleAppPrivacy);
  assert.equal(config.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
  assert.equal(config.ios.infoPlist.OpenJobSentryDSN, sentryFixture.dsn);
  assert.equal(config.ios.infoPlist.OpenJobSentryEnvironment, environment);
  assert.deepEqual(config.android.blockedPermissions, androidBlockedPermissions);
  assert.equal(config.extra.openjob.diagnosticsDsn, sentryFixture.dsn);
  assert.equal(
    config.extra.openjob.diagnosticsStartupCrashVerificationEnabled,
    environment === "preview",
  );
  assert.equal(
    config.extra.openjob.diagnosticsVerificationEnabled,
    environment === "preview",
  );
  const sentryPlugin = config.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "@sentry/react-native/expo",
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
      organization: sentryFixture.organization,
      project: sentryFixture.project,
      url: "https://sentry.io/",
    },
  ]);
  assert.deepEqual(config.updates, {
    checkAutomatically: "NEVER",
    enabled: false,
    useEmbeddedUpdate: true,
  });

  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, new RegExp(sentryFixture.authToken, "u"));
  assert.doesNotMatch(serialized, /codeSigning|requestHeaders|runtimeVersion/iu);
  assert.doesNotMatch(serialized, /https:\/\/u\.expo\.dev/iu);
  assert.equal(Object.hasOwn(config.updates, "url"), false);
  assert.equal(Object.hasOwn(config, "runtimeVersion"), false);
}

async function copyProject(targetRoot) {
  const targetNative = join(targetRoot, "native");
  await Promise.all([
    mkdir(join(targetRoot, "config"), { recursive: true }),
    mkdir(join(targetRoot, "public"), { recursive: true }),
    mkdir(targetNative, { recursive: true }),
  ]);
  await Promise.all([
    cp(join(repositoryRoot, "package.json"), join(targetRoot, "package.json")),
    cp(
      join(repositoryRoot, "config", "native-identities.json"),
      join(targetRoot, "config", "native-identities.json"),
    ),
    cp(
      join(repositoryRoot, "public", "icon-512.png"),
      join(targetRoot, "public", "icon-512.png"),
    ),
    cp(
      join(repositoryRoot, "public", "icon-maskable-512.png"),
      join(targetRoot, "public", "icon-maskable-512.png"),
    ),
    cp(join(nativeRoot, "app.config.mjs"), join(targetNative, "app.config.mjs")),
    cp(join(nativeRoot, "metro.config.cjs"), join(targetNative, "metro.config.cjs")),
    cp(join(nativeRoot, "package.json"), join(targetNative, "package.json")),
  ]);
  await cp(join(nativeRoot, "plugins"), join(targetNative, "plugins"), {
    recursive: true,
  });
  await symlink(join(nativeRoot, "node_modules"), join(targetNative, "node_modules"));
  return targetNative;
}

async function readTextTree(directory) {
  const parts = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (
        entry.isFile() &&
        /\.(?:entitlements|gradle|h|json|kt|pbxproj|plist|properties|strings|swift|xcprivacy|xml)$/iu.test(
          entry.name,
        )
      ) {
        parts.push(await readFile(child, "utf8"));
      }
    }
  }
  await visit(directory);
  return parts.join("\n");
}

const metroConfig = require(join(nativeRoot, "metro.config.cjs"));
assert.equal(
  typeof metroConfig.serializer?.customSerializer,
  "function",
  "Sentry Metro Debug ID serializer is not configured",
);
assert.deepEqual(
  metroConfig.resolver?.resolveRequest(
    {},
    "@sentry-internal/replay",
    "ios",
  ),
  { type: "empty" },
  "Sentry replay modules are not excluded from native bundles",
);

for (const environment of environments) {
  const publicConfig = JSON.parse(
    runExpo(["config", "--type", "public", "--json"], { environment }),
  );
  assertPublicConfig(publicConfig, environment);
}

const previewWithoutDiagnosticsDsn = JSON.parse(
  runExpo(["config", "--type", "public", "--json"], {
    diagnosticsDsn: null,
    environment: "preview",
  }),
);
assert.equal(previewWithoutDiagnosticsDsn.extra.openjob.diagnosticsDsn, "");
assert.equal(
  previewWithoutDiagnosticsDsn.extra.openjob.diagnosticsVerificationEnabled,
  false,
);

for (const environment of environments) {
  const generatedRoot = await mkdtemp(
    join(tmpdir(), `openjob-native-config-${environment}-`),
  );
  try {
    const generatedNative = await copyProject(generatedRoot);
    runExpo(["prebuild", "--clean", "--no-install", "--platform", "all"], {
      cwd: generatedNative,
      environment,
    });
    const [ios, android, podfile] = await Promise.all([
      readTextTree(join(generatedNative, "ios")),
      readTextTree(join(generatedNative, "android")),
      readFile(join(generatedNative, "ios", "Podfile"), "utf8"),
    ]);

    assert.ok(
      ios.includes(identities.environments[environment].ios.bundleId),
      `${environment} iOS identity was not generated`,
    );
    assert.ok(
      android.includes(
        identities.environments[environment].android.applicationId,
      ),
      `${environment} Android identity was not generated`,
    );
    for (const permission of androidBlockedPermissions) {
      assert.match(
        android,
        new RegExp(
          `uses-permission[^>]{0,240}android:name="${permission.replaceAll(".", "\\.")}"[^>]{0,240}tools:node="remove"`,
          "u",
        ),
        `${environment} Android did not block ${permission}`,
      );
    }
    assert.ok(
      ios.includes(
        identities.environments[environment].ios.googleReversedClientId,
      ),
      `${environment} Google callback scheme was not generated`,
    );
    assert.match(
      ios,
      /com\.apple\.developer\.applesignin[\s\S]{0,180}(?:Default|<string>Default<\/string>)/u,
    );
    assert.match(
      ios,
      /UIApplicationSceneManifest[\s\S]{0,800}UISceneDelegateClassName[\s\S]{0,160}\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate/u,
      `${environment} iOS scene lifecycle manifest was not generated`,
    );
    assert.match(
      ios,
      /UIApplicationSupportsMultipleScenes[\s\S]{0,120}<false\s*\/>/u,
      `${environment} iOS scene lifecycle unexpectedly enabled multiple scenes`,
    );
    assert.match(
      ios,
      /class SceneDelegate: UIResponder, UIWindowSceneDelegate/u,
      `${environment} iOS scene delegate was not generated`,
    );
    assert.equal(
      ios.match(/SceneDelegate\.swift in Sources/gu)?.length,
      2,
      `${environment} iOS scene delegate was not linked exactly once in the app target`,
    );
    assert.match(
      ios,
      /UIWindow\(windowScene: windowScene\)/u,
      `${environment} iOS scene window was not associated with its UIWindowScene`,
    );
    assert.match(
      ios,
      /appDelegate\.window = window/u,
      `${environment} iOS scene window was not mirrored to the app delegate`,
    );
    assert.match(
      ios,
      /factory\.startReactNative\([\s\S]{0,260}launchOptions: Self\.launchOptions\(/u,
      `${environment} iOS scene did not start React Native with reconstructed launch options`,
    );
    assert.match(
      ios,
      /UIApplicationLaunchOptionsURLKey[\s\S]{0,500}UIApplicationLaunchOptionsUserActivityKey/u,
      `${environment} iOS scene did not preserve cold-start links`,
    );
    assert.match(
      ios,
      /ExpoAppDelegateSubscriberManager\.application\([\s\S]{0,120}UIApplication\.shared,[\s\S]{0,80}open: context\.url,[\s\S]{0,80}options: options\)/u,
      `${environment} iOS scene did not forward authentication callback URLs to native handlers`,
    );
    assert.match(
      ios,
      /sceneWillResignActive[\s\S]{0,180}showPrivacyCurtain\(\)[\s\S]{0,180}applicationWillResignActive/u,
      `${environment} iOS privacy curtain was not installed synchronously before background notification`,
    );
    assert.match(
      ios,
      /sceneDidBecomeActive[\s\S]{0,180}hidePrivacyCurtain\(\)[\s\S]{0,180}applicationDidBecomeActive/u,
      `${environment} iOS privacy curtain was not removed on active use`,
    );
    assert.match(
      ios,
      /openjob-native-privacy-curtain[\s\S]{0,900}OPENJOB\\nPrivate in the app switcher\./u,
      `${environment} iOS branded privacy curtain was not generated`,
    );
    assert.match(
      android,
      /openjob-native-privacy-curtain[\s\S]{0,2400}override fun onPause\(\)[\s\S]{0,160}FLAG_SECURE[\s\S]{0,160}showOpenJobPrivacyCurtain\(\)[\s\S]{0,100}super\.onPause\(\)/u,
      `${environment} Android privacy curtain was not installed before onPause returned`,
    );
    assert.match(
      android,
      /override fun onResume\(\)[\s\S]{0,100}super\.onResume\(\)[\s\S]{0,100}hideOpenJobPrivacyCurtain\(\)[\s\S]{0,160}clearFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/u,
      `${environment} Android privacy curtain was not removed on active use`,
    );
    assert.match(
      android,
      /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.TIRAMISU[\s\S]{0,120}setRecentsScreenshotEnabled\(false\)/u,
      `${environment} Android task snapshots were not disabled`,
    );
    assert.match(
      android,
      /override fun onTrimMemory\(level: Int\)[\s\S]{0,300}openjobMemoryPressure/u,
      `${environment} Android memory pressure was not bridged to React Native`,
    );
    assert.match(
      android,
      /io\.sentry\.android\.core\.SentryPerformanceProvider[\s\S]{0,180}tools:node="remove"/u,
      `${environment} Android manifest did not remove Sentry's pre-JavaScript performance provider`,
    );
    assert.match(
      android,
      /openjob-native-diagnostics-bootstrap[\s\S]{0,180}initializeOpenJobDiagnostics\(this\)[\s\S]{0,900}loadReactNative\(this\)/u,
      `${environment} Android diagnostics did not start before React Native`,
    );
    assert.match(
      ios,
      /openjob-native-diagnostics-bootstrap[\s\S]{0,180}startOpenJobDiagnosticsIfEnabled\(\)[\s\S]{0,180}let delegate = ReactNativeDelegate\(\)/u,
      `${environment} iOS diagnostics did not start before the React Native factory`,
    );
    assert.match(
      ios,
      /#import <RNSentry\/RNSentry\.h>/u,
      `${environment} iOS diagnostics bridge header was not generated`,
    );
    assert.doesNotMatch(
      ios,
      /import RNSentry/u,
      `${environment} iOS diagnostics used a CocoaPods module that is not defined`,
    );
    assert.match(
      android,
      new RegExp(
        `dev\\.openjob\\.sentry\\.dsn[\\s\\S]{0,200}${sentryFixture.dsn.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`,
        "u",
      ),
      `${environment} Android diagnostics DSN metadata was not embedded`,
    );
    assert.match(
      ios,
      /OpenJobSentryDSN/u,
      `${environment} iOS diagnostics DSN metadata was not embedded`,
    );
    assert.doesNotMatch(
      android,
      /expo-application|expo\.modules\.application\.(?:ApplicationModule|ApplicationPackage)|installreferrer/iu,
      `${environment} Android identifier or install-referrer module was linked`,
    );
    assert.match(
      ios,
      /RCTLinkingManager\.application\([\s\S]{0,120}UIApplication\.shared,[\s\S]{0,80}open: context\.url,[\s\S]{0,80}options: options\)/u,
      `${environment} iOS scene did not forward authentication callback URLs to React Native`,
    );
    assert.doesNotMatch(
      ios,
      /UIWindow\(frame: UIScreen\.main\.bounds\)/u,
      `${environment} iOS app delegate still owns a legacy application window`,
    );
    assert.equal(
      podfile.match(/pod 'GoogleUtilities', :modular_headers => true/gu)
        ?.length,
      1,
      `${environment} GoogleUtilities module map configuration was not generated exactly once`,
    );
    assert.equal(
      podfile.match(/pod 'RecaptchaInterop', :modular_headers => true/gu)
        ?.length,
      1,
      `${environment} RecaptchaInterop module map configuration was not generated exactly once`,
    );
    assert.match(
      android,
      /android:fullBackupContent="@xml\/secure_store_backup_rules"/u,
      `${environment} Android protected-storage backup exclusion was not generated`,
    );
    assert.match(
      android,
      /android:dataExtractionRules="@xml\/secure_store_data_extraction_rules"/u,
      `${environment} Android protected-storage extraction exclusion was not generated`,
    );
    assert.match(
      ios,
      /["']?expo\.sqlite\.useSQLCipher["']?\s*[:=]\s*["']?true/u,
      `${environment} iOS SQLCipher build flag was not generated`,
    );
    assert.match(
      android,
      /expo\.sqlite\.useSQLCipher\s*=\s*true/u,
      `${environment} Android SQLCipher build flag was not generated`,
    );
    for (const { dataType, linked } of [
      { dataType: "NSPrivacyCollectedDataTypeName", linked: true },
      { dataType: "NSPrivacyCollectedDataTypeEmailAddress", linked: true },
      { dataType: "NSPrivacyCollectedDataTypeUserID", linked: true },
      { dataType: "NSPrivacyCollectedDataTypeProductInteraction", linked: true },
      { dataType: "NSPrivacyCollectedDataTypeCrashData", linked: false },
      { dataType: "NSPrivacyCollectedDataTypePerformanceData", linked: false },
      {
        dataType: "NSPrivacyCollectedDataTypeOtherDiagnosticData",
        linked: false,
      },
    ]) {
      assert.match(
        ios,
        new RegExp(
          `${dataType}[\\s\\S]{0,600}NSPrivacyCollectedDataTypeLinked[\\s\\S]{0,100}<${linked}\\s*/>[\\s\\S]{0,600}NSPrivacyCollectedDataTypeTracking[\\s\\S]{0,100}<false\\s*/>`,
          "u",
        ),
        `${environment} iOS privacy manifest did not declare ${dataType} with the expected linkage and no tracking`,
      );
    }
    assert.doesNotMatch(
      ios,
      /NSPrivacyCollectedDataTypeOtherUserContent/u,
      `${environment} iOS privacy manifest incorrectly declares downloaded-only Task or Group content as collected`,
    );
    assert.match(
      ios,
      /NSPrivacyCollectedDataTypePurposeAppFunctionality/u,
      `${environment} iOS app-functionality purpose was not generated`,
    );
    assert.match(
      ios,
      /NSPrivacyTracking[\s\S]{0,100}<false\s*\/>/u,
      `${environment} iOS privacy manifest unexpectedly enables tracking`,
    );
    assert.match(
      ios,
      /Upload Debug Symbols to Sentry/u,
      `${environment} iOS dSYM upload phase was not generated`,
    );
    assert.match(
      ios,
      /sentry-xcode-debug-files\.sh/u,
      `${environment} iOS debug-file uploader was not generated`,
    );
    assert.match(
      ios,
      /sentry-xcode\.sh/u,
      `${environment} iOS JavaScript source-map uploader was not generated`,
    );
    assert.match(
      android,
      /apply plugin: ["']io\.sentry\.android\.gradle["']/u,
      `${environment} Android symbol plugin was not generated`,
    );
    assert.match(
      android,
      /io\.sentry:sentry-android-gradle-plugin:5\.12\.2/u,
      `${environment} Android symbol plugin dependency was not generated`,
    );
    assert.match(
      android,
      /autoUploadProguardMapping\s*=\s*shouldSentryAutoUpload\(\)/u,
      `${environment} Android mapping upload was not generated`,
    );
    assert.match(
      android,
      /uploadNativeSymbols\s*=\s*shouldSentryAutoUpload\(\)/u,
      `${environment} Android native-symbol upload was not generated`,
    );
    assert.match(
      android,
      /includeNativeSources\s*=\s*false/u,
      `${environment} Android native source upload was not disabled`,
    );
    assert.match(
      android,
      /tracingInstrumentation\s*\{[\s\S]{0,100}enabled\s*=\s*false/u,
      `${environment} Android tracing instrumentation was not disabled`,
    );
    assert.match(
      android,
      /autoInstallation\s*\{[\s\S]{0,100}enabled\s*=\s*false/u,
      `${environment} Android Sentry dependency auto-install was not disabled`,
    );
    for (const excludedModule of [
      "sentry-android-ndk",
      "sentry-android-replay",
    ]) {
      assert.match(
        android,
        new RegExp(
          `exclude group: ["']io\\.sentry["'], module: ["']${excludedModule}["']`,
          "u",
        ),
        `${environment} Android ${excludedModule} was not excluded`,
      );
    }
    for (const generated of [ios, android]) {
      assert.match(
        generated,
        new RegExp(`defaults\\.org=${sentryFixture.organization}`, "u"),
      );
      assert.match(
        generated,
        new RegExp(`defaults\\.project=${sentryFixture.project}`, "u"),
      );
      assert.doesNotMatch(
        generated,
        new RegExp(sentryFixture.authToken, "u"),
        `${environment} generated native project persisted the Sentry auth token`,
      );
      assert.doesNotMatch(generated, /Crashlytics|PostHog/iu);
    }
    assert.match(ios, /EXUpdatesEnabled[\s\S]{0,120}<false\s*\/>/u);
    assert.match(
      ios,
      /EXUpdatesCheckOnLaunch[\s\S]{0,120}<string>NEVER<\/string>/u,
    );
    assert.doesNotMatch(
      ios,
      /EXUpdatesUseEmbeddedUpdate[\s\S]{0,120}<false\s*\/>/u,
    );
    assert.match(android, /expo\.modules\.updates\.ENABLED[\s\S]{0,160}false/u);
    assert.match(
      android,
      /expo\.modules\.updates\.EXPO_UPDATES_CHECK_ON_LAUNCH[\s\S]{0,160}NEVER/u,
    );
    assert.doesNotMatch(
      android,
      /expo\.modules\.updates\.USE_EMBEDDED_UPDATE[\s\S]{0,160}false/u,
    );

    const generated = `${ios}\n${android}`;
    assert.doesNotMatch(
      generated,
      /EXUpdatesURL|UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY|CODE_SIGNING|https:\/\/u\.expo\.dev/iu,
    );
    assert.doesNotMatch(generated, /EXUpdatesRuntimeVersion/iu);
  } finally {
    await rm(generatedRoot, { force: true, recursive: true });
  }
}

process.stdout.write(
  "Native config verification passed: 3 isolated generated iOS/Android environments; OTA disabled with embedded bundles required.\n",
);
