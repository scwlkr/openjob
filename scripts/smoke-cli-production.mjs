import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const idToken = process.env.OPENJOB_CLI_SMOKE_TOKEN;
const useKeychain = process.env.OPENJOB_CLI_SMOKE_USE_KEYCHAIN === "1";

if (!idToken && !useKeychain) {
  process.stderr.write(
    "OPENJOB_CLI_SMOKE_TOKEN is required unless OPENJOB_CLI_SMOKE_USE_KEYCHAIN=1.\n",
  );
  process.exitCode = 1;
} else {
  await smoke({ firebaseIdToken: idToken, useKeychain });
}

async function smoke({ firebaseIdToken, useKeychain: useStoredCredential }) {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-production-"));
  const credentialPath = join(directory, "credential");
  const configHome = join(directory, "config");
  const cli = process.env.OPENJOB_CLI_BIN || "openjob";
  const packageJson = JSON.parse(
    readFileSync(new URL("../cli/package.json", import.meta.url), "utf8"),
  );
  const refreshMarker = "openjob-cli-production-smoke";
  if (firebaseIdToken) writeFileSync(credentialPath, refreshMarker, { mode: 0o600 });

  const authServer = firebaseIdToken
    ? createServer((request, response) => {
        if (request.method === "POST" && request.url?.startsWith("/firebase/token?")) {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              expires_in: "3600",
              id_token: firebaseIdToken,
              refresh_token: refreshMarker,
            }),
          );
          return;
        }
        response.statusCode = 404;
        response.end();
      })
    : undefined;
  if (authServer) {
    await new Promise((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  }
  const address = authServer?.address();
  const childEnvironment = { ...process.env };
  delete childEnvironment.OPENJOB_CLI_SMOKE_TOKEN;
  delete childEnvironment.OPENJOB_CLI_SMOKE_USE_KEYCHAIN;
  delete childEnvironment.OPENJOB_API_URL;
  delete childEnvironment.OPENJOB_CONFIG;
  delete childEnvironment.OPENJOB_PREVIEW_QA_EXPECTED_USER_ID;
  delete childEnvironment.OPENJOB_PREVIEW_QA_GOOGLE_OAUTH_CLIENT_ID;
  for (const name of Object.keys(childEnvironment)) {
    if (name.startsWith("OPENJOB_TEST_")) delete childEnvironment[name];
  }
  Object.assign(childEnvironment, {
    NODE_ENV: useStoredCredential ? "production" : "test",
    XDG_CONFIG_HOME: configHome,
    OPENJOB_GROUP_ID: "",
  });
  if (address && typeof address === "object") {
    Object.assign(childEnvironment, {
      OPENJOB_API_URL: "https://openjob.dev/api/v1",
      OPENJOB_TEST_AUTH_URL: `http://127.0.0.1:${address.port}`,
      OPENJOB_TEST_CREDENTIAL_FILE: credentialPath,
      OPENJOB_TEST_FIREBASE_API_KEY: "production-smoke",
      OPENJOB_TEST_GOOGLE_CLIENT_ID:
        "production-smoke.apps.googleusercontent.com",
    });
  }

  let group;
  let task;
  async function invoke(arguments_) {
    try {
      const { stdout } = await run(cli, [...arguments_, "--format", "json", "--quiet"], {
        encoding: "utf8",
        env: childEnvironment,
      });
      return JSON.parse(stdout);
    } catch (error) {
      const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
      throw new Error(
        `${cli} ${arguments_.join(" ")} failed${stderr ? `: ${stderr}` : "."}`,
      );
    }
  }

  try {
    const version = await run(cli, ["--version"], {
      encoding: "utf8",
      env: childEnvironment,
    });
    if (version.stdout !== `openjob ${packageJson.version}\n`) {
      throw new Error(`Expected installed openjob ${packageJson.version}.`);
    }

    const authentication = await invoke(["auth", "status"]);
    const username = authentication.data.username ||
      process.env.OPENJOB_CLI_SMOKE_USERNAME ||
      `clismoke-${Date.now().toString(36)}`;
    if (!authentication.data.username) {
      await invoke(["username", "claim", username]);
    }

    const groupName = `OpenJob CLI smoke ${Date.now()}`;
    group = (await invoke(["group", "create", "--name", groupName])).data;
    const selection = await invoke(["group", "use", group.groupId]);
    if (selection.data.groupId !== group.groupId) {
      throw new Error("The installed CLI did not persist Group selection.");
    }

    task = (
      await invoke([
        "task",
        "create",
        "--text",
        "Prove the packaged CLI",
        "--assignee",
        username,
      ])
    ).data;
    const shown = await invoke(["task", "show", task.taskId]);
    if (shown.data.taskId !== task.taskId) {
      throw new Error("The installed CLI did not retrieve its hosted Task.");
    }
    await invoke(["task", "edit", task.taskId, "--text", "Prove and ship the packaged CLI"]);
    await invoke(["task", "done", task.taskId]);
    await invoke(["task", "reopen", task.taskId]);
    const listed = await invoke(["task", "list", "--status", "open", "--assignee", username]);
    if (!listed.data.some(({ taskId }) => taskId === task.taskId)) {
      throw new Error("The installed CLI did not list its hosted Task.");
    }
    await invoke(["task", "delete", task.taskId, "--yes"]);
    task = undefined;
    await invoke(["group", "end", "--confirm-name", groupName]);
    group = undefined;

    process.stdout.write(
      `Packaged openjob ${packageJson.version} production smoke passed: auth refresh, Group selection, Task lifecycle, cleanup.\n`,
    );
  } finally {
    if (task && group) {
      await invoke(["task", "delete", task.taskId, "--group", group.groupId, "--yes"]).catch(
        () => {},
      );
    }
    if (group) {
      await invoke([
        "group",
        "end",
        "--group",
        group.groupId,
        "--confirm-name",
        group.name,
      ]).catch(() => {});
    }
    if (authServer) await new Promise((resolve) => authServer.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
}
