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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(nativeRoot, "..");
const expo = join(nativeRoot, "node_modules", ".bin", "expo");
const environments = ["development", "preview", "production"];
const identities = JSON.parse(
  await readFile(
    join(repositoryRoot, "config", "native-identities.json"),
    "utf8",
  ),
);

function runExpo(args, { cwd = nativeRoot, environment = "production" } = {}) {
  const result = spawnSync(expo, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      OPENJOB_NATIVE_ENV: environment,
    },
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
  assert.deepEqual(config.updates, {
    checkAutomatically: "NEVER",
    enabled: false,
    useEmbeddedUpdate: true,
  });

  const serialized = JSON.stringify(config);
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
        /\.(?:entitlements|gradle|json|pbxproj|plist|properties|strings|swift|xml)$/iu.test(
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

for (const environment of environments) {
  const publicConfig = JSON.parse(
    runExpo(["config", "--type", "public", "--json"], { environment }),
  );
  assertPublicConfig(publicConfig, environment);
}

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
