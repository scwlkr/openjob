import vinext from "vinext";
import { defineConfig } from "vite";

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

  return {
    plugins: [
      vinext(),
      cloudflare({
        configPath: prototypeConfigPath,
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      }),
    ],
  };
});
