import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("CLI tables retain later Task fields, aligned blanks and escaped text without changing JSON", async t => {
  const directory = await mkdtemp(join(tmpdir(), "openjob-table-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const token = "oj_agent_agt_" + "0".repeat(32) + "." + "A".repeat(43);
  const tokenFile = join(directory, "fixture-token");
  await writeFile(tokenFile, token + "\n", { mode: 0o600 });
  const slot = { start: "2026-10-16T12:00:00.000Z", end: "2026-10-16T13:00:00.000Z" };
  let tasks = [
    { taskId: "task_unscheduled", text: "No\tslot\nfirst" },
    { taskId: "task_planned", text: "Planned", scheduledSlot: slot },
    { taskId: "task_due", text: "Due", dueDate: "2026-10-17" },
  ];
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, method: request.method, auth: request.headers.authorization });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: tasks, nextCursor: null }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = extra => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["cli/openjob.mjs", "task", "list", "--group", "grp_fixture", "--agent-token-file", tokenFile, ...extra], {
      env: { ...process.env, NODE_ENV: "test", OPENJOB_API_URL: base + "/api/v1", OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: "fixture", OPENJOB_TEST_GOOGLE_CLIENT_ID: "fixture.apps.googleusercontent.com", OPENJOB_CONFIG: join(directory, "config.json") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", reject);
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
  const expected = "TASK_ID\tTEXT\tSCHEDULED_SLOT\tDUE_DATE\n" +
    "task_unscheduled\tNo\\tslot\\nfirst\t\t\n" +
    `task_planned\tPlanned\t${JSON.stringify(slot)}\t\n` +
    "task_due\tDue\t\t2026-10-17\n";
  const table = await run([]);
  assert.equal(table.status, 0, table.stderr);
  assert.equal(table.stdout, expected);
  const path = join(directory, "tasks.tsv");
  const saved = await run(["--out", path]);
  assert.equal(saved.status, 0, saved.stderr); assert.equal(saved.stdout, "");
  assert.equal(await readFile(path, "utf8"), expected);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  for (const format of ["json", "jsonl"]) {
    const result = await run(["--format", format]);
    assert.equal(result.status, 0, result.stderr);
    if (format === "json") assert.deepEqual(JSON.parse(result.stdout), { data: tasks, nextCursor: null });
    else assert.deepEqual(result.stdout.trimEnd().split("\n").map(line => JSON.parse(line)), tasks);
  }
  tasks = [tasks[0]];
  const single = await run([]);
  assert.equal(single.status, 0, single.stderr);
  assert.equal(single.stdout, "TASK_ID\tTEXT\ntask_unscheduled\tNo\\tslot\\nfirst\n");
  tasks = [];
  const empty = await run([]);
  assert.equal(empty.status, 0, empty.stderr); assert.equal(empty.stdout, "");
  assert.equal(requests.length, 6);
  assert.ok(requests.every(request => request.method === "GET" && request.path.startsWith("/api/v1/groups/grp_fixture/tasks") && request.auth === `Bearer ${token}`));
});
