import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { releasePrivacyFingerprint } from "./release-privacy.mjs";

const USAGE = [
  "Usage:",
  "  npm run release:candidate -- prepare --record <path> --verification-result <path> --environment <preview|production>",
  "  npm run release:candidate -- execute --record <path> --action <build|submit|physical-proof|release-proof|promote> --platform <ios|android|all> --executor <module> [--confirm <token>]",
  "  npm run release:candidate -- status --record <path> --platform <ios|android> --executor <module>",
  "  npm run release:candidate -- resume --record <path> --platform <ios|android> --executor <module> [--confirm <token>]",
  "  npm run release:candidate -- inspect --record <path>",
  "  npm run release:candidate -- invalidate --record <path> --reason <text>",
  "  npm run release:candidate -- handoff --record <path>",
].join("\n");
const REQUIRED_VERIFICATION_GATES = [
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
];
const INPUT_PATHS = [
  "config/generated/native-privacy.json",
  "config/native-identities.json",
  "config/release-privacy-inventory.json",
  "native/eas.json",
  "native/package-lock.json",
  "package-lock.json",
];

class CandidateError extends Error {
  constructor(code, message, exitCode = 1) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(code, message) {
  throw new CandidateError(code, message);
}

function emitFailure(error) {
  const failure = error instanceof CandidateError
    ? error
    : new CandidateError("internal_error", error.message);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    status: "failed",
    error: { code: failure.code, message: failure.message },
  })}\n`);
  process.stderr.write(`FAILED ${failure.code} — ${failure.message}\n`);
  process.exitCode = failure.exitCode;
}

function run(command, args, root) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: "pipe",
  });
  if (result.error) throw result.error;
  return result;
}

function git(root, args, code = "git_error") {
  const result = run("git", args, root);
  if (result.status !== 0) {
    fail(
      code,
      (result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim(),
    );
  }
  return result.stdout.trim();
}

function parseArguments(arguments_) {
  const [command, ...options] = arguments_;
  if (
    ![
      "prepare",
      "execute",
      "status",
      "resume",
      "inspect",
      "invalidate",
      "handoff",
    ].includes(command)
  ) {
    throw new CandidateError("invalid_arguments", USAGE, 2);
  }
  const parsed = { command };
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index];
    const value = options[index + 1];
    if (
      !value ||
      ![
        "--record",
        "--verification-result",
        "--environment",
        "--action",
        "--platform",
        "--executor",
        "--confirm",
        "--reason",
      ].includes(option)
    ) {
      throw new CandidateError("invalid_arguments", USAGE, 2);
    }
    const property = {
      "--record": "record",
      "--verification-result": "verificationResult",
      "--environment": "environment",
      "--action": "action",
      "--platform": "platform",
      "--executor": "executor",
      "--confirm": "confirm",
      "--reason": "reason",
    }[option];
    if (parsed[property]) {
      throw new CandidateError("invalid_arguments", USAGE, 2);
    }
    parsed[property] = value;
  }
  const validPrepare =
    command === "prepare" &&
    parsed.record &&
    parsed.verificationResult &&
    ["preview", "production"].includes(parsed.environment) &&
    !parsed.action &&
    !parsed.platform &&
    !parsed.executor &&
    !parsed.confirm &&
    !parsed.reason;
  const validExecute =
    command === "execute" &&
    parsed.record &&
    ((["build", "submit", "physical-proof"].includes(parsed.action) &&
      ["ios", "android"].includes(parsed.platform)) ||
      (["release-proof", "promote"].includes(parsed.action) &&
        parsed.platform === "all")) &&
    parsed.executor &&
    !parsed.verificationResult &&
    !parsed.environment &&
    !parsed.reason;
  const validStatus =
    command === "status" &&
    parsed.record &&
    ["ios", "android"].includes(parsed.platform) &&
    parsed.executor &&
    !parsed.confirm &&
    !parsed.action &&
    !parsed.verificationResult &&
    !parsed.environment &&
    !parsed.reason;
  const validResume =
    command === "resume" &&
    parsed.record &&
    ["ios", "android"].includes(parsed.platform) &&
    parsed.executor &&
    !parsed.action &&
    !parsed.verificationResult &&
    !parsed.environment &&
    !parsed.reason;
  const validInspect =
    ["inspect", "handoff"].includes(command) &&
    parsed.record &&
    !parsed.action &&
    !parsed.platform &&
    !parsed.executor &&
    !parsed.confirm &&
    !parsed.verificationResult &&
    !parsed.environment &&
    !parsed.reason;
  const validInvalidate =
    command === "invalidate" &&
    parsed.record &&
    typeof parsed.reason === "string" &&
    parsed.reason.length >= 3 &&
    parsed.reason.length <= 240 &&
    /^[a-zA-Z0-9][a-zA-Z0-9 ._:/#-]*$/u.test(parsed.reason) &&
    !parsed.action &&
    !parsed.platform &&
    !parsed.executor &&
    !parsed.confirm &&
    !parsed.verificationResult &&
    !parsed.environment;
  if (
    !validPrepare &&
    !validExecute &&
    !validStatus &&
    !validResume &&
    !validInspect &&
    !validInvalidate
  ) {
    throw new CandidateError("invalid_arguments", USAGE, 2);
  }
  return parsed;
}

async function readJson(path, code = "invalid_json") {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") fail(code, `${path} does not exist.`);
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch {
    fail(code, `${path} is not valid JSON.`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function fingerprint(value) {
  const buffer = Buffer.isBuffer(value)
    ? value
    : Buffer.from(JSON.stringify(canonicalize(value)));
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

async function inputFingerprints(root) {
  return Object.fromEntries(
    await Promise.all(
      INPUT_PATHS.map(async (path) => {
        let contents;
        try {
          contents = await readFile(resolve(root, path));
        } catch (error) {
          if (error.code === "ENOENT") {
            fail("missing_candidate_input", `Required candidate input ${path} is missing.`);
          }
          throw error;
        }
        return [path, fingerprint(contents)];
      }),
    ),
  );
}

function defaultBranch(root) {
  const reference = git(
    root,
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    "missing_default_branch",
  );
  const prefix = "refs/remotes/origin/";
  if (!reference.startsWith(prefix) || reference.length === prefix.length) {
    fail("missing_default_branch", "origin/HEAD does not identify the default branch.");
  }
  return reference.slice(prefix.length);
}

function synchronizedSource(root) {
  const repositoryRoot = resolve(git(root, ["rev-parse", "--show-toplevel"]));
  if (repositoryRoot !== root) {
    fail("wrong_directory", "Run the candidate coordinator from the repository root.");
  }
  const branch = defaultBranch(root);
  const fetch = run("git", ["fetch", "origin", branch], root);
  if (fetch.status !== 0) {
    fail(
      "source_fetch_failed",
      (fetch.stderr || fetch.stdout || `Could not fetch origin/${branch}.`).trim(),
    );
  }
  if (git(root, ["branch", "--show-current"]) !== branch) {
    fail(
      "source_not_default_branch",
      `Candidate preparation must run from the default branch ${branch}.`,
    );
  }
  if (git(root, ["status", "--porcelain", "--untracked-files=all"])) {
    fail("source_not_clean", "Candidate preparation requires a clean working tree.");
  }
  const revision = git(root, ["rev-parse", "HEAD"]);
  const remoteRevision = git(root, ["rev-parse", `origin/${branch}^{commit}`]);
  if (revision !== remoteRevision) {
    fail(
      "source_not_synced",
      `Candidate preparation requires ${branch} to match origin/${branch}.`,
    );
  }
  if (git(root, ["cat-file", "-t", revision]) !== "commit") {
    fail("source_not_immutable", `${revision} is not an immutable commit.`);
  }
  return { branch, revision };
}

async function synchronizedVersion(root) {
  const [rootPackage, rootLock, cliPackage, nativePackage, nativeLock, openapi] =
    await Promise.all([
      readJson(resolve(root, "package.json"), "invalid_release_input"),
      readJson(resolve(root, "package-lock.json"), "invalid_release_input"),
      readJson(resolve(root, "cli/package.json"), "invalid_release_input"),
      readJson(resolve(root, "native/package.json"), "invalid_release_input"),
      readJson(resolve(root, "native/package-lock.json"), "invalid_release_input"),
      readFile(resolve(root, "openapi/openapi.yaml"), "utf8"),
    ]);
  const version = rootPackage.version;
  const versions = [
    rootLock.version,
    rootLock.packages?.[""]?.version,
    cliPackage.version,
    nativePackage.version,
    nativeLock.version,
    nativeLock.packages?.[""]?.version,
  ];
  const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) ||
    versions.some((candidate) => candidate !== version) ||
    !new RegExp(`\\n\\s*version:\\s*${escaped}\\s*\\n`, "u").test(openapi)
  ) {
    fail(
      "release_version_mismatch",
      "Root, lockfile, CLI, native, and OpenAPI release versions must be synchronized.",
    );
  }
  return { nativePackage, rootPackage, version };
}

function verifiedResult(result, source) {
  assertSafeCandidateData(result);
  if (
    !result ||
    result.schemaVersion !== 1 ||
    result.requestedMode !== "release-candidate" ||
    result.effectiveMode !== "release-candidate" ||
    result.status !== "passed" ||
    result.headRevision !== source.revision ||
    result.sourceState?.branch !== source.branch ||
    result.sourceState?.defaultBranchParity !== "0 0" ||
    !Array.isArray(result.gates)
  ) {
    fail(
      "verification_not_eligible",
      "Preparation requires a passing release-candidate Verification Mode result for this synced revision.",
    );
  }
  const gateResults = new Map(result.gates.map((gate) => [gate.id, gate.outcome]));
  const missing = REQUIRED_VERIFICATION_GATES.filter(
    (gate) => !["passed", "reused"].includes(gateResults.get(gate)),
  );
  if (missing.length > 0) {
    fail(
      "verification_incomplete",
      `Release-candidate verification is missing passing proof for: ${missing.join(", ")}.`,
    );
  }
  if (
    !Array.isArray(result.externalActions) ||
    result.externalActions.some((action) => action.outcome !== "skipped")
  ) {
    fail(
      "verification_external_action",
      "Release-candidate verification must not perform an external release action.",
    );
  }
  const normalized = structuredClone(result);
  if (normalized.cache) delete normalized.cache.path;
  return normalized;
}

function assertSafeCandidateData(value, path = "verification") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeCandidateData(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      (/\bBearer\s+[A-Za-z0-9._~-]+/iu.test(value) ||
        /-----BEGIN [A-Z ]+PRIVATE KEY-----/u.test(value) ||
        /[?&](?:access_?token|refresh_?token|key|secret)=/iu.test(value))
    ) {
      fail("unsafe_candidate_data", `Authentication material is forbidden at ${path}.`);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.replaceAll(/[-_]/gu, "").toLowerCase();
    if (
      /^(?:password|secret|accesstoken|refreshtoken|idtoken|authorization|cookie|privatekey|taskcontent|groupcontent|personaldata|email|username)$/u.test(
        normalized,
      )
    ) {
      fail(
        "unsafe_candidate_data",
        `Credentials, personal data, Task content, and Group content are forbidden at ${path}.${key}.`,
      );
    }
    assertSafeCandidateData(item, `${path}.${key}`);
  }
}

function platformState(platform, identity, sourceRevision, inputFingerprint, version) {
  const isIos = platform === "ios";
  return {
    identity: {
      sourceRevision,
      inputFingerprint,
      version,
      buildProfile: identity.buildProfile,
      applicationId: isIos ? identity.ios.bundleId : identity.android.applicationId,
      buildNumber: null,
    },
    artifact: null,
    store: {
      appId: isIos ? identity.appleAppId : identity.googleAppId,
      buildId: null,
    },
    build: { state: "pending", requestKey: null, failure: null },
    submission: { state: "pending", requestKey: null, failure: null },
    processing: { state: "pending", failure: null },
    availability: { state: "pending", failure: null },
    physicalProof: { state: "pending", evidence: [] },
    promotion: { state: "pending", failure: null },
    evidence: [],
  };
}

function iosSigningMetadata(signing) {
  return {
    bundleId: signing.bundleId,
    distribution: signing.distribution,
    provider: signing.provider,
    certificate: signing.certificate
      ? {
          id: signing.certificate.id,
          expiresAt: signing.certificate.expiresAt,
          fingerprintSha256: signing.certificate.fingerprintSha256,
          publicKeySpkiSha256: signing.certificate.publicKeySpkiSha256,
          serial: signing.certificate.serial,
        }
      : null,
    profile: signing.profile
      ? {
          id: signing.profile.id,
          expiresAt: signing.profile.expiresAt,
          name: signing.profile.name,
          type: signing.profile.type,
          uuid: signing.profile.uuid,
        }
      : null,
    eas: signing.eas
      ? {
          credentialsSource: signing.eas.credentialsSource,
          syncedAt: signing.eas.syncedAt,
        }
      : null,
  };
}

function androidSigningMetadata(signing) {
  return {
    configurationId: signing.configurationId,
    createdAt: signing.createdAt,
    owner: signing.owner,
    provider: signing.provider,
    rotationReviewBy: signing.rotationReviewBy,
    sha1Fingerprint: signing.sha1Fingerprint,
    sha256Fingerprint: signing.sha256Fingerprint,
  };
}

function easProfileMetadata(profile, profileFingerprint) {
  return {
    fingerprint: profileFingerprint,
    autoIncrement: profile.autoIncrement,
    distribution: profile.distribution,
    environment: profile.environment,
    android: profile.android
      ? { buildType: profile.android.buildType }
      : undefined,
    ios: profile.ios
      ? { credentialsSource: profile.ios.credentialsSource }
      : undefined,
  };
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function withRecordLock(path, operation) {
  const lockPath = `${path}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await mkdir(lockPath);
      await writeFile(
        resolve(lockPath, "owner.json"),
        `${JSON.stringify({
          createdAt: new Date().toISOString(),
          hostname: hostname(),
          pid: process.pid,
        })}\n`,
        { mode: 0o600 },
      );
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try {
        owner = JSON.parse(await readFile(resolve(lockPath, "owner.json"), "utf8"));
      } catch (ownerError) {
        if (
          !["ENOENT", "ENOTDIR"].includes(ownerError.code) &&
          !(ownerError instanceof SyntaxError)
        ) {
          throw ownerError;
        }
      }
      const ownerAge = Date.now() - Date.parse(owner?.createdAt ?? "");
      let ownerIsAlive = true;
      if (owner?.hostname === hostname() && Number.isInteger(owner?.pid)) {
        try {
          process.kill(owner.pid, 0);
        } catch (processError) {
          if (processError.code === "ESRCH") ownerIsAlive = false;
        }
      }
      if (!ownerIsAlive || ownerAge > 15 * 60 * 1000) {
        await rm(lockPath, { recursive: true });
        continue;
      }
      await delay(25);
    }
  }
  if (!acquired) {
    fail("candidate_locked", "Another candidate coordinator still owns this record.");
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true });
  }
}

async function existingRecord(path) {
  try {
    return await readJson(path, "corrupted_candidate_record");
  } catch (error) {
    if (error.code === "corrupted_candidate_record" && /does not exist/u.test(error.message)) {
      return null;
    }
    throw error;
  }
}

function validRecord(record) {
  if (
    !record ||
    record.schemaVersion !== 1 ||
    typeof record.candidate?.id !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(record.candidate?.identityFingerprint) ||
    !/^[a-f0-9]{40,64}$/u.test(record.candidate?.sourceRevision) ||
    typeof record.candidate?.version !== "string" ||
    !record.verification?.result ||
    record.verification.result.status !== "passed" ||
    !/^sha256:[a-f0-9]{64}$/u.test(record.verification?.fingerprint) ||
    !record.platforms?.ios ||
    !record.platforms?.android ||
    !Array.isArray(record.events) ||
    !record.releaseProof ||
    !Array.isArray(record.releaseProof.evidence) ||
    !Array.isArray(record.releaseProof.privacyDiscrepancies)
  ) {
    return false;
  }
  const workflowStates = new Set(["pending", "requested", "failed", "succeeded"]);
  const storeStates = new Set(["pending", "failed", "succeeded"]);
  for (const platformName of ["ios", "android"]) {
    const platform = record.platforms[platformName];
    if (
      platform.identity?.sourceRevision !== record.candidate.sourceRevision ||
      platform.identity?.inputFingerprint !== record.candidate.identityFingerprint ||
      platform.identity?.version !== record.candidate.version ||
      !workflowStates.has(platform.build?.state) ||
      !workflowStates.has(platform.submission?.state) ||
      !storeStates.has(platform.processing?.state) ||
      !storeStates.has(platform.availability?.state) ||
      !workflowStates.has(platform.physicalProof?.state) ||
      !workflowStates.has(platform.promotion?.state) ||
      !Array.isArray(platform.physicalProof?.evidence) ||
      !Array.isArray(platform.evidence)
    ) {
      return false;
    }
    if (platform.build.state === "succeeded") {
      if (
        !platform.artifact ||
        platform.artifact.sourceRevision !== record.candidate.sourceRevision ||
        platform.artifact.inputFingerprint !== record.candidate.identityFingerprint ||
        platform.artifact.version !== record.candidate.version ||
        platform.artifact.buildNumber !== platform.identity.buildNumber ||
        typeof platform.artifact.id !== "string" ||
        typeof platform.artifact.easBuildId !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(platform.artifact.checksum)
      ) {
        return false;
      }
    }
    if (platform.submission.state === "succeeded" && !platform.submission.id) {
      return false;
    }
  }
  return ["missing", "requested", "failed", "blocked", "succeeded"].includes(
    record.releaseProof.state,
  );
}

async function readRecord(path) {
  const record = await readJson(path, "corrupted_candidate_record");
  if (!validRecord(record)) {
    fail("corrupted_candidate_record", "The candidate record has an invalid schema.");
  }
  assertSafeCandidateData(record, "candidateRecord");
  return record;
}

async function currentCandidateMismatch(root, record) {
  try {
    const source = synchronizedSource(root);
    const [{ version }, selectedInputFingerprints, privacy] = await Promise.all([
      synchronizedVersion(root),
      inputFingerprints(root),
      readJson(
        resolve(root, "config/release-privacy-inventory.json"),
        "invalid_release_input",
      ),
    ]);
    if (version !== record.candidate.version) return "the synchronized version changed";
    if (
      JSON.stringify(selectedInputFingerprints) !==
      JSON.stringify(record.candidate.selectedInputFingerprints)
    ) {
      return "a dependency, native configuration, signing, permission, or privacy input changed";
    }
    if (
      releasePrivacyFingerprint(privacy) !==
      record.candidate.releasePrivacyInventoryFingerprint
    ) {
      return "the Release Privacy Inventory changed";
    }
    if (source.revision !== record.candidate.sourceRevision) {
      return "the source revision changed";
    }
    if (
      record.candidate.toolVersions?.node &&
      record.candidate.toolVersions.node !== process.version
    ) {
      return "the Node.js runtime changed after verification";
    }
    return null;
  } catch (error) {
    if (error instanceof CandidateError) return error.message;
    throw error;
  }
}

async function assertCurrentCandidate(root, path, record) {
  const mismatch = await currentCandidateMismatch(root, record);
  if (!mismatch) return;
  const now = new Date().toISOString();
  record.invalidation = {
    at: now,
    code: "candidate_inputs_changed",
    reason: mismatch,
  };
  record.updatedAt = now;
  record.events.push({ at: now, type: "candidate-invalidated", reason: mismatch });
  await atomicWrite(path, record);
  fail(
    "candidate_invalidated",
    `Release Candidate ${record.candidate.id} is invalid: ${mismatch}. Prepare a new identity.`,
  );
}

function confirmationToken(record, action, platform) {
  const suffix = fingerprint({
    action,
    candidate: record.candidate.id,
    platform,
  }).slice("sha256:".length, "sha256:".length + 12);
  return `${record.candidate.id}:${action}:${platform}:${suffix}`;
}

function executeExternal(executor, request, root) {
  const result = spawnSync(process.execPath, [executor], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    input: `${JSON.stringify(request)}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error) {
    return {
      status: "failed",
      failure: {
        classification: "resumable",
        code: "executor_start_failed",
        message: "The candidate executor could not start; inspect its local logs.",
        service: "eas",
      },
    };
  }
  if (result.status !== 0) {
    return {
      status: "failed",
      failure: {
        classification: "resumable",
        code: "executor_failed",
        message: "The candidate executor failed; inspect its local logs.",
        service: "eas",
      },
    };
  }
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    return {
      status: "failed",
      failure: {
        classification: "resumable",
        code: "executor_invalid_response",
        message: "Candidate executor returned invalid JSON.",
        service: "eas",
      },
    };
  }
  if (response.schemaVersion !== 1 || response.status !== "succeeded") {
    const requestedCode = response.failure?.code;
    const code =
      typeof requestedCode === "string" &&
      /^[a-z][a-z0-9_]{1,63}$/u.test(requestedCode)
        ? requestedCode
        : "executor_failed";
    const messages = {
      authentication_expired: "External authentication expired and can be renewed before resume.",
      executor_failed: "The external candidate step failed and can be resumed from local logs.",
      network_timeout: "The external service timed out; resume the same recorded step.",
      processing_delayed: "Store processing is delayed; resume status polling later.",
      rate_limited: "The external service rate-limited the request; resume the same step later.",
      service_unavailable: "The external service is unavailable; resume the same step later.",
    };
    return {
      status: "failed",
      failure: {
        classification: response.failure?.classification === "terminal"
          ? "terminal"
          : "resumable",
        code,
        message: messages[code] ?? messages.executor_failed,
        service: "eas",
      },
    };
  }
  return response;
}

function validBuildResponse(response, record) {
  return Boolean(
    response.sourceRevision === record.candidate.sourceRevision &&
      response.inputFingerprint === record.candidate.identityFingerprint &&
      response.version === record.candidate.version &&
      typeof response.buildNumber === "string" &&
      typeof response.easBuildId === "string" &&
      typeof response.artifact?.id === "string" &&
      /^sha256:[a-f0-9]{64}$/u.test(response.artifact?.checksum)
  );
}

function matchesCandidateResponse(response, record) {
  return Boolean(
    response.sourceRevision === record.candidate.sourceRevision &&
      response.inputFingerprint === record.candidate.identityFingerprint &&
      response.version === record.candidate.version
  );
}

function safeEvidenceReference(reference) {
  if (
    typeof reference !== "string" ||
    reference.length > 240 ||
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(reference)
  ) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(reference);
  } catch {
    return false;
  }
  return (
    ["https:", "local:", "executor:"].includes(parsed.protocol) &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search
  );
}

function safeEvidenceReferences(references) {
  return (
    Array.isArray(references) &&
    references.length > 0 &&
    references.every(safeEvidenceReference)
  );
}

function executorCandidate(record) {
  return {
    id: record.candidate.id,
    identityFingerprint: record.candidate.identityFingerprint,
    sourceRevision: record.candidate.sourceRevision,
    version: record.candidate.version,
    environment: record.candidate.environment,
    native: record.candidate.native,
  };
}

function failureService(action, platform) {
  if (action === "build") return "eas";
  return platform === "ios" ? "apple" : "google";
}

async function executeBuild(parsed, root) {
  const recordPath = resolve(root, parsed.record);
  let record = await readRecord(recordPath);
  if (record.invalidation) {
    fail(
      "candidate_invalidated",
      `Release Candidate ${record.candidate.id} is invalid: ${record.invalidation.reason}.`,
    );
  }
  await assertCurrentCandidate(root, recordPath, record);
  const token = confirmationToken(record, parsed.action, parsed.platform);
  if (!parsed.confirm) {
    return {
      schemaVersion: 1,
      status: "preview",
      candidateId: record.candidate.id,
      action: parsed.action,
      platform: parsed.platform,
      confirmationToken: token,
      reason: "Pass this exact token with --confirm to permit one external build action.",
      externalActionRan: false,
    };
  }
  if (parsed.confirm !== token) {
    fail("confirmation_mismatch", "The external action confirmation token does not match this candidate step.");
  }
  return withRecordLock(recordPath, async () => {
    record = await readRecord(recordPath);
    if (record.invalidation) {
      fail("candidate_invalidated", `Release Candidate ${record.candidate.id} is invalid.`);
    }
    await assertCurrentCandidate(root, recordPath, record);
    const platform = record.platforms[parsed.platform];
    if (platform.build.state === "succeeded") {
      return {
        schemaVersion: 1,
        status: "reused",
        candidateId: record.candidate.id,
        action: "build",
        platform: parsed.platform,
        reason: "The successful Candidate Artifact already matches this immutable identity; no rebuild occurred.",
        externalActionRan: false,
      };
    }
    const now = new Date().toISOString();
    const requestKey =
      platform.build.requestKey ?? `${record.candidate.id}:${parsed.platform}:build`;
    platform.build = {
      state: "requested",
      requestKey,
      failure: null,
      requestedAt: platform.build.requestedAt ?? now,
    };
    record.updatedAt = now;
    record.events.push({
      at: now,
      type: "build-requested",
      platform: parsed.platform,
      requestKey,
    });
    await atomicWrite(recordPath, record);
    const response = executeExternal(resolve(root, parsed.executor), {
      schemaVersion: 1,
      action: "build",
      platform: parsed.platform,
      requestKey,
      candidate: executorCandidate(record),
    }, root);
    const completedAt = new Date().toISOString();
    if (response.status !== "succeeded" || !validBuildResponse(response, record)) {
      const failure = response.status === "succeeded"
        ? {
            classification: "terminal",
            code: "artifact_identity_mismatch",
            message: "The executor artifact does not match the frozen candidate identity.",
            service: "eas",
          }
        : response.failure;
      if (failure.code === "artifact_identity_mismatch") {
        platform.mismatch = failure.message;
      }
      platform.build = {
        ...platform.build,
        state: "failed",
        failure,
        failedAt: completedAt,
      };
      record.updatedAt = completedAt;
      record.events.push({
        at: completedAt,
        type: "build-failed",
        platform: parsed.platform,
        reason: failure.message,
      });
      await atomicWrite(recordPath, record);
      fail(failure.code, failure.message);
    }
    platform.identity.buildNumber = response.buildNumber;
    delete platform.mismatch;
    platform.artifact = {
      id: response.artifact.id,
      easBuildId: response.easBuildId,
      checksum: response.artifact.checksum,
      sourceRevision: response.sourceRevision,
      inputFingerprint: response.inputFingerprint,
      version: response.version,
      buildNumber: response.buildNumber,
    };
    platform.build = {
      ...platform.build,
      state: "succeeded",
      failure: null,
      succeededAt: completedAt,
    };
    platform.evidence.push(`executor://eas/build/${response.easBuildId}`);
    record.updatedAt = completedAt;
    record.events.push({
      at: completedAt,
      type: "build-succeeded",
      platform: parsed.platform,
      artifactId: response.artifact.id,
    });
    await atomicWrite(recordPath, record);
    return {
      schemaVersion: 1,
      status: "succeeded",
      candidateId: record.candidate.id,
      action: "build",
      platform: parsed.platform,
      artifactId: response.artifact.id,
      externalActionRan: true,
    };
  });
}

async function executeSubmit(parsed, root) {
  const recordPath = resolve(root, parsed.record);
  let record = await readRecord(recordPath);
  if (record.invalidation) {
    fail("candidate_invalidated", `Release Candidate ${record.candidate.id} is invalid.`);
  }
  await assertCurrentCandidate(root, recordPath, record);
  const platform = record.platforms[parsed.platform];
  if (platform.build.state !== "succeeded" || !platform.artifact) {
    fail("artifact_missing", `Build ${parsed.platform} before submission.`);
  }
  if (platform.submission.state === "succeeded") {
    return {
      schemaVersion: 1,
      status: "reused",
      candidateId: record.candidate.id,
      action: "submit",
      platform: parsed.platform,
      reason: "The recorded Candidate Artifact was already submitted; no duplicate submission occurred.",
      externalActionRan: false,
    };
  }
  const token = confirmationToken(record, "submit", parsed.platform);
  if (!parsed.confirm) {
    return {
      schemaVersion: 1,
      status: "preview",
      candidateId: record.candidate.id,
      action: "submit",
      platform: parsed.platform,
      artifactId: platform.artifact.id,
      confirmationToken: token,
      reason: "Pass this exact token with --confirm to submit the recorded Candidate Artifact.",
      externalActionRan: false,
    };
  }
  if (parsed.confirm !== token) {
    fail("confirmation_mismatch", "The external action confirmation token does not match this candidate step.");
  }
  return withRecordLock(recordPath, async () => {
    record = await readRecord(recordPath);
    await assertCurrentCandidate(root, recordPath, record);
    const current = record.platforms[parsed.platform];
    if (current.submission.state === "succeeded") {
      return {
        schemaVersion: 1,
        status: "reused",
        candidateId: record.candidate.id,
        action: "submit",
        platform: parsed.platform,
        reason: "The recorded Candidate Artifact was already submitted; no duplicate submission occurred.",
        externalActionRan: false,
      };
    }
    if (current.build.state !== "succeeded" || !current.artifact) {
      fail("artifact_missing", `Build ${parsed.platform} before submission.`);
    }
    const now = new Date().toISOString();
    const requestKey =
      current.submission.requestKey ?? `${record.candidate.id}:${parsed.platform}:submit`;
    current.submission = {
      state: "requested",
      requestKey,
      failure: null,
      requestedAt: current.submission.requestedAt ?? now,
    };
    record.updatedAt = now;
    record.events.push({
      at: now,
      type: "submission-requested",
      platform: parsed.platform,
      requestKey,
      artifactId: current.artifact.id,
    });
    await atomicWrite(recordPath, record);
    const response = executeExternal(resolve(root, parsed.executor), {
      schemaVersion: 1,
      action: "submit",
      platform: parsed.platform,
      requestKey,
      candidate: executorCandidate(record),
      artifact: current.artifact,
      store: current.store,
    }, root);
    const completedAt = new Date().toISOString();
    const valid =
      response.status === "succeeded" &&
      matchesCandidateResponse(response, record) &&
      typeof response.submissionId === "string" &&
      typeof response.storeBuildId === "string";
    if (!valid) {
      const failure = response.status === "succeeded"
        ? {
            classification: "terminal",
            code: "submission_identity_mismatch",
            message: "The store submission does not match the frozen Candidate Artifact.",
            service: failureService("submit", parsed.platform),
          }
        : {
            ...response.failure,
            service: failureService("submit", parsed.platform),
          };
      if (failure.code === "submission_identity_mismatch") {
        current.mismatch = failure.message;
      }
      current.submission = {
        ...current.submission,
        state: "failed",
        failure,
        failedAt: completedAt,
      };
      record.updatedAt = completedAt;
      record.events.push({
        at: completedAt,
        type: "submission-failed",
        platform: parsed.platform,
        reason: failure.message,
      });
      await atomicWrite(recordPath, record);
      fail(failure.code, failure.message);
    }
    current.submission = {
      ...current.submission,
      state: "succeeded",
      id: response.submissionId,
      failure: null,
      succeededAt: completedAt,
    };
    delete current.mismatch;
    current.store.buildId = response.storeBuildId;
    current.evidence.push(
      `executor://${failureService("submit", parsed.platform)}/submission/${response.submissionId}`,
    );
    record.updatedAt = completedAt;
    record.events.push({
      at: completedAt,
      type: "submission-succeeded",
      platform: parsed.platform,
      submissionId: response.submissionId,
    });
    await atomicWrite(recordPath, record);
    return {
      schemaVersion: 1,
      status: "succeeded",
      candidateId: record.candidate.id,
      action: "submit",
      platform: parsed.platform,
      submissionId: response.submissionId,
      externalActionRan: true,
    };
  });
}

async function status(parsed, root) {
  const recordPath = resolve(root, parsed.record);
  return withRecordLock(recordPath, async () => {
    const record = await readRecord(recordPath);
    if (record.invalidation) {
      fail("candidate_invalidated", `Release Candidate ${record.candidate.id} is invalid.`);
    }
    await assertCurrentCandidate(root, recordPath, record);
    const platform = record.platforms[parsed.platform];
    if (platform.submission.state !== "succeeded") {
      fail("submission_missing", `Submit ${parsed.platform} before checking store status.`);
    }
    if (
      platform.processing.state === "succeeded" &&
      platform.availability.state === "succeeded"
    ) {
      return {
        schemaVersion: 1,
        status: "reused",
        candidateId: record.candidate.id,
        action: "status",
        platform: parsed.platform,
        reason: "Processing and internal-store availability are already recorded as successful.",
        externalActionRan: false,
      };
    }
    const requestKey = `${record.candidate.id}:${parsed.platform}:status`;
    const response = executeExternal(resolve(root, parsed.executor), {
      schemaVersion: 1,
      action: "status",
      platform: parsed.platform,
      requestKey,
      candidate: executorCandidate(record),
      artifact: platform.artifact,
      store: platform.store,
      submissionId: platform.submission.id,
    }, root);
    const now = new Date().toISOString();
    const valid =
      response.status === "succeeded" &&
      matchesCandidateResponse(response, record) &&
      response.storeBuildId === platform.store.buildId &&
      ["pending", "failed", "succeeded"].includes(response.processing) &&
      ["pending", "failed", "succeeded"].includes(response.availability);
    if (!valid) {
      const failure = response.status === "succeeded"
        ? {
            classification: "terminal",
            code: "store_identity_mismatch",
            message: "Store status does not identify the recorded Candidate Artifact.",
            service: failureService("submit", parsed.platform),
          }
        : {
            ...response.failure,
            service: failureService("submit", parsed.platform),
          };
      if (failure.code === "store_identity_mismatch") {
        platform.mismatch = failure.message;
      }
      const target = platform.processing.state === "succeeded"
        ? platform.availability
        : platform.processing;
      if (target.state !== "succeeded") {
        target.state = "failed";
        target.failure = failure;
        target.failedAt = now;
      }
      record.updatedAt = now;
      record.events.push({
        at: now,
        type: "store-status-failed",
        platform: parsed.platform,
        reason: failure.message,
      });
      await atomicWrite(recordPath, record);
      fail(failure.code, failure.message);
    }
    if (platform.processing.state !== "succeeded") {
      platform.processing = {
        state: response.processing,
        failure: response.processing === "failed"
          ? {
              classification: "resumable",
              code: "store_processing_failed",
              message: "Store processing has not succeeded.",
              service: failureService("submit", parsed.platform),
            }
          : null,
        checkedAt: now,
      };
    }
    delete platform.mismatch;
    if (platform.availability.state !== "succeeded") {
      platform.availability = {
        state: response.availability,
        failure: response.availability === "failed"
          ? {
              classification: "resumable",
              code: "store_availability_failed",
              message: "Internal-store availability has not succeeded.",
              service: failureService("submit", parsed.platform),
            }
          : null,
        checkedAt: now,
      };
    }
    record.updatedAt = now;
    record.events.push({
      at: now,
      type: "store-status-recorded",
      platform: parsed.platform,
      processing: platform.processing.state,
      availability: platform.availability.state,
    });
    await atomicWrite(recordPath, record);
    const succeeded =
      platform.processing.state === "succeeded" &&
      platform.availability.state === "succeeded";
    return {
      schemaVersion: 1,
      status: succeeded ? "succeeded" : "pending",
      candidateId: record.candidate.id,
      action: "status",
      platform: parsed.platform,
      processing: platform.processing.state,
      availability: platform.availability.state,
      externalActionRan: true,
    };
  });
}

async function resume(parsed, root) {
  const record = await readRecord(resolve(root, parsed.record));
  const platform = record.platforms[parsed.platform];
  if (platform.build.state !== "succeeded") {
    return executeBuild({ ...parsed, action: "build" }, root);
  }
  if (platform.submission.state !== "succeeded") {
    return executeSubmit({ ...parsed, action: "submit" }, root);
  }
  if (
    platform.processing.state !== "succeeded" ||
    platform.availability.state !== "succeeded"
  ) {
    if (parsed.confirm) {
      fail("confirmation_not_applicable", "Store status resumption does not accept a confirmation token.");
    }
    return status({ ...parsed, action: "status" }, root);
  }
  return executePhysicalProof({ ...parsed, action: "physical-proof" }, root);
}

async function executePhysicalProof(parsed, root) {
  const recordPath = resolve(root, parsed.record);
  let record = await readRecord(recordPath);
  if (record.invalidation) {
    fail("candidate_invalidated", `Release Candidate ${record.candidate.id} is invalid.`);
  }
  await assertCurrentCandidate(root, recordPath, record);
  let platform = record.platforms[parsed.platform];
  if (platform.availability.state !== "succeeded") {
    fail(
      "artifact_unavailable",
      `${parsed.platform} must be available through its internal store before physical proof.`,
    );
  }
  if (platform.physicalProof.state === "succeeded") {
    return {
      schemaVersion: 1,
      status: "reused",
      candidateId: record.candidate.id,
      action: "physical-proof",
      platform: parsed.platform,
      reason: "Physical proof already identifies this exact Candidate Artifact.",
      externalActionRan: false,
    };
  }
  const token = confirmationToken(record, "physical-proof", parsed.platform);
  if (!parsed.confirm) {
    return {
      schemaVersion: 1,
      status: "preview",
      candidateId: record.candidate.id,
      action: "physical-proof",
      platform: parsed.platform,
      artifactId: platform.artifact.id,
      confirmationToken: token,
      reason: "Confirm collection of non-secret #41 physical evidence for this exact artifact.",
      externalActionRan: false,
    };
  }
  if (parsed.confirm !== token) {
    fail("confirmation_mismatch", "The external action confirmation token does not match this candidate step.");
  }
  return withRecordLock(recordPath, async () => {
    record = await readRecord(recordPath);
    await assertCurrentCandidate(root, recordPath, record);
    platform = record.platforms[parsed.platform];
    if (platform.physicalProof.state === "succeeded") {
      return {
        schemaVersion: 1,
        status: "reused",
        candidateId: record.candidate.id,
        action: "physical-proof",
        platform: parsed.platform,
        reason: "Physical proof already identifies this exact Candidate Artifact.",
        externalActionRan: false,
      };
    }
    if (platform.availability.state !== "succeeded") {
      fail("artifact_unavailable", `${parsed.platform} is not available for physical proof.`);
    }
    const now = new Date().toISOString();
    const requestKey =
      platform.physicalProof.requestKey ??
      `${record.candidate.id}:${parsed.platform}:physical-proof`;
    platform.physicalProof = {
      ...platform.physicalProof,
      state: "requested",
      requestKey,
      failure: null,
      requestedAt: platform.physicalProof.requestedAt ?? now,
    };
    record.updatedAt = now;
    await atomicWrite(recordPath, record);
    const response = executeExternal(resolve(root, parsed.executor), {
      schemaVersion: 1,
      action: "physical-proof",
      platform: parsed.platform,
      requestKey,
      candidate: executorCandidate(record),
      artifact: platform.artifact,
      store: platform.store,
    }, root);
    const completedAt = new Date().toISOString();
    const valid =
      response.status === "succeeded" &&
      matchesCandidateResponse(response, record) &&
      response.artifactId === platform.artifact.id &&
      safeEvidenceReferences(response.evidenceReferences);
    if (!valid) {
      const failure = response.status === "succeeded"
        ? {
            classification: "terminal",
            code: "physical_proof_mismatch",
            message: "Physical evidence is unsafe or does not identify the recorded Candidate Artifact.",
            service: "evidence",
          }
        : { ...response.failure, service: "evidence" };
      platform.physicalProof = {
        ...platform.physicalProof,
        state: "failed",
        failure,
        failedAt: completedAt,
      };
      record.updatedAt = completedAt;
      record.events.push({
        at: completedAt,
        type: "physical-proof-failed",
        platform: parsed.platform,
        reason: failure.message,
      });
      await atomicWrite(recordPath, record);
      fail(failure.code, failure.message);
    }
    platform.physicalProof = {
      ...platform.physicalProof,
      state: "succeeded",
      failure: null,
      evidence: response.evidenceReferences,
      succeededAt: completedAt,
    };
    platform.evidence.push(...response.evidenceReferences);
    record.updatedAt = completedAt;
    record.events.push({
      at: completedAt,
      type: "physical-proof-succeeded",
      platform: parsed.platform,
      artifactId: platform.artifact.id,
    });
    await atomicWrite(recordPath, record);
    return {
      schemaVersion: 1,
      status: "succeeded",
      candidateId: record.candidate.id,
      action: "physical-proof",
      platform: parsed.platform,
      evidenceReferences: response.evidenceReferences,
      externalActionRan: true,
    };
  });
}

function validReviewItems(items, kind) {
  if (!Array.isArray(items)) return false;
  return items.every((item) => {
    if (!item || typeof item.id !== "string" || item.id.length > 120) return false;
    if (item.evidence && !safeEvidenceReference(item.evidence)) return false;
    if (kind === "discrepancy") return ["resolved", "unresolved"].includes(item.state);
    return typeof item.approved === "boolean";
  });
}

async function executeReleaseProof(parsed, root) {
  const recordPath = resolve(root, parsed.record);
  let record = await readRecord(recordPath);
  if (record.invalidation) {
    fail("candidate_invalidated", `Release Candidate ${record.candidate.id} is invalid.`);
  }
  await assertCurrentCandidate(root, recordPath, record);
  const missing = ["ios", "android"].filter(
    (platform) => record.platforms[platform].physicalProof.state !== "succeeded",
  );
  if (missing.length > 0) {
    fail(
      "physical_proof_incomplete",
      `Complete physical proof before #41 handoff: ${missing.join(", ")}.`,
    );
  }
  if (record.releaseProof.state === "succeeded") {
    return {
      schemaVersion: 1,
      status: "reused",
      candidateId: record.candidate.id,
      action: "release-proof",
      platform: "all",
      reason: "#41 Release Proof is already recorded for this candidate.",
      externalActionRan: false,
    };
  }
  const token = confirmationToken(record, "release-proof", "all");
  if (!parsed.confirm) {
    return {
      schemaVersion: 1,
      status: "preview",
      candidateId: record.candidate.id,
      action: "release-proof",
      platform: "all",
      confirmationToken: token,
      reason: "Confirm collection of #41 and privacy reconciliation state for the same candidate record.",
      externalActionRan: false,
    };
  }
  if (parsed.confirm !== token) {
    fail("confirmation_mismatch", "The external action confirmation token does not match this candidate step.");
  }
  return withRecordLock(recordPath, async () => {
    record = await readRecord(recordPath);
    await assertCurrentCandidate(root, recordPath, record);
    if (record.releaseProof.state === "succeeded") {
      return {
        schemaVersion: 1,
        status: "reused",
        candidateId: record.candidate.id,
        action: "release-proof",
        platform: "all",
        reason: "#41 Release Proof is already recorded for this candidate.",
        externalActionRan: false,
      };
    }
    const now = new Date().toISOString();
    const requestKey =
      record.releaseProof.requestKey ?? `${record.candidate.id}:all:release-proof`;
    record.releaseProof.state = "requested";
    record.releaseProof.requestKey = requestKey;
    record.releaseProof.failure = null;
    record.releaseProof.requestedAt ??= now;
    record.updatedAt = now;
    await atomicWrite(recordPath, record);
    const response = executeExternal(resolve(root, parsed.executor), {
      schemaVersion: 1,
      action: "release-proof",
      platform: "all",
      requestKey,
      candidate: executorCandidate(record),
      platforms: record.platforms,
      releaseProofIssue: 41,
    }, root);
    const completedAt = new Date().toISOString();
    const valid =
      response.status === "succeeded" &&
      matchesCandidateResponse(response, record) &&
      response.issue === 41 &&
      safeEvidenceReferences(response.evidenceReferences) &&
      validReviewItems(response.privacyDiscrepancies, "discrepancy") &&
      validReviewItems(response.limitations, "limitation");
    if (!valid) {
      const failure = response.status === "succeeded"
        ? {
            classification: "terminal",
            code: "release_proof_mismatch",
            message: "#41 evidence is unsafe, incomplete, or identifies another candidate.",
            service: "github",
          }
        : { ...response.failure, service: "github" };
      record.releaseProof.state = "failed";
      record.releaseProof.failure = failure;
      record.releaseProof.failedAt = completedAt;
      record.updatedAt = completedAt;
      record.events.push({
        at: completedAt,
        type: "release-proof-failed",
        reason: failure.message,
      });
      await atomicWrite(recordPath, record);
      fail(failure.code, failure.message);
    }
    const unresolved = response.privacyDiscrepancies.some(
      (item) => item.state !== "resolved",
    );
    const unapproved = response.limitations.some((item) => !item.approved);
    record.releaseProof.state = unresolved || unapproved ? "blocked" : "succeeded";
    record.releaseProof.failure = null;
    record.releaseProof.evidence = response.evidenceReferences;
    record.releaseProof.privacyDiscrepancies = response.privacyDiscrepancies;
    record.releaseProof.limitations = response.limitations;
    record.releaseProof.succeededAt = completedAt;
    record.updatedAt = completedAt;
    record.events.push({ at: completedAt, type: "release-proof-succeeded", issue: 41 });
    await atomicWrite(recordPath, record);
    return {
      schemaVersion: 1,
      status: "succeeded",
      candidateId: record.candidate.id,
      action: "release-proof",
      platform: "all",
      issue: 41,
      externalActionRan: true,
    };
  });
}

async function executePromotion(parsed, root) {
  const recordPath = resolve(root, parsed.record);
  let record = await readRecord(recordPath);
  await assertCurrentCandidate(root, recordPath, record);
  const blockers = promotionBlockers(record);
  if (blockers.length > 0) {
    fail("promotion_blocked", `Coequal promotion refused: ${blockers.join("; ")}.`);
  }
  if (["ios", "android"].every(
    (platform) => record.platforms[platform].promotion.state === "succeeded",
  )) {
    return {
      schemaVersion: 1,
      status: "reused",
      candidateId: record.candidate.id,
      action: "promote",
      platform: "all",
      reason: "Both coequal promotion results are already recorded.",
      externalActionRan: false,
    };
  }
  const token = confirmationToken(record, "promote", "all");
  if (!parsed.confirm) {
    return {
      schemaVersion: 1,
      status: "preview",
      candidateId: record.candidate.id,
      action: "promote",
      platform: "all",
      confirmationToken: token,
      reason: "Confirm one coequal promotion action for both fully proven Candidate Artifacts.",
      externalActionRan: false,
    };
  }
  if (parsed.confirm !== token) {
    fail("confirmation_mismatch", "The external action confirmation token does not match this candidate step.");
  }
  return withRecordLock(recordPath, async () => {
    record = await readRecord(recordPath);
    await assertCurrentCandidate(root, recordPath, record);
    const currentBlockers = promotionBlockers(record);
    if (currentBlockers.length > 0) {
      fail("promotion_blocked", `Coequal promotion refused: ${currentBlockers.join("; ")}.`);
    }
    const now = new Date().toISOString();
    const requestKey = `${record.candidate.id}:all:promote`;
    for (const platform of ["ios", "android"]) {
      record.platforms[platform].promotion = {
        ...record.platforms[platform].promotion,
        state: "requested",
        requestKey,
        failure: null,
        requestedAt: record.platforms[platform].promotion.requestedAt ?? now,
      };
    }
    record.updatedAt = now;
    await atomicWrite(recordPath, record);
    const response = executeExternal(resolve(root, parsed.executor), {
      schemaVersion: 1,
      action: "promote",
      platform: "all",
      requestKey,
      candidate: executorCandidate(record),
      platforms: record.platforms,
      releaseProof: record.releaseProof,
    }, root);
    const completedAt = new Date().toISOString();
    const valid =
      response.status === "succeeded" &&
      matchesCandidateResponse(response, record) &&
      ["ios", "android"].every(
        (platform) => typeof response.platforms?.[platform]?.promotionId === "string",
      );
    if (!valid) {
      const failure = response.status === "succeeded"
        ? {
            classification: "terminal",
            code: "coequal_promotion_mismatch",
            message: "Promotion did not return matching results for both coequal platforms.",
            service: "store",
          }
        : { ...response.failure, service: "store" };
      for (const platform of ["ios", "android"]) {
        if (record.platforms[platform].promotion.state !== "succeeded") {
          record.platforms[platform].promotion = {
            ...record.platforms[platform].promotion,
            state: "failed",
            failure,
            failedAt: completedAt,
          };
        }
      }
      record.updatedAt = completedAt;
      record.events.push({
        at: completedAt,
        type: "promotion-failed",
        reason: failure.message,
      });
      await atomicWrite(recordPath, record);
      fail(failure.code, failure.message);
    }
    for (const platform of ["ios", "android"]) {
      record.platforms[platform].promotion = {
        ...record.platforms[platform].promotion,
        state: "succeeded",
        id: response.platforms[platform].promotionId,
        failure: null,
        succeededAt: completedAt,
      };
    }
    record.updatedAt = completedAt;
    record.events.push({ at: completedAt, type: "promotion-succeeded" });
    await atomicWrite(recordPath, record);
    return {
      schemaVersion: 1,
      status: "succeeded",
      candidateId: record.candidate.id,
      action: "promote",
      platform: "all",
      externalActionRan: true,
    };
  });
}

async function inspect(parsed, root) {
  const record = await readRecord(resolve(root, parsed.record));
  return {
    schemaVersion: 1,
    status: record.invalidation ? "invalidated" : "valid",
    candidate: record.candidate,
    verification: record.verification,
    platforms: record.platforms,
    releaseProof: record.releaseProof,
    invalidation: record.invalidation,
    externalActionRan: false,
  };
}

async function invalidate(parsed, root) {
  const recordPath = resolve(root, parsed.record);
  return withRecordLock(recordPath, async () => {
    const record = await readRecord(recordPath);
    if (record.invalidation) {
      if (record.invalidation.reason !== parsed.reason) {
        fail(
          "already_invalidated",
          `Release Candidate ${record.candidate.id} was already invalidated: ${record.invalidation.reason}.`,
        );
      }
      return {
        schemaVersion: 1,
        status: "reused",
        candidateId: record.candidate.id,
        reason: record.invalidation.reason,
        externalActionRan: false,
      };
    }
    const now = new Date().toISOString();
    record.invalidation = {
      at: now,
      code: "operator_invalidated",
      reason: parsed.reason,
    };
    record.updatedAt = now;
    record.events.push({
      at: now,
      type: "candidate-invalidated",
      reason: parsed.reason,
    });
    await atomicWrite(recordPath, record);
    return {
      schemaVersion: 1,
      status: "invalidated",
      candidateId: record.candidate.id,
      reason: parsed.reason,
      externalActionRan: false,
    };
  });
}

function promotionBlockers(record) {
  const blockers = [];
  if (record.invalidation) blockers.push(`candidate invalidated: ${record.invalidation.reason}`);
  for (const platform of ["ios", "android"]) {
    const state = record.platforms[platform];
    if (state.build.state !== "succeeded") blockers.push(`${platform} build is incomplete`);
    if (state.submission.state !== "succeeded") blockers.push(`${platform} submission is incomplete`);
    if (state.processing.state !== "succeeded") blockers.push(`${platform} processing is incomplete`);
    if (state.availability.state !== "succeeded") blockers.push(`${platform} internal-store availability is incomplete`);
    if (state.physicalProof.state !== "succeeded") blockers.push(`${platform} physical proof is incomplete`);
    if (state.mismatch) blockers.push(`${platform} artifact identity mismatch: ${state.mismatch}`);
  }
  if (record.releaseProof.state !== "succeeded") {
    blockers.push("#41 Release Proof is incomplete");
  }
  if (record.releaseProof.privacyDiscrepancies.some((item) => item.state !== "resolved")) {
    blockers.push("an unexplained privacy discrepancy remains");
  }
  if ((record.releaseProof.limitations ?? []).some((item) => !item.approved)) {
    blockers.push("an unapproved limitation remains");
  }
  return blockers;
}

async function handoff(parsed, root) {
  const recordPath = resolve(root, parsed.record);
  const record = await readRecord(recordPath);
  if (!record.invalidation) await assertCurrentCandidate(root, recordPath, record);
  const source = await readFile(recordPath);
  const blockers = promotionBlockers(record);
  return {
    schemaVersion: 1,
    status: blockers.length === 0 ? "ready" : "blocked",
    candidateId: record.candidate.id,
    record: recordPath,
    recordFingerprint: fingerprint(source),
    releaseProof: {
      issue: 41,
      state: record.releaseProof.state,
    },
    blockers,
    reason: blockers.length === 0
      ? "The same candidate record is ready for #41's coequal promotion decision."
      : `#41 is the sole live Release Proof gate: ${blockers.join("; ")}.`,
    externalActionRan: false,
  };
}

async function prepare(parsed, root) {
  const source = synchronizedSource(root);
  const [{ nativePackage, rootPackage, version }, verificationSource, nativeIdentities, eas, privacy, selectedInputFingerprints] =
    await Promise.all([
      synchronizedVersion(root),
      readJson(resolve(root, parsed.verificationResult), "invalid_verification_result"),
      readJson(resolve(root, "config/native-identities.json"), "invalid_release_input"),
      readJson(resolve(root, "native/eas.json"), "invalid_release_input"),
      readJson(resolve(root, "config/release-privacy-inventory.json"), "invalid_release_input"),
      inputFingerprints(root),
    ]);
  const verification = verifiedResult(verificationSource, source);
  const environmentIdentity = nativeIdentities.environments?.[parsed.environment];
  const buildProfile = environmentIdentity?.eas?.buildProfile;
  if (
    !environmentIdentity ||
    !buildProfile ||
    !eas.build?.[buildProfile] ||
    environmentIdentity.ios?.bundleId !== nativeIdentities.apple?.distributionSigning?.[parsed.environment]?.bundleId ||
    environmentIdentity.android?.applicationId !== nativeIdentities.googlePlay?.apps?.[parsed.environment]?.applicationId
  ) {
    fail(
      "native_identity_mismatch",
      `Native identities and EAS build profile for ${parsed.environment} are incomplete or inconsistent.`,
    );
  }
  if (nativeIdentities.delivery?.updates?.enabled !== false) {
    fail("ota_enabled", "Release Candidate preparation requires OTA delivery to remain disabled.");
  }
  const releasePrivacyInventoryFingerprint = releasePrivacyFingerprint(privacy);
  const easProfile = eas.build[buildProfile];
  const iosSigning = nativeIdentities.apple.distributionSigning[parsed.environment];
  const androidSigning = environmentIdentity.android.signing;
  const input = {
    sourceRevision: source.revision,
    version,
    environment: parsed.environment,
    dependencyLocks: {
      root: selectedInputFingerprints["package-lock.json"],
      native: selectedInputFingerprints["native/package-lock.json"],
    },
    native: {
      buildProfile,
      easProfile: easProfileMetadata(
        easProfile,
        selectedInputFingerprints["native/eas.json"],
      ),
      expo: nativeIdentities.expo,
      ios: {
        bundleId: environmentIdentity.ios.bundleId,
        storeAppId: nativeIdentities.apple.appStoreConnect?.[parsed.environment]?.appId,
      },
      android: {
        applicationId: environmentIdentity.android.applicationId,
        storeAppId: nativeIdentities.googlePlay.apps?.[parsed.environment]?.appId,
      },
    },
    permissions: privacy.permissions,
    signing: {
      appleTeamId: nativeIdentities.apple.teamId,
      ios: iosSigningMetadata(iosSigning),
      android: androidSigningMetadata(androidSigning),
    },
    toolVersions: {
      ...verification.toolVersions,
      candidateCoordinator: 1,
      easCli: nativePackage.devDependencies?.["eas-cli"] ?? eas.cli?.version,
      nodeEngine: rootPackage.engines?.node,
    },
    releasePrivacyInventoryFingerprint,
    selectedInputFingerprints,
  };
  const identityFingerprint = fingerprint(input);
  const candidateId = `openjob-${version}-${identityFingerprint.slice("sha256:".length, "sha256:".length + 16)}`;
  const recordPath = resolve(root, parsed.record);
  const prior = await existingRecord(recordPath);
  if (prior) {
    if (
      validRecord(prior) &&
      prior.candidate?.identityFingerprint === identityFingerprint &&
      prior.invalidation === null
    ) {
      assertSafeCandidateData(prior, "candidateRecord");
      return { candidateId, record: recordPath, schemaVersion: 1, status: "reused" };
    }
    fail(
      "candidate_record_conflict",
      "The record path already contains another or invalidated Release Candidate.",
    );
  }
  const now = new Date().toISOString();
  const sharedIdentity = {
    buildProfile,
    ios: environmentIdentity.ios,
    android: environmentIdentity.android,
    appleAppId: nativeIdentities.apple.appStoreConnect?.[parsed.environment]?.appId ?? null,
    googleAppId: nativeIdentities.googlePlay.apps?.[parsed.environment]?.appId ?? null,
  };
  const record = {
    schemaVersion: 1,
    candidate: {
      id: candidateId,
      identityFingerprint,
      sourceRevision: source.revision,
      defaultBranch: source.branch,
      version,
      environment: parsed.environment,
      dependencyLocks: input.dependencyLocks,
      native: input.native,
      permissionsFingerprint: fingerprint(privacy.permissions),
      signing: input.signing,
      toolVersions: input.toolVersions,
      releasePrivacyInventoryFingerprint,
      selectedInputFingerprints,
    },
    verification: {
      fingerprint: fingerprint(verification),
      result: verification,
    },
    platforms: {
      ios: platformState("ios", sharedIdentity, source.revision, identityFingerprint, version),
      android: platformState("android", sharedIdentity, source.revision, identityFingerprint, version),
    },
    releaseProof: {
      issue: 41,
      state: "missing",
      evidence: [],
      privacyDiscrepancies: [],
      approvedLimitations: [],
    },
    invalidation: null,
    events: [{ at: now, type: "candidate-prepared", reason: "immutable inputs frozen" }],
    createdAt: now,
    updatedAt: now,
  };
  await atomicWrite(recordPath, record);
  return { candidateId, record: recordPath, schemaVersion: 1, status: "prepared" };
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const root = resolve(process.cwd());
  let report;
  if (parsed.command === "prepare") report = await prepare(parsed, root);
  else if (parsed.command === "status") report = await status(parsed, root);
  else if (parsed.command === "resume") report = await resume(parsed, root);
  else if (parsed.command === "inspect") report = await inspect(parsed, root);
  else if (parsed.command === "invalidate") report = await invalidate(parsed, root);
  else if (parsed.command === "handoff") report = await handoff(parsed, root);
  else if (parsed.action === "build") report = await executeBuild(parsed, root);
  else if (parsed.action === "submit") report = await executeSubmit(parsed, root);
  else if (parsed.action === "physical-proof") {
    report = await executePhysicalProof(parsed, root);
  }
  else if (parsed.action === "release-proof") {
    report = await executeReleaseProof(parsed, root);
  }
  else report = await executePromotion(parsed, root);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.stderr.write(
    `${report.status.toUpperCase()} ${report.candidateId} — no external action ran.\n`,
  );
}

try {
  await main();
} catch (error) {
  emitFailure(error);
}
