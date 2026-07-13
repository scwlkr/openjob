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
});

test("keeps durable task storage and social metadata wired", async () => {
  const [wrangler, storage, rules, layout, page] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../db/firestore.ts", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(wrangler, /"FIREBASE_PROJECT_ID": "openjob-dev"/);
  assert.match(wrangler, /"pattern": "openjob\.dev"/);
  assert.match(storage, /firestore\.googleapis\.com/);
  assert.match(rules, /allow read, write: if false/);
  assert.match(layout, /\/og\.png/);
  assert.match(page, /fetch\("\/api\/tasks"/);
  assert.match(page, /method: "PATCH"/);
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
});
