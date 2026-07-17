import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_BASE_URL = "https://openjob.dev";
const DEFAULT_PROJECT_ID = "openjob-dev";
const DEFAULT_DATABASE_ID = "(default)";
const LEGACY_COLLECTION = "tasks";

function statusError(label, response, expected) {
  return new Error(`${label} returned ${response.status}; expected ${expected}.`);
}

async function parseJsonResponse(response, label) {
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
  probeCount = 5,
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

  const taskCounts = [];
  for (let probe = 1; probe <= probeCount; probe += 1) {
    const legacyUrl = new URL("/api/tasks", origin);
    legacyUrl.searchParams.set("cutoverProbe", String(probe));
    const read = await fetchImplementation(legacyUrl, {
      headers: { "cache-control": "no-cache" },
    });
    const readLabel = `GET /api/tasks probe ${probe}`;
    const writes = await Promise.all(
      ["POST", "PATCH"].map(async (method) => ({
        method,
        response: await fetchImplementation(legacyUrl, {
          body: "{}",
          headers: {
            "cache-control": "no-cache",
            "content-type": "application/json",
          },
          method,
        }),
      })),
    );

    if (expectedMode === "unavailable") {
      if (read.status !== 404) throw statusError(readLabel, read, 404);
      for (const { method, response } of writes) {
        if (response.status !== 404) {
          throw statusError(`${method} /api/tasks probe ${probe}`, response, 404);
        }
      }
      continue;
    }

    if (read.status !== 200) throw statusError(readLabel, read, 200);
    for (const { method, response } of writes) {
      if (response.status !== 410) {
        throw statusError(`${method} /api/tasks probe ${probe}`, response, 410);
      }
    }
    const body = await parseJsonResponse(read, readLabel);
    if (!Array.isArray(body.tasks)) {
      throw new Error(`${readLabel} did not return the legacy Task collection.`);
    }
    taskCounts.push(body.tasks.length);
  }
  if (expectedMode === "unavailable") return { taskCount: null };
  if (taskCounts.some((count) => count !== taskCounts[0])) {
    throw new Error("The legacy Task count changed between freeze probes.");
  }
  return { taskCount: taskCounts[0] };
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
    const page = await parseJsonResponse(response, "Firestore legacy snapshot");
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

async function resolveThroughExistingAncestor(path) {
  let ancestor = path;
  const missing = [];
  for (;;) {
    try {
      return resolve(await realpath(ancestor), ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(basename(ancestor));
      ancestor = parent;
    }
  }
}

async function writeOwnerOnlyJson(outputPath, value, repoRoot) {
  const destination = resolve(outputPath);
  const canonicalRepo = await realpath(resolve(repoRoot));
  const canonicalDestination = await resolveThroughExistingAncestor(destination);
  if (isWithin(canonicalRepo, canonicalDestination)) {
    throw new Error("The legacy snapshot must be written outside the repository.");
  }
  const directory = dirname(destination);
  const createdDirectory = await mkdir(directory, { mode: 0o700, recursive: true });
  if (createdDirectory) await chmod(directory, 0o700);
  const finalDestination = resolve(await realpath(directory), basename(destination));
  if (isWithin(canonicalRepo, finalDestination)) {
    throw new Error("The legacy snapshot must be written outside the repository.");
  }
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
  getActiveWorkerVersion,
  now = () => new Date(),
  outputPath,
  projectId = DEFAULT_PROJECT_ID,
  repoRoot,
}) {
  if (!accessToken) throw new Error("An owner access token is required.");
  if (typeof getActiveWorkerVersion !== "function") {
    throw new Error("An active Worker version resolver is required.");
  }
  const freezeWorkerVersion = await getActiveWorkerVersion();
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
  if (await getActiveWorkerVersion() !== freezeWorkerVersion) {
    throw new Error("Active Worker changed during legacy snapshot capture.");
  }
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
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function ownerAccessToken() {
  const { stdout } = await execFileAsync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
  });
  const token = stdout.trim();
  if (!token) throw new Error("gcloud did not return an owner access token.");
  return token;
}

export function activeWorkerVersionFromDeployment(deployment) {
  const active = Array.isArray(deployment?.versions)
    ? deployment.versions.filter(({ percentage }) => percentage === 100)
    : [];
  if (active.length !== 1 || typeof active[0].version_id !== "string") {
    throw new Error("Snapshot requires exactly one Worker version at 100% traffic.");
  }
  return active[0].version_id;
}

async function activeWorkerVersion(repoRoot) {
  const wrangler = join(repoRoot, "node_modules", ".bin", "wrangler");
  const { stdout } = await execFileAsync(
    wrangler,
    ["deployments", "status", "--json"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  try {
    return activeWorkerVersionFromDeployment(JSON.parse(stdout));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Wrangler returned invalid deployment status JSON.");
    }
    throw error;
  }
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
    const outputPath = option(args, "--output") ?? defaultSnapshotPath();
    if (args.length > 0) throw new Error(`Unexpected argument: ${args[0]}`);
    const result = await captureLegacySnapshot({
      accessToken: await ownerAccessToken(),
      baseUrl: process.env.OPENJOB_BASE_URL ?? DEFAULT_BASE_URL,
      freezeGitCommit: await gitCommit(repoRoot),
      getActiveWorkerVersion: () => activeWorkerVersion(repoRoot),
      outputPath,
      repoRoot,
    });
    process.stdout.write(
      `Owner-only legacy snapshot: ${result.outputPath}\n` +
        `Task count: ${result.taskCount}\nSHA-256: ${result.sha256}\n`,
    );
    return result;
  }

  throw new Error("Usage: legacy-cutover.mjs smoke <read-only|unavailable> | snapshot [--output <path>]");
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
