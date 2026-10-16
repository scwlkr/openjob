import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { collectBrowserProvenance } from "./browser/browser-provenance.mjs";

const expected = { playwright: "1.61.1", version: "149.0.7827.55", revision: "1228" };
const source = { commit: "fixture-source", trackedChanges: false };

test("provenance identifies actual worker binary and baseline content without retaining arguments", async t => {
  const dir = await mkdtemp(join(tmpdir(), "openjob-provenance-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, "chrome");
  const snapshot = join(dir, "variant-b-phone-linux.png");
  await writeFile(executable, "fixture browser bytes"); await writeFile(snapshot, "fixture baseline bytes");
  let detached = false;
  const browser = {
    browserType: () => ({ name: () => "chromium" }), version: () => "154.0.8037.57",
    newBrowserCDPSession: async () => ({
      send: async method => method === "Browser.getVersion" ? { revision: "observed-build" } : { arguments: [executable, "--private-fixture-secret"] },
      detach: async () => { detached = true; },
    }),
  };
  const receipt = await collectBrowserProvenance({ browser, snapshots: [snapshot], expected, source, platform: "linux", arch: "x64" });
  assert.equal(receipt.observed.version, "154.0.8037.57"); assert.equal(receipt.observed.revision, "observed-build");
  assert.equal(receipt.observed.executableSha256, createHash("sha256").update("fixture browser bytes").digest("hex"));
  assert.deepEqual(receipt.snapshots, [{ path: "variant-b-phone-linux.png", sha256: createHash("sha256").update("fixture baseline bytes").digest("hex") }]);
  assert.equal(receipt.versionMatchesExpected, false); assert.equal(detached, true);
  assert.equal(JSON.stringify(receipt).includes("private-fixture-secret"), false);
  assert.equal(JSON.stringify(receipt).includes(dir), false);
  assert.equal(receipt.observed.executable, "chrome");
  const inside = await collectBrowserProvenance({ browser, snapshots: [snapshot], expected, source, projectRoot: dir });
  assert.equal(inside.snapshots[0].path, "variant-b-phone-linux.png");
  assert.deepEqual(receipt.runner, { platform: "linux", arch: "x64" });
});

test("matching versions do not claim pinned provenance and unavailable metadata stays explicit", async () => {
  const browser = {
    browserType: () => ({ name: () => "chromium" }), version: () => expected.version,
    newBrowserCDPSession: async () => { throw new Error("fixture unavailable"); },
  };
  const receipt = await collectBrowserProvenance({ browser, snapshots: ["/absent/fixture-baseline.png"], expected, source });
  assert.equal(receipt.versionMatchesExpected, true);
  assert.equal(receipt.artifactProvenance, "not-established-by-version-match");
  assert.equal(receipt.observed.executable, null); assert.equal(receipt.observed.executableSha256, null);
  assert.equal(receipt.observed.revision, null); assert.equal(receipt.snapshots[0].sha256, null);
});
