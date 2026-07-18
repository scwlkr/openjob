import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public release metadata identifies the deployed OpenJob build without caching", async () => {
  process.env.OPENJOB_GIT_COMMIT = "0123456789ab";
  const [{ GET }, packageSource] = await Promise.all([
    import("../app/api/version/route.ts"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  const response = GET();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), {
    version: JSON.parse(packageSource).version,
    commit: "0123456789ab",
  });
});
