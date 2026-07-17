import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { captureLegacySnapshot } from "../scripts/legacy-cutover.mjs";
import { createLegacyBoardApi } from "../server/legacy-board.ts";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

test("the frozen legacy board stays readable and rejects writes before storage", async () => {
  const tasks = [{ id: "legacy-task", description: "Preserve me" }];
  let reads = 0;
  const api = createLegacyBoardApi({
    mode: "read-only",
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

test("the cutover legacy route conceals the old contract without reading storage", async () => {
  const api = createLegacyBoardApi({
    mode: "unavailable",
    async listTasks() {
      throw new Error("Legacy storage must stay untouched after cutover.");
    },
  });

  for (const method of ["GET", "POST", "PATCH"]) {
    const response = await api.fetch(
      new Request("https://openjob.dev/api/tasks", { method }),
    );
    assert.equal(response.status, 404, method);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: { code: "not_found", message: "Not found." },
    });
  }
});

test("an authenticated empty legacy snapshot is owner-only and records its digest", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openjob-cutover-"));
  const outputPath = join(directory, "legacy-tasks.json");
  t.after(() => rm(directory, { force: true, recursive: true }));

  const result = await captureLegacySnapshot({
    accessToken: "owner-token",
    baseUrl: "https://openjob.dev",
    fetchImplementation: async (input, init = {}) => {
      const url = new URL(input);
      if (url.hostname === "firestore.googleapis.com") {
        assert.equal(
          new Headers(init.headers).get("authorization"),
          "Bearer owner-token",
        );
        return Response.json({ documents: [] });
      }
      if (url.pathname === "/api/tasks" && init.method === "POST") {
        return Response.json(
          { error: { code: "legacy_read_only" } },
          { status: 410 },
        );
      }
      if (url.pathname === "/api/tasks") {
        return Response.json({ tasks: [] });
      }
      if (url.pathname === "/api/v1/me") {
        return Response.json({}, { status: 401 });
      }
      return new Response("OpenJob", { status: 200 });
    },
    freezeGitCommit: "a".repeat(40),
    freezeWorkerVersion: "11111111-1111-4111-8111-111111111111",
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
      fetchImplementation: async (input, init = {}) => {
        const url = new URL(input);
        if (url.hostname === "firestore.googleapis.com") {
          return Response.json({ documents: [document] });
        }
        if (url.pathname === "/api/tasks" && init.method === "POST") {
          return Response.json({}, { status: 410 });
        }
        if (url.pathname === "/api/tasks") {
          return Response.json({ tasks: [{ id: "late" }] });
        }
        if (url.pathname === "/api/v1/me") {
          return Response.json({}, { status: 401 });
        }
        return new Response("OpenJob", { status: 200 });
      },
      freezeGitCommit: "b".repeat(40),
      freezeWorkerVersion: "22222222-2222-4222-8222-222222222222",
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
