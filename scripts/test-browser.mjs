import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url));

const executablePath = process.env.OPENJOB_CHROMIUM_EXECUTABLE;
if (executablePath) {
  // Cloud runners may supply Chromium when the browser CDN is unavailable.
  // Fail early on an invalid path; never silently skip browser tests.
  accessSync(executablePath, constants.X_OK);
} else {
  const install = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
  if (install.error) throw install.error;
  if (install.status !== 0) process.exit(install.status ?? 1);
}
for (const config of ["tests/browser/playwright.config.ts", "tests/browser/workspace-app.config.ts"]) {
  const result = spawnSync(process.execPath, [cli, "test", "--config", config], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
