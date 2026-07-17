import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const DEFAULT_BASE_URL = "https://openjob.dev";
const DEFAULT_PROJECT_ID = "openjob-dev";
const DEFAULT_DATABASE_ID = "(default)";
const LEGACY_COLLECTION = "tasks";

function statusError(label, response, expected) {
  return new Error(`${label} returned ${response.status}; expected ${expected}.`);
}

async function json(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
}

export async function verifyLegacyDeployment({
  baseUrl = DEFAULT_BASE_URL,
  expectedMode,
  fetchImplementation = fetch,
}) {
  if (!new Set(["read-only", "unavailable"]).has(expectedMode)) {
    throw new Error("Expected mode must be read-only or unavailable.");
  }
  const origin = new URL(baseUrl);
  const home = await fetchImplementation(new URL("/", origin));
  if (!home.ok) throw statusError("GET /", home, 200);

  const identity = await fetchImplementation(new URL("/api/v1/me", origin));
  if (identity.status !== 401) {
    throw statusError("GET /api/v1/me", identity, 401);
  }

  const legacyUrl = new URL("/api/tasks", origin);
  const read = await fetchImplementation(legacyUrl);
  const write = await fetchImplementation(legacyUrl, {
    body: "{}",
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (expectedMode === "unavailable") {
    if (read.status !== 404) throw statusError("GET /api/tasks", read, 404);
    if (write.status !== 404) throw statusError("POST /api/tasks", write, 404);
    return { taskCount: null };
  }

  if (read.status !== 200) throw statusError("GET /api/tasks", read, 200);
  if (write.status !== 410) throw statusError("POST /api/tasks", write, 410);
  const body = await json(read, "GET /api/tasks");
  if (!Array.isArray(body.tasks)) {
    throw new Error("GET /api/tasks did not return the legacy Task collection.");
  }
  return { taskCount: body.tasks.length };
}

async function fetchLegacyDocuments({
  accessToken,
  databaseId,
  fetchImplementation,
  projectId,
}) {
  const documents = [];
  let pageToken;
  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
        `/databases/${encodeURIComponent(databaseId)}/documents/${LEGACY_COLLECTION}`,
    );
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetchImplementation(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Firestore legacy snapshot returned ${response.status}.`);
    }
    const page = await json(response, "Firestore legacy snapshot");
    if (page.documents !== undefined && !Array.isArray(page.documents)) {
      throw new Error("Firestore returned an invalid legacy snapshot page.");
    }
    documents.push(...(page.documents ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return documents;
}

function isWithin(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

async function writeOwnerOnlyJson(outputPath, value, repoRoot) {
  const destination = resolve(outputPath);
  if (isWithin(resolve(repoRoot), destination)) {
    throw new Error("The legacy snapshot must be written outside the repository.");
  }
  const directory = dirname(destination);
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  const file = await open(destination, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await chmod(destination, 0o600);
  return destination;
}

export async function captureLegacySnapshot({
  accessToken,
  baseUrl = DEFAULT_BASE_URL,
  databaseId = DEFAULT_DATABASE_ID,
  fetchImplementation = fetch,
  freezeGitCommit,
  freezeWorkerVersion,
  now = () => new Date(),
  outputPath,
  projectId = DEFAULT_PROJECT_ID,
  repoRoot,
}) {
  if (!accessToken) throw new Error("An owner access token is required.");
  const deployment = await verifyLegacyDeployment({
    baseUrl,
    expectedMode: "read-only",
    fetchImplementation,
  });
  const documents = await fetchLegacyDocuments({
    accessToken,
    databaseId,
    fetchImplementation,
    projectId,
  });
  if (deployment.taskCount !== documents.length) {
    throw new Error(
      "The public legacy count changed while the authenticated snapshot was captured.",
    );
  }

  const rawSnapshot = { documents };
  const sha256 = createHash("sha256")
    .update(JSON.stringify(rawSnapshot))
    .digest("hex");
  const snapshot = {
    capturedAt: now().toISOString(),
    format: "openjob-legacy-tasks-snapshot-v1",
    freeze: {
      baseUrl: new URL(baseUrl).href,
      gitCommit: freezeGitCommit,
      workerVersion: freezeWorkerVersion,
    },
    rawSnapshot,
    sha256,
    source: {
      collection: LEGACY_COLLECTION,
      databaseId,
      projectId,
    },
    taskCount: documents.length,
  };
  const destination = await writeOwnerOnlyJson(outputPath, snapshot, repoRoot);
  if (documents.length !== 0) {
    throw new Error(
      `Cutover blocked: the fresh legacy Task count is ${documents.length}. ` +
        `Snapshot retained at ${destination} with SHA-256 ${sha256}.`,
    );
  }
  return { outputPath: destination, sha256, taskCount: documents.length };
}

function option(arguments_, name) {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  arguments_.splice(index, 2);
  return value;
}

function defaultSnapshotPath(now = new Date()) {
  const stamp = now.toISOString().replaceAll(":", "-");
  return join(
    homedir(),
    "Library",
    "Application Support",
    "OpenJob",
    "cutover",
    `legacy-tasks-${stamp}.json`,
  );
}

async function gitCommit(repoRoot) {
  const { stdout } = await run("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function ownerAccessToken() {
  const { stdout } = await run("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
  });
  const token = stdout.trim();
  if (!token) throw new Error("gcloud did not return an owner access token.");
  return token;
}

export async function runLegacyCutoverCli(arguments_ = process.argv.slice(2)) {
  const args = [...arguments_];
  const command = args.shift();
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));

  if (command === "smoke") {
    const expectedMode = args.shift();
    if (args.length > 0) throw new Error(`Unexpected argument: ${args[0]}`);
    const result = await verifyLegacyDeployment({
      baseUrl: process.env.OPENJOB_BASE_URL ?? DEFAULT_BASE_URL,
      expectedMode,
    });
    process.stdout.write(
      `Legacy ${expectedMode} smoke passed; Task count ${result.taskCount ?? "concealed"}.\n`,
    );
    return result;
  }

  if (command === "snapshot") {
    const freezeWorkerVersion = option(args, "--freeze-version");
    const outputPath = option(args, "--output") ?? defaultSnapshotPath();
    if (!freezeWorkerVersion) throw new Error("--freeze-version is required.");
    if (args.length > 0) throw new Error(`Unexpected argument: ${args[0]}`);
    const result = await captureLegacySnapshot({
      accessToken: await ownerAccessToken(),
      baseUrl: process.env.OPENJOB_BASE_URL ?? DEFAULT_BASE_URL,
      freezeGitCommit: await gitCommit(repoRoot),
      freezeWorkerVersion,
      outputPath,
      repoRoot,
    });
    process.stdout.write(
      `Owner-only legacy snapshot: ${result.outputPath}\n` +
        `Task count: ${result.taskCount}\nSHA-256: ${result.sha256}\n`,
    );
    return result;
  }

  throw new Error("Usage: legacy-cutover.mjs smoke <read-only|unavailable> | snapshot --freeze-version <id> [--output <path>]");
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await runLegacyCutoverCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
