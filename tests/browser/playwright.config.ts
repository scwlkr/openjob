import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "openjob-web.spec.ts",
  fullyParallel: false,
  outputDir: "../../output/playwright/test-results",
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite --config vite.config.ts",
    port: 4175,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
