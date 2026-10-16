import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

/** Exercise the actual app/router/proxy, not just a mounted component. */
export default defineConfig({
  testDir: ".",
  testMatch: ["workspace.spec.ts", "workspace-drafts.spec.ts"],
  fullyParallel: false,
  outputDir: "../../output/playwright/workspace-app-results",
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4176",
    browserName: "chromium",
    launchOptions: process.env.OPENJOB_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.OPENJOB_CHROMIUM_EXECUTABLE } : undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "node scripts/dev-workspace.mjs --port 4176 --app-test",
    port: 4176,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
