import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expo = join(nativeRoot, "node_modules", ".bin", "expo");
const requestedPlatforms = process.argv.slice(2);
if (
  requestedPlatforms.length > 1 ||
  (requestedPlatforms.length === 1 &&
    !["ios", "android"].includes(requestedPlatforms[0]))
) {
  throw new Error("Usage: verify-embedded-bundles.mjs [ios|android]");
}
const platforms = requestedPlatforms.length === 0
  ? ["ios", "android"]
  : requestedPlatforms;
const outputRoot = await mkdtemp(join(tmpdir(), "openjob-native-bundles-"));

function exportBundle(platform, bundle, sourceMap, assets) {
  const result = spawnSync(
    expo,
    [
      "export:embed",
      "--platform",
      platform,
      "--entry-file",
      "index.ts",
      "--dev",
      "false",
      "--minify",
      "true",
      "--bundle-output",
      bundle,
      "--sourcemap-output",
      sourceMap,
      "--assets-dest",
      assets,
      "--max-workers",
      "2",
    ],
    {
      cwd: nativeRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        OPENJOB_NATIVE_ENV: "production",
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Embedded ${platform} bundle export failed:\n${result.stderr || result.stdout}`,
    );
  }
}

async function collectFiles(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await visit(directory);
  return files;
}

try {
  const evidence = [];
  for (const platform of platforms) {
    const platformRoot = join(outputRoot, platform);
    const bundle = join(platformRoot, "main.jsbundle");
    const sourceMap = join(platformRoot, "main.jsbundle.map");
    const assets = join(platformRoot, "assets");
    exportBundle(platform, bundle, sourceMap, assets);

    const [bundleContents, bundleStats, assetFiles, sourceMapContents] = await Promise.all([
      readFile(bundle),
      stat(bundle),
      collectFiles(assets),
      readFile(sourceMap, "utf8"),
    ]);
    const text = bundleContents.toString("utf8");
    assert.ok(bundleStats.size > 100_000, `${platform} bundle is unexpectedly small`);
    assert.ok(assetFiles.length >= 4, `${platform} embedded assets are missing`);
    assert.match(text, /\/api\/v1/u);
    assert.doesNotMatch(text, /https:\/\/u\.expo\.dev/iu);
    for (const replayMarker of [
      "RNSentryReplayMask",
      "RNSentryReplayUnmask",
      "mobileReplayIntegration",
      "browserReplayIntegration",
      "captureReplay",
      "SentrySessionReplay",
    ]) {
      assert.doesNotMatch(
        text,
        new RegExp(replayMarker, "u"),
        `${platform} bundle contains disabled Sentry Session Replay code: ${replayMarker}`,
      );
    }
    const sources = JSON.parse(sourceMapContents).sources;
    assert.ok(Array.isArray(sources), `${platform} source map has no sources`);
    const prohibitedSentrySources = sources.filter(
      (source) =>
        typeof source === "string" &&
        /(?:@sentry|sentry-internal).*(?:feedback|profiling|replay|tracing)/iu.test(
          source,
        ),
    );
    assert.deepEqual(
      prohibitedSentrySources,
      [],
      `${platform} bundle contains disabled Sentry feature modules`,
    );
    assert.doesNotMatch(text, /Crashlytics|PostHog/iu);

    evidence.push(
      `${platform} ${bundleStats.size} bytes sha256:${createHash("sha256")
        .update(bundleContents)
        .digest("hex")
        .slice(0, 16)} assets:${assetFiles.length}`,
    );
  }
  process.stdout.write(
    `Embedded bundle verification passed: ${evidence.join("; ")}.\n`,
  );
} finally {
  await rm(outputRoot, { force: true, recursive: true });
}
