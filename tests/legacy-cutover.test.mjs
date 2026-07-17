import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  activeWorkerVersionFromDeployment,
  captureLegacySnapshot,
  deleteCloudflareWorkerVersion,
  getCloudflareActiveWorkerVersion,
  retireLegacyState,
  verifyLegacyDeployment,
} from "../scripts/legacy-cutover.mjs";
import { createLegacyBoardApi } from "../server/legacy-board.ts";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function createCutoverFetch({
  documents = [],
  legacyReadStatus = 200,
  onFirestore = () => {},
  tasks = [],
  writeStatus = 410,
} = {}) {
  const writeCounts = new Map();
  return async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "firestore.googleapis.com") {
      onFirestore(init);
      return Response.json({ documents });
    }
    if (url.pathname === "/api/tasks" && init.method) {
      const count = (writeCounts.get(init.method) ?? 0) + 1;
      writeCounts.set(init.method, count);
      const status = typeof writeStatus === "function"
        ? writeStatus({ count, method: init.method })
        : writeStatus;
      return Response.json({}, { status });
    }
    if (url.pathname === "/api/tasks") {
      return Response.json({ tasks }, { status: legacyReadStatus });
    }
    if (url.pathname === "/api/v1/me") {
      return Response.json({}, { status: 401 });
    }
    return new Response("OpenJob", { status: 200 });
  };
}

test("the frozen legacy board stays readable and rejects writes before storage", async () => {
  const tasks = [{ id: "legacy-task", description: "Preserve me" }];
  let reads = 0;
  const api = createLegacyBoardApi({
    async listTasks() {
      reads += 1;
      return tasks;
    },
  });

  const read = await api.fetch(new Request("https://openjob.dev/api/tasks"));
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "no-store");
  assert.deepEqual(await read.json(), { tasks });

  for (const method of ["POST", "PATCH"]) {
    const write = await api.fetch(
      new Request("https://openjob.dev/api/tasks", { method }),
    );
    assert.equal(write.status, 410, method);
    assert.deepEqual(await write.json(), {
      error: {
        code: "legacy_read_only",
        message: "The legacy board is read-only.",
      },
    });
  }
  assert.equal(reads, 1);
});

test("an authenticated empty legacy snapshot is owner-only and records its digest", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openjob-cutover-"));
  const outputPath = join(directory, "legacy-tasks.json");
  t.after(() => rm(directory, { force: true, recursive: true }));

  const result = await captureLegacySnapshot({
    accessToken: "owner-token",
    baseUrl: "https://openjob.dev",
    fetchImplementation: createCutoverFetch({
      onFirestore(init) {
        assert.equal(
          new Headers(init.headers).get("authorization"),
          "Bearer owner-token",
        );
      },
    }),
    freezeGitCommit: "a".repeat(40),
    getActiveWorkerVersion: async () => "11111111-1111-4111-8111-111111111111",
    now: () => new Date("2026-07-17T13:00:00.000Z"),
    outputPath,
    repoRoot,
  });

  assert.equal(result.taskCount, 0);
  assert.equal(
    result.sha256,
    "f332a4181af7c4a82f09927e71369910957b21632a21eb990216dbd59c728dd3",
  );
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), {
    capturedAt: "2026-07-17T13:00:00.000Z",
    format: "openjob-legacy-tasks-snapshot-v1",
    freeze: {
      baseUrl: "https://openjob.dev/",
      gitCommit: "a".repeat(40),
      workerVersion: "11111111-1111-4111-8111-111111111111",
    },
    rawSnapshot: { documents: [] },
    sha256: result.sha256,
    source: {
      collection: "tasks",
      databaseId: "(default)",
      projectId: "openjob-dev",
    },
    taskCount: 0,
  });
});

test("a fresh nonzero snapshot is retained but blocks cutover", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openjob-cutover-blocked-"));
  const outputPath = join(directory, "legacy-tasks.json");
  t.after(() => rm(directory, { force: true, recursive: true }));
  const document = {
    fields: { description: { stringValue: "Late legacy Task" } },
    name: "projects/openjob-dev/databases/(default)/documents/tasks/late",
  };

  await assert.rejects(
    captureLegacySnapshot({
      accessToken: "owner-token",
      baseUrl: "https://openjob.dev",
      fetchImplementation: createCutoverFetch({
        documents: [document],
        tasks: [{ id: "late" }],
      }),
      freezeGitCommit: "b".repeat(40),
      getActiveWorkerVersion: async () => "22222222-2222-4222-8222-222222222222",
      outputPath,
      repoRoot,
    }),
    /Cutover blocked: the fresh legacy Task count is 1/,
  );

  const retained = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(retained.taskCount, 1);
  assert.deepEqual(retained.rawSnapshot.documents, [document]);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
});

test("freeze verification rejects one stale write-capable edge response", async () => {
  let writes = 0;
  await assert.rejects(
    verifyLegacyDeployment({
      baseUrl: "https://openjob.dev",
      expectedMode: "read-only",
      fetchImplementation: createCutoverFetch({
        writeStatus({ method }) {
          if (method === "POST") writes += 1;
          return method === "POST" && writes === 2 ? 400 : 410;
        },
      }),
    }),
    /POST \/api\/tasks probe 2 returned 400; expected 410/,
  );
});

test("freeze verification checks the legacy PATCH write path", async () => {
  await assert.rejects(
    verifyLegacyDeployment({
      baseUrl: "https://openjob.dev",
      expectedMode: "read-only",
      fetchImplementation: createCutoverFetch({
        writeStatus: ({ method }) => method === "PATCH" ? 400 : 410,
      }),
    }),
    /PATCH \/api\/tasks probe 1 returned 400; expected 410/,
  );
});

test("a custom snapshot path does not change its existing parent permissions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openjob-cutover-parent-"));
  const outputPath = join(directory, "legacy-tasks.json");
  t.after(() => rm(directory, { force: true, recursive: true }));
  await chmod(directory, 0o755);

  await captureLegacySnapshot({
    accessToken: "owner-token",
    baseUrl: "https://openjob.dev",
    fetchImplementation: createCutoverFetch(),
    freezeGitCommit: "c".repeat(40),
    getActiveWorkerVersion: async () => "33333333-3333-4333-8333-333333333333",
    outputPath,
    repoRoot,
  });

  assert.equal((await stat(directory)).mode & 0o777, 0o755);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
});

test("an outside symlink cannot redirect the snapshot into the repository", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "openjob-cutover-link-"));
  const fakeRepo = join(workspace, "repo");
  const outside = join(workspace, "outside");
  await Promise.all([mkdir(fakeRepo), mkdir(outside)]);
  await symlink(fakeRepo, join(outside, "repo-link"), "dir");
  t.after(() => rm(workspace, { force: true, recursive: true }));

  await assert.rejects(
    captureLegacySnapshot({
      accessToken: "owner-token",
      baseUrl: "https://openjob.dev",
      fetchImplementation: createCutoverFetch(),
      freezeGitCommit: "d".repeat(40),
      getActiveWorkerVersion: async () => "44444444-4444-4444-8444-444444444444",
      outputPath: join(outside, "repo-link", "legacy-tasks.json"),
      repoRoot: fakeRepo,
    }),
    /snapshot must be written outside the repository/,
  );
});

test("snapshot selects only the one fully active Worker version", () => {
  assert.equal(
    activeWorkerVersionFromDeployment({
      versions: [{ percentage: 100, version_id: "active-version" }],
    }),
    "active-version",
  );
  assert.throws(
    () => activeWorkerVersionFromDeployment({
      versions: [
        { percentage: 50, version_id: "first" },
        { percentage: 50, version_id: "second" },
      ],
    }),
    /exactly one Worker version at 100%/,
  );
});

test("snapshot blocks if the active Worker changes during capture", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openjob-cutover-race-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  let checks = 0;

  await assert.rejects(
    captureLegacySnapshot({
      accessToken: "owner-token",
      baseUrl: "https://openjob.dev",
      fetchImplementation: createCutoverFetch(),
      freezeGitCommit: "f".repeat(40),
      getActiveWorkerVersion: async () => {
        checks += 1;
        return checks === 1
          ? "77777777-7777-4777-8777-777777777777"
          : "88888888-8888-4888-8888-888888888888";
      },
      outputPath: join(directory, "legacy-tasks.json"),
      repoRoot,
    }),
    /Active Worker changed during legacy snapshot capture/,
  );
});

test("final retirement revalidates the zero snapshot and removes only its inactive Worker", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openjob-retirement-"));
  const snapshotPath = join(directory, "legacy-tasks.json");
  t.after(() => rm(directory, { force: true, recursive: true }));
  const freezeWorkerVersion = "77777777-7777-4777-8777-777777777777";
  const sha256 = "f332a4181af7c4a82f09927e71369910957b21632a21eb990216dbd59c728dd3";
  await writeFile(
    snapshotPath,
    JSON.stringify({
      capturedAt: "2026-07-17T13:00:00.000Z",
      format: "openjob-legacy-tasks-snapshot-v1",
      freeze: {
        baseUrl: "https://openjob.dev/",
        gitCommit: "a".repeat(40),
        workerVersion: freezeWorkerVersion,
      },
      rawSnapshot: { documents: [] },
      sha256,
      source: {
        collection: "tasks",
        databaseId: "(default)",
        projectId: "openjob-dev",
      },
      taskCount: 0,
    }),
  );
  const deletedVersions = [];

  const result = await retireLegacyState({
    accessToken: "owner-token",
    confirmationDigest: sha256,
    confirmedFreezeWorkerVersion: freezeWorkerVersion,
    deleteWorkerVersion: async (versionId) => deletedVersions.push(versionId),
    fetchImplementation: createCutoverFetch({
      legacyReadStatus: 404,
      writeStatus: 404,
    }),
    getActiveWorkerVersion: async () => "88888888-8888-4888-8888-888888888888",
    snapshotPath,
  });

  assert.deepEqual(result, {
    freezeWorkerVersion,
    sha256,
    taskCount: 0,
  });
  assert.deepEqual(deletedVersions, [freezeWorkerVersion]);
});

test("final retirement requires the snapshot digest as explicit confirmation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openjob-retirement-confirmation-"));
  const snapshotPath = join(directory, "legacy-tasks.json");
  t.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(
    snapshotPath,
    JSON.stringify({
      capturedAt: "2026-07-17T13:00:00.000Z",
      format: "openjob-legacy-tasks-snapshot-v1",
      freeze: {
        baseUrl: "https://openjob.dev/",
        gitCommit: "a".repeat(40),
        workerVersion: "77777777-7777-4777-8777-777777777777",
      },
      rawSnapshot: { documents: [] },
      sha256: "f332a4181af7c4a82f09927e71369910957b21632a21eb990216dbd59c728dd3",
      source: {
        collection: "tasks",
        databaseId: "(default)",
        projectId: "openjob-dev",
      },
      taskCount: 0,
    }),
  );
  let deletionAttempted = false;

  await assert.rejects(
    retireLegacyState({
      accessToken: "owner-token",
      confirmationDigest: "wrong-digest",
      confirmedFreezeWorkerVersion: "77777777-7777-4777-8777-777777777777",
      deleteWorkerVersion: async () => {
        deletionAttempted = true;
      },
      fetchImplementation: createCutoverFetch({
        legacyReadStatus: 404,
        writeStatus: 404,
      }),
      getActiveWorkerVersion: async () => "88888888-8888-4888-8888-888888888888",
      snapshotPath,
    }),
    /confirmation must exactly match the snapshot SHA-256/,
  );
  assert.equal(deletionAttempted, false);
});

test("final retirement rejects tampered destructive target metadata", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openjob-retirement-tamper-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const freezeWorkerVersion = "77777777-7777-4777-8777-777777777777";
  const sha256 = "f332a4181af7c4a82f09927e71369910957b21632a21eb990216dbd59c728dd3";
  const baseSnapshot = {
    capturedAt: "2026-07-17T13:00:00.000Z",
    format: "openjob-legacy-tasks-snapshot-v1",
    freeze: {
      baseUrl: "https://openjob.dev/",
      gitCommit: "a".repeat(40),
      workerVersion: freezeWorkerVersion,
    },
    rawSnapshot: { documents: [] },
    sha256,
    source: {
      collection: "tasks",
      databaseId: "(default)",
      projectId: "openjob-dev",
    },
    taskCount: 0,
  };
  const tamperedSnapshots = [
    {
      ...baseSnapshot,
      freeze: { ...baseSnapshot.freeze, workerVersion: "99999999-9999-4999-8999-999999999999" },
    },
    {
      ...baseSnapshot,
      freeze: { ...baseSnapshot.freeze, baseUrl: "https://attacker.example/" },
    },
    {
      ...baseSnapshot,
      source: { ...baseSnapshot.source, projectId: "attacker-project" },
    },
    {
      ...baseSnapshot,
      source: { ...baseSnapshot.source, databaseId: "attacker-database" },
    },
  ];

  for (const [index, snapshot] of tamperedSnapshots.entries()) {
    const snapshotPath = join(directory, `legacy-tasks-${index}.json`);
    await writeFile(snapshotPath, JSON.stringify(snapshot));
    let deletionAttempted = false;
    await assert.rejects(
      retireLegacyState({
        accessToken: "owner-token",
        confirmationDigest: sha256,
        confirmedFreezeWorkerVersion: freezeWorkerVersion,
        deleteWorkerVersion: async () => {
          deletionAttempted = true;
        },
        fetchImplementation: createCutoverFetch({
          legacyReadStatus: 404,
          writeStatus: 404,
        }),
        getActiveWorkerVersion: async () => "88888888-8888-4888-8888-888888888888",
        snapshotPath,
      }),
      /snapshot (Worker|origin|project|database) does not match the retirement target/,
    );
    assert.equal(deletionAttempted, false);
  }
});

test("active Worker lookup and retirement share the Cloudflare target identity", async () => {
  let observedRequest;
  const versionId = await getCloudflareActiveWorkerVersion({
    accountId: "account-id",
    apiToken: "api-token",
    fetchImplementation: async (input, init) => {
      observedRequest = { init, url: String(input) };
      return Response.json({
        result: {
          deployments: [{ versions: [{ percentage: 100, version_id: "active-version" }] }],
        },
        success: true,
      });
    },
    workerName: "openjob",
  });

  assert.equal(versionId, "active-version");
  assert.equal(
    observedRequest.url,
    "https://api.cloudflare.com/client/v4/accounts/account-id/workers/scripts/openjob/deployments",
  );
  assert.equal(
    new Headers(observedRequest.init.headers).get("authorization"),
    "Bearer api-token",
  );
});

test("Worker retirement deletes only the confirmed Cloudflare version", async () => {
  let observedRequest;

  await deleteCloudflareWorkerVersion({
    accountId: "account-id",
    apiToken: "api-token",
    fetchImplementation: async (input, init) => {
      observedRequest = { init, url: String(input) };
      return Response.json({ errors: [], messages: [], success: true });
    },
    versionId: "77777777-7777-4777-8777-777777777777",
    workerName: "openjob",
  });

  assert.equal(
    observedRequest.url,
    "https://api.cloudflare.com/client/v4/accounts/account-id/workers/workers/openjob/versions/77777777-7777-4777-8777-777777777777",
  );
  assert.equal(observedRequest.init.method, "DELETE");
  assert.equal(
    new Headers(observedRequest.init.headers).get("authorization"),
    "Bearer api-token",
  );
});
