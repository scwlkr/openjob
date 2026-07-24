import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootPackageUrl = new URL("../package.json", import.meta.url);
const nativePackageUrl = new URL("../native/package.json", import.meta.url);
const easUrl = new URL("../native/eas.json", import.meta.url);
const nativeReadmeUrl = new URL("../native/README.md", import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("native public config is isolated, branded, adaptive, and OTA-disabled", async () => {
  const [{ default: createAppConfig }, rootPackage] = await Promise.all([
    import(`../native/app.config.mjs?native-shell=${Date.now()}`),
    readJson(rootPackageUrl),
  ]);
  const previousEnvironment = process.env.OPENJOB_NATIVE_ENV;

  try {
    const expected = {
      development: {
        apiBaseUrl:
          "https://openjob-preview.walkerworlddiscord.workers.dev/api/v1",
        name: "OpenJob Dev",
        bundleIdentifier: "dev.openjob.app.dev",
        applicationId: "dev.openjob.app.dev",
        badge: "Development",
      },
      preview: {
        apiBaseUrl:
          "https://openjob-preview.walkerworlddiscord.workers.dev/api/v1",
        name: "OpenJob Preview",
        bundleIdentifier: "dev.openjob.app.preview",
        applicationId: "dev.openjob.app.preview",
        badge: "Preview",
      },
      production: {
        apiBaseUrl: "https://openjob.dev/api/v1",
        name: "OpenJob",
        bundleIdentifier: "dev.openjob.app",
        applicationId: "dev.openjob.app",
        badge: null,
      },
    };

    for (const [environment, identity] of Object.entries(expected)) {
      process.env.OPENJOB_NATIVE_ENV = environment;
      const config = createAppConfig({ config: {} });

      assert.equal(config.name, identity.name);
      assert.equal(config.version, rootPackage.version);
      assert.deepEqual(config.platforms, ["ios", "android"]);
      assert.equal(config.orientation, "default");
      assert.equal(config.userInterfaceStyle, "automatic");
      assert.equal(config.newArchEnabled, true);
      assert.equal(config.ios.supportsTablet, true);
      assert.equal(config.ios.usesAppleSignIn, true);
      assert.equal(config.ios.bundleIdentifier, identity.bundleIdentifier);
      assert.equal(config.android.package, identity.applicationId);
      assert.equal(config.extra.openjob.apiBasePath, "/api/v1");
      assert.equal(config.extra.openjob.apiBaseUrl, identity.apiBaseUrl);
      assert.match(config.extra.openjob.firebaseApiKey, /^AIza/u);
      assert.match(config.extra.openjob.firebaseAuthDomain, /\.firebaseapp\.com$/u);
      assert.match(
        config.extra.openjob.googleWebClientId,
        /\.apps\.googleusercontent\.com$/u,
      );
      assert.match(
        config.extra.openjob.googleIosClientId,
        /\.apps\.googleusercontent\.com$/u,
      );
      assert.match(config.extra.openjob.appleServiceId, /^dev\.openjob\.auth/u);
      assert.match(
        config.extra.openjob.appleRedirectUri,
        /^https:\/\/.*\.firebaseapp\.com\/__\/auth\/handler$/u,
      );
      assert.equal(
        config.extra.openjob.keychainService,
        `${identity.bundleIdentifier}.auth`,
      );
      assert.equal(config.extra.openjob.environment, environment);
      assert.equal(
        config.extra.openjob.qaPasswordTenantId,
        environment === "preview" ? "OpenJob-QA-Two-mvz9m" : null,
      );
      if (identity.badge === null) {
        assert.equal(
          Object.hasOwn(config.extra.openjob, "environmentBadge"),
          false,
        );
      } else {
        assert.equal(config.extra.openjob.environmentBadge, identity.badge);
      }
      assert.equal(config.extra.openjob.releaseVersion, rootPackage.version);
      assert.deepEqual(config.updates, {
        checkAutomatically: "NEVER",
        enabled: false,
        useEmbeddedUpdate: true,
      });
      assert.equal(Object.hasOwn(config, "runtimeVersion"), false);
      assert.equal(JSON.stringify(config).includes("channel"), false);
      assert.equal(JSON.stringify(config).includes("codeSigning"), false);
      assert.ok(
        config.plugins.some(
          (plugin) =>
            Array.isArray(plugin) &&
            plugin[0] === "expo-secure-store" &&
            plugin[1].configureAndroidBackup === true,
        ),
      );
      assert.ok(
        config.plugins.some(
          (plugin) =>
            Array.isArray(plugin) &&
            plugin[0] ===
              "@react-native-google-signin/google-signin" &&
            plugin[1].iosUrlScheme.startsWith(
              "com.googleusercontent.apps.",
            ),
        ),
      );
    }
  } finally {
    if (previousEnvironment === undefined) delete process.env.OPENJOB_NATIVE_ENV;
    else process.env.OPENJOB_NATIVE_ENV = previousEnvironment;
  }
});

test("native build profiles use repeatable store versioning without OTA channels", async () => {
  const eas = await readJson(easUrl);

  assert.equal(eas.cli.appVersionSource, "remote");
  assert.equal(eas.cli.requireCommit, true);
  assert.equal(eas.build.development.developmentClient, true);
  assert.equal(eas.build.development.distribution, "internal");
  assert.equal(eas.build.preview.distribution, "store");
  assert.equal(eas.build.preview.autoIncrement, true);
  assert.equal(eas.build.preview.android.buildType, "app-bundle");
  assert.equal(eas.build.production.distribution, "store");
  assert.equal(eas.build.production.autoIncrement, true);
  assert.equal(eas.build.production.android.buildType, "app-bundle");

  for (const profile of Object.values(eas.build)) {
    assert.equal(Object.hasOwn(profile, "channel"), false);
  }
});

test("native package exposes focused simulator, build, and repository-gate commands", async () => {
  const [rootPackage, nativePackage] = await Promise.all([
    readJson(rootPackageUrl),
    readJson(nativePackageUrl),
  ]);

  assert.equal(nativePackage.version, rootPackage.version);
  assert.match(nativePackage.scripts.simulators, /--ios/u);
  assert.match(nativePackage.scripts.simulators, /--android/u);
  assert.equal(
    nativePackage.scripts.ios,
    "node scripts/run-local.mjs ios development debug",
  );
  assert.equal(
    nativePackage.scripts.android,
    "node scripts/run-local.mjs android development debug",
  );
  assert.equal(
    nativePackage.scripts["ios:preview"],
    "node scripts/run-local.mjs ios preview release",
  );
  assert.equal(
    nativePackage.scripts["android:preview"],
    "node scripts/run-local.mjs android preview release",
  );
  assert.equal(
    nativePackage.scripts["ios:release"],
    "node scripts/run-local.mjs ios production release",
  );
  assert.equal(
    nativePackage.scripts["android:release"],
    "node scripts/run-local.mjs android production release",
  );
  assert.equal(typeof nativePackage.scripts["build:development:ios"], "string");
  assert.equal(typeof nativePackage.scripts["build:development:android"], "string");
  assert.equal(typeof nativePackage.scripts["build:preview"], "string");
  assert.equal(typeof nativePackage.scripts["build:production"], "string");
  assert.equal(typeof nativePackage.scripts.lint, "string");
  assert.equal(typeof nativePackage.scripts.typecheck, "string");
  assert.equal(typeof nativePackage.scripts.test, "string");
  assert.equal(typeof nativePackage.scripts["bundle:verify"], "string");
  assert.equal(
    rootPackage.scripts["native:check"],
    "npm --prefix native run check",
  );
  assert.equal(
    rootPackage.scripts["native:simulators"],
    "npm --prefix native run simulators",
  );
  assert.match(rootPackage.scripts.test, /npm run native:check/u);
  assert.equal(rootPackage.scripts.postinstall, "npm --prefix native ci");
});

test("native runbook documents both-runtime launch, builds, versioning, and offline proof", async () => {
  const runbook = await readFile(nativeReadmeUrl, "utf8");

  assert.match(runbook, /npm run native:simulators/u);
  assert.match(runbook, /build:development:ios/u);
  assert.match(runbook, /build:development:android/u);
  assert.match(runbook, /build:preview/u);
  assert.match(runbook, /build:version:get/u);
  assert.match(runbook, /--configuration Release/u);
  assert.match(runbook, /--variant release/u);
  assert.match(runbook, /ios:preview/u);
  assert.match(runbook, /android:preview/u);
  assert.match(runbook, /ios:release/u);
  assert.match(runbook, /android:release/u);
  assert.match(runbook, /networking unavailable/iu);
  assert.match(runbook, /Reduced Motion/u);
  assert.doesNotMatch(runbook, /eas update(?:\s|$)/u);
});
