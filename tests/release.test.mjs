import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const RELEASE_SCRIPT = new URL("../scripts/release.mjs", import.meta.url).pathname;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function createReleaseFixture() {
  const root = await mkdtemp(join(tmpdir(), "openjob-release-"));
  const remote = `${root}-remote.git`;
  const fakeBin = join(root, "fake-bin");
  const commandLog = `${root}-commands.log`;
  await Promise.all([
    mkdir(join(root, "cli"), { recursive: true }),
    mkdir(join(root, "openapi"), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);
  await Promise.all([
    writeJson(join(root, "package.json"), { name: "openjob", version: "0.1.1" }),
    writeJson(join(root, "package-lock.json"), {
      name: "openjob",
      version: "0.1.1",
      lockfileVersion: 3,
      packages: { "": { name: "openjob", version: "0.1.1" } },
    }),
    writeJson(join(root, "cli", "package.json"), { name: "openjob", version: "0.1.1" }),
    writeFile(join(root, "openapi", "openapi.yaml"), "openapi: 3.1.0\ninfo:\n  title: OpenJob\n  version: 0.1.1\n"),
    writeFile(join(root, "README.md"), "Install OpenJob v0.1.1 from releases/download/v0.1.1/openjob-0.1.1.tgz\n"),
    writeFile(join(root, "cli", "README.md"), "Install OpenJob v0.1.1 from releases/download/v0.1.1/openjob-0.1.1.tgz\n"),
    writeFile(join(root, "CHANGELOG.md"), [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- Task Priority.",
      "",
      "### Changed",
      "",
      "- Unified releases.",
      "",
      "## [0.1.1] - 2026-07-17",
      "",
      "### Fixed",
      "",
      "- Previous fix.",
      "",
      "[Unreleased]: https://github.com/scwlkr/openjob/compare/v0.1.1...HEAD",
      "[0.1.1]: https://github.com/scwlkr/openjob/releases/tag/v0.1.1",
      "",
    ].join("\n")),
    writeFile(join(fakeBin, "npm"), [
      "#!/bin/sh",
      "printf 'npm %s\\n' \"$*\" >> \"$OPENJOB_RELEASE_COMMAND_LOG\"",
      "if [ \"$OPENJOB_FAKE_DEPLOY_FAIL\" = \"1\" ] && [ \"$1 $2\" = \"run deploy:raw\" ]; then exit 1; fi",
      "if [ \"$1\" = \"pack\" ]; then",
      "  version=$(node -p \"require('./cli/package.json').version\")",
      "  mkdir -p \"$5\"",
      "  printf 'openjob cli artifact' > \"$5/openjob-$version.tgz\"",
      "  printf '[{\"filename\":\"openjob-%s.tgz\"}]\\n' \"$version\"",
      "fi",
      "",
    ].join("\n")),
    writeFile(join(fakeBin, "gh"), [
      "#!/bin/sh",
      "printf 'gh %s\\n' \"$*\" >> \"$OPENJOB_RELEASE_COMMAND_LOG\"",
      "if [ \"$1\" = \"release\" ] && [ \"$2\" = \"view\" ]; then",
      "  if [ \"$OPENJOB_FAKE_RELEASE_EXISTS\" = \"1\" ]; then printf '{\"isDraft\":true,\"isPrerelease\":false}\\n'; exit 0; fi",
      "  exit 1",
      "fi",
      "",
    ].join("\n")),
  ]);
  await Promise.all([
    chmod(join(fakeBin, "npm"), 0o755),
    chmod(join(fakeBin, "gh"), 0o755),
  ]);

  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "OpenJob Test"]);
  git(root, ["config", "user.email", "test@openjob.dev"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "Initial release"]);
  execFileSync("git", ["init", "--bare", remote]);
  git(root, ["remote", "add", "origin", remote]);
  git(root, ["push", "-u", "origin", "main"]);

  return { commandLog, fakeBin, root };
}

test("package commands expose two-phase releases and guard production deploys", async () => {
  const packageMetadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(packageMetadata.scripts["release:prepare"], "node scripts/release.mjs prepare");
  assert.equal(packageMetadata.scripts["release:publish"], "node scripts/release.mjs publish");
  assert.equal(packageMetadata.scripts.deploy, "node scripts/release.mjs deploy");
  assert.equal(packageMetadata.scripts["deploy:raw"], "vinext deploy");
});

test("release prepare synchronizes a minor version, promotes notes, verifies, and commits", async () => {
  const fixture = await createReleaseFixture();
  const result = spawnSync(process.execPath, [RELEASE_SCRIPT, "prepare", "minor"], {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENJOB_RELEASE_COMMAND_LOG: fixture.commandLog,
      PATH: `${fixture.fakeBin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [rootPackage, lockfile, cliPackage, openapi, readme, cliReadme, changelog, commands] =
    await Promise.all([
      readFile(join(fixture.root, "package.json"), "utf8").then(JSON.parse),
      readFile(join(fixture.root, "package-lock.json"), "utf8").then(JSON.parse),
      readFile(join(fixture.root, "cli", "package.json"), "utf8").then(JSON.parse),
      readFile(join(fixture.root, "openapi", "openapi.yaml"), "utf8"),
      readFile(join(fixture.root, "README.md"), "utf8"),
      readFile(join(fixture.root, "cli", "README.md"), "utf8"),
      readFile(join(fixture.root, "CHANGELOG.md"), "utf8"),
      readFile(fixture.commandLog, "utf8"),
    ]);

  assert.equal(rootPackage.version, "0.2.0");
  assert.equal(lockfile.version, "0.2.0");
  assert.equal(lockfile.packages[""].version, "0.2.0");
  assert.equal(cliPackage.version, "0.2.0");
  assert.match(openapi, /version: 0\.2\.0/);
  assert.match(readme, /v0\.2\.0.*releases\/download\/v0\.2\.0\/openjob-0\.2\.0\.tgz/);
  assert.match(cliReadme, /v0\.2\.0.*releases\/download\/v0\.2\.0\/openjob-0\.2\.0\.tgz/);
  assert.match(changelog, /## \[Unreleased\][\s\S]*### Security[\s\S]*## \[0\.2\.0\] - \d{4}-\d{2}-\d{2}/);
  assert.match(changelog, /## \[0\.2\.0\][\s\S]*- Task Priority\.[\s\S]*- Unified releases\./);
  assert.match(changelog, /\[Unreleased\]: .*compare\/v0\.2\.0\.\.\.HEAD/);
  assert.match(changelog, /\[0\.2\.0\]: .*compare\/v0\.1\.1\.\.\.v0\.2\.0/);
  assert.equal(commands, [
    "npm run cli:types",
    "npm test",
    "npm run typecheck",
    "npm run lint",
    "npm run openapi:check",
  ].join("\n") + "\n");
  assert.equal(git(fixture.root, ["log", "-1", "--pretty=%s"]), "Prepare OpenJob v0.2.0");
  assert.equal(git(fixture.root, ["status", "--short"]), "");
});

test("release prepare rejects untracked files before changing the version", async () => {
  const fixture = await createReleaseFixture();
  await writeFile(join(fixture.root, "untracked-source.ts"), "export const draft = true;\n");
  const result = spawnSync(process.execPath, [RELEASE_SCRIPT, "prepare", "minor"], {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENJOB_RELEASE_COMMAND_LOG: fixture.commandLog,
      PATH: `${fixture.fakeBin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /working tree must be clean/i);
  assert.equal(
    JSON.parse(await readFile(join(fixture.root, "package.json"), "utf8")).version,
    "0.1.1",
  );
});

test("release publish creates a tagged draft before deploy proof and then publishes it", async () => {
  const fixture = await createReleaseFixture();
  const env = {
    ...process.env,
    OPENJOB_RELEASE_COMMAND_LOG: fixture.commandLog,
    PATH: `${fixture.fakeBin}:${process.env.PATH}`,
  };
  const prepared = spawnSync(process.execPath, [RELEASE_SCRIPT, "prepare", "minor"], {
    cwd: fixture.root,
    encoding: "utf8",
    env,
  });
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  git(fixture.root, ["push", "origin", "main"]);
  await writeFile(fixture.commandLog, "");

  const published = spawnSync(process.execPath, [RELEASE_SCRIPT, "publish"], {
    cwd: fixture.root,
    encoding: "utf8",
    env,
  });

  assert.equal(published.status, 0, published.stderr || published.stdout);
  const head = git(fixture.root, ["rev-parse", "HEAD"]);
  assert.equal(git(fixture.root, ["rev-list", "-n", "1", "v0.2.0"]), head);
  assert.equal(git(fixture.root, ["ls-remote", "origin", "refs/tags/v0.2.0^{}"]),
    `${head}\trefs/tags/v0.2.0^{}`);

  const commands = await readFile(fixture.commandLog, "utf8");
  const draft = commands.indexOf("gh release create v0.2.0");
  const deploy = commands.indexOf("npm run deploy:raw");
  const apiSmoke = commands.indexOf("npm run smoke:production");
  const cliSmoke = commands.indexOf("npm run cli:smoke:production");
  const publish = commands.indexOf("gh release edit v0.2.0 --draft=false --latest");
  assert.match(commands, /npm pack \.\/cli --json --pack-destination /);
  assert.match(commands, /gh release create v0\.2\.0 .*openjob-0\.2\.0\.tgz.*openjob-0\.2\.0\.tgz\.sha256.*--draft.*--verify-tag/);
  assert.ok(draft >= 0 && draft < deploy, commands);
  assert.ok(deploy < apiSmoke && apiSmoke < cliSmoke && cliSmoke < publish, commands);
  assert.equal(git(fixture.root, ["status", "--short"]), "");
});

test("release publish rejects commits made after release preparation", async () => {
  const fixture = await createReleaseFixture();
  const env = {
    ...process.env,
    OPENJOB_RELEASE_COMMAND_LOG: fixture.commandLog,
    PATH: `${fixture.fakeBin}:${process.env.PATH}`,
  };
  const prepared = spawnSync(process.execPath, [RELEASE_SCRIPT, "prepare", "minor"], {
    cwd: fixture.root,
    encoding: "utf8",
    env,
  });
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  await writeFile(join(fixture.root, "README.md"), "Post-prepare change\n", { flag: "a" });
  git(fixture.root, ["add", "README.md"]);
  git(fixture.root, ["commit", "-m", "Change after preparation"]);
  git(fixture.root, ["push", "origin", "main"]);

  const result = spawnSync(process.execPath, [RELEASE_SCRIPT, "publish"], {
    cwd: fixture.root,
    encoding: "utf8",
    env,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /prepared release commit/i);
  assert.equal(git(fixture.root, ["tag", "--list", "v0.2.0"]), "");
});

test("release candidates publish as prereleases without deploying production", async () => {
  const fixture = await createReleaseFixture();
  const env = {
    ...process.env,
    OPENJOB_RELEASE_COMMAND_LOG: fixture.commandLog,
    PATH: `${fixture.fakeBin}:${process.env.PATH}`,
  };
  const prepared = spawnSync(
    process.execPath,
    [RELEASE_SCRIPT, "prepare", "0.2.0-rc.1"],
    { cwd: fixture.root, encoding: "utf8", env },
  );
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  git(fixture.root, ["push", "origin", "main"]);
  await writeFile(fixture.commandLog, "");

  const published = spawnSync(process.execPath, [RELEASE_SCRIPT, "publish"], {
    cwd: fixture.root,
    encoding: "utf8",
    env,
  });

  assert.equal(published.status, 0, published.stderr || published.stdout);
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /gh release create v0\.2\.0-rc\.1 .*--draft.*--verify-tag.*--prerelease/);
  assert.match(commands, /gh release edit v0\.2\.0-rc\.1 --draft=false --prerelease/);
  assert.doesNotMatch(commands, /deploy:raw|smoke:production|--latest/);
});

test("direct production deploy fails closed without the matching release tag", async () => {
  const fixture = await createReleaseFixture();
  const result = spawnSync(process.execPath, [RELEASE_SCRIPT, "deploy"], {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENJOB_RELEASE_COMMAND_LOG: fixture.commandLog,
      PATH: `${fixture.fakeBin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHANGELOG\.md has no release notes for 0\.1\.1|requires v0\.1\.1/);
  const commands = await readFile(fixture.commandLog, "utf8").catch(() => "");
  assert.doesNotMatch(commands, /deploy:raw/);
});

test("a failed stable publish leaves a draft that resumes without changing version", async () => {
  const fixture = await createReleaseFixture();
  const baseEnvironment = {
    ...process.env,
    OPENJOB_RELEASE_COMMAND_LOG: fixture.commandLog,
    PATH: `${fixture.fakeBin}:${process.env.PATH}`,
  };
  const prepared = spawnSync(process.execPath, [RELEASE_SCRIPT, "prepare", "minor"], {
    cwd: fixture.root,
    encoding: "utf8",
    env: baseEnvironment,
  });
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  git(fixture.root, ["push", "origin", "main"]);
  await writeFile(fixture.commandLog, "");

  const failed = spawnSync(process.execPath, [RELEASE_SCRIPT, "publish"], {
    cwd: fixture.root,
    encoding: "utf8",
    env: { ...baseEnvironment, OPENJOB_FAKE_DEPLOY_FAIL: "1" },
  });
  assert.equal(failed.status, 1);
  let commands = await readFile(fixture.commandLog, "utf8");
  assert.ok(commands.indexOf("gh release create v0.2.0") < commands.indexOf("npm run deploy:raw"));
  assert.doesNotMatch(commands, /gh release edit v0\.2\.0 --draft=false/);

  await writeFile(fixture.commandLog, "");
  const resumed = spawnSync(process.execPath, [RELEASE_SCRIPT, "publish"], {
    cwd: fixture.root,
    encoding: "utf8",
    env: { ...baseEnvironment, OPENJOB_FAKE_RELEASE_EXISTS: "1" },
  });

  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /gh release edit v0\.2\.0 --draft --title OpenJob v0\.2\.0 --notes-file/);
  assert.match(commands, /gh release upload v0\.2\.0 .*--clobber/);
  assert.match(commands, /gh release edit v0\.2\.0 --draft=false --latest/);
  assert.equal(JSON.parse(await readFile(join(fixture.root, "package.json"), "utf8")).version, "0.2.0");
});
