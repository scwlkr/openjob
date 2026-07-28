import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

const MODES = new Set(["focused", "merge", "release-candidate"]);
const USAGE =
  "Usage: npm run verify -- <focused|merge|release-candidate> --base <revision> [--cache <path>] [--evidence <gate>=<reference>]";
const RISK_CATEGORIES = new Set([
  "unknown",
  "generated-output",
  "release",
  "security",
  "signing",
  "distribution",
  "permissions",
  "accessibility",
  "hardware-risk",
  "privacy",
  "store-compliance",
]);
const GATES = [
  { id: "typecheck", command: ["npm", "run", "typecheck"] },
  { id: "lint", command: ["npm", "run", "lint"] },
  {
    id: "repository-suite",
    command: ["npm", "run", "test:deterministic"],
    cacheable: true,
    inputs: "repository",
  },
  { id: "web-integration", command: ["npm", "run", "test:browser"] },
  { id: "api-integration", command: ["npm", "run", "test:api"] },
  { id: "openapi-contract", command: ["npm", "run", "openapi:check"] },
  { id: "cli-integration", command: ["npm", "run", "test:cli"] },
  { id: "cli-generated-types", command: ["npm", "run", "cli:types:check"] },
  {
    id: "native-typecheck",
    command: ["npm", "--prefix", "native", "run", "typecheck"],
  },
  {
    id: "native-lint",
    command: ["npm", "--prefix", "native", "run", "lint"],
  },
  { id: "native-automated", command: ["npm", "--prefix", "native", "test"] },
  {
    id: "verification-process-tests",
    command: ["npm", "run", "test:verification"],
  },
  { id: "secret-check", command: ["npm", "run", "secret:check"] },
  { id: "release-privacy", command: ["npm", "run", "privacy:check"] },
  {
    id: "native-clean-generation",
    command: ["npm", "--prefix", "native", "run", "config:verify"],
    cacheable: true,
    inputs: "native-generation",
  },
  {
    id: "ios-embedded-bundle",
    command: ["npm", "--prefix", "native", "run", "bundle:verify", "--", "ios"],
    cacheable: true,
    inputs: "native-bundle",
  },
  {
    id: "android-embedded-bundle",
    command: [
      "npm",
      "--prefix",
      "native",
      "run",
      "bundle:verify",
      "--",
      "android",
    ],
    cacheable: true,
    inputs: "native-bundle",
  },
  { id: "ios-simulator-journey", kind: "evidence" },
  { id: "android-emulator-journey", kind: "evidence" },
  { id: "ios-physical-journey", kind: "evidence" },
  { id: "android-physical-journey", kind: "evidence" },
  { id: "candidate-handoff", kind: "internal" },
];
const EVIDENCE_GATES = new Set([
  "ios-simulator-journey",
  "android-emulator-journey",
]);
const REPOSITORY_SUITE_COVERAGE = new Set([
  "web-integration",
  "api-integration",
  "cli-integration",
  "cli-generated-types",
  "native-typecheck",
  "native-lint",
  "native-automated",
  "verification-process-tests",
  "release-privacy",
]);
const HARDWARE_NATIVE_INPUTS = new Set([
  "native/src/auth/provider-gateway.ts",
  "native/src/auth/session-store.ts",
  "native/src/device-state.ts",
  "native/src/diagnostics-native.ts",
  "native/src/domain-cache.ts",
]);
const VIRTUAL_NATIVE_INPUTS = new Set([
  "native/src/OpenJobShell.tsx",
  "native/src/PrivacyCurtain.tsx",
  "native/src/ReadOnlyTaskList.tsx",
  "native/src/appearance-keyboard.ts",
  "native/src/auth/AuthGate.tsx",
  "native/src/auth/coordinator.ts",
  "native/src/auth/dependencies.ts",
  "native/src/auth/firebase-rest.ts",
  "native/src/auth/openjob-api.ts",
  "native/src/brand-marks.tsx",
  "native/src/diagnostics.ts",
  "native/src/runtime-config.ts",
  "native/src/startup.ts",
  "native/src/storage.ts",
  "native/src/task-list-contracts.ts",
  "native/src/task-list-freshness.ts",
  "native/src/theme.tsx",
  "native/src/use-control-interaction.ts",
]);

class VerificationError extends Error {
  constructor(code, message, exitCode = 1) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function emitFailure(error) {
  const result = {
    schemaVersion: 1,
    status: "failed",
    error: { code: error.code, message: error.message },
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.stderr.write(`FAILED ${error.code} — ${error.message}\n`);
  process.exitCode = error.exitCode;
}

function parseArguments(arguments_) {
  const [mode, ...options] = arguments_;
  if (!MODES.has(mode)) {
    throw new VerificationError("invalid_arguments", USAGE, 2);
  }

  let base;
  let cache;
  const evidence = new Map();
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index];
    const value = options[index + 1];
    if (!value || !["--base", "--cache", "--evidence"].includes(option)) {
      throw new VerificationError("invalid_arguments", USAGE, 2);
    }
    if (option === "--base") {
      if (base) throw new VerificationError("invalid_arguments", USAGE, 2);
      base = value;
    } else if (option === "--cache") {
      if (cache) throw new VerificationError("invalid_arguments", USAGE, 2);
      cache = value;
    } else {
      const separator = value.indexOf("=");
      if (separator < 1 || separator === value.length - 1) {
        throw new VerificationError("invalid_arguments", USAGE, 2);
      }
      const gate = value.slice(0, separator);
      const reference = value.slice(separator + 1);
      if (
        !EVIDENCE_GATES.has(gate) ||
        reference.length > 240 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/#-]*$/u.test(reference)
      ) {
        throw new VerificationError("invalid_arguments", USAGE, 2);
      }
      evidence.set(gate, reference);
    }
  }
  if (!base) throw new VerificationError("invalid_arguments", USAGE, 2);
  return { base, cache, evidence, mode };
}

function run(command, args, { cwd, gate = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: "pipe",
  });
  if (gate) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error) throw result.error;
  return result;
}

function gitOutput(root, args, code = "git_error") {
  const result = run("git", args, { cwd: root });
  if (result.status !== 0) {
    throw new VerificationError(
      code,
      (result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim(),
    );
  }
  return result.stdout.trim();
}

function nulEntries(value) {
  return value.split("\0").filter(Boolean);
}

function safeCachePath(root, requested) {
  const path = resolve(root, requested ?? ".openjob/verification-cache.json");
  const canonicalize = (candidate) => {
    let existing = candidate;
    const missing = [];
    while (!existsSync(existing)) {
      missing.unshift(basename(existing));
      existing = dirname(existing);
    }
    return join(realpathSync(existing), ...missing);
  };
  const canonicalRoot = canonicalize(root);
  const canonicalPath = canonicalize(path);
  const internalRoot = resolve(canonicalRoot, ".openjob");
  const insideRepository =
    canonicalPath === canonicalRoot || canonicalPath.startsWith(`${canonicalRoot}${sep}`);
  const insideCacheDirectory = canonicalPath.startsWith(`${internalRoot}${sep}`);
  if (insideRepository && !insideCacheDirectory) {
    throw new VerificationError(
      "unsafe_cache_path",
      "A repository-local verification cache must be inside .openjob/.",
    );
  }
  return path;
}

function changedFiles(root, baseCommit) {
  const values = [
    gitOutput(root, [
      "diff",
      "--name-only",
      "--diff-filter=ACMRDTUXB",
      "-z",
      `${baseCommit}...HEAD`,
    ]),
    gitOutput(root, ["diff", "--name-only", "--diff-filter=ACMRDTUXB", "-z"]),
    gitOutput(root, [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMRDTUXB",
      "-z",
    ]),
    gitOutput(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  return [...new Set(values.flatMap(nulEntries))].sort();
}

function releaseSourceState(root) {
  const branch = gitOutput(root, ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new VerificationError(
      "release_source_not_default_branch",
      "Release-candidate verification must run from main.",
    );
  }
  if (gitOutput(root, ["status", "--porcelain", "--untracked-files=all"])) {
    throw new VerificationError(
      "release_source_not_clean",
      "Release-candidate verification requires a clean working tree.",
    );
  }
  const originMain = run(
    "git",
    ["rev-parse", "--verify", "--end-of-options", "origin/main^{commit}"],
    { cwd: root },
  );
  if (originMain.status !== 0) {
    throw new VerificationError(
      "release_source_unsynced",
      "Release-candidate verification requires origin/main.",
    );
  }
  const parity = gitOutput(root, [
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...origin/main",
  ])
    .split(/\s+/u)
    .join(" ");
  if (parity !== "0 0") {
    throw new VerificationError(
      "release_source_unsynced",
      `Release-candidate verification requires main == origin/main; found ${parity}.`,
    );
  }
  return { branch, defaultBranchParity: parity };
}

function isNativeConfigurationInput(file) {
  return (
    file === "native/app.config.mjs" ||
    file === "native/eas.json" ||
    file === "native/metro.config.cjs" ||
    file === "native/package.json" ||
    file === "native/package-lock.json" ||
    file.startsWith("native/plugins/") ||
    file.startsWith("native/patches/") ||
    file === "config/native-identities.json" ||
    file === "config/release-privacy-inventory.json" ||
    file === "config/release-privacy-inventory.schema.json" ||
    file === "config/generated/native-privacy.json" ||
    /^public\/(?:apple-touch-icon|favicon|icon-|og\.)/u.test(file)
  );
}

function isNativeGenerationInput(file) {
  return (
    isNativeConfigurationInput(file) ||
    file === "package.json" ||
    file === "native/scripts/verify-config.mjs" ||
    file === "scripts/release-privacy.mjs"
  );
}

function isNativeBundleInput(file) {
  return (
    isNativeGenerationInput(file) ||
    file === "native/App.tsx" ||
    file === "native/index.ts" ||
    file.startsWith("native/src/") ||
    file === "native/scripts/verify-embedded-bundles.mjs"
  );
}

function isHardwareRiskInput(file) {
  if (HARDWARE_NATIVE_INPUTS.has(file)) return true;
  if (["native/App.tsx", "native/index.ts"].includes(file)) return true;
  return file.startsWith("native/src/") && !VIRTUAL_NATIVE_INPUTS.has(file);
}

function isReleasePrivacyInput(file) {
  return (
    file === "config/release-privacy-inventory.json" ||
    file === "config/release-privacy-inventory.schema.json" ||
    file === "config/generated/native-privacy.json" ||
    file === "config/generated/play-data-safety.json" ||
    file === "docs/generated/release-privacy.md" ||
    file === "scripts/release-privacy.mjs" ||
    file === "tests/release-privacy.test.mjs" ||
    file === "native/app.config.mjs" ||
    file === "native/package.json" ||
    file === "native/package-lock.json" ||
    file.startsWith("native/plugins/")
  );
}

function classify(files) {
  const categories = new Set();
  for (const file of files) {
    let matched = false;
    if (
      file === "scripts/verify.mjs" ||
      file === "tests/verification.test.mjs" ||
      file === "tests/native-shell-config.test.mjs" ||
      file === "tests/release-privacy.test.mjs" ||
      file === "docs/verification.md" ||
      file === "scripts/release-privacy.mjs" ||
      file === "scripts/release-candidate.mjs" ||
      file === "tests/release-candidate.test.mjs" ||
      file === "docs/release-candidates.md" ||
      file === "native/scripts/verify-config.mjs" ||
      file === "native/scripts/verify-embedded-bundles.mjs"
    ) {
      categories.add("verification-tooling");
      matched = true;
    }
    if (isReleasePrivacyInput(file)) {
      categories.add("privacy");
      categories.add("store-compliance");
      matched = true;
    }
    if (
      file === "config/generated/native-privacy.json" ||
      file === "config/generated/play-data-safety.json" ||
      file === "docs/generated/release-privacy.md"
    ) {
      categories.add("generated-output");
      matched = true;
    }
    if (
      [
        ".gitignore",
        "package.json",
        "eslint.config.mjs",
        "postcss.config.mjs",
        "next.config.ts",
      ].includes(file)
    ) {
      categories.add("repository-tooling");
      matched = true;
    }
    if (
      (file.startsWith("app/") && !file.startsWith("app/api/")) ||
      file.startsWith("public/") ||
      file.startsWith("tests/browser/") ||
      ["next.config.ts", "postcss.config.mjs"].includes(file)
    ) {
      categories.add("web");
      matched = true;
    }
    if (
      file.startsWith("app/api/") ||
      file.startsWith("server/") ||
      file.startsWith("db/") ||
      file.startsWith("worker/") ||
      file.startsWith("openapi/") ||
      file.startsWith("shared/") ||
      file.startsWith("tests/v1-") ||
      ["firestore.indexes.json", "firestore.rules", "firebase.json"].includes(file)
    ) {
      categories.add("api");
      matched = true;
    }
    if (file.startsWith("openapi/")) {
      categories.add("api-contract");
      matched = true;
    }
    if (file.startsWith("cli/") || file.startsWith("tests/cli")) {
      categories.add("cli");
      matched = true;
    }
    if (file.startsWith("cli/generated/")) {
      categories.add("generated-output");
      matched = true;
    }
    if (
      file === "native/App.tsx" ||
      file === "native/index.ts" ||
      file.startsWith("native/src/") ||
      file.startsWith("native/test/")
    ) {
      categories.add("native-behavior");
      matched = true;
    }
    if (isHardwareRiskInput(file)) {
      categories.add("hardware-risk");
      matched = true;
    }
    if (isNativeConfigurationInput(file)) {
      categories.add("native-configuration");
      matched = true;
    }
    if (
      file.startsWith("docs/") ||
      ["README.md", "CHANGELOG.md", "CONTEXT.md", "native/README.md"].includes(file)
    ) {
      categories.add("documentation");
      matched = true;
    }
    if (/(?:^|[/_.-])(?:security|auth|secret)(?:[/_.-]|$)/iu.test(file) || file === "firestore.rules") {
      categories.add("security");
      matched = true;
    }
    if (
      file === "native/eas.json" ||
      file === "config/native-identities.json" ||
      file === "scripts/release.mjs" ||
      file === "scripts/release-candidate.mjs" ||
      file === "tests/release-candidate.test.mjs" ||
      file === "docs/release-candidates.md" ||
      file.startsWith("native/trust/") ||
      file === "docs/native-trust-and-distribution.md"
    ) {
      categories.add("signing");
      categories.add("distribution");
      categories.add("release");
      categories.add("store-compliance");
      matched = true;
    }
    if (file === "native/app.config.mjs" || file.startsWith("native/plugins/")) {
      categories.add("permissions");
      categories.add("privacy");
      matched = true;
    }
    if (/(?:^|[/_.-])accessibility(?:[/_.-]|$)/iu.test(file)) {
      categories.add("accessibility");
      matched = true;
    }
    if (/(?:^|[/_.-])(?:privacy|diagnostics|sentry)(?:[/_.-]|$)/iu.test(file)) {
      categories.add("privacy");
      matched = true;
    }
    if (/(?:^|[/_.-])(?:app-store|play-store|store-compliance)(?:[/_.-]|$)/iu.test(file)) {
      categories.add("store-compliance");
      matched = true;
    }
    if (!matched) categories.add("unknown");
  }
  if (categories.size === 0) categories.add("unknown");
  return [...categories].sort();
}

function gatePlan(categories, requestedMode, effectiveMode) {
  const selected = new Set(["typecheck", "lint"]);
  if (requestedMode === "focused") {
    selected.add("ios-simulator-journey");
    selected.add("android-emulator-journey");
  }
  if (effectiveMode === "release-candidate") {
    for (const id of [
      "repository-suite",
      "openapi-contract",
      "secret-check",
      "release-privacy",
      "native-clean-generation",
      "ios-embedded-bundle",
      "android-embedded-bundle",
      "candidate-handoff",
    ]) {
      selected.add(id);
    }
  }
  if (effectiveMode !== "release-candidate") {
    if (categories.includes("web")) selected.add("web-integration");
    if (categories.includes("api")) {
      selected.add("api-integration");
      selected.add("openapi-contract");
    }
    if (categories.includes("api-contract")) selected.add("cli-generated-types");
    if (categories.includes("cli")) {
      selected.add("cli-integration");
      selected.add("cli-generated-types");
    }
    if (categories.includes("native-behavior")) {
      selected.add("native-typecheck");
      selected.add("native-lint");
      selected.add("native-automated");
    }
    if (categories.includes("native-configuration")) {
      selected.add("native-typecheck");
      selected.add("native-lint");
      selected.add("native-automated");
      selected.add("native-clean-generation");
      selected.add("ios-embedded-bundle");
      selected.add("android-embedded-bundle");
    }
    if (categories.includes("repository-tooling")) {
      selected.add("repository-suite");
    }
    if (categories.includes("verification-tooling")) {
      if (!selected.has("repository-suite")) selected.add("verification-process-tests");
      selected.add("native-clean-generation");
      selected.add("ios-embedded-bundle");
      selected.add("android-embedded-bundle");
    }
  }
  if (selected.has("repository-suite")) {
    for (const id of REPOSITORY_SUITE_COVERAGE) selected.add(id);
  }
  const escalated = requestedMode !== effectiveMode;
  return GATES.map((gate) => {
    const coveredByRepository =
      selected.has("repository-suite") && REPOSITORY_SUITE_COVERAGE.has(gate.id);
    return {
      ...gate,
      ...(coveredByRepository ? { coveredBy: "repository-suite" } : {}),
      outcome: selected.has(gate.id) ? "selected" : "skipped",
      reason: selected.has(gate.id)
        ? `${gate.id} is required by the ${effectiveMode} impact policy`
        : ["ios-physical-journey", "android-physical-journey"].includes(
              gate.id,
            ) && categories.includes("hardware-risk")
          ? "hardware-specific physical proof is deferred to issue #41 Release Proof"
        : gate.id === "release-privacy"
          ? "the Release Privacy Inventory, permissions, processors, configuration, and projections are unaffected"
          : "the changed inputs do not affect this gate",
      selection: selected.has(gate.id)
        ? escalated
          ? "escalated"
          : "selected"
        : "skipped",
    };
  });
}

function matchesInputs(file, inputSet) {
  if (inputSet === "native-generation") return isNativeGenerationInput(file);
  if (inputSet === "native-bundle") return isNativeBundleInput(file);
  if (inputSet === "repository") return true;
  return false;
}

async function toolVersions(root) {
  const npm = run("npm", ["--version"], { cwd: root });
  if (npm.status !== 0) {
    throw new VerificationError("tool_version_failed", "Could not read the npm version.");
  }
  const versions = { node: process.version, npm: npm.stdout.trim() };
  for (const [path, fields] of [
    ["package.json", ["typescript", "eslint", "@playwright/test", "vinext"]],
    ["native/package.json", ["expo", "react-native", "typescript"]],
  ]) {
    try {
      const metadata = JSON.parse(await readFile(resolve(root, path), "utf8"));
      for (const field of fields) {
        const version = metadata.dependencies?.[field] ?? metadata.devDependencies?.[field];
        if (version) versions[`${path}:${field}`] = version;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return versions;
}

async function gateFingerprint(root, gate, files, versions) {
  const hash = createHash("sha256");
  hash.update(`openjob-verification-v1\0${gate.id}\0`);
  hash.update(`${JSON.stringify(versions)}\0`);
  for (const file of files.filter((candidate) => matchesInputs(candidate, gate.inputs))) {
    hash.update(`${file}\0`);
    try {
      hash.update(await readFile(resolve(root, file)));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update("<missing>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function changeFingerprint(root, baseRevision, headRevision, files) {
  const hash = createHash("sha256");
  hash.update(`openjob-change-v1\0${baseRevision}\0${headRevision}\0`);
  for (const file of files) {
    hash.update(`${file}\0`);
    try {
      hash.update(await readFile(resolve(root, file)));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update("<missing>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function readCache(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.schemaVersion !== 1 ||
      !value.results ||
      typeof value.results !== "object" ||
      Array.isArray(value.results)
    ) {
      return { state: "invalid", value: { schemaVersion: 1, results: {} } };
    }
    return { state: "loaded", value };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { state: "missing", value: { schemaVersion: 1, results: {} } };
    }
    if (error instanceof SyntaxError) {
      return { state: "invalid", value: { schemaVersion: 1, results: {} } };
    }
    throw error;
  }
}

async function writeCache(path, cache) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function execute(plan, root, evidence, cache) {
  let priorFailure = false;
  for (const gate of plan) {
    if (gate.outcome === "skipped") continue;
    if (gate.coveredBy) {
      const coveringGate = plan.find((candidate) => candidate.id === gate.coveredBy);
      if (["passed", "reused"].includes(coveringGate?.outcome)) {
        gate.outcome = coveringGate.outcome;
        gate.reason = `${gate.id} is covered by the complete repository-suite command`;
        if (coveringGate.fingerprint) gate.fingerprint = coveringGate.fingerprint;
      } else {
        gate.outcome = "skipped";
        gate.reason = `${gate.coveredBy} did not produce reusable passing proof`;
      }
      continue;
    }
    if (priorFailure) {
      gate.outcome = "skipped";
      gate.reason = "a prior selected gate failed";
      continue;
    }
    if (
      gate.cacheable &&
      cache.value.results[gate.id]?.status === "passed" &&
      cache.value.results[gate.id]?.fingerprint === gate.fingerprint
    ) {
      gate.outcome = "reused";
      gate.reason = "the full declared input and tool fingerprint matches cached success";
      continue;
    }
    if (gate.kind === "evidence") {
      const reference = evidence.get(gate.id);
      if (reference) {
        gate.evidence = reference;
        gate.outcome = "passed";
      } else {
        gate.outcome = "failed";
        gate.reason = `${gate.id} requires a written evidence reference`;
        priorFailure = true;
      }
      continue;
    }
    if (gate.kind === "internal") {
      gate.outcome = "passed";
      gate.reason =
        "machine-readable verification result is ready for the candidate coordinator";
      continue;
    }
    const [command, ...args] = gate.command;
    const result = run(command, args, { cwd: root, gate: true });
    if (result.status === 0) {
      gate.outcome = "passed";
      if (gate.cacheable) {
        cache.value.results[gate.id] = {
          fingerprint: gate.fingerprint,
          status: "passed",
        };
      }
    }
    else {
      gate.outcome = "failed";
      gate.reason = `${gate.id} exited with status ${result.status ?? 1}`;
      priorFailure = true;
    }
  }
  return !priorFailure;
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const root = resolve(process.cwd());
  const repositoryRoot = resolve(gitOutput(root, ["rev-parse", "--show-toplevel"]));
  if (repositoryRoot !== root) {
    throw new VerificationError(
      "wrong_directory",
      "Run the verification command from the repository root.",
    );
  }
  const cachePath = safeCachePath(root, parsed.cache);
  const baseResult = run(
    "git",
    ["rev-parse", "--verify", "--end-of-options", `${parsed.base}^{commit}`],
    { cwd: root },
  );
  if (baseResult.status !== 0) {
    throw new VerificationError(
      "missing_base",
      `Base revision ${parsed.base} does not resolve to a commit.`,
    );
  }
  const baseRevision = baseResult.stdout.trim();
  const headRevision = gitOutput(root, ["rev-parse", "HEAD"]);
  const files = changedFiles(root, baseRevision);
  const categories = classify(files);
  const effectiveMode =
    parsed.mode === "release-candidate" ||
    categories.some((category) => RISK_CATEGORIES.has(category))
      ? "release-candidate"
      : parsed.mode;
  const sourceState =
    effectiveMode === "release-candidate" ? releaseSourceState(root) : undefined;
  const gates = gatePlan(categories, parsed.mode, effectiveMode);
  const [cache, versions] = await Promise.all([
    readCache(cachePath),
    toolVersions(root),
  ]);
  const repositoryFiles = nulEntries(
    gitOutput(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]),
  ).sort();
  for (const gate of gates) {
    if (gate.selection !== "skipped" && gate.cacheable) {
      gate.fingerprint = await gateFingerprint(root, gate, repositoryFiles, versions);
      const cached = cache.value.results[gate.id];
      if (cache.state === "missing") {
        gate.reason += "; no verification cache exists";
      } else if (cache.state === "invalid") {
        gate.reason += "; the verification cache is invalid and cannot be reused";
      } else if (!cached) {
        gate.reason += "; no cached success exists for this gate";
      } else if (cached.fingerprint !== gate.fingerprint) {
        gate.reason += "; the full input or tool fingerprint changed";
      }
    }
  }
  const currentChangeFingerprint = await changeFingerprint(
    root,
    baseRevision,
    headRevision,
    files,
  );
  const passed = await execute(gates, root, parsed.evidence, cache);
  await writeCache(cachePath, cache.value);
  const nativeDevelopmentClient = categories.includes("native-configuration")
    ? {
        action: "rebuild",
        reason: "native generation inputs changed",
      }
    : parsed.mode === "focused" ||
        categories.includes("native-behavior") ||
        categories.includes("verification-tooling") ||
        categories.includes("repository-tooling")
    ? {
        action: "reuse",
        reason: "native generation inputs are unchanged",
      }
    : undefined;
  const report = {
    schemaVersion: 1,
    requestedMode: parsed.mode,
    effectiveMode,
    status: passed ? "passed" : "failed",
    baseRevision,
    headRevision,
    ...(sourceState ? { sourceState } : {}),
    changedFiles: files,
    changeFingerprint: currentChangeFingerprint,
    categories,
    toolVersions: versions,
    cache: { path: cachePath, state: cache.state },
    ...(nativeDevelopmentClient ? { nativeDevelopmentClient } : {}),
    gates: gates.map((gate) =>
      Object.fromEntries(
        Object.entries(gate).filter(([property]) => property !== "command"),
      ),
    ),
    externalActions: [
      "eas-build",
      "apple-upload",
      "google-upload",
      "store-submission",
      "public-promotion",
    ].map((id) => ({
      id,
      outcome: "skipped",
      reason: "the verification command has no external release executor",
    })),
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.stderr.write(
    `Verification ${report.requestedMode} -> ${report.effectiveMode}: ${report.status}.\n`,
  );
  for (const gate of report.gates) {
    const selection = gate.selection === "skipped" ? "" : `${gate.selection} `;
    process.stderr.write(
      `${gate.outcome.toUpperCase()} ${selection}${gate.id} — ${gate.reason}\n`,
    );
  }
  process.stderr.write(
    "SKIPPED external release actions — no build, upload, submission, or promotion executor.\n",
  );
  if (!passed) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  if (error instanceof VerificationError) emitFailure(error);
  else emitFailure(new VerificationError("internal_error", error.message));
}
