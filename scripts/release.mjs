import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compareSemVer, parseSemVer } from "../lib/semver.ts";

const root = resolve(process.cwd());

function output(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr || result.stdout : "";
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail.trim()}` : ""}`);
  }
  return result.stdout?.trim() ?? "";
}

function attempt(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    env: process.env,
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function writeJson(path, value) {
  await writeFile(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

function assertReleaseBranch() {
  const repositoryRoot = resolve(output("git", ["rev-parse", "--show-toplevel"]));
  if (repositoryRoot !== root) throw new Error("Run the release command from the repository root.");
  if (output("git", ["branch", "--show-current"]) !== "main") {
    throw new Error("Releases must run from main.");
  }
  if (output("git", ["status", "--porcelain"])) {
    throw new Error("The working tree must be clean before a release.");
  }
  run("git", ["fetch", "origin", "main"]);
  const [behind, ahead] = output("git", [
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...origin/main",
  ]).split(/\s+/u).map(Number);
  if (behind !== 0 || ahead !== 0) {
    throw new Error("main must be synchronized with origin/main before a release.");
  }
}

function resolveTargetVersion(currentVersion, requested) {
  const current = parseSemVer(currentVersion);
  if (!current) throw new Error(`Current version ${currentVersion} is not valid SemVer.`);
  if (["patch", "minor", "major"].includes(requested)) {
    if (current.prerelease.length > 0) {
      throw new Error("Use an explicit version when preparing from a prerelease.");
    }
    if (requested === "major") return `${current.major + 1}.0.0`;
    if (requested === "minor") return `${current.major}.${current.minor + 1}.0`;
    return `${current.major}.${current.minor}.${current.patch + 1}`;
  }
  if (!parseSemVer(requested) || compareSemVer(requested, currentVersion) !== 1) {
    throw new Error(`Target version ${requested} must be valid SemVer greater than ${currentVersion}.`);
  }
  return requested;
}

function localDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function promoteChangelog(source, currentVersion, targetVersion) {
  const section = source.match(/## \[Unreleased\]\n([\s\S]*?)(?=\n## \[)/u);
  if (!section || !/^\s*-\s+\S/mu.test(section[1])) {
    throw new Error("CHANGELOG.md needs at least one Unreleased note.");
  }
  const notes = section[1].trim();
  const replacement = [
    "## [Unreleased]",
    "",
    "### Added",
    "",
    "### Changed",
    "",
    "### Fixed",
    "",
    "### Security",
    "",
    `## [${targetVersion}] - ${localDate()}`,
    "",
    notes,
  ].join("\n");
  let updated = source.replace(section[0], replacement);
  const unreleasedLink = /^\[Unreleased\]: .*$/mu;
  if (!unreleasedLink.test(updated)) {
    throw new Error("CHANGELOG.md is missing its Unreleased comparison link.");
  }
  updated = updated.replace(
    unreleasedLink,
    `[Unreleased]: https://github.com/scwlkr/openjob/compare/v${targetVersion}...HEAD`,
  );
  const currentLink = new RegExp(`^\\[${currentVersion.replaceAll(".", "\\.")}\\]: .*?$`, "mu");
  const targetLink = `[${targetVersion}]: https://github.com/scwlkr/openjob/compare/v${currentVersion}...v${targetVersion}`;
  if (!currentLink.test(updated)) {
    throw new Error(`CHANGELOG.md is missing the ${currentVersion} release link.`);
  }
  return updated.replace(currentLink, `${targetLink}\n$&`);
}

async function prepare(requested) {
  if (!requested) throw new Error("Usage: npm run release:prepare -- <patch|minor|major|version>");
  assertReleaseBranch();

  const [
    rootPackage,
    lockfile,
    cliPackage,
    nativePackage,
    nativeLockfile,
    openapi,
    readme,
    cliReadme,
    changelog,
  ] =
    await Promise.all([
      readJson("package.json"),
      readJson("package-lock.json"),
      readJson("cli/package.json"),
      readJson("native/package.json"),
      readJson("native/package-lock.json"),
      readFile(resolve(root, "openapi/openapi.yaml"), "utf8"),
      readFile(resolve(root, "README.md"), "utf8"),
      readFile(resolve(root, "cli/README.md"), "utf8"),
      readFile(resolve(root, "CHANGELOG.md"), "utf8"),
    ]);
  const currentVersion = rootPackage.version;
  const targetVersion = resolveTargetVersion(currentVersion, requested);
  const nextChangelog = promoteChangelog(changelog, currentVersion, targetVersion);

  rootPackage.version = targetVersion;
  lockfile.version = targetVersion;
  lockfile.packages[""].version = targetVersion;
  cliPackage.version = targetVersion;
  nativePackage.version = targetVersion;
  nativeLockfile.version = targetVersion;
  nativeLockfile.packages[""].version = targetVersion;
  const nextOpenapi = openapi.replace(
    new RegExp(`(\\n\\s*version:\\s*)${currentVersion.replaceAll(".", "\\.")}(\\s*\\n)`, "u"),
    `$1${targetVersion}$2`,
  );
  if (nextOpenapi === openapi) throw new Error("OpenAPI version does not match the root version.");
  const replaceVersion = (source) => source.replaceAll(currentVersion, targetVersion);

  await Promise.all([
    writeJson("package.json", rootPackage),
    writeJson("package-lock.json", lockfile),
    writeJson("cli/package.json", cliPackage),
    writeJson("native/package.json", nativePackage),
    writeJson("native/package-lock.json", nativeLockfile),
    writeFile(resolve(root, "openapi/openapi.yaml"), nextOpenapi),
    writeFile(resolve(root, "README.md"), replaceVersion(readme)),
    writeFile(resolve(root, "cli/README.md"), replaceVersion(cliReadme)),
    writeFile(resolve(root, "CHANGELOG.md"), nextChangelog),
  ]);

  run("npm", ["run", "cli:types"]);
  run("npm", ["test"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "lint"]);
  run("npm", ["run", "openapi:check"]);
  run("git", ["add", "-u"]);
  run("git", ["commit", "-m", `Prepare OpenJob v${targetVersion}`]);
  console.log(`Prepared OpenJob v${targetVersion}.`);
}

function escapedVersion(version) {
  return version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function synchronizedRelease() {
  const [rootPackage, cliPackage, nativePackage, openapi, changelog] =
    await Promise.all([
      readJson("package.json"),
      readJson("cli/package.json"),
      readJson("native/package.json"),
      readFile(resolve(root, "openapi/openapi.yaml"), "utf8"),
      readFile(resolve(root, "CHANGELOG.md"), "utf8"),
    ]);
  const version = rootPackage.version;
  const parsed = parseSemVer(version);
  if (!parsed) throw new Error(`Current version ${version} is not valid SemVer.`);
  if (
    cliPackage.version !== version ||
    nativePackage.version !== version ||
    !new RegExp(
      `\\n\\s*version:\\s*${escapedVersion(version)}\\s*\\n`,
      "u",
    ).test(openapi)
  ) {
    throw new Error("Release versions are not synchronized.");
  }
  const release = changelog.match(
    new RegExp(`## \\[${escapedVersion(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\n([\\s\\S]*?)(?=\\n## \\[)`, "u"),
  );
  if (!release || !/^\s*-\s+\S/mu.test(release[1])) {
    throw new Error(`CHANGELOG.md has no release notes for ${version}.`);
  }
  return { notes: release[1].trim(), parsed, version };
}

function tagCommit(tag) {
  const result = attempt("git", ["rev-parse", `${tag}^{}`]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function ensureReleaseTag(version) {
  const tag = `v${version}`;
  const head = output("git", ["rev-parse", "HEAD"]);
  const existingCommit = tagCommit(tag);
  if (existingCommit && existingCommit !== head) {
    throw new Error(`${tag} does not identify the current release commit.`);
  }
  if (!existingCommit) run("git", ["tag", "-a", tag, "-m", `OpenJob ${tag}`]);
  run("git", ["push", "origin", tag]);
  return tag;
}

function assertDeployableTag(version) {
  const parsed = parseSemVer(version);
  if (!parsed || parsed.prerelease.length > 0) {
    throw new Error("Only stable releases may deploy to production.");
  }
  const tag = `v${version}`;
  if (tagCommit(tag) !== output("git", ["rev-parse", "HEAD"])) {
    throw new Error(`Production deploy requires ${tag} on the current commit.`);
  }
}

function deploy(version) {
  assertReleaseBranch();
  assertDeployableTag(version);
  run("npm", ["run", "deploy:raw"], {
    env: { OPENJOB_GIT_COMMIT: output("git", ["rev-parse", "--short=12", "HEAD"]) },
  });
}

async function publish() {
  assertReleaseBranch();
  const release = await synchronizedRelease();
  if (output("git", ["log", "-1", "--pretty=%s"]) !== `Prepare OpenJob v${release.version}`) {
    throw new Error(`Publishing requires the prepared release commit for v${release.version}.`);
  }
  const tag = ensureReleaseTag(release.version);
  const releaseDirectory = await mkdtemp(join(tmpdir(), "openjob-publish-"));

  try {
    const packed = JSON.parse(run("npm", [
      "pack",
      "./cli",
      "--json",
      "--pack-destination",
      releaseDirectory,
    ], { capture: true }));
    const filename = packed[0]?.filename;
    if (typeof filename !== "string") throw new Error("npm pack did not report a CLI artifact.");
    const artifact = join(releaseDirectory, filename);
    const installationPrefix = join(releaseDirectory, "cli-installation");
    run("npm", ["install", "--global", "--prefix", installationPrefix, artifact]);
    const checksum = `${artifact}.sha256`;
    const digest = createHash("sha256").update(await readFile(artifact)).digest("hex");
    await Promise.all([
      writeFile(checksum, `${digest}  ${filename}\n`),
      writeFile(join(releaseDirectory, "release-notes.md"), `${release.notes}\n`),
    ]);
    const notesFile = join(releaseDirectory, "release-notes.md");
    const existing = attempt("gh", ["release", "view", tag, "--json", "isDraft,isPrerelease"]);
    if (existing.status === 0) {
      const state = JSON.parse(existing.stdout);
      if (!state.isDraft) throw new Error(`${tag} is already published.`);
      run("gh", [
        "release",
        "edit",
        tag,
        "--draft",
        "--title",
        `OpenJob ${tag}`,
        "--notes-file",
        notesFile,
      ]);
      run("gh", ["release", "upload", tag, artifact, checksum, "--clobber"]);
    } else {
      const createArgs = [
        "release",
        "create",
        tag,
        `${artifact}#OpenJob CLI ${tag}`,
        `${checksum}#SHA-256 checksum`,
        "--draft",
        "--verify-tag",
        "--title",
        `OpenJob ${tag}`,
        "--notes-file",
        notesFile,
      ];
      if (release.parsed.prerelease.length > 0) createArgs.push("--prerelease");
      run("gh", createArgs);
    }

    if (release.parsed.prerelease.length === 0) {
      deploy(release.version);
      const proofEnvironment = {
        OPENJOB_EXPECTED_COMMIT: output("git", ["rev-parse", "--short=12", "HEAD"]),
        OPENJOB_EXPECTED_VERSION: release.version,
      };
      run("npm", ["run", "smoke:production"], { env: proofEnvironment });
      run("npm", ["run", "cli:smoke:production"], {
        env: {
          ...proofEnvironment,
          OPENJOB_CLI_BIN: join(installationPrefix, "bin", "openjob"),
          OPENJOB_CLI_SMOKE_USE_KEYCHAIN: "1",
        },
      });
      run("gh", ["release", "edit", tag, "--draft=false", "--latest"]);
    } else {
      run("gh", ["release", "edit", tag, "--draft=false", "--prerelease"]);
    }
    console.log(`Published OpenJob ${tag}.`);
  } finally {
    await rm(releaseDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command === "prepare") return prepare(argument);
  if (command === "publish") return publish();
  if (command === "deploy") {
    assertReleaseBranch();
    const release = await synchronizedRelease();
    return deploy(release.version);
  }
  throw new Error("Usage: release.mjs <prepare|publish|deploy>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
