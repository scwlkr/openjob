import {
  readRefreshCredential,
  writeRefreshCredential,
} from "./credential-store.mjs";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { CliError } from "./errors.mjs";
import { resolveCliProfile } from "./profiles.mjs";

export function authEndpoints(
  environment = process.env,
  profile = resolveCliProfile(undefined, environment),
) {
  const key = encodeURIComponent(profile.firebaseApiKey);
  return {
    firebaseSignIn: `${profile.firebaseSignInUrl}?key=${key}`,
    firebaseToken: `${profile.firebaseTokenUrl}?key=${key}`,
    oauthAuthorize: profile.oauthAuthorizeUrl,
    oauthExchange: profile.oauthExchangeUrl,
  };
}

export async function loginWithGoogle(
  { openBrowser },
  environment = process.env,
  profile = resolveCliProfile(undefined, environment),
) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callback = await loopbackCallback(state);
  const endpoints = authEndpoints(environment, profile);
  const authorizationUrl = new URL(endpoints.oauthAuthorize);
  const authorizationParameters = new URLSearchParams({
    client_id: profile.googleDesktopClientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: callback.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
  });
  if (profile.oauthPrompt) {
    authorizationParameters.set("prompt", profile.oauthPrompt);
  }
  authorizationUrl.search = authorizationParameters.toString();

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
    const exchange = await postJson(endpoints.oauthExchange, {
      code,
      codeVerifier: verifier,
      redirectUri: callback.redirectUri,
    });
    const googleIdToken = exchange.data?.idToken;
    if (typeof googleIdToken !== "string") {
      throw new CliError("auth_failed", "Google sign-in returned no credential.", 3);
    }
    const firebaseResponse = await postJson(endpoints.firebaseSignIn, {
      postBody: new URLSearchParams({
        id_token: googleIdToken,
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
    return {
      idToken: firebaseResponse.idToken,
      refreshToken: firebaseResponse.refreshToken,
    };
  } finally {
    await callback.close();
  }
}

export async function refreshIdToken(
  environment = process.env,
  profile = resolveCliProfile(undefined, environment),
) {
  const refreshCredential = await readRefreshCredential(environment, profile);
  if (!refreshCredential) {
    throw new CliError("auth_required", "Run openjob auth login first.", 3);
  }

  let response;
  try {
    response = await fetch(authEndpoints(environment, profile).firebaseToken, {
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
    await writeRefreshCredential(payload.refresh_token, environment, profile);
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
    if (request.method === "GET" && url.pathname === "/complete") {
      response.setHeader("cache-control", "no-store");
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.setHeader("referrer-policy", "no-referrer");
      response.end(
        "<!doctype html><title>OpenJob signed in</title><p>Sign-in received. You can close this tab and return to OpenJob.</p>",
      );
      return;
    }
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
    response.statusCode = 303;
    response.setHeader("cache-control", "no-store");
    response.setHeader("location", "/complete");
    response.setHeader("referrer-policy", "no-referrer");
    response.end();
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
    const errorCode = payload?.error?.code;
    if (response.status === 429 || errorCode === "rate_limited") {
      throw new CliError("rate_limited", "Try again later.", 7);
    }
    if (response.status >= 500 || errorCode === "service_unavailable") {
      throw new CliError(
        "service_unavailable",
        "OpenJob could not complete sign-in.",
        8,
      );
    }
    throw new CliError("auth_failed", "Google sign-in was rejected.", 3);
  }
  return payload;
}
