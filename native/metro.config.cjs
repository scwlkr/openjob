/* global __dirname */

const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname, {
  annotateReactComponents: false,
  enableSourceContextInDevelopment: false,
  includeWebReplay: false,
  injectReleaseForWeb: false,
});
