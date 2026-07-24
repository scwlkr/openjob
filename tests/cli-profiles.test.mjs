import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { configPath } from "../cli/lib/config.mjs";
import {
  CLI_PROFILE_NAMES,
  DEFAULT_CLI_PROFILE_NAME,
  resolveCliProfile,
} from "../cli/lib/profiles.mjs";

const PREVIEW_DESKTOP_CLIENT_ID =
  "550998178053-t47ol37o4hu6e8gte63r79oj52vn4u94.apps.googleusercontent.com";
const PREVIEW_USER_ID = `user_${"a".repeat(32)}`;
const PREVIEW_CREDENTIAL_DIGEST = createHash("sha256")
  .update(PREVIEW_USER_ID, "utf8")
  .digest("hex")
  .slice(0, 16);

test("production is the immutable default CLI profile", () => {
  assert.deepEqual(CLI_PROFILE_NAMES, ["production", "preview-qa-one"]);
  assert.equal(Object.isFrozen(CLI_PROFILE_NAMES), true);

  const profile = resolveCliProfile(undefined, {});

  assert.deepEqual(profile, {
    apiOrigin: "https://openjob.dev",
    configNamespace: "openjob",
    credentialAccount: "firebase-refresh-token",
    expectedUsername: null,
    expectedUserId: null,
    firebaseApiKey: "AIzaSyCnk2KPwHgRu0dhJcy6QDow-hI_rEBTHaU",
    firebaseProjectId: "openjob-dev",
    firebaseSignInUrl:
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp",
    firebaseTokenUrl: "https://securetoken.googleapis.com/v1/token",
    googleDesktopClientId:
      "1015996869029-7rsl506o6gc6sg9d7l5kl6ant3q1t4cb.apps.googleusercontent.com",
    name: "production",
    oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    oauthExchangeUrl: "https://openjob.dev/api/cli-auth/exchange",
    oauthPrompt: null,
    tier: "production",
  });
  assert.equal(DEFAULT_CLI_PROFILE_NAME, "production");
  assert.equal(Object.isFrozen(profile), true);
});

test("preview QA resolves one environment-bound immutable tuple", () => {
  const profile = resolveCliProfile("preview-qa-one", {
    OPENJOB_PREVIEW_QA_EXPECTED_USER_ID: PREVIEW_USER_ID,
  });

  assert.deepEqual(profile, {
    apiOrigin: "https://openjob-preview.walkerworlddiscord.workers.dev",
    configNamespace: "openjob-preview-qa-one",
    credentialAccount:
      `firebase-refresh-token:preview-qa-one:${PREVIEW_CREDENTIAL_DIGEST}`,
    expectedUsername: "qa-one",
    expectedUserId: PREVIEW_USER_ID,
    firebaseApiKey: "AIzaSyDcONX1KOS-mIg5koGzh5saWHZCf5-HISo",
    firebaseProjectId: "openjob-nonprod",
    firebaseSignInUrl:
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp",
    firebaseTokenUrl: "https://securetoken.googleapis.com/v1/token",
    googleDesktopClientId: PREVIEW_DESKTOP_CLIENT_ID,
    name: "preview-qa-one",
    oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    oauthExchangeUrl:
      "https://openjob-preview.walkerworlddiscord.workers.dev/api/cli-auth/exchange",
    oauthPrompt: "select_account",
    tier: "nonproduction",
  });
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(profile.credentialAccount.includes(PREVIEW_USER_ID), false);
});

test("profile selection is closed and Preview requires its 1Password identity binding", () => {
  assert.throws(
    () => resolveCliProfile("preview-qa-two", {}),
    (error) =>
      error.code === "config_invalid" &&
      /Unknown OpenJob CLI profile/u.test(error.message),
  );
  assert.throws(
    () =>
      resolveCliProfile("preview-qa-one", {
      }),
    (error) =>
      error.code === "config_invalid" &&
      /OPENJOB_PREVIEW_QA_EXPECTED_USER_ID/u.test(error.message),
  );
  assert.throws(
    () =>
      resolveCliProfile("production", {
        OPENJOB_PREVIEW_QA_EXPECTED_USER_ID: PREVIEW_USER_ID,
      }),
    (error) =>
      error.code === "config_invalid" &&
      /requires --profile preview-qa-one/u.test(error.message),
  );
});

test("runtime endpoint and test seams cannot split a non-test profile", () => {
  for (const environment of [
    { OPENJOB_API_URL: "https://override.example/api/v1" },
    { OPENJOB_TEST_AUTH_URL: "https://auth.example" },
    { OPENJOB_TEST_FIREBASE_API_KEY: "split-key" },
    { OPENJOB_TEST_GOOGLE_CLIENT_ID: "split-client" },
    { OPENJOB_CONFIG: "/tmp/split-config.json" },
    {
      OPENJOB_PREVIEW_QA_GOOGLE_OAUTH_CLIENT_ID:
        "1015996869029-7rsl506o6gc6sg9d7l5kl6ant3q1t4cb.apps.googleusercontent.com",
    },
  ]) {
    assert.throws(
      () => resolveCliProfile("production", environment),
      (error) =>
        error.code === "config_invalid" &&
        /Runtime profile overrides are test-only/u.test(error.message),
    );
  }
});

test("production and Preview use separate config and Keychain namespaces", () => {
  const production = resolveCliProfile("production", {});
  const preview = resolveCliProfile("preview-qa-one", {
    OPENJOB_PREVIEW_QA_EXPECTED_USER_ID: PREVIEW_USER_ID,
  });
  const environment = { XDG_CONFIG_HOME: "/tmp/openjob-profile-test" };

  assert.equal(
    configPath(environment, production),
    "/tmp/openjob-profile-test/openjob/config.json",
  );
  assert.equal(
    configPath(environment, preview),
    "/tmp/openjob-profile-test/openjob-preview-qa-one/config.json",
  );
  assert.notEqual(production.credentialAccount, preview.credentialAccount);
  const otherPreview = resolveCliProfile("preview-qa-one", {
    OPENJOB_PREVIEW_QA_EXPECTED_USER_ID: `user_${"b".repeat(32)}`,
  });
  assert.notEqual(preview.credentialAccount, otherPreview.credentialAccount);
  assert.doesNotMatch(preview.credentialAccount, /user_[a-f0-9]{32}/u);
});

test("test bindings become one complete hermetic profile", () => {
  const profile = resolveCliProfile("preview-qa-one", {
    NODE_ENV: "test",
    OPENJOB_API_URL: "http://127.0.0.1:45123/api/v1",
    OPENJOB_TEST_AUTH_URL: "http://127.0.0.1:46234",
    OPENJOB_TEST_FIREBASE_API_KEY: "hermetic-firebase-key",
    OPENJOB_TEST_GOOGLE_CLIENT_ID:
      "hermetic-client.apps.googleusercontent.com",
  });

  assert.deepEqual(profile, {
    apiOrigin: "http://127.0.0.1:45123",
    configNamespace: "openjob-test",
    credentialAccount: "firebase-refresh-token:test",
    expectedUsername: null,
    expectedUserId: null,
    firebaseApiKey: "hermetic-firebase-key",
    firebaseProjectId: "openjob-test",
    firebaseSignInUrl:
      "http://127.0.0.1:46234/firebase/accounts:signInWithIdp",
    firebaseTokenUrl: "http://127.0.0.1:46234/firebase/token",
    googleDesktopClientId: "hermetic-client.apps.googleusercontent.com",
    name: "test",
    oauthAuthorizeUrl: "http://127.0.0.1:46234/oauth/authorize",
    oauthExchangeUrl: "http://127.0.0.1:46234/api/cli-auth/exchange",
    oauthPrompt: null,
    tier: "test",
  });
  assert.equal(Object.isFrozen(profile), true);
});

test("a test override requires an API URL and never falls back to live endpoints", () => {
  assert.throws(
    () =>
      resolveCliProfile("production", {
        NODE_ENV: "test",
        OPENJOB_TEST_AUTH_URL: "http://127.0.0.1:46234",
      }),
    (error) =>
      error.code === "config_invalid" &&
      /OPENJOB_API_URL/u.test(error.message),
  );
});
