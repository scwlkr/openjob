import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../cli/openjob.mjs", import.meta.url));

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    input: options.input,
  });
}

function runCliAsync(args, options = {}) {
  const running = startCli(args, options);
  running.child.stdin.end(options.input);
  return running.result;
}

function startCli(args, options = {}) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const result = new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  return { child, result };
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function requestBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

test("production CLI exposes the executable contract separately from the simulator", () => {
  const help = runCli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^OpenJob\n\nUsage:/);
  assert.doesNotMatch(help.stdout, /prototype|simulator|no network/i);
  assert.equal(help.stderr, "");

  const version = runCli(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, "openjob 0.0.5\n");
  assert.equal(version.stderr, "");

  const authHelp = runCli(["help", "auth"]);
  assert.equal(authHelp.status, 0, authHelp.stderr);
  assert.match(authHelp.stdout, /openjob auth login \[--no-open\]/);
  assert.match(authHelp.stdout, /openjob auth status/);
  assert.match(authHelp.stdout, /openjob auth logout/);

  const groupHelp = runCli(["help", "group"]);
  assert.equal(groupHelp.status, 0, groupHelp.stderr);
  assert.match(groupHelp.stdout, /openjob group list/);
  assert.match(groupHelp.stdout, /openjob group create --name <name>/);
  assert.match(groupHelp.stdout, /openjob group show \[--group <group-id>\]/);
  assert.match(groupHelp.stdout, /openjob group use <group-id>/);
  assert.match(groupHelp.stdout, /openjob group current/);
});

test("group current resolves explicit flag, environment, then local config", () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-config-"));
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({ currentGroupId: "grp_config" }));

  try {
    const config = runCli(["group", "current", "--format", "json"], {
      env: { OPENJOB_CONFIG: configPath, OPENJOB_GROUP_ID: "" },
    });
    assert.equal(config.status, 0, config.stderr);
    assert.deepEqual(JSON.parse(config.stdout), {
      data: { groupId: "grp_config", source: "config" },
    });
    assert.equal(config.stderr, "");

    const environment = runCli(["group", "current", "--format", "json"], {
      env: { OPENJOB_CONFIG: configPath, OPENJOB_GROUP_ID: "grp_environment" },
    });
    assert.equal(environment.status, 0, environment.stderr);
    assert.deepEqual(JSON.parse(environment.stdout), {
      data: { groupId: "grp_environment", source: "environment" },
    });

    const explicit = runCli(
      ["group", "current", "--group", "grp_explicit", "--format", "json"],
      { env: { OPENJOB_CONFIG: configPath, OPENJOB_GROUP_ID: "grp_environment" } },
    );
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.deepEqual(JSON.parse(explicit.stdout), {
      data: { groupId: "grp_explicit", source: "flag" },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("auth status reports a stable missing-auth error without stdout", () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-auth-"));
  try {
    const result = runCli(["auth", "status", "--format", "json"], {
      env: {
        NODE_ENV: "test",
        OPENJOB_TEST_CREDENTIAL_FILE: join(directory, "credential"),
      },
    });
    assert.equal(result.status, 3);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      error: {
        code: "auth_required",
        message: "Run openjob auth login first.",
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("auth status refreshes in memory and never prints credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-session-"));
  const credentialPath = join(directory, "credential");
  const originalRefresh = "firebase-refresh-original-secret";
  const rotatedRefresh = "firebase-refresh-rotated-secret";
  const idToken = "firebase-id-token-process-only-secret";
  writeFileSync(credentialPath, originalRefresh, { mode: 0o600 });
  const calls = [];

  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
    calls.push({ body, headers: request.headers, method: request.method, url: request.url });
    if (request.url === "/firebase/token?key=test-api-key") {
      assert.equal(request.method, "POST");
      assert.equal(
        body,
        `grant_type=refresh_token&refresh_token=${originalRefresh}`,
      );
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          expires_in: "3600",
          id_token: idToken,
          refresh_token: rotatedRefresh,
          user_id: "user_scwlkr",
        }),
      );
      return;
    }
    if (request.url === "/api/v1/me") {
      assert.equal(request.headers.authorization, `Bearer ${idToken}`);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          data: {
            userId: "user_scwlkr",
            username: "scwlkr",
            usernameRequired: false,
            groups: [],
          },
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  try {
    const result = await runCliAsync(["auth", "status", "--format", "json"], {
      env: {
        NODE_ENV: "test",
        OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
        OPENJOB_TEST_AUTH_URL: service.baseUrl,
        OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
        OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      data: {
        signedIn: true,
        userId: "user_scwlkr",
        username: "scwlkr",
        usernameRequired: false,
      },
    });
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout + result.stderr, /process-only-secret|refresh-/);
    assert.equal(calls.length, 2);
    assert.equal(await import("node:fs").then(({ readFileSync }) => readFileSync(credentialPath, "utf8")), rotatedRefresh);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("auth login uses state, PKCE, random loopback, and stores only Firebase refresh", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-login-"));
  const credentialPath = join(directory, "credential");
  const googleAccessToken = "google-oauth-access-process-only-secret";
  const firebaseIdToken = "firebase-id-token-process-only-secret";
  const firebaseRefresh = "firebase-refresh-keychain-only-secret";
  let authorizationUrl;
  let tokenExchange;
  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
    if (request.url === "/oauth/token") {
      tokenExchange = new URLSearchParams(body);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ access_token: googleAccessToken, expires_in: 3600 }),
      );
      return;
    }
    if (request.url === "/firebase/accounts:signInWithIdp?key=test-api-key") {
      const payload = JSON.parse(body);
      assert.equal(payload.requestUri, authorizationUrl.searchParams.get("redirect_uri"));
      const assertion = new URLSearchParams(payload.postBody);
      assert.equal(assertion.get("access_token"), googleAccessToken);
      assert.equal(assertion.get("providerId"), "google.com");
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          idToken: firebaseIdToken,
          refreshToken: firebaseRefresh,
          expiresIn: "3600",
        }),
      );
      return;
    }
    if (request.url === "/api/v1/me") {
      assert.equal(request.headers.authorization, `Bearer ${firebaseIdToken}`);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          data: {
            userId: "user_scwlkr",
            username: null,
            usernameRequired: true,
            groups: [],
          },
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  try {
    const running = startCli(["auth", "login", "--no-open", "--format", "json"], {
      env: {
        NODE_ENV: "test",
        OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
        OPENJOB_TEST_AUTH_URL: service.baseUrl,
        OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
        OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
        OPENJOB_TEST_GOOGLE_CLIENT_ID: "desktop-client.apps.googleusercontent.com",
      },
    });
    running.child.stdin.end();

    authorizationUrl = await new Promise((resolve, reject) => {
      let stderr = "";
      const timeout = setTimeout(() => reject(new Error("login URL was not emitted")), 5000);
      running.child.stderr.setEncoding("utf8");
      running.child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = stderr.match(/Open this URL:\n(https?:\/\/[^\n]+)\n/);
        if (match) {
          clearTimeout(timeout);
          resolve(new URL(match[1]));
        }
      });
    });

    assert.equal(authorizationUrl.origin, service.baseUrl);
    assert.equal(authorizationUrl.pathname, "/oauth/authorize");
    assert.equal(
      authorizationUrl.searchParams.get("client_id"),
      "desktop-client.apps.googleusercontent.com",
    );
    assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.match(authorizationUrl.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
    const redirectUri = new URL(authorizationUrl.searchParams.get("redirect_uri"));
    assert.equal(redirectUri.hostname, "127.0.0.1");
    assert.notEqual(redirectUri.port, "0");

    const callback = new URL(redirectUri);
    callback.searchParams.set("code", "one-time-google-code");
    callback.searchParams.set("state", authorizationUrl.searchParams.get("state"));
    const callbackResponse = await fetch(callback);
    assert.equal(callbackResponse.status, 200);
    assert.match(await callbackResponse.text(), /return to OpenJob/i);

    const result = await running.result;
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      data: {
        userId: "user_scwlkr",
        username: null,
        usernameRequired: true,
        groups: [],
      },
    });
    assert.match(result.stderr, /^Open this URL:\nhttp:\/\/127\.0\.0\.1:/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /one-time-google-code|process-only-secret|keychain-only-secret/,
    );
    assert.equal(tokenExchange.get("code"), "one-time-google-code");
    assert.equal(tokenExchange.get("client_secret"), null);
    const challenge = createHash("sha256")
      .update(tokenExchange.get("code_verifier"))
      .digest("base64url");
    assert.equal(challenge, authorizationUrl.searchParams.get("code_challenge"));
    assert.equal(
      await import("node:fs").then(({ readFileSync }) =>
        readFileSync(credentialPath, "utf8"),
      ),
      firebaseRefresh,
    );
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("auth logout deletes the stored refresh credential without network access", () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-logout-"));
  const credentialPath = join(directory, "credential");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  try {
    const first = runCli(["auth", "logout", "--format", "json"], {
      env: {
        NODE_ENV: "test",
        OPENJOB_API_URL: "http://127.0.0.1:1/api/v1",
        OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
      },
    });
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), { data: { signedIn: false } });
    assert.equal(first.stderr, "");
    assert.equal(existsSync(credentialPath), false);

    const repeated = runCli(["auth", "logout", "--format", "json"], {
      env: {
        NODE_ENV: "test",
        OPENJOB_API_URL: "http://127.0.0.1:1/api/v1",
        OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
      },
    });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(JSON.parse(repeated.stdout), { data: { signedIn: false } });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("user show and username claim use the shared identity API", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-identity-"));
  const credentialPath = join(directory, "credential");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  const calls = [];
  const currentUser = {
    data: {
      userId: "user_scwlkr",
      username: "scwlkr",
      usernameRequired: false,
      groups: [],
    },
  };
  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
    calls.push({ body, method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/firebase/token?key=test-api-key") {
      response.end(
        JSON.stringify({
          id_token: "firebase-id-token-process-only-secret",
          refresh_token: "firebase-refresh-keychain-only-secret",
        }),
      );
      return;
    }
    assert.equal(
      request.headers.authorization,
      "Bearer firebase-id-token-process-only-secret",
    );
    if (request.url === "/api/v1/me" && request.method === "GET") {
      response.end(JSON.stringify(currentUser));
      return;
    }
    if (request.url === "/api/v1/me/username" && request.method === "PUT") {
      assert.deepEqual(JSON.parse(body), { username: "scwlkr" });
      response.end(JSON.stringify(currentUser));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found", message: "Missing." } }));
  });
  const environment = {
    NODE_ENV: "test",
    OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
    OPENJOB_TEST_AUTH_URL: service.baseUrl,
    OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
    OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
  };

  try {
    const show = await runCliAsync(["user", "show", "--format", "json"], {
      env: environment,
    });
    assert.equal(show.status, 0, show.stderr);
    assert.deepEqual(JSON.parse(show.stdout), currentUser);
    assert.equal(show.stderr, "");

    const claim = await runCliAsync(
      ["username", "claim", "@scwlkr", "--format", "json"],
      { env: environment },
    );
    assert.equal(claim.status, 0, claim.stderr);
    assert.deepEqual(JSON.parse(claim.stdout), currentUser);
    assert.equal(claim.stderr, "");
    assert.equal(calls.length, 4);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Group commands paginate, create, inspect, and persist verified selection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-groups-"));
  const credentialPath = join(directory, "credential");
  const configPath = join(directory, "openjob", "config.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  const calls = [];
  const groups = {
    config: {
      groupId: "grp_selected",
      name: "Selected Group",
      role: "member",
      createdAt: "2026-07-16T12:00:00Z",
    },
    created: {
      groupId: "grp_created",
      name: "Field Ops",
      role: "admin",
      createdAt: "2026-07-16T12:00:00Z",
    },
    explicit: {
      groupId: "grp_explicit",
      name: "Explicit Group",
      role: "admin",
      createdAt: "2026-07-16T12:00:00Z",
    },
  };
  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
    calls.push({ body, method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/firebase/token?key=test-api-key") {
      response.end(
        JSON.stringify({
          id_token: "firebase-id-token-process-only-secret",
          refresh_token: "firebase-refresh-keychain-only-secret",
        }),
      );
      return;
    }
    if (request.url === "/api/v1/groups" && request.method === "GET") {
      response.end(JSON.stringify({ data: [groups.explicit], nextCursor: "next-page" }));
      return;
    }
    if (request.url === "/api/v1/groups?cursor=next-page" && request.method === "GET") {
      response.end(JSON.stringify({ data: [groups.config], nextCursor: null }));
      return;
    }
    if (request.url === "/api/v1/groups" && request.method === "POST") {
      assert.deepEqual(JSON.parse(body), { name: "Field Ops" });
      response.statusCode = 201;
      response.end(JSON.stringify({ data: groups.created }));
      return;
    }
    if (request.url === "/api/v1/groups/grp_explicit" && request.method === "GET") {
      response.end(JSON.stringify({ data: groups.explicit }));
      return;
    }
    if (request.url === "/api/v1/groups/grp_selected" && request.method === "GET") {
      response.end(JSON.stringify({ data: groups.config }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "group_not_found", message: "Group not found." } }));
  });
  const environment = {
    NODE_ENV: "test",
    OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
    OPENJOB_CONFIG: configPath,
    OPENJOB_GROUP_ID: "",
    OPENJOB_TEST_AUTH_URL: service.baseUrl,
    OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
    OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
  };

  try {
    const list = await runCliAsync(["group", "list", "--format", "json"], {
      env: environment,
    });
    assert.equal(list.status, 0, list.stderr);
    assert.deepEqual(JSON.parse(list.stdout), {
      data: [groups.explicit, groups.config],
      nextCursor: null,
    });

    const create = await runCliAsync(
      ["group", "create", "--name", "Field Ops", "--format", "json"],
      { env: environment },
    );
    assert.equal(create.status, 0, create.stderr);
    assert.deepEqual(JSON.parse(create.stdout), { data: groups.created });

    const show = await runCliAsync(
      ["group", "show", "--group", "grp_explicit", "--format", "json"],
      { env: environment },
    );
    assert.equal(show.status, 0, show.stderr);
    assert.deepEqual(JSON.parse(show.stdout), { data: groups.explicit });

    const use = await runCliAsync(
      ["group", "use", "grp_selected", "--format", "json"],
      { env: environment },
    );
    assert.equal(use.status, 0, use.stderr);
    assert.deepEqual(JSON.parse(use.stdout), {
      data: { groupId: "grp_selected", source: "config" },
    });
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
      currentGroupId: "grp_selected",
    });

    const current = runCli(["group", "current", "--format", "json"], {
      env: environment,
    });
    assert.equal(current.status, 0, current.stderr);
    assert.deepEqual(JSON.parse(current.stdout), {
      data: { groupId: "grp_selected", source: "config" },
    });
    assert.equal(calls.filter(({ url }) => url.startsWith("/api/v1/")).length, 5);
    assert.equal(
      calls.filter(({ url }) => url === "/firebase/token?key=test-api-key").length,
      4,
    );
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("success output is atomic and never mixes files with stdout", () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-output-"));
  const configPath = join(directory, "config.json");
  const outputPath = join(directory, "result.json");
  writeFileSync(configPath, JSON.stringify({ currentGroupId: "grp_output" }));
  const environment = { OPENJOB_CONFIG: configPath, OPENJOB_GROUP_ID: "" };

  try {
    const first = runCli(
      ["group", "current", "--format", "json", "--out", outputPath],
      { env: environment },
    );
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, "");
    assert.equal(first.stderr, "");
    assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), {
      data: { groupId: "grp_output", source: "config" },
    });
    assert.deepEqual(
      readdirSync(directory).sort(),
      ["config.json", "result.json"],
    );

    const refused = runCli(
      ["group", "current", "--format", "json", "--out", outputPath],
      { env: environment },
    );
    assert.equal(refused.status, 2);
    assert.equal(refused.stdout, "");
    assert.deepEqual(JSON.parse(refused.stderr), {
      error: {
        code: "output_exists",
        message: `Output file already exists: ${outputPath}`,
      },
    });

    writeFileSync(configPath, JSON.stringify({ currentGroupId: "grp_replaced" }));
    const forced = runCli(
      [
        "group",
        "current",
        "--format",
        "json",
        "--out",
        outputPath,
        "--force",
      ],
      { env: environment },
    );
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(forced.stdout, "");
    assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), {
      data: { groupId: "grp_replaced", source: "config" },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("API errors preserve the envelope and never create selected output", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-error-"));
  const credentialPath = join(directory, "credential");
  const outputPath = join(directory, "must-not-exist.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  const service = await listen(async (request, response) => {
    await requestBody(request);
    response.setHeader("content-type", "application/json");
    if (request.url === "/firebase/token?key=test-api-key") {
      response.end(
        JSON.stringify({
          id_token: "firebase-id-token-process-only-secret",
          refresh_token: "firebase-refresh-keychain-only-secret",
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(
      JSON.stringify({
        error: {
          code: "group_not_found",
          message: "Group not found.",
          requestId: "req_cli_error",
        },
      }),
    );
  });

  try {
    const result = await runCliAsync(
      [
        "group",
        "show",
        "--group",
        "grp_missing",
        "--format",
        "json",
        "--out",
        outputPath,
      ],
      {
        env: {
          NODE_ENV: "test",
          OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
          OPENJOB_TEST_AUTH_URL: service.baseUrl,
          OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
          OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
        },
      },
    );
    assert.equal(result.status, 5);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      error: {
        code: "group_not_found",
        message: "Group not found.",
        requestId: "req_cli_error",
      },
    });
    assert.equal(existsSync(outputPath), false);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("existing output is rejected before a non-idempotent request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-preflight-"));
  const credentialPath = join(directory, "credential");
  const outputPath = join(directory, "existing.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  writeFileSync(outputPath, "keep me");
  let calls = 0;
  const service = await listen((_request, response) => {
    calls += 1;
    response.statusCode = 500;
    response.end();
  });

  try {
    const result = await runCliAsync(
      [
        "group",
        "create",
        "--name",
        "Must Not Be Created",
        "--format",
        "json",
        "--out",
        outputPath,
      ],
      {
        env: {
          NODE_ENV: "test",
          OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
          OPENJOB_TEST_AUTH_URL: service.baseUrl,
          OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
          OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
        },
      },
    );
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      error: {
        code: "output_exists",
        message: `Output file already exists: ${outputPath}`,
      },
    });
    assert.equal(calls, 0);
    assert.equal(readFileSync(outputPath, "utf8"), "keep me");

    const missingDirectoryOutput = join(directory, "missing", "result.json");
    const unwritable = await runCliAsync(
      [
        "group",
        "create",
        "--name",
        "Also Must Not Be Created",
        "--format",
        "json",
        "--out",
        missingDirectoryOutput,
      ],
      {
        env: {
          NODE_ENV: "test",
          OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
          OPENJOB_TEST_AUTH_URL: service.baseUrl,
          OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
          OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
        },
      },
    );
    assert.equal(unwritable.status, 2);
    assert.equal(unwritable.stdout, "");
    assert.deepEqual(JSON.parse(unwritable.stderr), {
      error: {
        code: "output_write_failed",
        message: `Could not atomically write output in ${join(directory, "missing")}.`,
      },
    });
    assert.equal(calls, 0);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
