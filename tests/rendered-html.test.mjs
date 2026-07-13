import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("defines the Openjob task board", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /Openjob — A shared team to-do list/);
  assert.match(page, /What needs doing\?/);
  assert.match(page, /@shane/);
  assert.match(page, /Shared team board/);
  assert.match(page, /Anyone with the link can add or check off tasks/);
  assert.doesNotMatch(`${page}\n${layout}`, /codex-preview|react-loading-skeleton/);
});

test("keeps durable task storage and social metadata wired", async () => {
  const [hosting, schema, layout, page] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"d1": "DB"/);
  assert.match(schema, /sqliteTable\(\s*"tasks"/);
  assert.match(layout, /\/og\.png/);
  assert.match(page, /fetch\("\/api\/tasks"/);
  assert.match(page, /method: "PATCH"/);
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
});
