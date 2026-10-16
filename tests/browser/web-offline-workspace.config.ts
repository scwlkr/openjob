import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".", testMatch: ["web-offline-workspace.spec.ts", "calendar-files.spec.ts", "outlook-mail.spec.ts"], fullyParallel: false, workers: 1,
  outputDir: "../../output/playwright/web-offline-results", reporter: "line",
  use: { baseURL: "http://127.0.0.1:4176", browserName: "chromium", trace: "retain-on-failure",
    launchOptions: process.env.OPENJOB_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OPENJOB_CHROMIUM_EXECUTABLE } : undefined },
  webServer: { cwd: fileURLToPath(new URL("../..", import.meta.url)), command: "node scripts/dev-personal-workspace.mjs --port 4176", port: 4176, reuseExistingServer: false, timeout: 60000 },
});
