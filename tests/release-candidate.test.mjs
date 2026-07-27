import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const CANDIDATE_SCRIPT = new URL(
  "../scripts/release-candidate.mjs",
  import.meta.url,
).pathname;
const REPOSITORY_ROOT = new URL("../", import.meta.url);

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runCandidate(root, arguments_, environment = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CANDIDATE_SCRIPT, ...arguments_], {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({
        report: stdout.trim() ? JSON.parse(stdout) : undefined,
        status,
        stderr,
      });
    });
  });
}

async function createCandidateFixture() {
  const root = await mkdtemp(join(tmpdir(), "openjob-candidate-"));
  const remote = `${root}-remote.git`;
  const version = "1.2.3";
  const rootPackage = {
    name: "openjob",
    version,
    engines: { node: ">=22.13.0" },
    devDependencies: { typescript: "5.9.3", eslint: "9.39.4" },
  };
  const nativePackage = {
    name: "@openjob/native",
    version,
    dependencies: { expo: "57.0.0", "react-native": "0.84.0" },
    devDependencies: { typescript: "5.9.3", "eas-cli": "21.1.0" },
  };
  const nativeIdentities = {
    schemaVersion: 1,
    apple: {
      teamId: "TEAM123456",
      distributionSigning: {
        production: {
          bundleId: "dev.openjob.app",
          certificate: { id: "CERT123", fingerprintSha256: "AA:BB" },
          profile: { id: "PROFILE123", uuid: "profile-uuid" },
          provider: "apple-developer",
        },
      },
      appStoreConnect: {
        production: { appId: "123456789", testFlight: true },
      },
    },
    googlePlay: {
      apps: {
        production: {
          appId: "987654321",
          applicationId: "dev.openjob.app",
          internalTesting: true,
        },
      },
    },
    expo: { account: "openjob", projectId: "expo-project", slug: "openjob" },
    delivery: { updates: { enabled: false, releasePath: "store-build" } },
    environments: {
      production: {
        eas: { buildProfile: "production", environment: "production" },
        ios: { bundleId: "dev.openjob.app" },
        android: {
          applicationId: "dev.openjob.app",
          signing: {
            configurationId: "ANDROID-SIGNING",
            provider: "eas-managed",
            sha256Fingerprint: "CC:DD",
          },
        },
      },
    },
  };
  const eas = {
    cli: { appVersionSource: "remote", requireCommit: true, version: ">= 21.1.0" },
    build: {
      production: {
        autoIncrement: true,
        distribution: "store",
        environment: "production",
        android: { buildType: "app-bundle" },
        ios: { credentialsSource: "remote" },
      },
    },
    submit: {
      production: {
        android: { track: "internal" },
        ios: { ascAppId: "123456789" },
      },
    },
  };
  const privacy = {
    schemaVersion: 1,
    inventoryVersion: "2026-07-27",
    permissions: [
      {
        id: "notifications",
        platforms: ["ios", "android"],
        required: false,
      },
    ],
    processors: [],
  };

  await Promise.all([
    writeJson(join(root, "package.json"), rootPackage),
    writeJson(join(root, "package-lock.json"), {
      name: "openjob",
      version,
      lockfileVersion: 3,
      packages: { "": { name: "openjob", version } },
    }),
    writeJson(join(root, "cli", "package.json"), {
      name: "openjob-cli",
      version,
    }),
    writeJson(join(root, "native", "package.json"), nativePackage),
    writeJson(join(root, "native", "package-lock.json"), {
      name: "@openjob/native",
      version,
      lockfileVersion: 3,
      packages: { "": { name: "@openjob/native", version } },
    }),
    writeJson(join(root, "config", "native-identities.json"), nativeIdentities),
    writeJson(join(root, "config", "release-privacy-inventory.json"), privacy),
    writeJson(join(root, "config", "generated", "native-privacy.json"), {
      inventoryFingerprint: "fixture-projection",
      nativeConfiguration: { android: {}, ios: {} },
    }),
    writeJson(join(root, "native", "eas.json"), eas),
    writeFile(
      join(root, "openapi.yaml"),
      `openapi: 3.1.0\ninfo:\n  title: OpenJob\n  version: ${version}\n`,
    ),
    writeFile(join(root, ".gitignore"), ".openjob/\n"),
  ]);
  await mkdir(join(root, "openapi"), { recursive: true });
  await writeFile(
    join(root, "openapi", "openapi.yaml"),
    `openapi: 3.1.0\ninfo:\n  title: OpenJob\n  version: ${version}\n`,
  );

  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "candidate@example.test"]);
  git(root, ["config", "user.name", "Candidate Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "Candidate source"]);
  git(dirname(root), ["init", "--bare", remote]);
  git(root, ["remote", "add", "origin", remote]);
  git(root, ["push", "-u", "origin", "main"]);
  git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(root, ["remote", "set-head", "origin", "--auto"]);
  const revision = git(root, ["rev-parse", "HEAD"]);
  const verification = {
    schemaVersion: 1,
    requestedMode: "release-candidate",
    effectiveMode: "release-candidate",
    status: "passed",
    baseRevision: `${revision}^`,
    headRevision: revision,
    sourceState: { branch: "main", defaultBranchParity: "0 0" },
    changedFiles: [],
    changeFingerprint: "fixture-change-fingerprint",
    categories: ["release"],
    toolVersions: {
      node: process.version,
      npm: "11.4.2",
      "native/package.json:expo": "57.0.0",
      "native/package.json:react-native": "0.84.0",
    },
    cache: { path: join(root, ".openjob", "verification-cache.json"), state: "loaded" },
    nativeDevelopmentClient: { action: "reuse", reason: "native inputs unchanged" },
    gates: [
      "typecheck",
      "lint",
      "repository-suite",
      "openapi-contract",
      "secret-check",
      "release-privacy",
      "native-clean-generation",
      "ios-embedded-bundle",
      "android-embedded-bundle",
      "candidate-handoff",
    ].map((id) => ({ id, outcome: "passed", selection: "selected", reason: "fixture" })),
    externalActions: ["eas-build", "apple-upload", "google-upload", "store-submission", "public-promotion"].map((id) => ({
      id,
      outcome: "skipped",
      reason: "no executor",
    })),
  };
  const verificationPath = join(root, ".openjob", "verification.json");
  await writeJson(verificationPath, verification);
  const executorPath = join(root, ".openjob", "fake-executor.mjs");
  const executorLog = join(root, ".openjob", "executor.log");
  const executorState = join(root, ".openjob", "executor-state.json");
  await writeFile(
    executorPath,
    [
      'import { appendFile, readFile, writeFile } from "node:fs/promises";',
      'let source = "";',
      'process.stdin.setEncoding("utf8");',
      'for await (const chunk of process.stdin) source += chunk;',
      'const request = JSON.parse(source);',
      'await appendFile(process.env.OPENJOB_CANDIDATE_EXECUTOR_LOG, `${request.action}:${request.platform}:${request.requestKey}\\n`);',
      'let state = {};',
      'try { state = JSON.parse(await readFile(process.env.OPENJOB_CANDIDATE_EXECUTOR_STATE, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }',
      'const operation = `${request.action}:${request.platform}`;',
      'state[operation] = (state[operation] ?? 0) + 1;',
      'await writeFile(process.env.OPENJOB_CANDIDATE_EXECUTOR_STATE, `${JSON.stringify(state)}\\n`);',
      'if (process.env.OPENJOB_CANDIDATE_FAIL_ONCE === operation && state[operation] === 1) {',
      '  const code = process.env.OPENJOB_CANDIDATE_FAILURE_CODE ?? "network_timeout";',
      '  const classification = process.env.OPENJOB_CANDIDATE_FAILURE_CLASSIFICATION ?? "resumable";',
      '  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: "failed", failure: { classification, code, message: "safe fake provider failure" } })}\\n`);',
      '  process.exit(0);',
      '}',
      'const buildNumber = request.platform === "ios" ? "42" : "314";',
      'const identity = {',
      '  sourceRevision: request.candidate.sourceRevision,',
      '  inputFingerprint: request.candidate.identityFingerprint,',
      '  version: request.candidate.version,',
      '};',
      'let response;',
      'if (["build", "resume-build"].includes(request.action)) response = {',
      '  schemaVersion: 1,',
      '  status: "succeeded",',
      '  ...identity,',
      '  buildNumber,',
      '  easBuildId: `eas-${request.platform}-1`,',
      '  artifact: {',
      '    id: `artifact-${request.platform}-1`,',
      '    checksum: `sha256:${request.platform === "ios" ? "a" : "b"}`.padEnd(71, request.platform === "ios" ? "a" : "b"),',
      '    uri: `https://artifacts.example.test/${request.platform}/1?access_token=executor-only-secret`,',
      '  },',
      '};',
      'if (request.action === "submit") response = { schemaVersion: 1, status: "succeeded", ...identity, submissionId: `submission-${request.platform}-1`, storeBuildId: `store-${request.platform}-${buildNumber}` };',
      'if (request.action === "status") response = { schemaVersion: 1, status: "succeeded", ...identity, storeBuildId: `store-${request.platform}-${buildNumber}`, processing: "succeeded", availability: "succeeded" };',
      'if (process.env.OPENJOB_CANDIDATE_PENDING_ONCE === operation) {',
      '  const pendingKey = `${operation}:pending`;',
      '  state[pendingKey] = (state[pendingKey] ?? 0) + 1;',
      '  await writeFile(process.env.OPENJOB_CANDIDATE_EXECUTOR_STATE, `${JSON.stringify(state)}\\n`);',
      '  if (state[pendingKey] === 1) { response.processing = "pending"; response.availability = "pending"; }',
      '}',
      'if (request.action === "physical-proof") response = { schemaVersion: 1, status: "succeeded", ...identity, artifactId: request.artifact.id, evidenceReferences: [`https://github.com/scwlkr/openjob/issues/41#${request.platform}-physical`] };',
      'if (request.action === "release-proof") response = { schemaVersion: 1, status: "succeeded", ...identity, issue: 41, evidenceReferences: ["https://github.com/scwlkr/openjob/issues/41#release-proof"], privacyDiscrepancies: [], limitations: [] };',
      'if (request.action === "promote") response = { schemaVersion: 1, status: "succeeded", ...identity, platforms: { ios: { promotionId: "promotion-ios-1" }, android: { promotionId: "promotion-android-1" } } };',
      'if (process.env.OPENJOB_CANDIDATE_MISMATCH === operation) response.sourceRevision = "mismatched-source-revision";',
      'if (request.action === "release-proof" && process.env.OPENJOB_CANDIDATE_RELEASE_BLOCKERS === "1") {',
      '  response.privacyDiscrepancies = [{ id: "sdk-traffic", state: "unresolved", evidence: "https://github.com/scwlkr/openjob/issues/40#traffic" }];',
      '  response.limitations = [{ id: "android-review-delay", approved: false, evidence: "https://github.com/scwlkr/openjob/issues/41#limitation" }];',
      '}',
      'if (process.env.OPENJOB_CANDIDATE_UNSAFE_ID === operation && response.artifact) response.artifact.id = "person@example.test";',
      'process.stdout.write(`${JSON.stringify(response)}\\n`);',
      "",
    ].join("\n"),
  );
  return {
    executorLog,
    executorPath,
    executorState,
    recordPath: join(root, ".openjob", "candidate.json"),
    remote,
    revision,
    root,
    verificationPath,
  };
}

test("prepare freezes one synced candidate identity and reuses it unchanged", async () => {
  const fixture = await createCandidateFixture();
  const arguments_ = [
    "prepare",
    "--record",
    fixture.recordPath,
    "--verification-result",
    fixture.verificationPath,
    "--environment",
    "production",
  ];

  const first = await runCandidate(fixture.root, arguments_);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.report.status, "prepared");
  const original = await readFile(fixture.recordPath, "utf8");
  const record = JSON.parse(original);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.candidate.sourceRevision, fixture.revision);
  assert.equal(record.candidate.version, "1.2.3");
  assert.equal(record.candidate.environment, "production");
  assert.match(record.candidate.id, /^openjob-1\.2\.3-[a-f0-9]{16}$/u);
  assert.match(record.candidate.identityFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.match(record.candidate.releasePrivacyInventoryFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(Object.keys(record.candidate.selectedInputFingerprints), [
    "config/generated/native-privacy.json",
    "config/native-identities.json",
    "config/release-privacy-inventory.json",
    "native/eas.json",
    "native/package-lock.json",
    "package-lock.json",
  ]);
  assert.equal(record.verification.result.status, "passed");
  assert.deepEqual(record.verification.result.changedFiles, []);
  assert.deepEqual(record.verification.result.cache, { state: "loaded" });
  assert.equal(record.verification.result.nativeDevelopmentClient.action, "reuse");
  assert.equal(
    record.verification.result.gates[0].reason,
    "redacted nonessential verification text",
  );
  assert.equal(record.platforms.ios.build.state, "pending");
  assert.equal(record.platforms.android.build.state, "pending");
  assert.equal(record.releaseProof.issue, 41);
  assert.equal(record.invalidation, null);

  const second = await runCandidate(fixture.root, arguments_);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.report.status, "reused");
  assert.equal(await readFile(fixture.recordPath, "utf8"), original);
});

test("prepare rejects dirty, unsynced, version-mismatched, or unverified source", async (context) => {
  await context.test("dirty source", async () => {
    const fixture = await createCandidateFixture();
    await writeFile(join(fixture.root, "unexpected.txt"), "dirty\n");
    const result = await runCandidate(fixture.root, [
      "prepare", "--record", fixture.recordPath,
      "--verification-result", fixture.verificationPath,
      "--environment", "production",
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.report.error.code, "source_not_clean");
  });

  await context.test("unsynced default branch", async () => {
    const fixture = await createCandidateFixture();
    await writeFile(join(fixture.root, "README.md"), "local-only commit\n");
    git(fixture.root, ["add", "README.md"]);
    git(fixture.root, ["commit", "-m", "Local only"]);
    const result = await runCandidate(fixture.root, [
      "prepare", "--record", fixture.recordPath,
      "--verification-result", fixture.verificationPath,
      "--environment", "production",
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.report.error.code, "source_not_synced");
  });

  await context.test("unsynchronized release version", async () => {
    const fixture = await createCandidateFixture();
    const cliPackagePath = join(fixture.root, "cli", "package.json");
    const cliPackage = JSON.parse(await readFile(cliPackagePath, "utf8"));
    cliPackage.version = "1.2.4";
    await writeJson(cliPackagePath, cliPackage);
    git(fixture.root, ["add", "cli/package.json"]);
    git(fixture.root, ["commit", "-m", "Break synchronized version"]);
    git(fixture.root, ["push", "origin", "main"]);
    const result = await runCandidate(fixture.root, [
      "prepare", "--record", fixture.recordPath,
      "--verification-result", fixture.verificationPath,
      "--environment", "production",
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.report.error.code, "release_version_mismatch");
  });

  await context.test("failed Verification Mode result", async () => {
    const fixture = await createCandidateFixture();
    const verification = JSON.parse(await readFile(fixture.verificationPath, "utf8"));
    verification.status = "failed";
    await writeJson(fixture.verificationPath, verification);
    const result = await runCandidate(fixture.root, [
      "prepare", "--record", fixture.recordPath,
      "--verification-result", fixture.verificationPath,
      "--environment", "production",
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.report.error.code, "verification_not_eligible");
  });

  await context.test("missing store identifier", async () => {
    const fixture = await createCandidateFixture();
    const identitiesPath = join(fixture.root, "config", "native-identities.json");
    const identities = JSON.parse(await readFile(identitiesPath, "utf8"));
    delete identities.apple.appStoreConnect.production.appId;
    await writeJson(identitiesPath, identities);
    git(fixture.root, ["add", "config/native-identities.json"]);
    git(fixture.root, ["commit", "-m", "Remove store identifier"]);
    git(fixture.root, ["push", "origin", "main"]);
    const verification = JSON.parse(await readFile(fixture.verificationPath, "utf8"));
    verification.headRevision = git(fixture.root, ["rev-parse", "HEAD"]);
    await writeJson(fixture.verificationPath, verification);
    const result = await runCandidate(fixture.root, [
      "prepare", "--record", fixture.recordPath,
      "--verification-result", fixture.verificationPath,
      "--environment", "production",
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.report.error.code, "native_identity_mismatch");
  });
});

test("build is previewed, explicitly confirmed once, and then reused", async () => {
  const fixture = await createCandidateFixture();
  const environment = {
    OPENJOB_CANDIDATE_EXECUTOR_LOG: fixture.executorLog,
    OPENJOB_CANDIDATE_EXECUTOR_STATE: fixture.executorState,
  };
  const prepared = await runCandidate(fixture.root, [
    "prepare",
    "--record",
    fixture.recordPath,
    "--verification-result",
    fixture.verificationPath,
    "--environment",
    "production",
  ], environment);
  assert.equal(prepared.status, 0, prepared.stderr);
  const beforePreview = await readFile(fixture.recordPath, "utf8");
  const action = [
    "execute",
    "--record",
    fixture.recordPath,
    "--action",
    "build",
    "--platform",
    "ios",
    "--executor",
    fixture.executorPath,
  ];

  const preview = await runCandidate(fixture.root, action, environment);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.report.status, "preview");
  assert.equal(preview.report.action, "build");
  assert.equal(preview.report.platform, "ios");
  assert.match(
    preview.report.confirmationToken,
    new RegExp(`^${prepared.report.candidateId}:build:ios:[a-f0-9]{12}$`, "u"),
  );
  assert.equal(await readFile(fixture.recordPath, "utf8"), beforePreview);
  await assert.rejects(readFile(fixture.executorLog, "utf8"), { code: "ENOENT" });

  const executed = await runCandidate(
    fixture.root,
    [...action, "--confirm", preview.report.confirmationToken],
    environment,
  );
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.report.status, "succeeded");
  assert.match(executed.stderr, /configured external executor ran/u);
  assert.doesNotMatch(executed.stderr, /no external action ran/u);
  const record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(record.platforms.ios.build.state, "succeeded");
  assert.equal(record.platforms.ios.identity.buildNumber, "42");
  assert.equal(record.platforms.ios.artifact.id, "artifact-ios-1");
  assert.equal(record.platforms.ios.artifact.easBuildId, "eas-ios-1");
  assert.match(record.platforms.ios.artifact.checksum, /^sha256:a{64}$/u);
  assert.doesNotMatch(JSON.stringify(record), /executor-only-secret/u);
  assert.equal(record.platforms.android.build.state, "pending");
  assert.equal((await readFile(fixture.executorLog, "utf8")).trim().split("\n").length, 1);

  const repeated = await runCandidate(
    fixture.root,
    [...action, "--confirm", preview.report.confirmationToken],
    environment,
  );
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.report.status, "reused");
  assert.match(repeated.report.reason, /successful Candidate Artifact/u);
  assert.equal((await readFile(fixture.executorLog, "utf8")).trim().split("\n").length, 1);
  const rewound = structuredClone(record);
  rewound.platforms.ios.build.state = "pending";
  rewound.platforms.ios.build.requestKey = null;
  await writeJson(fixture.recordPath, rewound);
  const rejectedRewind = await runCandidate(fixture.root, [
    "inspect", "--record", fixture.recordPath,
  ]);
  assert.equal(rejectedRewind.status, 1);
  assert.equal(rejectedRewind.report.error.code, "corrupted_candidate_record");
  await writeJson(fixture.recordPath, record);
  const staleLock = `${fixture.recordPath}.lock`;
  await mkdir(staleLock);
  await writeJson(join(staleLock, "owner.json"), {
    createdAt: new Date().toISOString(),
    hostname: hostname(),
    pid: 999_999_999,
  });
  const recovered = await runCandidate(fixture.root, [
    "invalidate", "--record", fixture.recordPath,
    "--reason", "stale lock recovery proved",
  ], environment);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(recovered.report.status, "invalidated");
});

test("submission failure resumes the same artifact while platform state stays independent", async () => {
  const fixture = await createCandidateFixture();
  const environment = {
    OPENJOB_CANDIDATE_EXECUTOR_LOG: fixture.executorLog,
    OPENJOB_CANDIDATE_EXECUTOR_STATE: fixture.executorState,
    OPENJOB_CANDIDATE_FAIL_ONCE: "submit:ios",
  };
  const prepared = await runCandidate(fixture.root, [
    "prepare", "--record", fixture.recordPath,
    "--verification-result", fixture.verificationPath,
    "--environment", "production",
  ], environment);
  assert.equal(prepared.status, 0, prepared.stderr);

  for (const platform of ["ios", "android"]) {
    const build = [
      "execute", "--record", fixture.recordPath,
      "--action", "build", "--platform", platform,
      "--executor", fixture.executorPath,
    ];
    const preview = await runCandidate(fixture.root, build, environment);
    const result = await runCandidate(
      fixture.root,
      [...build, "--confirm", preview.report.confirmationToken],
      environment,
    );
    assert.equal(result.status, 0, result.stderr);
  }

  const submit = [
    "execute", "--record", fixture.recordPath,
    "--action", "submit", "--platform", "ios",
    "--executor", fixture.executorPath,
  ];
  const submitPreview = await runCandidate(fixture.root, submit, environment);
  assert.equal(submitPreview.status, 0, submitPreview.stderr);
  const failed = await runCandidate(
    fixture.root,
    [...submit, "--confirm", submitPreview.report.confirmationToken],
    environment,
  );
  assert.equal(failed.status, 1);
  assert.equal(failed.report.error.code, "network_timeout");
  let record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(record.platforms.ios.build.state, "succeeded");
  assert.equal(record.platforms.ios.submission.state, "failed");
  assert.equal(record.platforms.ios.submission.failure.classification, "resumable");
  assert.equal(record.platforms.android.build.state, "succeeded");
  assert.equal(record.platforms.android.submission.state, "pending");

  const resume = [
    "resume", "--record", fixture.recordPath,
    "--platform", "ios", "--executor", fixture.executorPath,
  ];
  const resumePreview = await runCandidate(fixture.root, resume, environment);
  assert.equal(resumePreview.status, 0, resumePreview.stderr);
  assert.equal(resumePreview.report.status, "preview");
  assert.equal(resumePreview.report.action, "submit");
  const resumed = await runCandidate(
    fixture.root,
    [...resume, "--confirm", resumePreview.report.confirmationToken],
    environment,
  );
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(resumed.report.status, "succeeded");
  assert.equal(resumed.report.action, "submit");

  const status = await runCandidate(fixture.root, [
    "status", "--record", fixture.recordPath,
    "--platform", "ios", "--executor", fixture.executorPath,
  ], environment);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.report.status, "succeeded");
  record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(record.platforms.ios.submission.state, "succeeded");
  assert.equal(record.platforms.ios.submission.id, "submission-ios-1");
  assert.equal(record.platforms.ios.store.buildId, "store-ios-42");
  assert.equal(record.platforms.ios.processing.state, "succeeded");
  assert.equal(record.platforms.ios.availability.state, "succeeded");
  assert.equal(record.platforms.android.submission.state, "pending");

  const calls = (await readFile(fixture.executorLog, "utf8")).trim().split("\n");
  assert.deepEqual(calls.map((entry) => entry.split(":").slice(0, 2).join(":")), [
    "build:ios",
    "build:android",
    "submit:ios",
    "submit:ios",
    "status:ios",
  ]);
});

test("resumable EAS, Apple, and Google failures reuse stable platform request keys", async () => {
  const fixture = await createCandidateFixture();
  const environment = {
    OPENJOB_CANDIDATE_EXECUTOR_LOG: fixture.executorLog,
    OPENJOB_CANDIDATE_EXECUTOR_STATE: fixture.executorState,
  };
  await runCandidate(fixture.root, [
    "prepare", "--record", fixture.recordPath,
    "--verification-result", fixture.verificationPath,
    "--environment", "production",
  ], environment);

  const failureCodes = {
    "build:ios": "authentication_expired",
    "submit:ios": "rate_limited",
    "build:android": "service_unavailable",
    "submit:android": "network_timeout",
  };
  for (const platform of ["ios", "android"]) {
    for (const action of ["build", "submit"]) {
      const arguments_ = [
        "execute", "--record", fixture.recordPath,
        "--action", action, "--platform", platform,
        "--executor", fixture.executorPath,
      ];
      const preview = await runCandidate(fixture.root, arguments_, environment);
      assert.equal(preview.status, 0, preview.stderr);
      const failed = await runCandidate(
        fixture.root,
        [...arguments_, "--confirm", preview.report.confirmationToken],
        {
          ...environment,
          OPENJOB_CANDIDATE_FAIL_ONCE: `${action}:${platform}`,
          OPENJOB_CANDIDATE_FAILURE_CODE: failureCodes[`${action}:${platform}`],
          OPENJOB_CANDIDATE_FAILURE_CLASSIFICATION: "terminal",
        },
      );
      assert.equal(failed.status, 1);
      assert.equal(failed.report.error.code, failureCodes[`${action}:${platform}`]);
      let record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
      const stateName = action === "build" ? "build" : "submission";
      assert.equal(record.platforms[platform][stateName].state, "failed");
      assert.equal(
        record.platforms[platform][stateName].failure.classification,
        "resumable",
      );
      assert.equal(
        record.platforms[platform][stateName].failure.service,
        action === "build" ? "eas" : platform === "ios" ? "apple" : "google",
      );
      const requestKey = record.platforms[platform][stateName].requestKey;

      const resume = [
        "resume", "--record", fixture.recordPath,
        "--platform", platform, "--executor", fixture.executorPath,
      ];
      const resumePreview = await runCandidate(fixture.root, resume, environment);
      assert.equal(resumePreview.status, 0, resumePreview.stderr);
      assert.equal(resumePreview.report.action, action);
      const resumed = await runCandidate(
        fixture.root,
        [...resume, "--confirm", resumePreview.report.confirmationToken],
        environment,
      );
      assert.equal(resumed.status, 0, resumed.stderr);
      record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
      assert.equal(record.platforms[platform][stateName].state, "succeeded");
      assert.equal(record.platforms[platform][stateName].requestKey, requestKey);
    }
  }
  const calls = (await readFile(fixture.executorLog, "utf8")).trim().split("\n");
  for (const platform of ["ios", "android"]) {
    assert.equal(
      calls.filter((entry) => entry.startsWith(`build:${platform}:`)).length,
      1,
    );
    assert.equal(
      calls.filter((entry) => entry.startsWith(`resume-build:${platform}:`)).length,
      1,
    );
  }
});

test("inspect, invalidate, and handoff preserve one durable non-external record", async () => {
  const fixture = await createCandidateFixture();
  const prepared = await runCandidate(fixture.root, [
    "prepare", "--record", fixture.recordPath,
    "--verification-result", fixture.verificationPath,
    "--environment", "production",
  ]);
  assert.equal(prepared.status, 0, prepared.stderr);
  const before = await readFile(fixture.recordPath, "utf8");

  const inspected = await runCandidate(fixture.root, [
    "inspect", "--record", fixture.recordPath,
  ]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(inspected.report.status, "valid");
  assert.equal(inspected.report.candidate.id, prepared.report.candidateId);
  assert.equal(inspected.report.externalActionRan, false);

  const handoff = await runCandidate(fixture.root, [
    "handoff", "--record", fixture.recordPath,
  ]);
  assert.equal(handoff.status, 0, handoff.stderr);
  assert.equal(handoff.report.status, "blocked");
  assert.equal(handoff.report.releaseProof.issue, 41);
  assert.match(handoff.report.reason, /#41/u);
  assert.match(handoff.report.recordFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(await readFile(fixture.recordPath, "utf8"), before);

  const invalidated = await runCandidate(fixture.root, [
    "invalidate", "--record", fixture.recordPath,
    "--reason", "native signing identity rotated",
  ]);
  assert.equal(invalidated.status, 0, invalidated.stderr);
  assert.equal(invalidated.report.status, "invalidated");
  const record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(record.invalidation.reason, "operator invalidated candidate");
  assert.match(record.invalidation.reasonFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(record), /native signing identity rotated/u);
  assert.equal(record.platforms.ios.build.state, "pending");
  assert.equal(record.platforms.android.build.state, "pending");

  const repeated = await runCandidate(fixture.root, [
    "invalidate", "--record", fixture.recordPath,
    "--reason", "native signing identity rotated",
  ]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.report.status, "reused");
});

test("coequal promotion refuses incomplete Release Proof and advances both platforms together", async () => {
  const fixture = await createCandidateFixture();
  const environment = {
    OPENJOB_CANDIDATE_EXECUTOR_LOG: fixture.executorLog,
    OPENJOB_CANDIDATE_EXECUTOR_STATE: fixture.executorState,
  };
  const prepared = await runCandidate(fixture.root, [
    "prepare", "--record", fixture.recordPath,
    "--verification-result", fixture.verificationPath,
    "--environment", "production",
  ], environment);
  assert.equal(prepared.status, 0, prepared.stderr);
  for (const platform of ["ios", "android"]) {
    for (const action of ["build", "submit"]) {
      const arguments_ = [
        "execute", "--record", fixture.recordPath,
        "--action", action, "--platform", platform,
        "--executor", fixture.executorPath,
      ];
      const preview = await runCandidate(fixture.root, arguments_, environment);
      assert.equal(preview.status, 0, preview.stderr);
      const result = await runCandidate(
        fixture.root,
        [...arguments_, "--confirm", preview.report.confirmationToken],
        environment,
      );
      assert.equal(result.status, 0, result.stderr);
    }
    const status = await runCandidate(fixture.root, [
      "status", "--record", fixture.recordPath,
      "--platform", platform, "--executor", fixture.executorPath,
    ], environment);
    assert.equal(status.status, 0, status.stderr);
  }

  const promotion = [
    "execute", "--record", fixture.recordPath,
    "--action", "promote", "--platform", "all",
    "--executor", fixture.executorPath,
  ];
  const refused = await runCandidate(fixture.root, promotion, environment);
  assert.equal(refused.status, 1);
  assert.equal(refused.report.error.code, "promotion_blocked");
  assert.match(refused.report.error.message, /iOS physical proof is incomplete/i);
  assert.match(refused.report.error.message, /#41 Release Proof is incomplete/u);

  for (const platform of ["ios", "android"]) {
    const proof = [
      "execute", "--record", fixture.recordPath,
      "--action", "physical-proof", "--platform", platform,
      "--executor", fixture.executorPath,
    ];
    const preview = await runCandidate(fixture.root, proof, environment);
    assert.equal(preview.status, 0, preview.stderr);
    const result = await runCandidate(
      fixture.root,
      [...proof, "--confirm", preview.report.confirmationToken],
      environment,
    );
    assert.equal(result.status, 0, result.stderr);
  }
  const releaseProof = [
    "execute", "--record", fixture.recordPath,
    "--action", "release-proof", "--platform", "all",
    "--executor", fixture.executorPath,
  ];
  const proofPreview = await runCandidate(fixture.root, releaseProof, environment);
  assert.equal(proofPreview.status, 0, proofPreview.stderr);
  const failedReleaseProof = await runCandidate(
    fixture.root,
    [...releaseProof, "--confirm", proofPreview.report.confirmationToken],
    { ...environment, OPENJOB_CANDIDATE_FAIL_ONCE: "release-proof:all" },
  );
  assert.equal(failedReleaseProof.status, 1);
  let failedRecord = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(failedRecord.releaseProof.failure.classification, "resumable");
  assert.equal(failedRecord.releaseProof.failure.service, "github");
  const retryProofPreview = await runCandidate(
    fixture.root,
    releaseProof,
    environment,
  );
  assert.equal(retryProofPreview.status, 0, retryProofPreview.stderr);
  const blockedProofResult = await runCandidate(
    fixture.root,
    [...releaseProof, "--confirm", retryProofPreview.report.confirmationToken],
    { ...environment, OPENJOB_CANDIDATE_RELEASE_BLOCKERS: "1" },
  );
  assert.equal(blockedProofResult.status, 0, blockedProofResult.stderr);
  assert.equal(blockedProofResult.report.status, "blocked");
  failedRecord = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(failedRecord.releaseProof.succeededAt, undefined);
  assert.match(failedRecord.releaseProof.blockedAt, /^\d{4}-/u);
  assert.equal(failedRecord.events.at(-1).type, "release-proof-blocked");

  const privacyRefused = await runCandidate(fixture.root, promotion, environment);
  assert.equal(privacyRefused.status, 1);
  assert.match(privacyRefused.report.error.message, /privacy discrepancy/u);
  assert.match(privacyRefused.report.error.message, /unapproved limitation/u);

  const correctedPreview = await runCandidate(fixture.root, releaseProof, environment);
  assert.equal(correctedPreview.status, 0, correctedPreview.stderr);
  assert.equal(correctedPreview.report.status, "preview");
  const corrected = await runCandidate(
    fixture.root,
    [...releaseProof, "--confirm", correctedPreview.report.confirmationToken],
    environment,
  );
  assert.equal(corrected.status, 0, corrected.stderr);

  const promotionPreview = await runCandidate(fixture.root, promotion, environment);
  assert.equal(promotionPreview.status, 0, promotionPreview.stderr);
  assert.equal(promotionPreview.report.status, "preview");
  const promoted = await runCandidate(
    fixture.root,
    [...promotion, "--confirm", promotionPreview.report.confirmationToken],
    environment,
  );
  assert.equal(promoted.status, 0, promoted.stderr);
  assert.equal(promoted.report.status, "succeeded");
  const record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(record.platforms.ios.physicalProof.state, "succeeded");
  assert.equal(record.platforms.android.physicalProof.state, "succeeded");
  assert.equal(record.releaseProof.state, "succeeded");
  assert.equal(record.platforms.ios.promotion.state, "succeeded");
  assert.equal(record.platforms.android.promotion.state, "succeeded");
  const rewoundPromotion = structuredClone(record);
  for (const platform of ["ios", "android"]) {
    rewoundPromotion.platforms[platform].promotion.state = "requested";
  }
  await writeJson(fixture.recordPath, rewoundPromotion);
  const duplicatePromotion = await runCandidate(fixture.root, [
    "inspect", "--record", fixture.recordPath,
  ]);
  assert.equal(duplicatePromotion.status, 1);
  assert.equal(duplicatePromotion.report.error.code, "corrupted_candidate_record");
  await writeJson(fixture.recordPath, record);
  record.platforms.ios.physicalProof.evidence = [];
  await writeJson(fixture.recordPath, record);
  const fabricatedProof = await runCandidate(fixture.root, [
    "inspect", "--record", fixture.recordPath,
  ]);
  assert.equal(fabricatedProof.status, 1);
  assert.equal(fabricatedProof.report.error.code, "corrupted_candidate_record");
});

test("a mismatched platform artifact blocks both without discarding the valid platform", async () => {
  const fixture = await createCandidateFixture();
  const environment = {
    OPENJOB_CANDIDATE_EXECUTOR_LOG: fixture.executorLog,
    OPENJOB_CANDIDATE_EXECUTOR_STATE: fixture.executorState,
  };
  await runCandidate(fixture.root, [
    "prepare", "--record", fixture.recordPath,
    "--verification-result", fixture.verificationPath,
    "--environment", "production",
  ], environment);
  for (const platform of ["ios", "android"]) {
    const build = [
      "execute", "--record", fixture.recordPath,
      "--action", "build", "--platform", platform,
      "--executor", fixture.executorPath,
    ];
    const preview = await runCandidate(fixture.root, build, environment);
    const result = await runCandidate(
      fixture.root,
      [...build, "--confirm", preview.report.confirmationToken],
      platform === "android"
        ? { ...environment, OPENJOB_CANDIDATE_MISMATCH: "build:android" }
        : environment,
    );
    assert.equal(result.status, platform === "ios" ? 0 : 1, result.stderr);
  }
  const record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(record.platforms.ios.artifact.id, "artifact-ios-1");
  assert.equal(record.platforms.ios.build.state, "succeeded");
  assert.equal(record.platforms.android.build.state, "failed");
  assert.match(record.platforms.android.mismatch, /frozen candidate identity/u);
  const promotion = await runCandidate(fixture.root, [
    "execute", "--record", fixture.recordPath,
    "--action", "promote", "--platform", "all",
    "--executor", fixture.executorPath,
  ], environment);
  assert.equal(promotion.status, 1);
  assert.match(promotion.report.error.message, /android artifact identity mismatch/u);
});

test("changed release inputs invalidate before submission without discarding a valid artifact", async () => {
  const fixture = await createCandidateFixture();
  const environment = {
    OPENJOB_CANDIDATE_EXECUTOR_LOG: fixture.executorLog,
    OPENJOB_CANDIDATE_EXECUTOR_STATE: fixture.executorState,
  };
  const prepared = await runCandidate(fixture.root, [
    "prepare", "--record", fixture.recordPath,
    "--verification-result", fixture.verificationPath,
    "--environment", "production",
  ], environment);
  assert.equal(prepared.status, 0, prepared.stderr);
  const build = [
    "execute", "--record", fixture.recordPath,
    "--action", "build", "--platform", "ios",
    "--executor", fixture.executorPath,
  ];
  const preview = await runCandidate(fixture.root, build, environment);
  const built = await runCandidate(
    fixture.root,
    [...build, "--confirm", preview.report.confirmationToken],
    environment,
  );
  assert.equal(built.status, 0, built.stderr);

  const easPath = join(fixture.root, "native", "eas.json");
  const eas = JSON.parse(await readFile(easPath, "utf8"));
  eas.build.production.environment = "production-corrected";
  await writeJson(easPath, eas);
  git(fixture.root, ["add", "native/eas.json"]);
  git(fixture.root, ["commit", "-m", "Change native build profile"]);
  git(fixture.root, ["push", "origin", "main"]);

  const submission = await runCandidate(fixture.root, [
    "execute", "--record", fixture.recordPath,
    "--action", "submit", "--platform", "ios",
    "--executor", fixture.executorPath,
  ], environment);
  assert.equal(submission.status, 1);
  assert.equal(submission.report.error.code, "candidate_invalidated");
  assert.match(submission.report.error.message, /native configuration/u);
  const record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.match(record.invalidation.reason, /native configuration/u);
  assert.equal(record.platforms.ios.build.state, "succeeded");
  assert.equal(record.platforms.ios.artifact.id, "artifact-ios-1");
  assert.equal((await readFile(fixture.executorLog, "utf8")).trim().split("\n").length, 1);
});

test("concurrent build invocations share one request and one Candidate Artifact", async () => {
  const fixture = await createCandidateFixture();
  const environment = {
    OPENJOB_CANDIDATE_EXECUTOR_LOG: fixture.executorLog,
    OPENJOB_CANDIDATE_EXECUTOR_STATE: fixture.executorState,
  };
  await runCandidate(fixture.root, [
    "prepare", "--record", fixture.recordPath,
    "--verification-result", fixture.verificationPath,
    "--environment", "production",
  ], environment);
  const action = [
    "execute", "--record", fixture.recordPath,
    "--action", "build", "--platform", "android",
    "--executor", fixture.executorPath,
  ];
  const preview = await runCandidate(fixture.root, action, environment);
  const confirmed = [...action, "--confirm", preview.report.confirmationToken];
  const [first, second] = await Promise.all([
    runCandidate(fixture.root, confirmed, environment),
    runCandidate(fixture.root, confirmed, environment),
  ]);
  assert.deepEqual([first.status, second.status], [0, 0]);
  assert.deepEqual(
    [first.report.status, second.report.status].sort(),
    ["reused", "succeeded"],
  );
  assert.equal((await readFile(fixture.executorLog, "utf8")).trim().split("\n").length, 1);
});

test("corrupted state and authentication material fail closed", async () => {
  const corrupt = await createCandidateFixture();
  await writeFile(corrupt.recordPath, "{not-json\n");
  const inspected = await runCandidate(corrupt.root, [
    "inspect", "--record", corrupt.recordPath,
  ]);
  assert.equal(inspected.status, 1);
  assert.equal(inspected.report.error.code, "corrupted_candidate_record");

  const structurallyCorrupt = await createCandidateFixture();
  const preparedSafe = await runCandidate(structurallyCorrupt.root, [
    "prepare", "--record", structurallyCorrupt.recordPath,
    "--verification-result", structurallyCorrupt.verificationPath,
    "--environment", "production",
  ]);
  assert.equal(preparedSafe.status, 0, preparedSafe.stderr);
  const corruptedRecord = JSON.parse(
    await readFile(structurallyCorrupt.recordPath, "utf8"),
  );
  corruptedRecord.platforms.android.build.state = "rewound";
  await writeJson(structurallyCorrupt.recordPath, corruptedRecord);
  const structuralInspection = await runCandidate(structurallyCorrupt.root, [
    "inspect", "--record", structurallyCorrupt.recordPath,
  ]);
  assert.equal(structuralInspection.status, 1);
  assert.equal(
    structuralInspection.report.error.code,
    "corrupted_candidate_record",
  );

  const semanticCorrupt = await createCandidateFixture();
  await runCandidate(semanticCorrupt.root, [
    "prepare", "--record", semanticCorrupt.recordPath,
    "--verification-result", semanticCorrupt.verificationPath,
    "--environment", "production",
  ]);
  const semanticallyCorruptedRecord = JSON.parse(
    await readFile(semanticCorrupt.recordPath, "utf8"),
  );
  semanticallyCorruptedRecord.candidate.native.ios.bundleId = "dev.example.tampered";
  await writeJson(semanticCorrupt.recordPath, semanticallyCorruptedRecord);
  const semanticInspection = await runCandidate(semanticCorrupt.root, [
    "inspect", "--record", semanticCorrupt.recordPath,
  ]);
  assert.equal(semanticInspection.status, 1);
  assert.equal(semanticInspection.report.error.code, "corrupted_candidate_record");

  const impossible = await createCandidateFixture();
  await runCandidate(impossible.root, [
    "prepare", "--record", impossible.recordPath,
    "--verification-result", impossible.verificationPath,
    "--environment", "production",
  ]);
  const impossibleRecord = JSON.parse(await readFile(impossible.recordPath, "utf8"));
  impossibleRecord.platforms.ios.submission = {
    state: "succeeded",
    id: "submission-without-build",
  };
  await writeJson(impossible.recordPath, impossibleRecord);
  const impossibleInspection = await runCandidate(impossible.root, [
    "inspect", "--record", impossible.recordPath,
  ]);
  assert.equal(impossibleInspection.status, 1);
  assert.equal(impossibleInspection.report.error.code, "corrupted_candidate_record");

  const unsafe = await createCandidateFixture();
  const verification = JSON.parse(await readFile(unsafe.verificationPath, "utf8"));
  verification.gates[0].accessToken = "must-never-enter-candidate-state";
  await writeJson(unsafe.verificationPath, verification);
  const prepared = await runCandidate(unsafe.root, [
    "prepare", "--record", unsafe.recordPath,
    "--verification-result", unsafe.verificationPath,
    "--environment", "production",
  ]);
  assert.equal(prepared.status, 1);
  assert.equal(prepared.report.error.code, "unsafe_candidate_data");
  await assert.rejects(readFile(unsafe.recordPath, "utf8"), { code: "ENOENT" });

  const redacted = await createCandidateFixture();
  const personalVerification = JSON.parse(
    await readFile(redacted.verificationPath, "utf8"),
  );
  personalVerification.gates[0].reason =
    "Task content: private assignment for person@example.test in Group content: private team";
  personalVerification.gates[1].reason = "Call Alice Walker at 312-555-0142";
  await writeJson(redacted.verificationPath, personalVerification);
  const redactedPreparation = await runCandidate(redacted.root, [
    "prepare", "--record", redacted.recordPath,
    "--verification-result", redacted.verificationPath,
    "--environment", "production",
  ]);
  assert.equal(redactedPreparation.status, 0, redactedPreparation.stderr);
  const durableSource = await readFile(redacted.recordPath, "utf8");
  assert.doesNotMatch(
    durableSource,
    /person@example\.test|private assignment|private team|Alice Walker|312-555-0142/u,
  );
  assert.match(durableSource, /redacted nonessential verification text/u);
});

test("unsafe executor identifiers never enter durable state", async () => {
  const fixture = await createCandidateFixture();
  const environment = {
    OPENJOB_CANDIDATE_EXECUTOR_LOG: fixture.executorLog,
    OPENJOB_CANDIDATE_EXECUTOR_STATE: fixture.executorState,
    OPENJOB_CANDIDATE_UNSAFE_ID: "build:ios",
  };
  await runCandidate(fixture.root, [
    "prepare", "--record", fixture.recordPath,
    "--verification-result", fixture.verificationPath,
    "--environment", "production",
  ], environment);
  const build = [
    "execute", "--record", fixture.recordPath,
    "--action", "build", "--platform", "ios",
    "--executor", fixture.executorPath,
  ];
  const preview = await runCandidate(fixture.root, build, environment);
  const executed = await runCandidate(
    fixture.root,
    [...build, "--confirm", preview.report.confirmationToken],
    environment,
  );
  assert.equal(executed.status, 1);
  assert.equal(executed.report.error.code, "artifact_identity_mismatch");
  assert.doesNotMatch(await readFile(fixture.recordPath, "utf8"), /person@example\.test/u);
});

test("the durable record hands off unchanged through a local fake Git remote", async () => {
  const fixture = await createCandidateFixture();
  const prepared = await runCandidate(fixture.root, [
    "prepare", "--record", fixture.recordPath,
    "--verification-result", fixture.verificationPath,
    "--environment", "production",
  ]);
  assert.equal(prepared.status, 0, prepared.stderr);
  const transferredRoot = await mkdtemp(join(tmpdir(), "openjob-candidate-transfer-"));
  git(dirname(transferredRoot), ["clone", fixture.remote, transferredRoot]);
  const transferredRecord = join(transferredRoot, ".openjob", "candidate.json");
  await mkdir(dirname(transferredRecord), { recursive: true });
  await cp(fixture.recordPath, transferredRecord);

  const handedOff = await runCandidate(transferredRoot, [
    "handoff", "--record", transferredRecord,
  ]);
  assert.equal(handedOff.status, 0, handedOff.stderr);
  assert.equal(handedOff.report.candidateId, prepared.report.candidateId);
  assert.equal(handedOff.report.status, "blocked");
  assert.equal(
    await readFile(transferredRecord, "utf8"),
    await readFile(fixture.recordPath, "utf8"),
  );
});

test("resume targets failed store processing and evidence collection without rebuilding", async () => {
  const fixture = await createCandidateFixture();
  const environment = {
    OPENJOB_CANDIDATE_EXECUTOR_LOG: fixture.executorLog,
    OPENJOB_CANDIDATE_EXECUTOR_STATE: fixture.executorState,
  };
  await runCandidate(fixture.root, [
    "prepare", "--record", fixture.recordPath,
    "--verification-result", fixture.verificationPath,
    "--environment", "production",
  ], environment);
  for (const action of ["build", "submit"]) {
    const arguments_ = [
      "execute", "--record", fixture.recordPath,
      "--action", action, "--platform", "ios",
      "--executor", fixture.executorPath,
    ];
    const preview = await runCandidate(fixture.root, arguments_, environment);
    const result = await runCandidate(
      fixture.root,
      [...arguments_, "--confirm", preview.report.confirmationToken],
      environment,
    );
    assert.equal(result.status, 0, result.stderr);
  }

  const failedStatus = await runCandidate(fixture.root, [
    "status", "--record", fixture.recordPath,
    "--platform", "ios", "--executor", fixture.executorPath,
  ], {
    ...environment,
    OPENJOB_CANDIDATE_FAIL_ONCE: "status:ios",
    OPENJOB_CANDIDATE_FAILURE_CODE: "processing_delayed",
  });
  assert.equal(failedStatus.status, 1);
  assert.equal(failedStatus.report.error.code, "processing_delayed");
  let record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(record.platforms.ios.processing.state, "failed");
  assert.equal(record.platforms.ios.processing.failure.classification, "resumable");

  const resumedStatus = await runCandidate(fixture.root, [
    "resume", "--record", fixture.recordPath,
    "--platform", "ios", "--executor", fixture.executorPath,
  ], { ...environment, OPENJOB_CANDIDATE_PENDING_ONCE: "status:ios" });
  assert.equal(resumedStatus.status, 0, resumedStatus.stderr);
  assert.equal(resumedStatus.report.action, "status");
  assert.equal(resumedStatus.report.status, "pending");
  const finishedStatus = await runCandidate(fixture.root, [
    "resume", "--record", fixture.recordPath,
    "--platform", "ios", "--executor", fixture.executorPath,
  ], { ...environment, OPENJOB_CANDIDATE_PENDING_ONCE: "status:ios" });
  assert.equal(finishedStatus.status, 0, finishedStatus.stderr);
  assert.equal(finishedStatus.report.status, "succeeded");
  record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(record.platforms.ios.availability.state, "succeeded");

  const proof = [
    "execute", "--record", fixture.recordPath,
    "--action", "physical-proof", "--platform", "ios",
    "--executor", fixture.executorPath,
  ];
  const proofPreview = await runCandidate(fixture.root, proof, environment);
  const failedProof = await runCandidate(
    fixture.root,
    [...proof, "--confirm", proofPreview.report.confirmationToken],
    { ...environment, OPENJOB_CANDIDATE_FAIL_ONCE: "physical-proof:ios" },
  );
  assert.equal(failedProof.status, 1);
  record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  assert.equal(record.platforms.ios.physicalProof.state, "failed");
  assert.equal(record.platforms.ios.physicalProof.failure.classification, "resumable");

  const resume = [
    "resume", "--record", fixture.recordPath,
    "--platform", "ios", "--executor", fixture.executorPath,
  ];
  const resumePreview = await runCandidate(fixture.root, resume, environment);
  assert.equal(resumePreview.status, 0, resumePreview.stderr);
  assert.equal(resumePreview.report.action, "physical-proof");
  const resumedProof = await runCandidate(
    fixture.root,
    [...resume, "--confirm", resumePreview.report.confirmationToken],
    environment,
  );
  assert.equal(resumedProof.status, 0, resumedProof.stderr);
  assert.equal(resumedProof.report.action, "physical-proof");
  const calls = (await readFile(fixture.executorLog, "utf8")).trim().split("\n");
  assert.equal(calls.filter((entry) => entry.startsWith("build:ios:")).length, 1);
});

test("operator documentation exposes every durable flow and the #41 handoff", async () => {
  const [packageSource, documentation, readme, verificationSource] =
    await Promise.all([
      readFile(new URL("package.json", REPOSITORY_ROOT), "utf8"),
      readFile(new URL("docs/release-candidates.md", REPOSITORY_ROOT), "utf8"),
      readFile(new URL("README.md", REPOSITORY_ROOT), "utf8"),
      readFile(new URL("scripts/verify.mjs", REPOSITORY_ROOT), "utf8"),
    ]);
  const packageJson = JSON.parse(packageSource);
  assert.equal(
    packageJson.scripts["release:candidate"],
    "node scripts/release-candidate.mjs",
  );
  assert.match(packageJson.scripts["test:verification"], /release-candidate\.test\.mjs/u);
  for (const command of [
    "prepare",
    "inspect",
    "execute",
    "status",
    "resume",
    "invalidate",
    "handoff",
  ]) {
    assert.match(documentation, new RegExp(`release:candidate -- ${command}`, "u"));
  }
  assert.match(documentation, /confirmationToken/u);
  assert.match(documentation, /executor.*JSON/isu);
  assert.match(documentation, /#41.*sole.*Release Proof/isu);
  assert.match(documentation, /does not authorize.*real.*build/isu);
  assert.match(readme, /durable candidate coordinator/u);
  assert.match(verificationSource, /scripts\/release-candidate\.mjs/u);
  assert.match(verificationSource, /tests\/release-candidate\.test\.mjs/u);
  assert.match(verificationSource, /docs\/release-candidates\.md/u);
});
