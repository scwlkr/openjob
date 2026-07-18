import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoPath = fileURLToPath(new URL("../", import.meta.url));
const cliPackagePath = fileURLToPath(new URL("../cli/", import.meta.url));
const cliManifest = JSON.parse(
  readFileSync(join(cliPackagePath, "package.json"), "utf8"),
);
const rootManifest = JSON.parse(
  readFileSync(join(repoPath, "package.json"), "utf8"),
);
const cliVersion = cliManifest.version;
const releaseTag = `v${cliVersion}`;
const installCommand = `npm install --global https://github.com/scwlkr/openjob/releases/download/${releaseTag}/openjob-${cliVersion}.tgz`;

test("the repository documents one clean-Mac CLI install command", () => {
  const readme = readFileSync(join(repoPath, "README.md"), "utf8");
  const cliReadme = readFileSync(join(cliPackagePath, "README.md"), "utf8");
  assert.equal(cliVersion, rootManifest.version);
  assert.match(readme, /Requires macOS and Node\.js 22\.13 or newer\./);
  assert.equal(readme.split(installCommand).length - 1, 1);
  assert.equal(cliReadme.split(installCommand).length - 1, 1);
});

test("the hosted CLI smoke fails closed without a Firebase ID token", () => {
  const result = spawnSync(
    process.execPath,
    [join(repoPath, "scripts", "smoke-cli-production.mjs")],
    {
      cwd: repoPath,
      encoding: "utf8",
      env: {
        ...process.env,
        OPENJOB_CLI_SMOKE_TOKEN: "",
        OPENJOB_CLI_SMOKE_USE_KEYCHAIN: "",
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /OPENJOB_CLI_SMOKE_TOKEN is required/);
});

test("the CLI release artifact installs the complete executable without app code", () => {
  const directory = mkdtempSync(join(tmpdir(), "openjob-cli-package-"));
  const installPrefix = join(directory, "install");

  try {
    const packed = spawnSync(
      "npm",
      ["pack", cliPackagePath, "--json", "--pack-destination", directory],
      { cwd: repoPath, encoding: "utf8" },
    );
    assert.equal(packed.status, 0, packed.stderr);

    const [artifact] = JSON.parse(packed.stdout);
    assert.equal(artifact.name, "openjob");
    assert.equal(artifact.version, cliVersion);

    const packagedFiles = artifact.files.map(({ path }) => path);
    for (const required of [
      "generated/openapi.d.ts",
      "lib/api.mjs",
      "lib/auth.mjs",
      "lib/credential-store.mjs",
      "openapi-types.ts",
      "openjob.mjs",
      "package.json",
      "README.md",
    ]) {
      assert.ok(packagedFiles.includes(required), `missing ${required}`);
    }
    assert.equal(
      packagedFiles.some((path) => /(^|\/)(app|db|prototypes|server|tests)(\/|$)/.test(path)),
      false,
    );

    const installed = spawnSync(
      "npm",
      [
        "install",
        "--prefix",
        installPrefix,
        "--no-package-lock",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(directory, artifact.filename),
      ],
      { encoding: "utf8" },
    );
    assert.equal(installed.status, 0, installed.stderr);

    const installedCli = join(installPrefix, "node_modules", ".bin", "openjob");
    const version = spawnSync(installedCli, ["--version"], { encoding: "utf8" });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout, `openjob ${cliVersion}\n`);

    const help = spawnSync(installedCli, ["--help"], { encoding: "utf8" });
    assert.equal(help.status, 0, help.stderr);
    for (const resource of [
      "auth",
      "user",
      "username",
      "group",
      "member",
      "ban",
      "invite",
      "task",
    ]) {
      assert.match(help.stdout, new RegExp(`^  ${resource}\\s`, "m"));
    }

    const expectedCommands = {
      auth: ["login", "status", "logout"],
      user: ["show"],
      username: ["claim"],
      group: ["list", "create", "show", "use", "current", "rename", "leave", "end"],
      member: ["list", "kick", "promote", "demote"],
      ban: ["list", "add", "remove"],
      invite: ["show", "rotate", "inspect", "join"],
      task: ["list", "create", "show", "edit", "done", "reopen", "delete"],
    };
    for (const [resource, commands] of Object.entries(expectedCommands)) {
      const resourceHelp = spawnSync(installedCli, ["help", resource], {
        encoding: "utf8",
      });
      assert.equal(resourceHelp.status, 0, resourceHelp.stderr);
      for (const command of commands) {
        assert.match(resourceHelp.stdout, new RegExp(`openjob ${resource} ${command}`));
      }
    }

    const manifest = JSON.parse(
      readFileSync(join(installPrefix, "node_modules", "openjob", "package.json"), "utf8"),
    );
    assert.deepEqual(manifest.dependencies, { "@napi-rs/keyring": "1.3.0" });

    const installedSuiteEnvironment = {
      ...process.env,
      OPENJOB_CLI_TEST_BIN: installedCli,
    };
    delete installedSuiteEnvironment.NODE_TEST_CONTEXT;
    const installedProcessSuite = spawnSync(
      process.execPath,
      ["--test", join(repoPath, "tests", "cli.test.mjs")],
      {
        cwd: repoPath,
        encoding: "utf8",
        env: installedSuiteEnvironment,
      },
    );
    assert.equal(
      installedProcessSuite.status,
      0,
      installedProcessSuite.stderr || installedProcessSuite.stdout,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
