declare const __dirname: string;

const { readFileSync } = jest.requireActual("node:fs") as {
  readFileSync(path: string, encoding: "utf8"): string;
};
const { join } = jest.requireActual("node:path") as {
  join(...paths: string[]): string;
};

const nativeRoot = join(__dirname, "..");

test("applies the native Sentry pre-transport allowlist on iOS and Android", () => {
  const ios = readFileSync(
    join(nativeRoot, "node_modules/@sentry/react-native/ios/RNSentry.mm"),
    "utf8",
  );
  const iosWrapper = readFileSync(
    join(nativeRoot, "node_modules/@sentry/react-native/ios/SentrySDKWrapper.m"),
    "utf8",
  );
  const android = readFileSync(
    join(
      nativeRoot,
      "node_modules/@sentry/react-native/android/src/main/java/io/sentry/react/RNSentryModuleImpl.java",
    ),
    "utf8",
  );
  const androidBuild = readFileSync(
    join(nativeRoot, "node_modules/@sentry/react-native/android/build.gradle"),
    "utf8",
  );
  const nativeSpec = readFileSync(
    join(nativeRoot, "node_modules/@sentry/react-native/src/js/NativeRNSentry.ts"),
    "utf8",
  );
  const androidOldArch = readFileSync(
    join(
      nativeRoot,
      "node_modules/@sentry/react-native/android/src/oldarch/java/io/sentry/react/RNSentryModule.java",
    ),
    "utf8",
  );
  const androidNewArch = readFileSync(
    join(
      nativeRoot,
      "node_modules/@sentry/react-native/android/src/newarch/java/io/sentry/react/RNSentryModule.java",
    ),
    "utf8",
  );

  for (const source of [ios, android]) {
    expect(source).toContain("openJobSanitizeNativeEvent");
    expect(source).toContain("OpenJob native failure");
    expect(source).toContain("unhandled_exception");
  }

  expect(ios).toContain("event.user = nil");
  expect(ios).toContain("event.request = nil");
  expect(ios).toContain("event.breadcrumbs = nil");
  expect(ios).toContain("debugMeta.codeFile = nil");
  expect(ios).toContain('@"runtime_version"');
  expect(ios).toContain('@"update_source"');
  expect(ios).toContain("openJobNativeRuntimeContext");
  expect(ios).toContain('options[@"release"] = runtime[@"runtime_version"]');
  expect(ios).toContain('options[@"initialScope"]');
  expect(iosWrapper).toContain("sentryOptions.enableAutoBreadcrumbTracking = NO");
  expect(iosWrapper).toContain("sentryOptions.enableNetworkTracking = NO");
  expect(iosWrapper).toContain("sentryOptions.enableFileIOTracing = NO");
  expect(iosWrapper).toContain("sentryOptions.enableCoreDataTracing = NO");
  expect(iosWrapper).toContain("sentryOptions.enableUIViewControllerTracing = NO");
  expect(iosWrapper).toContain("sentryOptions.enableUserInteractionTracing = NO");
  expect(iosWrapper).toContain('@"SentryCrashIntegration"');
  expect(iosWrapper).toContain('@"SentryANRTrackingIntegration"');
  expect(iosWrapper).toContain('@"SentryWatchdogTerminationTrackingIntegration"');
  expect(iosWrapper).toContain("sentryOptions.enableSwizzling = NO");
  expect(iosWrapper).toContain("sentryOptions.tracePropagationTargets = @[]");
  expect(android).toContain("event.setUser(null)");
  expect(android).toContain("event.setRequest(null)");
  expect(android).toContain("event.setBreadcrumbs(null)");
  expect(android).toContain("image.setCodeFile(null)");
  expect(android).toContain('"runtime_version"');
  expect(android).toContain('"update_source"');
  expect(android).toContain("openJobNativeRuntimeContext");
  expect(android).toContain('options.setRelease((String) runtime.get("runtime_version"))');
  expect(android).toContain("options.setDist((String) buildVersion)");
  expect(nativeSpec).toContain("fetchNativeRelease(): Promise<NativeReleaseResponse>");
  expect(android).toContain("public void fetchNativeRelease(Promise promise)");
  expect(android).toContain('release.putString("build", String.valueOf(packageInfo.versionCode))');
  for (const architecture of [androidOldArch, androidNewArch]) {
    expect(architecture).toContain("this.impl.fetchNativeRelease(promise)");
  }
  expect(ios).toContain("fetchNativeRelease : (RCTPromiseResolveBlock)resolve");
  expect(ios).toContain('@"build" : infoDict[@"CFBundleVersion"]');
  expect(android).not.toContain("event.getContexts().clear()");
  expect(android).toContain("options.enableAllAutoBreadcrumbs(false)");
  expect(android).toContain("options.setEnableAutoActivityLifecycleTracing(false)");
  expect(android).toContain("options.setCollectAdditionalContext(false)");
  expect(android).toContain("options.setEnablePerformanceV2(false)");
  expect(android).toContain("options.setEnableUserInteractionTracing(false)");
  expect(android).toContain("options.setDistinctId(null)");
  expect(android).toContain("options.setTracesSampleRate(0d)");
  expect(android).toContain("options.setProfileSessionSampleRate(0d)");
  expect(android).toContain('name.equals("SendCachedEnvelopeIntegration")');
  expect(android).toContain('name.equals("EnvelopeFileObserverIntegration")');
  expect(android).toContain('name.equals("DefaultAndroidEventProcessor")');
  expect(android).toContain("initializeOpenJobDiagnostics");
  expect(android).toContain('"share_diagnostics_enabled"');
  expect(android).toContain("setOpenJobDiagnosticsEnabled");
  expect(android).toContain("getOpenJobDiagnosticsEnabled");
  expect(android).toContain("options.setTransportGate(");
  expect(android).toContain("openJobDiagnosticsDeliveryAllowed.set(false)");
  expect(android).toContain("options.setShutdownTimeoutMillis(0)");
  expect(android).toContain("options.setFlushTimeoutMillis(2_000)");
  expect(android).not.toContain(
    "options.addIgnoredExceptionForType(JavascriptException.class)",
  );
  expect(android).toContain("openJobIsReactNativeJavaScriptWrapper(event)");
  expect(android).toContain("openJobConsumeStoredJavaScriptFatal()");
  expect(android).toContain("OPENJOB_JS_FATAL_WRAPPER_WINDOW_MILLIS");
  const androidCrash = android.slice(
    android.indexOf("public void crash()"),
    android.indexOf("public void addListener"),
  );
  expect(androidCrash).toContain("new Handler(Looper.getMainLooper()).post");
  expect(androidCrash).toContain(
    'throw new RuntimeException("OpenJob native failure")',
  );
  expect(androidCrash).not.toContain(
    'throw new RuntimeException("TEST - Sentry Client Crash (only works in release mode)")',
  );
  expect(android).toContain("currentScope.getClient().close(false)");
  expect(android).toMatch(
    /promise\.resolve\(false\);\s+return;\s+\}\s+promise\.resolve\(true\);/u,
  );
  expect(android).toContain("cacheDirPath = options.getCacheDirPath()");
  expect(android).toContain("FileUtils.deleteRecursively(new File(cacheDirPath))");
  expect(android).toContain('new File(getApplicationContext().getFilesDir(), "INSTALLATION")');
  expect(android).toContain('getDeclaredField("deviceId")');
  expect(android).toContain("getEnvelopeDiskCache().storeEnvelope(envelope, new Hint())");
  const androidCapture = android.slice(android.indexOf("public void captureEnvelope"));
  expect(androidCapture.indexOf("storeEnvelope(envelope, new Hint())"))
    .toBeLessThan(androidCapture.indexOf("SystemClock.elapsedRealtime()"));
  expect(androidCapture.indexOf("SystemClock.elapsedRealtime()"))
    .toBeLessThan(androidCapture.indexOf("promise.resolve(stored)"));
  expect(androidBuild).toContain("java.exclude '**/replay/**'");

  expect(iosWrapper).toContain(
    'stringByAppendingPathComponent:@"io.sentry"',
  );
  expect(iosWrapper).toContain(
    'stringByAppendingPathComponent:@"INSTALLATION"',
  );
  expect(iosWrapper).toContain(
    'stringByAppendingPathComponent:@"SentryCrash"',
  );
  expect(iosWrapper).toContain("removeItemAtPath:path error:nil");
  expect(iosWrapper).toContain("invalidateAndCancel");
  expect(iosWrapper).toContain("OpenJobSentryURLProtocol");
  expect(iosWrapper).toContain("drainOpenJobDiagnosticsTransport");
  expect(iosWrapper).toContain('NSClassFromString(@"SentrySDKInternal")');
  expect(iosWrapper).toContain("purgeOpenJobDiagnosticsAtPath");
  expect(ios).toContain("startOpenJobDiagnosticsIfEnabled");
  expect(ios).toContain('openJobDiagnosticsPreferenceKey = @"share_diagnostics_enabled"');
  expect(ios).toContain("setOpenJobDiagnosticsEnabled");
  expect(ios).toContain("getOpenJobDiagnosticsEnabled");
  expect(ios).toContain("[SentrySDKWrapper storeOpenJobEnvelope:envelope]");
  expect(ios).toContain("event.tags[openJobJsFatalEnvelopeStoredTag]");
  expect(ios).toContain("markerAge >= -1 && markerAge <= 10");
  expect(ios).not.toContain("std::atomic_bool");
  const iosCapture = ios.slice(ios.indexOf("RCT_EXPORT_METHOD(captureEnvelope"));
  expect(iosCapture.indexOf("storeOpenJobEnvelope:envelope"))
    .toBeLessThan(iosCapture.indexOf("setTagValue:storedAt"));
  expect(iosCapture.indexOf("setTagValue:storedAt"))
    .toBeLessThan(iosCapture.indexOf("resolve(@YES)"));
  expect(iosWrapper).toContain("fileExistsAtPath:path");
  expect(iosWrapper).toContain("storeOpenJobEnvelope");

  const androidClose = android.slice(android.indexOf("public void closeNativeSdk"));
  expect(androidClose).toContain("options.setFlushTimeoutMillis(0)");
  expect(androidClose.indexOf("options.setFlushTimeoutMillis(0)"))
    .toBeLessThan(androidClose.indexOf("currentScope.getClient().close(false)"));
  expect(androidClose.indexOf("openJobDiagnosticsDeliveryAllowed.set(false)"))
    .toBeLessThan(
      androidClose.indexOf("putBoolean(OPENJOB_DIAGNOSTICS_ENABLED, false)"),
    );
  expect(androidClose.indexOf("putBoolean(OPENJOB_DIAGNOSTICS_ENABLED, false)"))
    .toBeLessThan(androidClose.indexOf("purgeOpenJobDiagnostics(cacheDirPath)"));
  expect(androidClose.indexOf("purgeOpenJobDiagnostics(cacheDirPath)"))
    .toBeLessThan(androidClose.indexOf("currentScope.getClient().close(false)"));
  expect(androidClose.indexOf("currentScope.getClient().close(false)"))
    .toBeLessThan(androidClose.lastIndexOf("purgeOpenJobDiagnostics(cacheDirPath)"));
  const iosClose = iosWrapper.slice(iosWrapper.indexOf("+ (BOOL)close"));
  expect(iosClose.indexOf("blockOpenJobDiagnosticsDelivery"))
    .toBeLessThan(iosClose.indexOf("purgeOpenJobDiagnosticsAtPath"));
  expect(iosClose.indexOf("purgeOpenJobDiagnosticsAtPath"))
    .toBeLessThan(iosClose.indexOf("drainOpenJobDiagnosticsTransport"));
  expect(iosClose.indexOf("drainOpenJobDiagnosticsTransport"))
    .toBeLessThan(iosClose.indexOf("[SentrySDK close]"));
  expect(iosClose.indexOf("[SentrySDK close]"))
    .toBeLessThan(iosClose.lastIndexOf("purgeOpenJobDiagnosticsAtPath"));
  const iosBridgeClose = ios.slice(ios.indexOf("closeNativeSdk"));
  expect(iosBridgeClose.indexOf("openJobDiagnosticsStarted = false"))
    .toBeLessThan(iosBridgeClose.indexOf("if (!purged)"));
  expect(iosBridgeClose.indexOf("sentHybridSdkDidBecomeActive = false"))
    .toBeLessThan(iosBridgeClose.indexOf("if (!purged)"));

  const patch = readFileSync(
    join(nativeRoot, "patches/@sentry+react-native+7.11.0.patch"),
    "utf8",
  );
  for (const hardenedSource of [
    "openJobSanitizeNativeEvent",
    "enableAllAutoBreadcrumbs(false)",
    "getEnvelopeDiskCache().storeEnvelope(envelope, new Hint())",
    "getOpenJobDiagnosticsEnabled",
    "initializeOpenJobDiagnostics",
    "OpenJobSentryURLProtocol",
    "drainOpenJobDiagnosticsTransport",
    "openJobDiagnosticsDeliveryAllowed.set(false)",
    "openJobJsFatalEnvelopeStored",
    "OPENJOB_JS_FATAL_WRAPPER_WINDOW_MILLIS",
    "openJobIsReactNativeJavaScriptWrapper",
    "openJobNativeRuntimeContext",
    "new Handler(Looper.getMainLooper()).post",
    "options.setTransportGate(",
    "purgeOpenJobDiagnosticsAtPath",
    "setOpenJobDiagnosticsEnabled",
    "startOpenJobDiagnosticsIfEnabled",
    "storeOpenJobEnvelope",
  ]) {
    expect(patch).toContain(hardenedSource);
  }
  expect(patch).not.toContain("build/generated");
  expect(patch).not.toContain("build/intermediates");
  expect(patch).not.toContain("Users/shanewalker");
});

test("injects diagnostics bootstrap before React starts on both platforms", () => {
  const androidPlugin = jest.requireActual(
    "../plugins/with-sentry-android-privacy.cjs",
  ) as {
    addOpenJobDiagnosticsBootstrap(contents: string): string;
  };
  const iosPlugin = jest.requireActual(
    "../plugins/with-ios-scene-lifecycle.cjs",
  ) as {
    addDiagnosticsBootstrap(contents: string): string;
    addSentryBridgingHeader(contents: string): string;
  };
  const android = androidPlugin.addOpenJobDiagnosticsBootstrap(`package fixture

import android.app.Application

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
`);
  expect(android.indexOf("initializeOpenJobDiagnostics(this)")).toBeLessThan(
    android.indexOf("loadReactNative(this)"),
  );

  const ios = iosPlugin.addDiagnosticsBootstrap(`internal import Expo
import React
import ReactAppDependencyProvider

class AppDelegate {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
  }
}
`);
  expect(ios.indexOf("startOpenJobDiagnosticsIfEnabled()")).toBeLessThan(
    ios.indexOf("let delegate = ReactNativeDelegate()"),
  );
  expect(ios).not.toContain("import RNSentry");
  expect(
    iosPlugin.addSentryBridgingHeader("// Generated bridge header\n"),
  ).toBe("// Generated bridge header\n#import <RNSentry/RNSentry.h>\n");
});
