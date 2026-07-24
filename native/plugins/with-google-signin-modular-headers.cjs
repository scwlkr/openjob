const { CodeGenerator, withPodfile } = require("expo/config-plugins");

const tag = "openjob-google-signin-modular-headers";

function addGoogleSignInModularHeaders(contents) {
  return CodeGenerator.mergeContents({
    anchor: /^\s*use_expo_modules!\s*$/m,
    comment: "#",
    newSrc: [
      "  pod 'GoogleUtilities', :modular_headers => true",
      "  pod 'RecaptchaInterop', :modular_headers => true",
    ].join("\n"),
    offset: 1,
    src: contents,
    tag,
  }).contents;
}

module.exports = function withGoogleSignInModularHeaders(config) {
  return withPodfile(config, (podfileConfig) => {
    podfileConfig.modResults.contents = addGoogleSignInModularHeaders(
      podfileConfig.modResults.contents,
    );
    return podfileConfig;
  });
};

module.exports.addGoogleSignInModularHeaders =
  addGoogleSignInModularHeaders;
