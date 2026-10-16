import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

async function sha256(path) {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
  } catch { return null; }
}

/** Retain hashes and safe path labels; arguments and absolute paths may contain private data. */
export async function collectBrowserProvenance({ browser, snapshots, expected, source, platform = process.platform, arch = process.arch, projectRoot = process.cwd() }) {
  let session;
  let observed = { name: browser.browserType().name(), version: browser.version(), revision: null, executable: null, executableSha256: null };
  try {
    session = await browser.newBrowserCDPSession();
    const version = await session.send("Browser.getVersion");
    observed.revision = typeof version.revision === "string" ? version.revision : null;
    const command = await session.send("Browser.getBrowserCommandLine");
    const executable = command.arguments?.[0];
    if (typeof executable === "string" && isAbsolute(executable)) {
      observed.executable = basename(executable);
      observed.executableSha256 = await sha256(executable);
    }
  } catch { /* Observed fixture version remains useful when CDP metadata is unavailable. */ }
  finally { await session?.detach().catch(() => {}); }
  return {
    schemaVersion: 1,
    runner: { platform, arch },
    source,
    expected,
    observed,
    versionMatchesExpected: observed.version === expected.version,
    // A matching version alone does not establish the binary's download provenance.
    artifactProvenance: "not-established-by-version-match",
    snapshots: await Promise.all(snapshots.map(async path => {
      const label = relative(projectRoot, path);
      return { path: label && label !== ".." && !label.startsWith("../") && !isAbsolute(label) ? label : basename(path), sha256: await sha256(path) };
    })),
  };
}

/** Attach provenance from the same browser fixture that executes the visual assertion. */
export async function attachBrowserProvenance(browser, testInfo, names) {
  const coreRoot = dirname(require.resolve("playwright-core/package.json"));
  const corePackage = JSON.parse(await readFile(join(coreRoot, "package.json"), "utf8"));
  const registry = JSON.parse(await readFile(join(coreRoot, "browsers.json"), "utf8"));
  const pinned = registry.browsers.find(value => value.name === "chromium");
  const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const dirty = spawnSync("git", ["diff", "--quiet", "HEAD"], { encoding: "utf8" });
  const receipt = await collectBrowserProvenance({
    browser,
    snapshots: names.map(name => testInfo.snapshotPath(name)),
    expected: { playwright: corePackage.version, version: pinned.browserVersion, revision: pinned.revision },
    source: { commit: git.status === 0 ? git.stdout.trim() : null, trackedChanges: dirty.status === 0 ? false : dirty.status === 1 ? true : null },
  });
  await testInfo.attach("browser-provenance", { body: Buffer.from(JSON.stringify(receipt, null, 2) + "\n"), contentType: "application/json" });
}
