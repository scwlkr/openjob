/* global __dirname */

const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("node:path");

module.exports = getSentryExpoConfig(__dirname, {
  annotateReactComponents: false,
  enableSourceContextInDevelopment: false,
  includeWebReplay: false,
  injectReleaseForWeb: false,
});

// Native Tasks/Calendar sync uses the same pure runtime validation as the API.
module.exports.watchFolders = [path.resolve(__dirname, "../shared")];
module.exports.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
