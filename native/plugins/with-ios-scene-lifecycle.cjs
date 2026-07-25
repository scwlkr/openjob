const fs = require("node:fs");
const path = require("node:path");
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withMainActivity,
} = require("expo/config-plugins");

const sceneDelegate = `internal import ExpoModulesCore
import React
import UIKit

@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  private var privacyCurtain: UIView?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory else {
      fatalError(
        "SceneDelegate could not start React Native because AppDelegate did not initialize its factory."
      )
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    let browsingWebActivity = connectionOptions.userActivities.first {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: Self.launchOptions(
        url: connectionOptions.urlContexts.first?.url,
        userActivity: browsingWebActivity)
    )

    Self.route(urlContexts: connectionOptions.urlContexts)
    connectionOptions.userActivities.forEach { Self.route(userActivity: $0) }
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    hidePrivacyCurtain()
    window = nil
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    hidePrivacyCurtain()
    ExpoAppDelegateSubscriberManager.applicationDidBecomeActive(
      UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    showPrivacyCurtain()
    ExpoAppDelegateSubscriberManager.applicationWillResignActive(
      UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillEnterForeground(
      UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    showPrivacyCurtain()
    ExpoAppDelegateSubscriberManager.applicationDidEnterBackground(
      UIApplication.shared)
  }

  private func showPrivacyCurtain() {
    guard privacyCurtain == nil, let window else { return }
    let curtain = UIView(frame: window.bounds)
    curtain.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    curtain.backgroundColor = UIColor(red: 17 / 255, green: 20 / 255, blue: 26 / 255, alpha: 1)
    curtain.accessibilityIdentifier = "openjob-native-privacy-curtain"

    let label = UILabel(frame: curtain.bounds.insetBy(dx: 32, dy: 32))
    label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    label.font = .systemFont(ofSize: 22, weight: .black)
    label.numberOfLines = 0
    label.text = "OPENJOB\\nPrivate in the app switcher."
    label.textAlignment = .center
    label.textColor = .white
    curtain.addSubview(label)

    window.addSubview(curtain)
    window.bringSubviewToFront(curtain)
    privacyCurtain = curtain
  }

  private func hidePrivacyCurtain() {
    privacyCurtain?.removeFromSuperview()
    privacyCurtain = nil
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    Self.route(urlContexts: URLContexts)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    Self.route(userActivity: userActivity)
  }

  private static func launchOptions(
    url: URL?,
    userActivity: NSUserActivity?
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url {
      let urlKey = UIApplication.LaunchOptionsKey(
        rawValue: "UIApplicationLaunchOptionsURLKey")
      launchOptions[urlKey] = url
    }
    if let userActivity {
      let userActivityDictionaryKey = UIApplication.LaunchOptionsKey(
        rawValue: "UIApplicationLaunchOptionsUserActivityDictionaryKey")
      launchOptions[userActivityDictionaryKey] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": userActivity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": userActivity,
      ]
    }
    return launchOptions.isEmpty ? nil : launchOptions
  }

  private static func route(urlContexts: Set<UIOpenURLContext>) {
    for context in urlContexts {
      let options = openURLOptions(from: context.options)
      _ = ExpoAppDelegateSubscriberManager.application(
        UIApplication.shared,
        open: context.url,
        options: options)
      RCTLinkingManager.application(
        UIApplication.shared,
        open: context.url,
        options: options)
    }
  }

  private static func route(userActivity: NSUserActivity) {
    _ = ExpoAppDelegateSubscriberManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }

  private static func openURLOptions(
    from sceneOptions: UIScene.OpenURLOptions
  ) -> [UIApplication.OpenURLOptionsKey: Any] {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [
      .openInPlace: sceneOptions.openInPlace,
    ]
    if let sourceApplication = sceneOptions.sourceApplication {
      options[.sourceApplication] = sourceApplication
    }
    if let annotation = sceneOptions.annotation {
      options[.annotation] = annotation
    }
    return options
  }
}
`;

function addDiagnosticsBootstrap(contents) {
  if (contents.includes("openjob-native-diagnostics-bootstrap")) return contents;
  const importAnchor = "import ReactAppDependencyProvider\n";
  const launchAnchor = `  ) -> Bool {
    let delegate = ReactNativeDelegate()
`;
  if (!contents.includes(importAnchor) || !contents.includes(launchAnchor)) {
    throw new Error(
      "OpenJob diagnostics bootstrap could not find the generated AppDelegate template.",
    );
  }
  return contents.replace(
      launchAnchor,
      `  ) -> Bool {
    // openjob-native-diagnostics-bootstrap
    RNSentry.startOpenJobDiagnosticsIfEnabled()
    let delegate = ReactNativeDelegate()
`,
    );
}

function addSentryBridgingHeader(contents) {
  const sentryImport = "#import <RNSentry/RNSentry.h>";
  if (contents.includes(sentryImport)) return contents;
  return `${contents.trimEnd()}\n${sentryImport}\n`;
}

function migrateAppDelegate(contents) {
  if (!contents.includes("UIWindow(frame: UIScreen.main.bounds)")) {
    return addDiagnosticsBootstrap(contents);
  }

  const legacyStart = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;
  const legacyLinking = `  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
`;

  for (const anchor of [legacyStart, legacyLinking]) {
    if (!contents.includes(anchor)) {
      throw new Error(
        `OpenJob iOS scene lifecycle plugin could not migrate the generated AppDelegate template near ${JSON.stringify(anchor.slice(0, 48))}.`,
      );
    }
  }

  const sceneStart = `    // The scene delegate owns the window and starts React Native.
`;

  return addDiagnosticsBootstrap(
    contents.replace(legacyStart, sceneStart).replace(legacyLinking, ""),
  );
}

function addAndroidPrivacyCurtain(contents) {
  if (contents.includes("openjob-native-privacy-curtain")) return contents;
  const importAnchor = "import android.os.Bundle\n";
  const classAnchor = "class MainActivity : ReactActivity() {\n";
  const componentAnchor = `  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
`;
  const createAnchor = "    super.onCreate(null)\n";
  for (const anchor of [
    importAnchor,
    classAnchor,
    componentAnchor,
    createAnchor,
  ]) {
    if (!contents.includes(anchor)) {
      throw new Error(
        "OpenJob native privacy curtain could not find the generated MainActivity template.",
      );
    }
  }

  const privacyImports = `import android.content.ComponentCallbacks2
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import com.facebook.react.modules.core.DeviceEventManagerModule
`;
  const privacyLifecycle = `  // openjob-native-privacy-curtain
  private var openJobPrivacyCurtain: View? = null

  private fun showOpenJobPrivacyCurtain() {
    if (openJobPrivacyCurtain != null) return
    val curtain = FrameLayout(this).apply {
      setBackgroundColor(Color.rgb(17, 20, 26))
      isClickable = true
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }
    val label = TextView(this).apply {
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      text = "OPENJOB\\nPrivate in the app switcher."
      textSize = 22f
      typeface = android.graphics.Typeface.DEFAULT_BOLD
    }
    curtain.addView(
      label,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    addContentView(
      curtain,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    openJobPrivacyCurtain = curtain
  }

  private fun hideOpenJobPrivacyCurtain() {
    (openJobPrivacyCurtain?.parent as? ViewGroup)?.removeView(openJobPrivacyCurtain)
    openJobPrivacyCurtain = null
  }

  override fun onPause() {
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    showOpenJobPrivacyCurtain()
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    hideOpenJobPrivacyCurtain()
    window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
  }

  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    if (level < ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) return
    runCatching {
      reactInstanceManager.currentReactContext
        ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("openjobMemoryPressure", level)
    }
  }

`;

  return contents
    .replace(importAnchor, `${importAnchor}${privacyImports}`)
    .replace(classAnchor, `${classAnchor}${privacyLifecycle}`)
    .replace(componentAnchor, componentAnchor)
    .replace(
      createAnchor,
      `${createAnchor}    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {\n      setRecentsScreenshotEnabled(false)\n    }\n`,
    );
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (infoPlistConfig) => {
    infoPlistConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName:
              "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return infoPlistConfig;
  });

  config = withAppDelegate(config, (appDelegateConfig) => {
    appDelegateConfig.modResults.contents = migrateAppDelegate(
      appDelegateConfig.modResults.contents,
    );
    return appDelegateConfig;
  });

  config = withDangerousMod(config, ["ios", async (dangerousConfig) => {
    const sourceRoot = IOSConfig.Paths.getSourceRoot(
      dangerousConfig.modRequest.projectRoot,
    );
    const bridgingHeaderPath = path.join(
      sourceRoot,
      `${path.basename(sourceRoot)}-Bridging-Header.h`,
    );
    const contents = await fs.promises.readFile(bridgingHeaderPath, "utf8");
    await fs.promises.writeFile(
      bridgingHeaderPath,
      addSentryBridgingHeader(contents),
    );
    return dangerousConfig;
  }]);

  config = withMainActivity(config, (mainActivityConfig) => {
    mainActivityConfig.modResults.contents = addAndroidPrivacyCurtain(
      mainActivityConfig.modResults.contents,
    );
    return mainActivityConfig;
  });

  return IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
    contents: sceneDelegate,
    filePath: "SceneDelegate.swift",
    overwrite: true,
  });
}

module.exports = withIosSceneLifecycle;
module.exports.addDiagnosticsBootstrap = addDiagnosticsBootstrap;
module.exports.addSentryBridgingHeader = addSentryBridgingHeader;
module.exports.migrateAppDelegate = migrateAppDelegate;
module.exports.addAndroidPrivacyCurtain = addAndroidPrivacyCurtain;
module.exports.sceneDelegate = sceneDelegate;
