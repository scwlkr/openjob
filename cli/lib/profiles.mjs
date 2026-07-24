import { createHash } from "node:crypto";
import { CliError } from "./errors.mjs";
import {
  GOOGLE_DESKTOP_CLIENT_ID,
  GOOGLE_PREVIEW_QA_DESKTOP_CLIENT_ID,
} from "./oauth-config.mjs";

export const DEFAULT_CLI_PROFILE_NAME = "production";
export const CLI_PROFILE_NAMES = Object.freeze([
  DEFAULT_CLI_PROFILE_NAME,
  "preview-qa-one",
]);

const TEST_PROFILE_BINDINGS = Object.freeze([
  "OPENJOB_API_URL",
  "OPENJOB_TEST_AUTH_URL",
  "OPENJOB_TEST_FIREBASE_API_KEY",
  "OPENJOB_TEST_GOOGLE_CLIENT_ID",
]);

const PRODUCTION_PROFILE = Object.freeze({
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
  googleDesktopClientId: GOOGLE_DESKTOP_CLIENT_ID,
  name: DEFAULT_CLI_PROFILE_NAME,
  oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  oauthExchangeUrl: "https://openjob.dev/api/cli-auth/exchange",
  oauthPrompt: null,
  tier: "production",
});

const PREVIEW_QA_PROFILE = Object.freeze({
  apiOrigin: "https://openjob-preview.walkerworlddiscord.workers.dev",
  configNamespace: "openjob-preview-qa-one",
  credentialAccount: "firebase-refresh-token:preview-qa-one",
  expectedUsername: "qa-one",
  firebaseApiKey: "AIzaSyDcONX1KOS-mIg5koGzh5saWHZCf5-HISo",
  firebaseProjectId: "openjob-nonprod",
  firebaseSignInUrl:
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp",
  firebaseTokenUrl: "https://securetoken.googleapis.com/v1/token",
  googleDesktopClientId: GOOGLE_PREVIEW_QA_DESKTOP_CLIENT_ID,
  name: "preview-qa-one",
  oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  oauthExchangeUrl:
    "https://openjob-preview.walkerworlddiscord.workers.dev/api/cli-auth/exchange",
  oauthPrompt: "select_account",
  tier: "nonproduction",
});

function invalidProfile(message) {
  return new CliError("config_invalid", message, 2);
}

function requestedTestOverride(environment) {
  return Object.keys(environment).some(
    (name) =>
      name === "OPENJOB_API_URL" ||
      name === "OPENJOB_CONFIG" ||
      name === "OPENJOB_PREVIEW_QA_GOOGLE_OAUTH_CLIENT_ID" ||
      name.startsWith("OPENJOB_TEST_"),
  );
}

function requiredTestBinding(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    throw invalidProfile(
      `A hermetic CLI test profile requires ${TEST_PROFILE_BINDINGS.join(", ")}.`,
    );
  }
  return value;
}

function parsedUrl(value, label, { api = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalidProfile(`${label} must be a valid URL.`);
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw invalidProfile(`${label} must use HTTPS or test loopback HTTP.`);
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (api && url.pathname.replace(/\/$/, "") !== "/api/v1")
  ) {
    throw invalidProfile(`${label} does not match the CLI profile boundary.`);
  }
  return url;
}

function testProfile(environment) {
  const apiUrl = parsedUrl(
    requiredTestBinding(environment, "OPENJOB_API_URL"),
    "OPENJOB_API_URL",
    { api: true },
  );
  const authUrl = parsedUrl(
    requiredTestBinding(environment, "OPENJOB_TEST_AUTH_URL"),
    "OPENJOB_TEST_AUTH_URL",
  );
  if (authUrl.pathname !== "/" && authUrl.pathname !== "") {
    throw invalidProfile(
      "OPENJOB_TEST_AUTH_URL must contain only the test service origin.",
    );
  }
  const expectedUsername = environment.OPENJOB_TEST_EXPECTED_USERNAME || null;
  const expectedUserId = environment.OPENJOB_TEST_EXPECTED_USER_ID || null;
  if ((expectedUsername === null) !== (expectedUserId === null)) {
    throw invalidProfile(
      "A test identity binding requires both OPENJOB_TEST_EXPECTED_USERNAME and OPENJOB_TEST_EXPECTED_USER_ID.",
    );
  }
  return Object.freeze({
    apiOrigin: apiUrl.origin,
    configNamespace: "openjob-test",
    credentialAccount: "firebase-refresh-token:test",
    expectedUsername,
    expectedUserId,
    firebaseApiKey: requiredTestBinding(
      environment,
      "OPENJOB_TEST_FIREBASE_API_KEY",
    ),
    firebaseProjectId: "openjob-test",
    firebaseSignInUrl: `${authUrl.origin}/firebase/accounts:signInWithIdp`,
    firebaseTokenUrl: `${authUrl.origin}/firebase/token`,
    googleDesktopClientId: requiredTestBinding(
      environment,
      "OPENJOB_TEST_GOOGLE_CLIENT_ID",
    ),
    name: "test",
    oauthAuthorizeUrl: `${authUrl.origin}/oauth/authorize`,
    oauthExchangeUrl: `${authUrl.origin}/api/cli-auth/exchange`,
    oauthPrompt: null,
    tier: "test",
  });
}

function previewQaProfile(environment) {
  const expectedUserId = environment.OPENJOB_PREVIEW_QA_EXPECTED_USER_ID;
  if (
    typeof expectedUserId !== "string" ||
    !/^user_[a-f0-9]{32}$/u.test(expectedUserId)
  ) {
    throw invalidProfile(
      "OPENJOB_PREVIEW_QA_EXPECTED_USER_ID must contain the 1Password-bound Preview QA User ID.",
    );
  }
  const identityDigest = createHash("sha256")
    .update(expectedUserId, "utf8")
    .digest("hex")
    .slice(0, 16);
  return Object.freeze({
    ...PREVIEW_QA_PROFILE,
    credentialAccount: `${PREVIEW_QA_PROFILE.credentialAccount}:${identityDigest}`,
    expectedUserId,
  });
}

export function resolveCliProfile(
  name = DEFAULT_CLI_PROFILE_NAME,
  environment = process.env,
) {
  if (!CLI_PROFILE_NAMES.includes(name)) {
    throw invalidProfile(
      `Unknown OpenJob CLI profile. Use ${CLI_PROFILE_NAMES.join(" or ")}.`,
    );
  }
  if (
    name !== "preview-qa-one" &&
    Object.hasOwn(environment, "OPENJOB_PREVIEW_QA_EXPECTED_USER_ID")
  ) {
    throw invalidProfile(
      "OPENJOB_PREVIEW_QA_EXPECTED_USER_ID requires --profile preview-qa-one.",
    );
  }

  const hasTestOverride = requestedTestOverride(environment);
  if (hasTestOverride && environment.NODE_ENV !== "test") {
    throw invalidProfile(
      "Runtime profile overrides are test-only. Select an approved CLI profile.",
    );
  }
  if (hasTestOverride) return testProfile(environment);

  return name === DEFAULT_CLI_PROFILE_NAME
    ? PRODUCTION_PROFILE
    : previewQaProfile(environment);
}
