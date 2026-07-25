const {
  AndroidConfig,
  CodeGenerator,
  withAndroidManifest,
  withMainApplication,
  withProjectBuildGradle,
} = require("expo/config-plugins");

const tag = "openjob-sentry-android-privacy";

function excludeUnusedSentryAndroidModules(contents) {
  return CodeGenerator.mergeContents({
    anchor: /^apply plugin: ["']com\.facebook\.react\.rootproject["']\s*$/m,
    comment: "//",
    newSrc: [
      "subprojects {",
      "  configurations.configureEach {",
      "    exclude group: 'io.sentry', module: 'sentry-android-ndk'",
      "    exclude group: 'io.sentry', module: 'sentry-android-replay'",
      "  }",
      "}",
    ].join("\n"),
    offset: 1,
    src: contents,
    tag,
  }).contents;
}

function removeSentryPerformanceProvider(androidManifest) {
  AndroidConfig.Manifest.ensureToolsAvailable(androidManifest);
  const application =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const providerName = "io.sentry.android.core.SentryPerformanceProvider";
  application.provider ??= [];
  const existing = application.provider.find(
    (provider) => provider.$?.["android:name"] === providerName,
  );
  const removal = {
    "android:name": providerName,
    "tools:node": "remove",
  };
  if (existing) existing.$ = removal;
  else application.provider.push({ $: removal });
  return androidManifest;
}

function setOpenJobDiagnosticsMetadata(androidManifest, { dsn, environment }) {
  const application =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  application["meta-data"] ??= [];
  const values = {
    "dev.openjob.sentry.dsn": dsn ?? "",
    "dev.openjob.sentry.environment": environment,
  };
  for (const [name, value] of Object.entries(values)) {
    const existing = application["meta-data"].find(
      (entry) => entry.$?.["android:name"] === name,
    );
    const attributes = { "android:name": name, "android:value": value };
    if (existing) existing.$ = attributes;
    else application["meta-data"].push({ $: attributes });
  }
  return androidManifest;
}

function addOpenJobDiagnosticsBootstrap(contents) {
  if (contents.includes("openjob-native-diagnostics-bootstrap")) return contents;
  const importAnchor = "import android.app.Application\n";
  const launchAnchor = "    super.onCreate()\n";
  if (!contents.includes(importAnchor) || !contents.includes(launchAnchor)) {
    throw new Error(
      "OpenJob diagnostics bootstrap could not find the generated MainApplication template.",
    );
  }
  return contents
    .replace(
      importAnchor,
      `${importAnchor}import io.sentry.react.RNSentryModuleImpl\n`,
    )
    .replace(
      launchAnchor,
      `${launchAnchor}    // openjob-native-diagnostics-bootstrap\n    RNSentryModuleImpl.initializeOpenJobDiagnostics(this)\n`,
    );
}

module.exports = function withSentryAndroidPrivacy(config) {
  const diagnostics = config.extra?.openjob;
  config = withProjectBuildGradle(config, (buildGradleConfig) => {
    buildGradleConfig.modResults.contents = excludeUnusedSentryAndroidModules(
      buildGradleConfig.modResults.contents,
    );
    return buildGradleConfig;
  });
  config = withMainApplication(config, (mainApplicationConfig) => {
    mainApplicationConfig.modResults.contents = addOpenJobDiagnosticsBootstrap(
      mainApplicationConfig.modResults.contents,
    );
    return mainApplicationConfig;
  });
  return withAndroidManifest(config, (androidManifestConfig) => {
    androidManifestConfig.modResults = removeSentryPerformanceProvider(
      androidManifestConfig.modResults,
    );
    androidManifestConfig.modResults = setOpenJobDiagnosticsMetadata(
      androidManifestConfig.modResults,
      {
        dsn: diagnostics?.diagnosticsDsn,
        environment: diagnostics?.environment,
      },
    );
    return androidManifestConfig;
  });
};

module.exports.addOpenJobDiagnosticsBootstrap = addOpenJobDiagnosticsBootstrap;
module.exports.excludeUnusedSentryAndroidModules =
  excludeUnusedSentryAndroidModules;
module.exports.removeSentryPerformanceProvider = removeSentryPerformanceProvider;
module.exports.setOpenJobDiagnosticsMetadata = setOpenJobDiagnosticsMetadata;
