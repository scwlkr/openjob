import {
  readRefreshCredential,
  writeRefreshCredential,
} from "./credential-store.mjs";
import { spawnSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { CliError } from "./errors.mjs";

const FIREBASE_API_KEY = "AIzaSyCnk2KPwHgRu0dhJcy6QDow-hI_rEBTHaU";
const CLI_AUTH_URL = "https://openjob.dev/cli-auth";

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
      browserLogin: `${base}/cli-auth`,
    };
  }
  return {
    firebaseSignIn: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${key}`,
    firebaseToken: `https://securetoken.googleapis.com/v1/token?key=${key}`,
    browserLogin: CLI_AUTH_URL,
  };
}

export async function loginWithGoogle({ openBrowser }, environment = process.env) {
  const state = randomBytes(32).toString("base64url");
  const endpoints = authEndpoints(environment);
  const authorizationUrl = new URL(endpoints.browserLogin);
  const callback = await loopbackCallback(state, authorizationUrl.origin);
  authorizationUrl.search = new URLSearchParams({
    callback: callback.redirectUri,
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
    const googleIdToken = await callback.idToken;
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

async function loopbackCallback(expectedState, allowedOrigin) {
  let resolveIdToken;
  let rejectIdToken;
  const idToken = new Promise((resolve, reject) => {
    resolveIdToken = resolve;
    rejectIdToken = reject;
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method !== "POST" || url.pathname !== "/callback") {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    if (request.headers.origin !== allowedOrigin) {
      response.statusCode = 403;
      response.end("Invalid sign-in origin. Return to OpenJob and try again.");
      rejectIdToken(new CliError("auth_failed", "Google sign-in origin did not match.", 3));
      return;
    }
    response.setHeader("access-control-allow-origin", allowedOrigin);
    response.setHeader("vary", "Origin");
    let parameters;
    try {
      parameters = await readForm(request);
    } catch {
      response.statusCode = 400;
      response.end("Invalid sign-in response. Return to OpenJob and try again.");
      rejectIdToken(new CliError("auth_failed", "Google sign-in was not completed.", 3));
      return;
    }
    const receivedState = parameters.get("state") || "";
    if (!safeEqual(receivedState, expectedState)) {
      response.statusCode = 400;
      response.end("Invalid OAuth state. Return to OpenJob and try again.");
      rejectIdToken(new CliError("auth_failed", "Google sign-in state did not match.", 3));
      return;
    }
    const providerError = parameters.get("error");
    const googleIdToken = parameters.get("id_token");
    if (providerError || !googleIdToken) {
      response.statusCode = 400;
      response.end("Google sign-in was not completed. Return to OpenJob and try again.");
      rejectIdToken(new CliError("auth_failed", "Google sign-in was not completed.", 3));
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      "<!doctype html><title>OpenJob signed in</title><p>Sign-in received. You can close this tab and return to OpenJob.</p>",
    );
    resolveIdToken(googleIdToken);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const timeout = setTimeout(() => {
    rejectIdToken(new CliError("auth_timeout", "Google sign-in timed out.", 3));
    server.close();
  }, 5 * 60 * 1000);
  timeout.unref();
  let closed = false;
  return {
    idToken,
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

async function readForm(request) {
  if (!request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
    throw new Error("unexpected content type");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("sign-in response too large");
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
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
    throw new CliError("auth_failed", "Google sign-in was rejected.", 3);
  }
  return payload;
}
