import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const args = process.argv.slice(2);
const index = args.indexOf("--port");
const port = index === -1 ? "5173" : args[index + 1];
const flags = args.filter((_, position) => position !== index && (index < 0 || position !== index + 1));
if (flags.some(flag => !["--fresh", "--test", "--app-test"].includes(flag)) || !port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Use [--fresh] [--port 1-65535].");
const stateFile = (args.includes("--test") || args.includes("--app-test"))
  ? join(tmpdir(), `openjob-workspace-browser-${process.pid}.json`)
  : args.includes("--fresh") ? join(mkdtempSync(join(tmpdir(), "openjob-workspace-demo-")), "state.json")
    : process.env.OPENJOB_WORKSPACE_STATE_FILE || join(process.cwd(), ".openjob", "workspace-demo.json");
console.log(`Fixture state: ${stateFile}`);
console.log("First startup seeds Alex and Sam with synthetic Mail, Tasks and Calendars. No login, credentials or provider setup required.");
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
function launch(script, childArgs, ipc = false) {
  const child = spawn(process.execPath, [script, ...childArgs], {
    stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit", env: { ...process.env, OPENJOB_WORKSPACE_FIXTURE: "1" },
  });
  children.push(child);
  child.on("error", error => { process.stderr.write(error.message + "\n"); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code ?? 1); });
  return child;
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
// Wait for this child, never an unrelated service already listening on port4180.
const backend = launch("scripts/workspace-fixture-server.mjs", ["--state-file", stateFile], true);
const ready = await new Promise(resolve => {
  const timer = setTimeout(() => resolve(false), 10000);
  backend.once("message", message => { clearTimeout(timer); resolve(message?.type === "workspace-fixture-ready"); });
  backend.once("exit", () => { clearTimeout(timer); resolve(false); });
  backend.once("error", () => { clearTimeout(timer); resolve(false); });
});
if (ready && !stopping) launch("node_modules/vite/bin/vite.js", ["--config", args.includes("--test") ? "tests/browser/vite.config.ts" : "vite.config.ts", "--host", "127.0.0.1", "--port", port, "--strictPort"]);
else stop(1);
