import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const VERIFY_SCRIPT = new URL("../scripts/verify.mjs", import.meta.url).pathname;
const REAL_GIT = execFileSync("/usr/bin/which", ["git"], {
  encoding: "utf8",
}).trim();
const FOCUSED_EVIDENCE = [
  "--evidence",
  "ios-simulator-journey=local://issue-44/ios",
  "--evidence",
  "android-emulator-journey=local://issue-44/android",
];
const PHYSICAL_EVIDENCE = [
  "--evidence",
  "ios-physical-journey=local://issue-44/ios-physical",
  "--evidence",
  "android-physical-journey=local://issue-44/android-physical",
];

function git(cwd, args) {
  return execFileSync(REAL_GIT, args, { cwd, encoding: "utf8" }).trim();
}

async function createVerificationFixture() {
  const root = await mkdtemp(join(tmpdir(), "openjob-verification-"));
  const fakeBin = join(root, "fake-bin");
  const commandLog = `${root}-commands.log`;
  await Promise.all([
    mkdir(join(root, "app"), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);
  await writeFile(join(root, "app", "page.tsx"), "export default 'before';\n");

  const fakeNpm = join(fakeBin, "npm");
  const fakeGit = join(fakeBin, "git");
  await Promise.all([
    writeFile(
      fakeNpm,
      [
        "#!/bin/sh",
        "printf 'npm %s\\n' \"$*\" >> \"$OPENJOB_VERIFY_COMMAND_LOG\"",
        "if [ \"$1\" = \"--version\" ]; then printf '%s\\n' \"${OPENJOB_FAKE_NPM_VERSION:-10.9.0}\"; exit 0; fi",
        "if [ \"$OPENJOB_VERIFY_FAIL_COMMAND\" = \"$*\" ]; then exit 23; fi",
        "",
      ].join("\n"),
    ),
    writeFile(
      fakeGit,
      [
        "#!/bin/sh",
        "printf 'git %s\\n' \"$*\" >> \"$OPENJOB_VERIFY_COMMAND_LOG\"",
        `exec ${REAL_GIT} \"$@\"`,
        "",
      ].join("\n"),
    ),
    ...["eas", "apple", "google", "xcrun", "adb", "gh"].map((name) =>
      writeFile(
        join(fakeBin, name),
        `#!/bin/sh\nprintf '${name} %s\\n' \"$*\" >> \"$OPENJOB_VERIFY_COMMAND_LOG\"\nexit 99\n`,
      ),
    ),
  ]);
  await Promise.all(
    ["npm", "git", "eas", "apple", "google", "xcrun", "adb", "gh"].map((name) =>
      chmod(join(fakeBin, name), 0o755),
    ),
  );

  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "OpenJob Test"]);
  git(root, ["config", "user.email", "test@openjob.dev"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "Fixture baseline"]);
  return { commandLog, fakeBin, root };
}

async function runVerification(fixture, args, environment = {}) {
  return spawnSync(process.execPath, [VERIFY_SCRIPT, ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment,
      OPENJOB_VERIFY_COMMAND_LOG: fixture.commandLog,
      PATH: `${fixture.fakeBin}:${process.env.PATH}`,
    },
  });
}

function syncFixtureMain(fixture) {
  const remote = `${fixture.root}-remote.git`;
  execFileSync(REAL_GIT, ["init", "--bare", remote]);
  git(fixture.root, ["remote", "add", "origin", remote]);
  git(fixture.root, ["push", "-u", "origin", "main"]);
}

async function addChangedFile(fixture, path, contents = "changed\n") {
  const target = join(fixture.root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

test("verification command rejects a missing mode before running gates", async () => {
  const packageMetadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageMetadata.scripts.verify, "node scripts/verify.mjs");

  const result = spawnSync(process.execPath, [VERIFY_SCRIPT], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    status: "failed",
    error: {
      code: "invalid_arguments",
      message:
        "Usage: npm run verify -- <focused|merge|release-candidate> --base <revision> [--cache <path>] [--evidence <gate>=<reference>]",
    },
  });
  assert.match(result.stderr, /FAILED invalid_arguments/u);

  const unknown = spawnSync(process.execPath, [VERIFY_SCRIPT, "release"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(unknown.status, 2);
  assert.equal(JSON.parse(unknown.stdout).error.code, "invalid_arguments");
});

test("focused web changes run only the affected public seam with type and lint", async () => {
  const fixture = await createVerificationFixture();
  await writeFile(join(fixture.root, "app", "page.tsx"), "export default 'after';\n");

  const result = await runVerification(fixture, [
    "focused",
    "--base",
    "HEAD",
    "--cache",
    `${fixture.root}-cache.json`,
    ...FOCUSED_EVIDENCE,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.requestedMode, "focused");
  assert.equal(report.effectiveMode, "focused");
  assert.equal(report.status, "passed");
  assert.match(report.changeFingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual(report.categories, ["web"]);
  assert.deepEqual(
    report.gates
      .filter((gate) => gate.outcome === "passed")
      .map((gate) => gate.id),
    [
      "typecheck",
      "lint",
      "web-integration",
      "ios-simulator-journey",
      "android-emulator-journey",
    ],
  );
  assert.match(result.stderr, /PASSED selected web-integration/u);

  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /npm run typecheck/u);
  assert.match(commands, /npm run lint/u);
  assert.match(commands, /npm run test:browser/u);
  assert.doesNotMatch(commands, /(?:eas|xcrun|adb|gh) /u);
  assert.doesNotMatch(commands, /native|bundle|submit|promot/u);
});

test("focused impact policy selects API and CLI seams while documentation stays cheap", async (context) => {
  const cases = [
    {
      category: "api",
      commandPatterns: [/npm run test:api/u, /npm run openapi:check/u],
      path: "server/example.ts",
    },
    {
      category: "cli",
      commandPatterns: [/npm run test:cli/u, /npm run cli:types:check/u],
      path: "cli/example.mjs",
    },
    {
      category: "documentation",
      commandPatterns: [],
      path: "docs/example.md",
    },
  ];

  for (const item of cases) {
    await context.test(item.category, async () => {
      const fixture = await createVerificationFixture();
      await addChangedFile(fixture, item.path);
      const result = await runVerification(fixture, [
        "focused",
        "--base",
        "HEAD",
        "--cache",
        `${fixture.root}-cache.json`,
        ...FOCUSED_EVIDENCE,
      ]);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(report.categories, [item.category]);
      const commands = await readFile(fixture.commandLog, "utf8");
      assert.match(commands, /npm run typecheck/u);
      assert.match(commands, /npm run lint/u);
      for (const pattern of item.commandPatterns) assert.match(commands, pattern);
      for (const id of ["ios-simulator-journey", "android-emulator-journey"]) {
        assert.equal(
          report.gates.find((gate) => gate.id === id).outcome,
          "passed",
        );
      }
      if (item.category === "documentation") {
        assert.doesNotMatch(commands, /test:(?:api|browser|cli)|native|bundle/u);
      }
      assert.doesNotMatch(commands, /(?:eas|xcrun|adb|gh) /u);
    });
  }
});

test("focused native behavior requires both virtual-runtime journeys and reuses development clients", async () => {
  const fixture = await createVerificationFixture();
  await addChangedFile(fixture, "native/src/OpenJobShell.tsx");
  const arguments_ = [
    "focused",
    "--base",
    "HEAD",
    "--cache",
    `${fixture.root}-cache.json`,
  ];

  const missingEvidence = await runVerification(fixture, arguments_);
  assert.equal(missingEvidence.status, 1);
  const failedReport = JSON.parse(missingEvidence.stdout);
  assert.deepEqual(failedReport.categories, ["native-behavior"]);
  assert.deepEqual(failedReport.nativeDevelopmentClient, {
    action: "reuse",
    reason: "native generation inputs are unchanged",
  });
  assert.equal(
    failedReport.gates.find((gate) => gate.id === "native-automated").outcome,
    "passed",
  );
  assert.equal(
    failedReport.gates.find((gate) => gate.id === "ios-simulator-journey").outcome,
    "failed",
  );
  assert.equal(
    failedReport.gates.find((gate) => gate.id === "android-emulator-journey")
      .outcome,
    "skipped",
  );

  const proved = await runVerification(fixture, [
    ...arguments_,
    ...FOCUSED_EVIDENCE,
  ]);
  assert.equal(proved.status, 0, proved.stderr || proved.stdout);
  const report = JSON.parse(proved.stdout);
  for (const id of ["ios-simulator-journey", "android-emulator-journey"]) {
    const gate = report.gates.find((candidate) => candidate.id === id);
    assert.equal(gate.outcome, "passed");
    assert.match(gate.evidence, /^local:\/\/issue-44\//u);
  }
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /npm --prefix native run typecheck/u);
  assert.match(commands, /npm --prefix native run lint/u);
  assert.match(commands, /npm --prefix native test/u);
  assert.doesNotMatch(commands, /prebuild|config:verify|bundle:verify/u);
  assert.doesNotMatch(commands, /(?:eas|xcrun|adb|gh) /u);
});

test("focused hardware-risk inputs require coequal physical evidence", async () => {
  const fixture = await createVerificationFixture();
  await addChangedFile(
    fixture,
    "native/src/domain-cache.ts",
    'import * as SecureStore from "expo-secure-store";\n',
  );
  git(fixture.root, ["add", "native/src/domain-cache.ts"]);
  git(fixture.root, ["commit", "-m", "Change hardware-backed cache"]);
  syncFixtureMain(fixture);
  const arguments_ = [
    "focused",
    "--base",
    "HEAD^",
    "--cache",
    `${fixture.root}-cache.json`,
    ...FOCUSED_EVIDENCE,
  ];

  const missingPhysical = await runVerification(fixture, arguments_);
  assert.equal(missingPhysical.status, 1);
  const missingReport = JSON.parse(missingPhysical.stdout);
  assert.ok(missingReport.categories.includes("hardware-risk"));
  assert.equal(missingReport.effectiveMode, "release-candidate");
  assert.equal(
    missingReport.gates.find((gate) => gate.id === "ios-physical-journey")
      .outcome,
    "failed",
  );

  const proved = await runVerification(fixture, [
    ...arguments_,
    ...PHYSICAL_EVIDENCE,
  ]);
  assert.equal(proved.status, 0, proved.stderr || proved.stdout);
  const report = JSON.parse(proved.stdout);
  for (const id of ["ios-physical-journey", "android-physical-journey"]) {
    assert.equal(report.gates.find((gate) => gate.id === id).outcome, "passed");
  }
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(commands, /(?:eas|xcrun|adb|gh) /u);
});

test("merge reuses native generation and bundles only for an exact input and tool fingerprint", async () => {
  const fixture = await createVerificationFixture();
  await addChangedFile(
    fixture,
    "native/scripts/verify-config.mjs",
    "export const verifierVersion = 1;\n",
  );
  git(fixture.root, ["add", "native/scripts/verify-config.mjs"]);
  git(fixture.root, ["commit", "-m", "Add native config verifier"]);
  await addChangedFile(
    fixture,
    "native/package.json",
    '{"name":"@openjob/native","version":"1.0.0"}\n',
  );
  const cache = `${fixture.root}-cache.json`;
  const arguments_ = ["merge", "--base", "HEAD", "--cache", cache];

  const first = await runVerification(fixture, arguments_);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstReport = JSON.parse(first.stdout);
  assert.deepEqual(firstReport.categories, ["native-configuration"]);
  assert.equal(firstReport.cache.state, "missing");
  assert.deepEqual(firstReport.nativeDevelopmentClient, {
    action: "rebuild",
    reason: "native generation inputs changed",
  });
  for (const id of [
    "native-clean-generation",
    "ios-embedded-bundle",
    "android-embedded-bundle",
  ]) {
    const gate = firstReport.gates.find((candidate) => candidate.id === id);
    assert.equal(gate.outcome, "passed");
    assert.match(gate.fingerprint, /^[a-f0-9]{64}$/u);
    assert.match(gate.reason, /cache|fingerprint/u);
  }

  await writeFile(fixture.commandLog, "");
  const second = await runVerification(fixture, arguments_);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const secondReport = JSON.parse(second.stdout);
  for (const id of [
    "native-clean-generation",
    "ios-embedded-bundle",
    "android-embedded-bundle",
  ]) {
    assert.equal(
      secondReport.gates.find((candidate) => candidate.id === id).outcome,
      "reused",
    );
  }
  const reusedCommands = await readFile(fixture.commandLog, "utf8");
  assert.match(reusedCommands, /npm --prefix native test/u);
  assert.doesNotMatch(reusedCommands, /config:verify|bundle:verify/u);

  await writeFile(fixture.commandLog, "");
  await writeFile(cache, '{"schemaVersion":1,"results":null}\n');
  const malformedCache = await runVerification(fixture, arguments_);
  assert.equal(malformedCache.status, 0, malformedCache.stderr || malformedCache.stdout);
  const malformedCacheReport = JSON.parse(malformedCache.stdout);
  assert.equal(malformedCacheReport.cache.state, "invalid");
  for (const id of [
    "native-clean-generation",
    "ios-embedded-bundle",
    "android-embedded-bundle",
  ]) {
    assert.equal(
      malformedCacheReport.gates.find((candidate) => candidate.id === id).outcome,
      "passed",
    );
  }

  await writeFile(fixture.commandLog, "");
  await writeFile(
    join(fixture.root, "native", "package.json"),
    '{"name":"@openjob/native","version":"1.0.1"}\n',
  );
  const changedInput = await runVerification(fixture, arguments_);
  assert.equal(changedInput.status, 0, changedInput.stderr || changedInput.stdout);
  const changedInputReport = JSON.parse(changedInput.stdout);
  for (const id of [
    "native-clean-generation",
    "ios-embedded-bundle",
    "android-embedded-bundle",
  ]) {
    assert.equal(
      changedInputReport.gates.find((candidate) => candidate.id === id).outcome,
      "passed",
    );
  }
  const changedInputCommands = await readFile(fixture.commandLog, "utf8");
  assert.match(changedInputCommands, /config:verify/u);
  assert.match(changedInputCommands, /bundle:verify/u);

  await writeFile(fixture.commandLog, "");
  await writeFile(
    join(fixture.root, "native", "scripts", "verify-config.mjs"),
    "export const verifierVersion = 2;\n",
  );
  const changedVerifier = await runVerification(fixture, arguments_);
  assert.equal(changedVerifier.status, 0, changedVerifier.stderr || changedVerifier.stdout);
  const changedVerifierReport = JSON.parse(changedVerifier.stdout);
  assert.equal(
    changedVerifierReport.gates.find(
      (candidate) => candidate.id === "native-clean-generation",
    ).outcome,
    "passed",
  );
  const changedVerifierCommands = await readFile(fixture.commandLog, "utf8");
  assert.match(changedVerifierCommands, /config:verify/u);

  await writeFile(fixture.commandLog, "");
  await writeFile(cache, "{not-json\n");
  const changedTool = await runVerification(fixture, arguments_, {
    OPENJOB_FAKE_NPM_VERSION: "10.9.1",
  });
  assert.equal(changedTool.status, 0, changedTool.stderr || changedTool.stdout);
  const changedToolReport = JSON.parse(changedTool.stdout);
  assert.equal(changedToolReport.cache.state, "invalid");
  for (const id of [
    "native-clean-generation",
    "ios-embedded-bundle",
    "android-embedded-bundle",
  ]) {
    assert.equal(
      changedToolReport.gates.find((candidate) => candidate.id === id).outcome,
      "passed",
    );
  }
  const rerunCommands = await readFile(fixture.commandLog, "utf8");
  assert.match(rerunCommands, /npm --prefix native run config:verify/u);
  assert.match(rerunCommands, /npm --prefix native run bundle:verify -- ios/u);
  assert.match(rerunCommands, /npm --prefix native run bundle:verify -- android/u);
  assert.doesNotMatch(rerunCommands, /(?:eas|xcrun|adb|gh) /u);
});

test("unknown, generated, and release-risk inputs escalate without external side effects", async (context) => {
  const cases = [
    ["security/policy.ts", "security"],
    ["native/eas.json", "signing"],
    ["scripts/release.mjs", "release"],
    ["config/native-identities.json", "distribution"],
    ["native/app.config.mjs", "permissions"],
    ["docs/privacy-contract.md", "privacy"],
    ["docs/accessibility-checklist.md", "accessibility"],
    ["docs/app-store-checklist.md", "store-compliance"],
    ["cli/generated/openapi.d.ts", "generated-output"],
    ["mystery/typo.tx", "unknown"],
  ];

  for (const [path, category] of cases) {
    await context.test(category, async () => {
      const fixture = await createVerificationFixture();
      await addChangedFile(fixture, path);
      git(fixture.root, ["add", path]);
      git(fixture.root, ["commit", "-m", `Add ${category} input`]);
      syncFixtureMain(fixture);
      const result = await runVerification(fixture, [
        "focused",
        "--base",
        "HEAD^",
        "--cache",
        `${fixture.root}-cache.json`,
        ...FOCUSED_EVIDENCE,
      ]);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const report = JSON.parse(result.stdout);
      assert.equal(report.requestedMode, "focused");
      assert.equal(report.effectiveMode, "release-candidate");
      assert.equal(report.sourceState.defaultBranchParity, "0 0");
      assert.ok(report.categories.includes(category), report.categories.join(", "));
      assert.equal(
        report.gates.find((gate) => gate.id === "repository-suite").selection,
        "escalated",
      );
      assert.equal(
        report.gates.find((gate) => gate.id === "candidate-handoff").outcome,
        "passed",
      );
      assert.match(result.stderr, /PASSED escalated repository-suite/u);
      assert.deepEqual(
        report.externalActions.map(({ id, outcome }) => ({ id, outcome })),
        [
          { id: "eas-build", outcome: "skipped" },
          { id: "apple-upload", outcome: "skipped" },
          { id: "google-upload", outcome: "skipped" },
          { id: "store-submission", outcome: "skipped" },
          { id: "public-promotion", outcome: "skipped" },
        ],
      );
      const commands = await readFile(fixture.commandLog, "utf8");
      assert.match(commands, /npm run test:deterministic/u);
      assert.match(commands, /npm run secret:check/u);
      assert.doesNotMatch(commands, /(?:eas|xcrun|adb|gh) /u);
      assert.doesNotMatch(commands, /build:(?:preview|production)|submit|promot/u);
    });
  }
});

test("escalated release-candidate scope rejects dirty source before gates", async () => {
  const fixture = await createVerificationFixture();
  await addChangedFile(fixture, "security/policy.ts");

  const result = await runVerification(fixture, [
    "focused",
    "--base",
    "HEAD",
    "--cache",
    `${fixture.root}-cache.json`,
    ...FOCUSED_EVIDENCE,
  ]);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "release_source_not_clean");
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(commands, /npm run/u);
});

test("OpenAPI inputs select generated CLI type validation", async () => {
  const fixture = await createVerificationFixture();
  await addChangedFile(fixture, "openapi/openapi.yaml");

  const result = await runVerification(fixture, [
    "merge",
    "--base",
    "HEAD",
    "--cache",
    `${fixture.root}-cache.json`,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.ok(report.categories.includes("api-contract"));
  assert.equal(
    report.gates.find((gate) => gate.id === "cli-generated-types").outcome,
    "passed",
  );
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /npm run cli:types:check/u);
});

test("release-candidate mode requires clean synchronized main and only produces a handoff", async () => {
  const fixture = await createVerificationFixture();
  await writeFile(join(fixture.root, "app", "page.tsx"), "export default 'candidate';\n");
  git(fixture.root, ["add", "app/page.tsx"]);
  git(fixture.root, ["commit", "-m", "Candidate input"]);
  syncFixtureMain(fixture);

  const clean = await runVerification(fixture, [
    "release-candidate",
    "--base",
    "HEAD^",
    "--cache",
    `${fixture.root}-cache.json`,
  ]);
  assert.equal(clean.status, 0, clean.stderr || clean.stdout);
  const cleanReport = JSON.parse(clean.stdout);
  assert.equal(cleanReport.effectiveMode, "release-candidate");
  assert.equal(cleanReport.sourceState.branch, "main");
  assert.equal(cleanReport.sourceState.defaultBranchParity, "0 0");
  assert.equal(
    cleanReport.gates.find((gate) => gate.id === "candidate-handoff").outcome,
    "passed",
  );
  const cleanCommands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(cleanCommands, /(?:eas|xcrun|adb|gh) /u);

  await writeFile(fixture.commandLog, "");
  await writeFile(join(fixture.root, "app", "page.tsx"), "export default 'dirty';\n");
  const dirty = await runVerification(fixture, [
    "release-candidate",
    "--base",
    "HEAD^",
    "--cache",
    `${fixture.root}-cache.json`,
  ]);
  assert.equal(dirty.status, 1);
  assert.equal(JSON.parse(dirty.stdout).error.code, "release_source_not_clean");
  const dirtyCommands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(dirtyCommands, /npm run/u);

  git(fixture.root, ["add", "app/page.tsx"]);
  git(fixture.root, ["commit", "-m", "Unsynced input"]);
  await writeFile(fixture.commandLog, "");
  const unsynced = await runVerification(fixture, [
    "release-candidate",
    "--base",
    "HEAD^",
    "--cache",
    `${fixture.root}-cache.json`,
  ]);
  assert.equal(unsynced.status, 1);
  assert.equal(JSON.parse(unsynced.stdout).error.code, "release_source_unsynced");
  const unsyncedCommands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(unsyncedCommands, /npm run/u);
});

test("malformed input and partial failures fail closed before later gates", async () => {
  const fixture = await createVerificationFixture();
  await writeFile(join(fixture.root, "app", "page.tsx"), "export default 'after';\n");

  const malformed = await runVerification(fixture, [
    "focused",
    "--bsae",
    "HEAD",
  ]);
  assert.equal(malformed.status, 2);
  assert.equal(JSON.parse(malformed.stdout).error.code, "invalid_arguments");

  const missingBase = await runVerification(fixture, [
    "focused",
    "--base",
    "does-not-exist",
  ]);
  assert.equal(missingBase.status, 1);
  assert.equal(JSON.parse(missingBase.stdout).error.code, "missing_base");

  const packagePath = join(fixture.root, "package.json");
  await writeFile(packagePath, '{"private":true}\n');
  const unsafeCache = await runVerification(fixture, [
    "focused",
    "--base",
    "HEAD",
    "--cache",
    packagePath,
  ]);
  assert.equal(unsafeCache.status, 1);
  assert.equal(JSON.parse(unsafeCache.stdout).error.code, "unsafe_cache_path");
  assert.equal(await readFile(packagePath, "utf8"), '{"private":true}\n');

  await writeFile(fixture.commandLog, "");
  const partial = await runVerification(
    fixture,
    [
      "focused",
      "--base",
      "HEAD",
      "--cache",
      `${fixture.root}-cache.json`,
    ],
    { OPENJOB_VERIFY_FAIL_COMMAND: "run lint" },
  );
  assert.equal(partial.status, 1);
  const report = JSON.parse(partial.stdout);
  assert.equal(
    report.gates.find((gate) => gate.id === "typecheck").outcome,
    "passed",
  );
  assert.equal(report.gates.find((gate) => gate.id === "lint").outcome, "failed");
  assert.equal(
    report.gates.find((gate) => gate.id === "web-integration").outcome,
    "skipped",
  );
  assert.match(
    report.gates.find((gate) => gate.id === "web-integration").reason,
    /prior selected gate failed/u,
  );
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(commands, /npm run test:browser/u);
  assert.doesNotMatch(commands, /(?:eas|xcrun|adb|gh) /u);
});

test("verification-tooling changes use focused proof and preserve compatibility gates", async () => {
  const packageMetadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageMetadata.scripts["native:check"], "npm --prefix native run check");
  assert.match(packageMetadata.scripts["native:quick"], /native run typecheck/u);
  assert.doesNotMatch(packageMetadata.scripts["native:quick"], /secret:check/u);
  assert.match(packageMetadata.scripts["test:deterministic"], /native:quick/u);
  assert.doesNotMatch(packageMetadata.scripts.test, /native:check/u);

  const fixture = await createVerificationFixture();
  await addChangedFile(fixture, "scripts/verify.mjs");
  const result = await runVerification(fixture, [
    "focused",
    "--base",
    "HEAD",
    "--cache",
    `${fixture.root}-cache.json`,
    ...FOCUSED_EVIDENCE,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.effectiveMode, "focused");
  assert.deepEqual(report.categories, ["verification-tooling"]);
  for (const id of [
    "verification-process-tests",
    "native-clean-generation",
    "ios-embedded-bundle",
    "android-embedded-bundle",
    "ios-simulator-journey",
    "android-emulator-journey",
  ]) {
    assert.equal(
      report.gates.find((gate) => gate.id === id).outcome,
      "passed",
      id,
    );
  }
  assert.deepEqual(report.nativeDevelopmentClient, {
    action: "reuse",
    reason: "native generation inputs are unchanged",
  });
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /npm run test:verification/u);
  assert.match(commands, /npm --prefix native run config:verify/u);
  assert.match(commands, /npm --prefix native run bundle:verify -- ios/u);
  assert.match(commands, /npm --prefix native run bundle:verify -- android/u);
  assert.doesNotMatch(commands, /(?:eas|xcrun|adb|gh) /u);
});

test("operator documentation separates Feature Proof, merge proof, and #41 Release Proof", async () => {
  const [guide, readme, nativeReadme] = await Promise.all([
    readFile(new URL("../docs/verification.md", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../native/README.md", import.meta.url), "utf8"),
  ]);

  assert.match(guide, /npm run verify -- focused --base/u);
  assert.match(guide, /npm run verify -- merge --base/u);
  assert.match(guide, /npm run verify -- release-candidate --base/u);
  assert.match(guide, /Feature Proof/u);
  assert.match(guide, /issue #41/u);
  assert.match(guide, /JSON.*stdout/isu);
  assert.match(guide, /summary.*stderr/isu);
  assert.match(guide, /--evidence ios-simulator-journey=/u);
  assert.match(guide, /hardware-specific.*physical/isu);
  assert.match(guide, /full.*fingerprint/isu);
  assert.match(guide, /EAS build|Apple upload/u);
  assert.match(guide, /never.*upload|does not.*upload/iu);
  assert.match(guide, /native:check/u);
  assert.match(readme, /docs\/verification\.md/u);
  assert.match(nativeReadme, /bundle:verify -- ios/u);
  assert.match(nativeReadme, /bundle:verify -- android/u);
});

test("merge mode composes affected public seams and native asset proof without journeys", async () => {
  const fixture = await createVerificationFixture();
  await Promise.all([
    writeFile(join(fixture.root, "app", "page.tsx"), "export default 'after';\n"),
    addChangedFile(fixture, "server/example.ts"),
    addChangedFile(fixture, "cli/example.mjs"),
    addChangedFile(fixture, "native/src/OpenJobShell.tsx"),
    addChangedFile(fixture, "public/icon-example.png", "fixture-image\n"),
  ]);
  const result = await runVerification(fixture, [
    "merge",
    "--base",
    "HEAD",
    "--cache",
    `${fixture.root}-cache.json`,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.categories, [
    "api",
    "cli",
    "native-behavior",
    "native-configuration",
    "web",
  ]);
  for (const id of [
    "web-integration",
    "api-integration",
    "cli-integration",
    "native-automated",
    "native-clean-generation",
    "ios-embedded-bundle",
    "android-embedded-bundle",
  ]) {
    assert.equal(report.gates.find((gate) => gate.id === id).outcome, "passed", id);
  }
  assert.equal(
    report.gates.find((gate) => gate.id === "ios-simulator-journey").outcome,
    "skipped",
  );
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /npm run test:browser/u);
  assert.match(commands, /npm run test:api/u);
  assert.match(commands, /npm run test:cli/u);
  assert.match(commands, /npm --prefix native test/u);
  assert.doesNotMatch(commands, /(?:eas|xcrun|adb|gh) /u);
});
