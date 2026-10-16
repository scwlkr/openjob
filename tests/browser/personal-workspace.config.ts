import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../..", import.meta.url));
export default defineConfig({
  testDir: ".", testMatch: ["personal-workspace.spec.ts", "personal-mail.spec.ts", "personal-calendar-workflow.spec.ts"], fullyParallel: false,
  outputDir: "../../output/playwright/personal-workspace-results", reporter: "line",
  use: { baseURL: "http://127.0.0.1:4178", browserName: "chromium", trace: "retain-on-failure",
    launchOptions: process.env.OPENJOB_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OPENJOB_CHROMIUM_EXECUTABLE } : undefined },
  webServer: [
    { cwd, command: "node scripts/personal-workspace-test-server.mjs --test-only", port: 4181, reuseExistingServer: false, timeout: 30000 },
    { cwd, command: "node node_modules/vite/bin/vite.js --config tests/browser/personal-workspace-vite.config.ts", port: 4178, reuseExistingServer: false, timeout: 30000 },
  ],
});
