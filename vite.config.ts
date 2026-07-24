import { execFileSync } from "node:child_process";
import vinext from "vinext";
import { defineConfig } from "vite";
import { webFirebaseConfigFor } from "./config/web-firebase-config.mjs";
import packageMetadata from "./package.json" with { type: "json" };

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const prototypeConfigPath = process.env.OPENJOB_ASSIGNEE_COLUMNS_PROTOTYPE
    ? "app/prototype/assignee-columns/wrangler.prototype.jsonc"
    : undefined;
  const gitCommit = process.env.OPENJOB_GIT_COMMIT ?? execFileSync(
    "git",
    ["rev-parse", "--short=12", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const webFirebaseConfig = webFirebaseConfigFor(
    process.env.CLOUDFLARE_ENV,
  );

  return {
    define: {
      __OPENJOB_FIREBASE_CONFIG__: JSON.stringify(webFirebaseConfig),
      __OPENJOB_GIT_COMMIT__: JSON.stringify(gitCommit),
      __OPENJOB_VERSION__: JSON.stringify(packageMetadata.version),
    },
    plugins: [
      vinext(),
      cloudflare({
        configPath: prototypeConfigPath,
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      }),
    ],
  };
});
