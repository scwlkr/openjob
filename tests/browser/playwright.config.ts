import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "openjob-web.spec.ts",
  fullyParallel: false,
  outputDir: "../../output/playwright/test-results",
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    launchOptions: process.env.OPENJOB_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.OPENJOB_CHROMIUM_EXECUTABLE }
      : undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "node node_modules/vite/bin/vite.js --config tests/browser/vite.config.ts",
    port: 4175,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
