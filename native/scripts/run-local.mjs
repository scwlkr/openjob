import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expo = join(nativeRoot, "node_modules", ".bin", "expo");
const [platform, environment, mode, ...forwarded] = process.argv.slice(2);
const platforms = new Set(["android", "ios"]);
const environments = new Set(["development", "preview", "production"]);
const modes = new Set(["debug", "release"]);

if (
  !platforms.has(platform) ||
  !environments.has(environment) ||
  !modes.has(mode) ||
  (environment === "development") !== (mode === "debug")
) {
  throw new Error(
    "Usage: run-local.mjs <ios|android> <development|preview|production> <debug|release> [Expo run options]",
  );
}

const childEnvironment = {
  ...process.env,
  OPENJOB_NATIVE_ENV: environment,
};

function run(args) {
  const result = spawnSync(expo, args, {
    cwd: nativeRoot,
    env: childEnvironment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write(
  `Regenerating ${platform} for the isolated ${environment} identity.\n`,
);
run(["prebuild", "--clean", "--no-install", "--platform", platform]);

const buildSelection =
  platform === "ios"
    ? ["--configuration", mode === "debug" ? "Debug" : "Release"]
    : ["--variant", mode];
run([
  `run:${platform}`,
  ...buildSelection,
  ...(mode === "release" ? ["--no-bundler"] : []),
  ...forwarded,
]);
