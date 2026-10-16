import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const index = args.indexOf("--port");
const port = index === -1 ? "5173" : args[index + 1];
if (!port || !/^\d+$/.test(port)) throw new Error("Use --port <number>.");
const stateFile = (args.includes("--test") || args.includes("--app-test"))
  ? join(tmpdir(), `openjob-workspace-browser-${process.pid}.json`)
  : process.env.OPENJOB_WORKSPACE_STATE_FILE || join(process.cwd(), ".openjob", "workspace-demo.json");
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const [script, childArgs] of [
  ["scripts/workspace-fixture-server.mjs", ["--state-file", stateFile]],
  ["node_modules/vite/bin/vite.js", ["--config", args.includes("--test") ? "tests/browser/vite.config.ts" : "vite.config.ts", "--host", "127.0.0.1", "--port", port, "--strictPort"]],
]) {
  if (script.includes("vite")) {
    let ready = false;
    for (let attempt = 0; attempt < 50 && !stopping; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:4180/api/workspace/snapshot", { headers: { "x-openjob-fixture-owner": "demo_alex" }, signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* The owned fixture server is still starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) { stop(1); break; }
  }
  const child = spawn(process.execPath, [script, ...childArgs], {
    stdio: "inherit", env: { ...process.env, OPENJOB_WORKSPACE_FIXTURE: "1" },
  });
  children.push(child);
  child.on("error", error => { process.stderr.write(error.message + "\n"); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code ?? 1); });
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
