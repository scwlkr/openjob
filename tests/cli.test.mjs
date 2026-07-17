import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
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

const cliPath =
  process.env.OPENJOB_CLI_TEST_BIN ||
  fileURLToPath(new URL("../cli/openjob.mjs", import.meta.url));
const repoPath = fileURLToPath(new URL("../", import.meta.url));
const cliVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL("../cli/package.json", import.meta.url)), "utf8"),
).version;

function runCli(args, options = {}) {
  return spawnSync(cliPath, args, {
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
  const child = spawn(cliPath, args, {
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

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function runCliInPty(args, { env, input, prompt }) {
  const command = [cliPath, ...args];
  const quotedCommand = command.map(shellQuote).join(" ");
  const scriptCommand = process.platform === "darwin"
    ? `script -q -e /dev/null ${quotedCommand}`
    : `script -q -e -c ${shellQuote(quotedCommand)} /dev/null`;
  const feeder = `(sleep 0.1; printf %s ${shellQuote(input)}; sleep 1) | ${scriptCommand}`;
  const child = spawn("sh", ["-c", feeder], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let terminal = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out running PTY prompt: ${prompt}`));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (terminal += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, terminal, stderr });
    });
  });
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
  for (const resource of ["member", "ban", "invite"]) {
    assert.match(help.stdout, new RegExp(`^  ${resource}\\s`, "m"));
  }
  assert.equal(help.stderr, "");

  const version = runCli(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, `openjob ${cliVersion}\n`);
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
  assert.match(groupHelp.stdout, /openjob group rename --name <name>/);
  assert.match(groupHelp.stdout, /openjob group leave \[--yes\]/);
  assert.match(groupHelp.stdout, /openjob group end \[--confirm-name <name>\]/);

  const memberHelp = runCli(["help", "member"]);
  assert.equal(memberHelp.status, 0, memberHelp.stderr);
  for (const command of ["list", "kick", "promote", "demote"]) {
    assert.match(memberHelp.stdout, new RegExp(`openjob member ${command}`));
  }

  const banHelp = runCli(["help", "ban"]);
  assert.equal(banHelp.status, 0, banHelp.stderr);
  for (const command of ["list", "add", "remove"]) {
    assert.match(banHelp.stdout, new RegExp(`openjob ban ${command}`));
  }

  const inviteHelp = runCli(["help", "invite"]);
  assert.equal(inviteHelp.status, 0, inviteHelp.stderr);
  for (const command of ["show", "rotate", "inspect", "join"]) {
    assert.match(inviteHelp.stdout, new RegExp(`openjob invite ${command}`));
  }

  const taskHelp = runCli(["help", "task"]);
  assert.equal(taskHelp.status, 0, taskHelp.stderr);
  for (const command of ["list", "create", "show", "edit", "done", "reopen", "delete"]) {
    assert.match(taskHelp.stdout, new RegExp(`openjob task ${command}`));
  }
});

test("package installation exposes the executable on PATH", () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-install-"));
  try {
    const install = spawnSync(
      "npm",
      [
        "install",
        "--prefix",
        directory,
        "--no-package-lock",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        repoPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(install.status, 0, install.stderr);
    const installedCli = join(directory, "node_modules", ".bin", "openjob");
    const version = spawnSync(installedCli, ["--version"], { encoding: "utf8" });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout, `openjob ${cliVersion}\n`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

    const invalidOption = runCli(
      ["group", "current", "--user-id", "user_ignored", "--format", "json"],
      { env: { OPENJOB_CONFIG: configPath, OPENJOB_GROUP_ID: "" } },
    );
    assert.equal(invalidOption.status, 2);
    assert.equal(invalidOption.stdout, "");
    assert.equal(JSON.parse(invalidOption.stderr).error.code, "usage_error");
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

test("auth login uses Desktop OAuth, PKCE, random loopback, and stores only Firebase refresh", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-login-"));
  const credentialPath = join(directory, "credential");
  const googleIdToken = "google-id-token-process-only-secret";
  const firebaseIdToken = "firebase-id-token-process-only-secret";
  const firebaseRefresh = "firebase-refresh-keychain-only-secret";
  let authorizationUrl;
  let tokenExchange;
  let running;
  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
    if (request.url === "/cli-auth/exchange") {
      tokenExchange = JSON.parse(body);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: { idToken: googleIdToken } }));
      return;
    }
    if (request.url === "/firebase/accounts:signInWithIdp?key=test-api-key") {
      const payload = JSON.parse(body);
      assert.equal(payload.requestUri, authorizationUrl.searchParams.get("redirect_uri"));
      const assertion = new URLSearchParams(payload.postBody);
      assert.equal(assertion.get("id_token"), googleIdToken);
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
    running = startCli(["auth", "login", "--no-open", "--format", "json"], {
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
    assert.equal(tokenExchange.code, "one-time-google-code");
    assert.equal(tokenExchange.redirectUri, redirectUri.href);
    assert.equal(Object.hasOwn(tokenExchange, "clientSecret"), false);
    const challenge = createHash("sha256")
      .update(tokenExchange.codeVerifier)
      .digest("base64url");
    assert.equal(challenge, authorizationUrl.searchParams.get("code_challenge"));
    assert.equal(
      await import("node:fs").then(({ readFileSync }) =>
        readFileSync(credentialPath, "utf8"),
      ),
      firebaseRefresh,
    );
  } finally {
    if (running?.child.exitCode === null) running.child.kill("SIGINT");
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production auth login uses the configured Google Desktop client and PKCE", async () => {
  const running = startCli(["auth", "login", "--no-open"], {
    env: { NODE_ENV: "production" },
  });
  running.child.stdin.end();

  try {
    const authorizationUrl = await new Promise((resolve, reject) => {
      let stderr = "";
      const timeout = setTimeout(
        () => reject(new Error("production login URL was not emitted")),
        5000,
      );
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

    assert.equal(authorizationUrl.origin, "https://accounts.google.com");
    assert.equal(authorizationUrl.pathname, "/o/oauth2/v2/auth");
    assert.equal(
      authorizationUrl.searchParams.get("client_id"),
      "1015996869029-7rsl506o6gc6sg9d7l5kl6ant3q1t4cb.apps.googleusercontent.com",
    );
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.match(
      authorizationUrl.searchParams.get("code_challenge"),
      /^[A-Za-z0-9_-]{43}$/,
    );
    assert.match(authorizationUrl.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
    const redirectUri = new URL(authorizationUrl.searchParams.get("redirect_uri"));
    assert.equal(redirectUri.hostname, "127.0.0.1");
    assert.notEqual(redirectUri.port, "0");
  } finally {
    running.child.kill("SIGINT");
  }

  const result = await running.result;
  assert.equal(result.status, 130, result.stderr);
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

test("Group lifecycle commands preserve input, confirmation, and Group context contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-group-lifecycle-"));
  const credentialPath = join(directory, "credential");
  const configPath = join(directory, "config.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  writeFileSync(configPath, JSON.stringify({ currentGroupId: "grp_config" }));
  const calls = [];
  const renamedGroup = {
    groupId: "grp_flag",
    name: "Renamed Group",
    role: "admin",
    createdAt: "2026-07-16T12:00:00Z",
  };
  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
    calls.push({ body, method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/firebase/token?key=test-api-key") {
      response.end(JSON.stringify({
        id_token: "firebase-id-token-process-only-secret",
        refresh_token: "firebase-refresh-keychain-only-secret",
      }));
      return;
    }
    if (request.url === "/api/v1/groups/grp_flag" && request.method === "PATCH") {
      assert.deepEqual(JSON.parse(body), { name: "Renamed Group" });
      response.end(JSON.stringify({ data: renamedGroup }));
      return;
    }
    if (request.url === "/api/v1/groups/grp_empty" && request.method === "PATCH") {
      assert.deepEqual(JSON.parse(body), { name: "" });
      response.statusCode = 400;
      response.end(JSON.stringify({ error: {
        code: "group_name_invalid",
        message: "Group Name is required.",
        fieldErrors: { name: "required" },
      } }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_environment/actions/leave" &&
      request.method === "POST"
    ) {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_config/actions/end" &&
      request.method === "POST"
    ) {
      assert.deepEqual(JSON.parse(body), { confirmationName: "Config Group" });
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found", message: "Missing." } }));
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
    const rename = await runCliAsync(
      ["group", "rename", "--name", "Renamed Group", "--group", "grp_flag", "--format", "json"],
      { env: environment },
    );
    assert.equal(rename.status, 0, rename.stderr);
    assert.deepEqual(JSON.parse(rename.stdout), { data: renamedGroup });
    assert.equal(rename.stderr, "");

    const emptyName = await runCliAsync(
      ["group", "rename", "--name", "", "--group", "grp_empty", "--format", "json"],
      { env: environment },
    );
    assert.equal(emptyName.status, 2);
    assert.equal(emptyName.stdout, "");
    assert.equal(JSON.parse(emptyName.stderr).error.code, "group_name_invalid");

    const leaveRefused = runCli(
      ["group", "leave", "--format", "json"],
      { env: { ...environment, OPENJOB_GROUP_ID: "grp_environment" } },
    );
    assert.equal(leaveRefused.status, 2);
    assert.equal(leaveRefused.stdout, "");
    assert.equal(JSON.parse(leaveRefused.stderr).error.code, "confirmation_required");

    const leave = await runCliAsync(
      ["group", "leave", "--yes", "--format", "json"],
      { env: { ...environment, OPENJOB_GROUP_ID: "grp_environment" } },
    );
    assert.equal(leave.status, 0, leave.stderr);
    assert.deepEqual(JSON.parse(leave.stdout), {
      data: { resource: "membership", groupId: "grp_environment", deleted: true },
    });

    const endBypassed = runCli(
      ["group", "end", "--yes", "--format", "json"],
      { env: environment },
    );
    assert.equal(endBypassed.status, 2);
    assert.equal(endBypassed.stdout, "");
    assert.equal(JSON.parse(endBypassed.stderr).error.code, "confirmation_required");

    const end = await runCliAsync(
      ["group", "end", "--confirm-name", "Config Group", "--format", "json"],
      { env: environment },
    );
    assert.equal(end.status, 0, end.stderr);
    assert.deepEqual(JSON.parse(end.stdout), {
      data: { resource: "group", groupId: "grp_config", deleted: true },
    });
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {});

    assert.deepEqual(
      calls.filter(({ url }) => url.startsWith("/api/v1/")).map(({ method, url }) => `${method} ${url}`),
      [
        "PATCH /api/v1/groups/grp_flag",
        "PATCH /api/v1/groups/grp_empty",
        "POST /api/v1/groups/grp_environment/actions/leave",
        "POST /api/v1/groups/grp_config/actions/end",
      ],
    );
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Member commands list and govern canonical Users through Username inputs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-members-"));
  const credentialPath = join(directory, "credential");
  const configPath = join(directory, "config.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  writeFileSync(configPath, JSON.stringify({ currentGroupId: "grp_members" }));
  const calls = [];
  const members = [
    {
      userId: "user_alex",
      username: "alex",
      role: "member",
      joinedAt: "2026-07-16T12:00:00Z",
    },
    {
      userId: "user_sam",
      username: "sam",
      role: "admin",
      joinedAt: "2026-07-15T12:00:00Z",
    },
  ];
  const service = await listen(async (request, response) => {
    await requestBody(request);
    calls.push({ method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/firebase/token?key=test-api-key") {
      response.end(JSON.stringify({
        id_token: "firebase-id-token-process-only-secret",
        refresh_token: "firebase-refresh-keychain-only-secret",
      }));
      return;
    }
    if (request.url === "/api/v1/groups/grp_members/members" && request.method === "GET") {
      response.end(JSON.stringify({ data: members, nextCursor: null }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_members/members/user_alex/actions/promote" &&
      request.method === "POST"
    ) {
      response.end(JSON.stringify({ data: { ...members[0], role: "admin" } }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_members/members/user_sam/actions/demote" &&
      request.method === "POST"
    ) {
      response.end(JSON.stringify({ data: { ...members[1], role: "member" } }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_members/members/user_alex/actions/kick" &&
      request.method === "POST"
    ) {
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "member_not_found", message: "Member not found." } }));
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
    const list = await runCliAsync(["member", "list", "--format", "json"], {
      env: environment,
    });
    assert.equal(list.status, 0, list.stderr);
    assert.deepEqual(JSON.parse(list.stdout), { data: members, nextCursor: null });

    const promote = await runCliAsync(
      ["member", "promote", "@alex", "--format", "json"],
      { env: environment },
    );
    assert.equal(promote.status, 0, promote.stderr);
    assert.deepEqual(JSON.parse(promote.stdout), {
      data: { ...members[0], role: "admin" },
    });

    for (const [command, username] of [["demote", "sam"], ["kick", "alex"]]) {
      const refused = runCli(
        ["member", command, username, "--format", "json"],
        { env: environment },
      );
      assert.equal(refused.status, 2);
      assert.equal(refused.stdout, "");
      assert.equal(JSON.parse(refused.stderr).error.code, "confirmation_required");
    }

    const demote = await runCliAsync(
      ["member", "demote", "sam", "--yes", "--format", "json"],
      { env: environment },
    );
    assert.equal(demote.status, 0, demote.stderr);
    assert.deepEqual(JSON.parse(demote.stdout), {
      data: { ...members[1], role: "member" },
    });

    const kick = await runCliAsync(
      ["member", "kick", "@alex", "--yes", "--format", "json"],
      { env: environment },
    );
    assert.equal(kick.status, 0, kick.stderr);
    assert.deepEqual(JSON.parse(kick.stdout), {
      data: {
        resource: "membership",
        groupId: "grp_members",
        userId: "user_alex",
        username: "alex",
        deleted: true,
      },
    });

    assert.deepEqual(
      calls.filter(({ url }) => url.startsWith("/api/v1/")).map(({ method, url }) => `${method} ${url}`),
      [
        "GET /api/v1/groups/grp_members/members",
        "GET /api/v1/groups/grp_members/members",
        "POST /api/v1/groups/grp_members/members/user_alex/actions/promote",
        "GET /api/v1/groups/grp_members/members",
        "POST /api/v1/groups/grp_members/members/user_sam/actions/demote",
        "GET /api/v1/groups/grp_members/members",
        "POST /api/v1/groups/grp_members/members/user_alex/actions/kick",
      ],
    );
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Ban commands cover current and former Members without duplicating service rules", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-bans-"));
  const credentialPath = join(directory, "credential");
  const configPath = join(directory, "config.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  writeFileSync(configPath, JSON.stringify({ currentGroupId: "grp_bans" }));
  const calls = [];
  const alex = {
    userId: "user_alex",
    username: "alex",
    role: "member",
    joinedAt: "2026-07-16T12:00:00Z",
  };
  const existingBan = {
    userId: "user_banned",
    username: "banned",
    bannedAt: "2026-07-15T12:00:00Z",
  };
  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
    calls.push({ body, method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/firebase/token?key=test-api-key") {
      response.end(JSON.stringify({
        id_token: "firebase-id-token-process-only-secret",
        refresh_token: "firebase-refresh-keychain-only-secret",
      }));
      return;
    }
    if (request.url === "/api/v1/groups/grp_bans/bans" && request.method === "GET") {
      response.end(JSON.stringify({ data: [existingBan], nextCursor: null }));
      return;
    }
    if (request.url === "/api/v1/groups/grp_bans/members" && request.method === "GET") {
      response.end(JSON.stringify({ data: [alex], nextCursor: null }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_bans/bans/actions/ban" &&
      request.method === "POST"
    ) {
      const { userId } = JSON.parse(body);
      response.statusCode = 201;
      response.end(JSON.stringify({
        data: {
          userId,
          username: userId === "user_alex" ? "alex" : "former",
          bannedAt: "2026-07-16T13:00:00Z",
        },
      }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_bans/bans/user_banned/actions/unban" &&
      request.method === "POST"
    ) {
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "ban_not_found", message: "Ban not found." } }));
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
    const list = await runCliAsync(["ban", "list", "--format", "json"], {
      env: environment,
    });
    assert.equal(list.status, 0, list.stderr);
    assert.deepEqual(JSON.parse(list.stdout), { data: [existingBan], nextCursor: null });

    const refused = runCli(
      ["ban", "add", "--username", "alex", "--format", "json"],
      { env: environment },
    );
    assert.equal(refused.status, 2);
    assert.equal(refused.stdout, "");
    assert.equal(JSON.parse(refused.stderr).error.code, "confirmation_required");

    const currentMember = await runCliAsync(
      ["ban", "add", "--username", "@alex", "--yes", "--format", "json"],
      { env: environment },
    );
    assert.equal(currentMember.status, 0, currentMember.stderr);
    assert.equal(JSON.parse(currentMember.stdout).data.userId, "user_alex");

    const formerMember = await runCliAsync(
      ["ban", "add", "--user-id", "user_former", "--yes", "--format", "json"],
      { env: environment },
    );
    assert.equal(formerMember.status, 0, formerMember.stderr);
    assert.equal(JSON.parse(formerMember.stdout).data.userId, "user_former");

    const jsonInput = await runCliAsync(
      ["ban", "add", "--input", "-", "--yes", "--format", "json"],
      { env: environment, input: '{"userId":"user_input"}\n' },
    );
    assert.equal(jsonInput.status, 0, jsonInput.stderr);
    assert.equal(JSON.parse(jsonInput.stdout).data.userId, "user_input");

    const remove = await runCliAsync(
      ["ban", "remove", "user_banned", "--format", "json"],
      { env: environment },
    );
    assert.equal(remove.status, 0, remove.stderr);
    assert.deepEqual(JSON.parse(remove.stdout), {
      data: {
        resource: "ban",
        groupId: "grp_bans",
        userId: "user_banned",
        deleted: true,
      },
    });

    assert.deepEqual(
      calls.filter(({ url }) => url.startsWith("/api/v1/")).map(({ body, method, url }) => ({
        body: body ? JSON.parse(body) : null,
        method,
        url,
      })),
      [
        { body: null, method: "GET", url: "/api/v1/groups/grp_bans/bans" },
        { body: null, method: "GET", url: "/api/v1/groups/grp_bans/members" },
        {
          body: { userId: "user_alex" },
          method: "POST",
          url: "/api/v1/groups/grp_bans/bans/actions/ban",
        },
        {
          body: { userId: "user_former" },
          method: "POST",
          url: "/api/v1/groups/grp_bans/bans/actions/ban",
        },
        {
          body: { userId: "user_input" },
          method: "POST",
          url: "/api/v1/groups/grp_bans/bans/actions/ban",
        },
        {
          body: null,
          method: "POST",
          url: "/api/v1/groups/grp_bans/bans/user_banned/actions/unban",
        },
      ],
    );
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Invite commands show, rotate, inspect, and join with tokens or URLs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-invites-"));
  const credentialPath = join(directory, "credential");
  const configPath = join(directory, "config.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  writeFileSync(configPath, JSON.stringify({ currentGroupId: "grp_invites" }));
  const calls = [];
  const inviteLink = {
    token: "ivt_current",
    url: "https://openjob.dev/invites/ivt_current",
    issuedAt: "2026-07-16T12:00:00Z",
    expiresAt: "2026-07-23T12:00:00Z",
    remainingJoins: 25,
  };
  const joinedGroup = {
    groupId: "grp_joined",
    name: "Joined Group",
    role: "member",
    createdAt: "2026-07-15T12:00:00Z",
  };
  const service = await listen(async (request, response) => {
    await requestBody(request);
    calls.push({ method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/firebase/token?key=test-api-key") {
      response.end(JSON.stringify({
        id_token: "firebase-id-token-process-only-secret",
        refresh_token: "firebase-refresh-keychain-only-secret",
      }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_invites/invite-link" &&
      request.method === "GET"
    ) {
      response.end(JSON.stringify({ data: inviteLink }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_invites/invite-link/actions/rotate" &&
      request.method === "POST"
    ) {
      response.end(JSON.stringify({
        data: { ...inviteLink, token: "ivt_rotated", url: "https://openjob.dev/invites/ivt_rotated" },
      }));
      return;
    }
    if (request.url === "/api/v1/invites/ivt_raw" && request.method === "GET") {
      response.end(JSON.stringify({ data: { groupName: "Raw Token Group" } }));
      return;
    }
    if (
      request.url === "/api/v1/invites/ivt_url/actions/join" &&
      request.method === "POST"
    ) {
      response.end(JSON.stringify({ data: joinedGroup }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "invite_invalid", message: "Invite Link is not valid." } }));
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
    const show = await runCliAsync(["invite", "show", "--format", "json"], {
      env: environment,
    });
    assert.equal(show.status, 0, show.stderr);
    assert.deepEqual(JSON.parse(show.stdout), { data: inviteLink });

    const rotateRefused = runCli(
      ["invite", "rotate", "--format", "json"],
      { env: environment },
    );
    assert.equal(rotateRefused.status, 2);
    assert.equal(rotateRefused.stdout, "");
    assert.equal(JSON.parse(rotateRefused.stderr).error.code, "confirmation_required");

    const rotate = await runCliAsync(
      ["invite", "rotate", "--yes", "--format", "json"],
      { env: environment },
    );
    assert.equal(rotate.status, 0, rotate.stderr);
    assert.equal(JSON.parse(rotate.stdout).data.token, "ivt_rotated");

    const inspect = await runCliAsync(
      ["invite", "inspect", "ivt_raw", "--format", "json"],
      { env: environment },
    );
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.deepEqual(JSON.parse(inspect.stdout), {
      data: { groupName: "Raw Token Group" },
    });

    const join = await runCliAsync(
      ["invite", "join", "https://openjob.dev/invites/ivt_url", "--format", "json"],
      { env: environment },
    );
    assert.equal(join.status, 0, join.stderr);
    assert.deepEqual(JSON.parse(join.stdout), { data: joinedGroup });

    const invalidUrl = runCli(
      ["invite", "inspect", "https://openjob.dev/groups/not-an-invite", "--format", "json"],
      { env: environment },
    );
    assert.equal(invalidUrl.status, 2);
    assert.equal(invalidUrl.stdout, "");
    assert.equal(JSON.parse(invalidUrl.stderr).error.code, "usage_error");

    assert.deepEqual(
      calls.filter(({ url }) => url.startsWith("/api/v1/")).map(({ method, url }) => `${method} ${url}`),
      [
        "GET /api/v1/groups/grp_invites/invite-link",
        "POST /api/v1/groups/grp_invites/invite-link/actions/rotate",
        "GET /api/v1/invites/ivt_raw",
        "POST /api/v1/invites/ivt_url/actions/join",
      ],
    );
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("interactive Group ending requires typing the current Group Name", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-group-end-interactive-"));
  const credentialPath = join(directory, "credential");
  const outputPath = join(directory, "ended.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  const calls = [];
  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
    calls.push({ body, method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/firebase/token?key=test-api-key") {
      response.end(JSON.stringify({
        id_token: "firebase-id-token-process-only-secret",
        refresh_token: "firebase-refresh-keychain-only-secret",
      }));
      return;
    }
    if (request.url === "/api/v1/groups/grp_interactive" && request.method === "GET") {
      response.end(JSON.stringify({ data: {
        groupId: "grp_interactive",
        name: "Exact Group Name",
        role: "admin",
        createdAt: "2026-07-16T12:00:00Z",
      } }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_interactive/actions/end" &&
      request.method === "POST"
    ) {
      assert.deepEqual(JSON.parse(body), { confirmationName: "Exact Group Name" });
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "group_not_found", message: "Group not found." } }));
  });
  const environment = {
    NODE_ENV: "test",
    OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
    OPENJOB_GROUP_ID: "",
    OPENJOB_TEST_AUTH_URL: service.baseUrl,
    OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
    OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
  };

  try {
    const mismatch = await runCliInPty(
      ["group", "end", "--group", "grp_interactive", "--format", "json"],
      {
        env: environment,
        input: "Wrong Name\n",
        prompt: "Type Exact Group Name to End Group:",
      },
    );
    assert.equal(mismatch.status, 2, `${mismatch.stderr}\n${mismatch.terminal}`);
    assert.equal(mismatch.stderr, "");
    assert.match(mismatch.terminal, /Type Exact Group Name to End Group:/);
    assert.match(mismatch.terminal, /"code":"confirmation_declined"/);

    const ended = await runCliInPty(
      [
        "group",
        "end",
        "--group",
        "grp_interactive",
        "--yes",
        "--format",
        "json",
        "--out",
        outputPath,
      ],
      {
        env: environment,
        input: "Exact Group Name\n",
        prompt: "Type Exact Group Name to End Group:",
      },
    );
    assert.equal(ended.status, 0, `${ended.stderr}\n${ended.terminal}`);
    assert.equal(ended.stderr, "");
    assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), {
      data: { resource: "group", groupId: "grp_interactive", deleted: true },
    });
    assert.match(ended.terminal, /Type Exact Group Name to End Group:/);

    assert.deepEqual(
      calls.filter(({ url }) => url.startsWith("/api/v1/")).map(({ method, url }) => `${method} ${url}`),
      [
        "GET /api/v1/groups/grp_interactive",
        "GET /api/v1/groups/grp_interactive",
        "POST /api/v1/groups/grp_interactive/actions/end",
      ],
    );
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("governance commands preserve privacy, permission, conflict, and retry contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-governance-errors-"));
  const credentialPath = join(directory, "credential");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  const calls = [];
  let joinAttempts = 0;
  const service = await listen(async (request, response) => {
    await requestBody(request);
    calls.push({ method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/firebase/token?key=test-api-key") {
      response.end(JSON.stringify({
        id_token: "firebase-id-token-process-only-secret",
        refresh_token: "firebase-refresh-keychain-only-secret",
      }));
      return;
    }
    if (request.url === "/api/v1/groups/grp_errors/members" && request.method === "GET") {
      response.end(JSON.stringify({ data: [{
        userId: "user_alex",
        username: "alex",
        role: "member",
        joinedAt: "2026-07-16T12:00:00Z",
      }], nextCursor: null }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_errors/members/user_alex/actions/promote" &&
      request.method === "POST"
    ) {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: { code: "admin_required", message: "Admin role required." } }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_errors/actions/leave" &&
      request.method === "POST"
    ) {
      response.statusCode = 409;
      response.end(JSON.stringify({ error: { code: "open_tasks_assigned", message: "Reassign open Tasks first." } }));
      return;
    }
    if (request.url === "/api/v1/invites/ivt_private" && request.method === "GET") {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { code: "invite_invalid", message: "Invite Link is not valid." } }));
      return;
    }
    if (
      request.url === "/api/v1/groups/grp_errors/invite-link/actions/rotate" &&
      request.method === "POST"
    ) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: { code: "internal_error", message: "Do not retry rotation." } }));
      return;
    }
    if (request.url === "/api/v1/invites/ivt_retry/actions/join" && request.method === "POST") {
      joinAttempts += 1;
      if (joinAttempts === 1) {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: { code: "internal_error", message: "Retry safe join." } }));
        return;
      }
      response.end(JSON.stringify({ data: {
        groupId: "grp_joined",
        name: "Joined Group",
        role: "member",
        createdAt: "2026-07-16T12:00:00Z",
      } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found", message: "Missing." } }));
  });
  const environment = {
    NODE_ENV: "test",
    OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
    OPENJOB_GROUP_ID: "",
    OPENJOB_TEST_AUTH_URL: service.baseUrl,
    OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
    OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
  };

  try {
    const permission = await runCliAsync(
      ["member", "promote", "alex", "--group", "grp_errors", "--format", "json"],
      { env: environment },
    );
    assert.equal(permission.status, 4);
    assert.equal(permission.stdout, "");
    assert.equal(JSON.parse(permission.stderr).error.code, "admin_required");

    const conflict = await runCliAsync(
      ["group", "leave", "--group", "grp_errors", "--yes", "--format", "json"],
      { env: environment },
    );
    assert.equal(conflict.status, 6);
    assert.equal(conflict.stdout, "");
    assert.equal(JSON.parse(conflict.stderr).error.code, "open_tasks_assigned");

    const concealed = await runCliAsync(
      ["invite", "inspect", "ivt_private", "--format", "json"],
      { env: environment },
    );
    assert.equal(concealed.status, 5);
    assert.equal(concealed.stdout, "");
    assert.deepEqual(JSON.parse(concealed.stderr), {
      error: { code: "invite_invalid", message: "Invite Link is not valid." },
    });

    const rotate = await runCliAsync(
      ["invite", "rotate", "--group", "grp_errors", "--yes", "--format", "json"],
      { env: environment },
    );
    assert.equal(rotate.status, 8);
    assert.equal(rotate.stdout, "");
    assert.equal(JSON.parse(rotate.stderr).error.code, "internal_error");

    const join = await runCliAsync(
      ["invite", "join", "ivt_retry", "--format", "json"],
      { env: environment },
    );
    assert.equal(join.status, 0, join.stderr);
    assert.equal(JSON.parse(join.stdout).data.groupId, "grp_joined");
    assert.match(join.stderr, /Retrying safe request/);

    assert.equal(
      calls.filter(({ url }) => url === "/api/v1/groups/grp_errors/invite-link/actions/rotate").length,
      1,
    );
    assert.equal(
      calls.filter(({ url }) => url === "/api/v1/invites/ivt_retry/actions/join").length,
      2,
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

test("task list applies filters, follows cursors, and honors a total limit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-task-list-"));
  const credentialPath = join(directory, "credential");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  const tasks = [
    { taskId: "task_1", text: "First", state: "open" },
    { taskId: "task_2", text: "Second", state: "done" },
  ];
  const taskRequests = [];
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
    const url = new URL(request.url, service.baseUrl);
    if (url.pathname === "/api/v1/groups/grp_tasks/tasks") {
      taskRequests.push(url);
      assert.equal(request.method, "GET");
      assert.equal(url.searchParams.get("status"), "all");
      assert.equal(url.searchParams.get("assignee"), "scwlkr");
      if (!url.searchParams.has("cursor")) {
        assert.equal(url.searchParams.get("limit"), "2");
        response.end(JSON.stringify({ data: [tasks[0]], nextCursor: "page_2" }));
        return;
      }
      assert.equal(url.searchParams.get("cursor"), "page_2");
      assert.equal(url.searchParams.get("limit"), "1");
      response.end(JSON.stringify({ data: [tasks[1]], nextCursor: "page_3" }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  try {
    const result = await runCliAsync(
      [
        "task",
        "list",
        "--group",
        "grp_tasks",
        "--status",
        "all",
        "--assignee",
        "@scwlkr",
        "--limit",
        "2",
        "--format",
        "json",
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
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { data: tasks, nextCursor: null });
    assert.equal(result.stderr, "");
    assert.equal(taskRequests.length, 2);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("task create accepts exactly one explicit named or JSON input mode", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-task-create-"));
  const credentialPath = join(directory, "credential");
  const textPath = join(directory, "task.txt");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  writeFileSync(textPath, "Line one\n\nLine two\n");
  const bodies = [];
  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
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
    if (request.url === "/api/v1/groups/grp_tasks/tasks") {
      assert.equal(request.method, "POST");
      bodies.push(JSON.parse(body));
      response.statusCode = 201;
      response.end(
        JSON.stringify({
          data: {
            taskId: `task_${bodies.length}`,
            groupId: "grp_tasks",
            ...bodies.at(-1),
            state: "open",
          },
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const environment = {
    NODE_ENV: "test",
    OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
    OPENJOB_TEST_AUTH_URL: service.baseUrl,
    OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
    OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
  };

  try {
    const named = await runCliAsync(
      [
        "task",
        "create",
        "--group",
        "grp_tasks",
        "--text-file",
        textPath,
        "--assignee",
        "@scwlkr",
        "--due",
        "2026-07-18",
        "--format",
        "json",
      ],
      { env: environment },
    );
    assert.equal(named.status, 0, named.stderr);
    assert.deepEqual(bodies[0], {
      text: "Line one\n\nLine two",
      assigneeUsername: "scwlkr",
      dueDate: "2026-07-18",
    });

    const input = { text: "From stdin", assigneeUsername: "maya" };
    const json = await runCliAsync(
      ["task", "create", "--group", "grp_tasks", "--input", "-", "--format", "json"],
      { env: environment, input: JSON.stringify(input) },
    );
    assert.equal(json.status, 0, json.stderr);
    assert.deepEqual(bodies[1], input);

    const leadingDashes = await runCliAsync(
      [
        "task",
        "create",
        "--group",
        "grp_tasks",
        "--text=--urgent",
        "--assignee",
        "maya",
        "--format",
        "json",
      ],
      { env: environment },
    );
    assert.equal(leadingDashes.status, 0, leadingDashes.stderr);
    assert.equal(bodies[2].text, "--urgent");

    const mixed = runCli(
      [
        "task",
        "create",
        "--group",
        "grp_tasks",
        "--input",
        "-",
        "--text",
        "Do not read stdin",
        "--assignee",
        "maya",
        "--format",
        "json",
      ],
      { env: environment },
    );
    assert.equal(mixed.status, 2);
    assert.equal(mixed.stdout, "");
    assert.deepEqual(JSON.parse(mixed.stderr), {
      error: {
        code: "usage_error",
        message: "task create accepts --input or named field flags, never both.",
      },
    });
    assert.equal(bodies.length, 3);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("task show and edit expose server state through explicit edit inputs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-task-edit-"));
  const credentialPath = join(directory, "credential");
  const inputPath = join(directory, "edit.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  writeFileSync(inputPath, JSON.stringify({ dueDate: "2026-07-20" }));
  let task = {
    taskId: "task_edit",
    groupId: "grp_tasks",
    text: "Original",
    assigneeUsername: "maya",
    dueDate: "2026-07-18",
    state: "open",
  };
  const patches = [];
  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
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
    if (request.url === "/api/v1/groups/grp_tasks/tasks/task_edit") {
      if (request.method === "GET") {
        response.end(JSON.stringify({ data: task }));
        return;
      }
      if (request.method === "PATCH") {
        const patch = JSON.parse(body);
        patches.push(patch);
        task = { ...task, ...patch };
        response.end(JSON.stringify({ data: task }));
        return;
      }
    }
    response.statusCode = 404;
    response.end();
  });
  const environment = {
    NODE_ENV: "test",
    OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
    OPENJOB_TEST_AUTH_URL: service.baseUrl,
    OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
    OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
  };

  try {
    const show = await runCliAsync(
      ["task", "show", "task_edit", "--group", "grp_tasks", "--format", "json"],
      { env: environment },
    );
    assert.equal(show.status, 0, show.stderr);
    assert.deepEqual(JSON.parse(show.stdout), { data: task });

    const named = await runCliAsync(
      [
        "task",
        "edit",
        "task_edit",
        "--group",
        "grp_tasks",
        "--text-file",
        "-",
        "--assignee",
        "@scwlkr",
        "--due",
        "none",
        "--format",
        "json",
      ],
      { env: environment, input: "Edited\n\nfrom stdin\n" },
    );
    assert.equal(named.status, 0, named.stderr);
    assert.deepEqual(patches[0], {
      text: "Edited\n\nfrom stdin",
      assigneeUsername: "scwlkr",
      dueDate: null,
    });

    const json = await runCliAsync(
      [
        "task",
        "edit",
        "task_edit",
        "--group",
        "grp_tasks",
        "--input",
        inputPath,
        "--format",
        "json",
      ],
      { env: environment },
    );
    assert.equal(json.status, 0, json.stderr);
    assert.deepEqual(patches[1], { dueDate: "2026-07-20" });
    assert.deepEqual(JSON.parse(json.stdout).data, task);

    const invalidOption = await runCliAsync(
      [
        "task",
        "show",
        "task_edit",
        "--group",
        "grp_tasks",
        "--due",
        "none",
        "--format",
        "json",
      ],
      { env: environment },
    );
    assert.equal(invalidOption.status, 2);
    assert.equal(invalidOption.stdout, "");
    assert.equal(JSON.parse(invalidOption.stderr).error.code, "usage_error");
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("task state commands are explicit and deletion requires confirmation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-task-state-"));
  const credentialPath = join(directory, "credential");
  const interactiveOutputPath = join(directory, "interactive-delete.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  const states = [];
  const deleted = [];
  const service = await listen(async (request, response) => {
    const body = await requestBody(request);
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
    const stateMatch = request.url.match(
      /^\/api\/v1\/groups\/grp_tasks\/tasks\/([^/]+)\/state$/,
    );
    if (stateMatch) {
      assert.equal(request.method, "PUT");
      const state = JSON.parse(body).state;
      states.push(state);
      response.end(
        JSON.stringify({
          data: { taskId: stateMatch[1], groupId: "grp_tasks", state },
        }),
      );
      return;
    }
    const deleteMatch = request.url.match(
      /^\/api\/v1\/groups\/grp_tasks\/tasks\/([^/]+)$/,
    );
    if (deleteMatch && request.method === "DELETE") {
      deleted.push(deleteMatch[1]);
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const environment = {
    NODE_ENV: "test",
    OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
    OPENJOB_TEST_AUTH_URL: service.baseUrl,
    OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
    OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
  };

  try {
    for (const [command, expected] of [
      ["done", "done"],
      ["reopen", "open"],
    ]) {
      const result = await runCliAsync(
        ["task", command, "task_state", "--group", "grp_tasks", "--format", "json"],
        { env: environment },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).data.state, expected);
    }
    assert.deepEqual(states, ["done", "open"]);

    const refused = await runCliAsync(
      ["task", "delete", "task_refused", "--group", "grp_tasks", "--format", "json"],
      { env: environment },
    );
    assert.equal(refused.status, 2);
    assert.equal(refused.stdout, "");
    assert.deepEqual(JSON.parse(refused.stderr), {
      error: {
        code: "confirmation_required",
        message: "Non-interactive deletion requires --yes.",
      },
    });

    const declined = await runCliInPty(
      ["task", "delete", "task_declined", "--group", "grp_tasks", "--format", "json"],
      {
        env: environment,
        input: "no\n",
        prompt: "Delete Task task_declined? [y/N]",
      },
    );
    assert.equal(declined.status, 2, `${declined.stderr}\n${declined.terminal}`);
    assert.equal(declined.stderr, "");
    assert.match(declined.terminal, /Delete Task task_declined\? \[y\/N\]/);
    assert.match(declined.terminal, /"code":"confirmation_declined"/);

    const approved = await runCliAsync(
      [
        "task",
        "delete",
        "task_deleted",
        "--group",
        "grp_tasks",
        "--yes",
        "--format",
        "json",
      ],
      { env: environment },
    );
    assert.equal(approved.status, 0, approved.stderr);
    assert.deepEqual(JSON.parse(approved.stdout), {
      data: { taskId: "task_deleted", deleted: true },
    });
    assert.equal(approved.stderr, "");

    const interactive = await runCliInPty(
      [
        "task",
        "delete",
        "task_interactive",
        "--group",
        "grp_tasks",
        "--format",
        "json",
        "--out",
        interactiveOutputPath,
      ],
      {
        env: environment,
        input: "yes\n",
        prompt: "Delete Task task_interactive? [y/N]",
      },
    );
    assert.equal(interactive.status, 0, `${interactive.stderr}\n${interactive.terminal}`);
    assert.equal(interactive.stderr, "");
    assert.match(interactive.terminal, /Delete Task task_interactive\? \[y\/N\]/);
    assert.deepEqual(JSON.parse(readFileSync(interactiveOutputPath, "utf8")), {
      data: { taskId: "task_interactive", deleted: true },
    });
    assert.deepEqual(deleted, ["task_deleted", "task_interactive"]);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("task retries only safe operations and never writes partial output", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-task-retry-"));
  const credentialPath = join(directory, "credential");
  const outputPath = join(directory, "partial.json");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  const calls = new Map();
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
    const key = `${request.method} ${request.url}`;
    calls.set(key, (calls.get(key) || 0) + 1);
    const attempt = calls.get(key);

    if (request.url.endsWith("/tasks/task_show") && request.method === "GET") {
      if (attempt === 1) {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: { code: "internal_error", message: "Retry." } }));
        return;
      }
      response.end(JSON.stringify({ data: { taskId: "task_show", state: "open" } }));
      return;
    }
    if (request.url.endsWith("/tasks/task_state/state") && request.method === "PUT") {
      if (attempt === 1) {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: { code: "internal_error", message: "Retry." } }));
        return;
      }
      response.end(JSON.stringify({ data: { taskId: "task_state", state: "done" } }));
      return;
    }
    if (request.url.endsWith("/tasks/task_create") || request.method === "POST") {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: { code: "internal_error", message: "No retry." } }));
      return;
    }
    if (request.url.endsWith("/tasks/task_delete") && request.method === "DELETE") {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: { code: "internal_error", message: "No retry." } }));
      return;
    }
    if (request.url.includes("/tasks?status=open")) {
      if (!request.url.includes("cursor=page_2")) {
        response.end(
          JSON.stringify({
            data: [{ taskId: "task_page_1", state: "open" }],
            nextCursor: "page_2",
          }),
        );
        return;
      }
      response.statusCode = 500;
      response.end(JSON.stringify({ error: { code: "internal_error", message: "Partial." } }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const environment = {
    NODE_ENV: "test",
    OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
    OPENJOB_TEST_AUTH_URL: service.baseUrl,
    OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
    OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
  };

  try {
    const show = await runCliAsync(
      ["task", "show", "task_show", "--group", "grp_tasks", "--format", "json"],
      { env: environment },
    );
    assert.equal(show.status, 0, show.stderr);
    assert.match(show.stderr, /Retrying safe request after a temporary service failure\./);
    assert.equal(calls.get("GET /api/v1/groups/grp_tasks/tasks/task_show"), 2);

    const state = await runCliAsync(
      [
        "task",
        "done",
        "task_state",
        "--group",
        "grp_tasks",
        "--format",
        "json",
        "--quiet",
      ],
      { env: environment },
    );
    assert.equal(state.status, 0, state.stderr);
    assert.equal(state.stderr, "");
    assert.equal(calls.get("PUT /api/v1/groups/grp_tasks/tasks/task_state/state"), 2);

    const create = await runCliAsync(
      [
        "task",
        "create",
        "--group",
        "grp_tasks",
        "--text",
        "No retry",
        "--assignee",
        "scwlkr",
        "--format",
        "json",
      ],
      { env: environment },
    );
    assert.equal(create.status, 8);
    assert.doesNotMatch(create.stderr, /Retrying safe request/);
    assert.equal(calls.get("POST /api/v1/groups/grp_tasks/tasks"), 1);

    const deletion = await runCliAsync(
      [
        "task",
        "delete",
        "task_delete",
        "--group",
        "grp_tasks",
        "--yes",
        "--format",
        "json",
      ],
      { env: environment },
    );
    assert.equal(deletion.status, 8);
    assert.doesNotMatch(deletion.stderr, /Retrying safe request/);
    assert.equal(calls.get("DELETE /api/v1/groups/grp_tasks/tasks/task_delete"), 1);

    const partial = await runCliAsync(
      [
        "task",
        "list",
        "--group",
        "grp_tasks",
        "--format",
        "json",
        "--out",
        outputPath,
      ],
      { env: environment },
    );
    assert.equal(partial.status, 8);
    assert.equal(partial.stdout, "");
    assert.equal(existsSync(outputPath), false);
    assert.equal(
      calls.get("GET /api/v1/groups/grp_tasks/tasks?status=open&cursor=page_2"),
      2,
    );
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("task failures keep stable API exit statuses and interruption exits 130", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-task-status-"));
  const credentialPath = join(directory, "credential");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  let interruptStarted;
  const interruptRequest = new Promise((resolve) => (interruptStarted = resolve));
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
    const match = request.url.match(/\/tasks\/status_(\d+|interrupt)$/);
    if (!match) {
      response.statusCode = 404;
      response.end();
      return;
    }
    if (match[1] === "interrupt") {
      interruptStarted();
      return;
    }
    const status = Number(match[1]);
    response.statusCode = status;
    response.end(
      JSON.stringify({
        error: {
          code: `status_${status}`,
          message: `HTTP ${status}`,
          requestId: `req_${status}`,
        },
      }),
    );
  });
  const environment = {
    NODE_ENV: "test",
    OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
    OPENJOB_TEST_AUTH_URL: service.baseUrl,
    OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
    OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
  };

  try {
    for (const [httpStatus, exitStatus] of [
      [400, 2],
      [401, 3],
      [403, 4],
      [404, 5],
      [409, 6],
      [429, 7],
      [500, 8],
    ]) {
      const result = await runCliAsync(
        [
          "task",
          "edit",
          `status_${httpStatus}`,
          "--group",
          "grp_tasks",
          "--text",
          "Changed",
          "--format",
          "json",
        ],
        { env: environment },
      );
      assert.equal(result.status, exitStatus, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(JSON.parse(result.stderr).error.code, `status_${httpStatus}`);
    }

    const interrupted = startCli(
      [
        "task",
        "edit",
        "status_interrupt",
        "--group",
        "grp_tasks",
        "--text",
        "Changed",
      ],
      { env: environment },
    );
    interrupted.child.stdin.end();
    await interruptRequest;
    interrupted.child.kill("SIGINT");
    const result = await interrupted.result;
    assert.equal(result.status, 130);
    assert.equal(result.signal, null);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Task table and JSON Lines output stay stable when redirected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-task-formats-"));
  const credentialPath = join(directory, "credential");
  const outputPath = join(directory, "tasks.jsonl");
  writeFileSync(credentialPath, "firebase-refresh-keychain-only-secret", { mode: 0o600 });
  const tasks = [
    { taskId: "task_1", text: "Line one\nLine two", state: "open" },
    { taskId: "task_2", text: "Second", state: "done" },
  ];
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
    if (request.url === "/api/v1/groups/grp_tasks/tasks?status=open") {
      response.end(JSON.stringify({ data: tasks, nextCursor: null }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const environment = {
    NODE_ENV: "test",
    OPENJOB_API_URL: `${service.baseUrl}/api/v1`,
    OPENJOB_TEST_AUTH_URL: service.baseUrl,
    OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
    OPENJOB_TEST_FIREBASE_API_KEY: "test-api-key",
  };

  try {
    const table = await runCliAsync(
      ["task", "list", "--group", "grp_tasks", "--out", "-"],
      { env: environment },
    );
    assert.equal(table.status, 0, table.stderr);
    assert.equal(
      table.stdout,
      "TASK_ID\tTEXT\tSTATE\n" +
        "task_1\tLine one\\nLine two\topen\n" +
        "task_2\tSecond\tdone\n",
    );
    assert.equal(table.stderr, "");

    const jsonl = await runCliAsync(
      [
        "task",
        "list",
        "--group",
        "grp_tasks",
        "--format",
        "jsonl",
        "--out",
        outputPath,
      ],
      { env: environment },
    );
    assert.equal(jsonl.status, 0, jsonl.stderr);
    assert.equal(jsonl.stdout, "");
    assert.equal(
      readFileSync(outputPath, "utf8"),
      `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`,
    );
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("atomic output refuses a destination created during the request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-output-race-"));
  const credentialPath = join(directory, "credential");
  const outputPath = join(directory, "result.json");
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
    if (request.url === "/api/v1/groups/grp_tasks/tasks/task_race") {
      writeFileSync(outputPath, "created by another process");
      response.end(JSON.stringify({ data: { taskId: "task_race", state: "open" } }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  try {
    const result = await runCliAsync(
      [
        "task",
        "show",
        "task_race",
        "--group",
        "grp_tasks",
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
    assert.equal(JSON.parse(result.stderr).error.code, "output_exists");
    assert.equal(readFileSync(outputPath, "utf8"), "created by another process");
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unexpected local failures use exit status 1", () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-internal-status-"));
  const credentialPath = join(directory, "credential-directory");
  mkdirSync(credentialPath);
  try {
    const result = runCli(["auth", "status", "--format", "json"], {
      env: {
        NODE_ENV: "test",
        OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
      },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).error.code, "internal_error");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
