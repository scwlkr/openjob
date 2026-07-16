import {
  readRefreshCredential,
  writeRefreshCredential,
} from "./credential-store.mjs";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { CliError } from "./errors.mjs";

const FIREBASE_API_KEY = "AIzaSyCnk2KPwHgRu0dhJcy6QDow-hI_rEBTHaU";
const GOOGLE_DESKTOP_CLIENT_ID = "pending-desktop-client.apps.googleusercontent.com";

function firebaseApiKey(environment) {
  if (environment.NODE_ENV === "test" && environment.OPENJOB_TEST_FIREBASE_API_KEY) {
    return environment.OPENJOB_TEST_FIREBASE_API_KEY;
  }
  return FIREBASE_API_KEY;
}

export function authEndpoints(environment = process.env) {
  const key = encodeURIComponent(firebaseApiKey(environment));
  if (environment.NODE_ENV === "test" && environment.OPENJOB_TEST_AUTH_URL) {
    const base = environment.OPENJOB_TEST_AUTH_URL.replace(/\/$/, "");
    return {
      firebaseSignIn: `${base}/firebase/accounts:signInWithIdp?key=${key}`,
      firebaseToken: `${base}/firebase/token?key=${key}`,
      oauthAuthorize: `${base}/oauth/authorize`,
      oauthToken: `${base}/oauth/token`,
    };
  }
  return {
    firebaseSignIn: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${key}`,
    firebaseToken: `https://securetoken.googleapis.com/v1/token?key=${key}`,
    oauthAuthorize: "https://accounts.google.com/o/oauth2/v2/auth",
    oauthToken: "https://oauth2.googleapis.com/token",
  };
}

function googleClientId(environment) {
  if (environment.NODE_ENV === "test" && environment.OPENJOB_TEST_GOOGLE_CLIENT_ID) {
    return environment.OPENJOB_TEST_GOOGLE_CLIENT_ID;
  }
  return GOOGLE_DESKTOP_CLIENT_ID;
}

export async function loginWithGoogle({ openBrowser }, environment = process.env) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callback = await loopbackCallback(state);
  const endpoints = authEndpoints(environment);
  const authorizationUrl = new URL(endpoints.oauthAuthorize);
  authorizationUrl.search = new URLSearchParams({
    client_id: googleClientId(environment),
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: callback.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
  }).toString();

  if (openBrowser) {
    const opened = spawnSync("/usr/bin/open", [authorizationUrl.href], {
      stdio: "ignore",
    });
    if (opened.status === 0) {
      process.stderr.write("Opening Google sign-in in your browser...\n");
    } else {
      process.stderr.write(`Open this URL:\n${authorizationUrl.href}\n`);
    }
  } else {
    process.stderr.write(`Open this URL:\n${authorizationUrl.href}\n`);
  }

  try {
    const code = await callback.code;
    const oauth = await postForm(endpoints.oauthToken, {
      client_id: googleClientId(environment),
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: callback.redirectUri,
    });
    const credentialName =
      typeof oauth.id_token === "string" ? "id_token" : "access_token";
    const googleCredential = oauth[credentialName];
    if (typeof googleCredential !== "string") {
      throw new CliError("auth_failed", "Google sign-in returned no credential.", 3);
    }
    const firebaseResponse = await postJson(endpoints.firebaseSignIn, {
      postBody: new URLSearchParams({
        [credentialName]: googleCredential,
        providerId: "google.com",
      }).toString(),
      requestUri: callback.redirectUri,
      returnIdpCredential: false,
      returnSecureToken: true,
    });
    if (
      typeof firebaseResponse.idToken !== "string" ||
      typeof firebaseResponse.refreshToken !== "string"
    ) {
      throw new CliError("auth_failed", "Firebase sign-in returned no session.", 3);
    }
    await writeRefreshCredential(firebaseResponse.refreshToken, environment);
    return firebaseResponse.idToken;
  } finally {
    await callback.close();
  }
}

export async function refreshIdToken(environment = process.env) {
  const refreshCredential = await readRefreshCredential(environment);
  if (!refreshCredential) {
    throw new CliError("auth_required", "Run openjob auth login first.", 3);
  }

  let response;
  try {
    response = await fetch(authEndpoints(environment).firebaseToken, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshCredential,
      }),
    });
  } catch {
    throw new CliError(
      "service_unavailable",
      "OpenJob could not refresh authentication.",
      8,
    );
  }

  const payload = await readJson(response);
  if (!response.ok || typeof payload.id_token !== "string") {
    throw new CliError("auth_required", "Run openjob auth login again.", 3);
  }
  if (
    typeof payload.refresh_token === "string" &&
    payload.refresh_token !== refreshCredential
  ) {
    await writeRefreshCredential(payload.refresh_token, environment);
  }
  return payload.id_token;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function loopbackCallback(expectedState) {
  let resolveCode;
  let rejectCode;
  const code = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== "/callback") {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    const receivedState = url.searchParams.get("state") || "";
    if (!safeEqual(receivedState, expectedState)) {
      response.statusCode = 400;
      response.end("Invalid OAuth state. Return to OpenJob and try again.");
      rejectCode(new CliError("auth_failed", "Google sign-in state did not match.", 3));
      return;
    }
    const providerError = url.searchParams.get("error");
    const authorizationCode = url.searchParams.get("code");
    if (providerError || !authorizationCode) {
      response.statusCode = 400;
      response.end("Google sign-in was not completed. Return to OpenJob and try again.");
      rejectCode(new CliError("auth_failed", "Google sign-in was not completed.", 3));
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      "<!doctype html><title>OpenJob signed in</title><p>Sign-in received. You can close this tab and return to OpenJob.</p>",
    );
    resolveCode(authorizationCode);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const timeout = setTimeout(() => {
    rejectCode(new CliError("auth_timeout", "Google sign-in timed out.", 3));
    server.close();
  }, 5 * 60 * 1000);
  timeout.unref();
  let closed = false;
  return {
    code,
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    close: () =>
      new Promise((resolve) => {
        clearTimeout(timeout);
        if (closed || !server.listening) {
          resolve();
          return;
        }
        closed = true;
        server.close(resolve);
      }),
  };
}

function safeEqual(received, expected) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function postForm(url, values) {
  return requestAuth(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
}

async function postJson(url, value) {
  return requestAuth(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function requestAuth(url, init) {
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new CliError("service_unavailable", "OpenJob could not complete sign-in.", 8);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new CliError("auth_failed", "Google sign-in was rejected.", 3);
  }
  return payload;
}
