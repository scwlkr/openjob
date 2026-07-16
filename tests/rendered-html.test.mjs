import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("defines the OpenJob sign-in and Group entry", async () => {
  const [page, layout, app] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/openjob-app.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /OpenJob — One clear list for your team/);
  assert.match(page, /createFirebaseAuth/);
  assert.match(page, /createOpenJobApi/);
  assert.match(app, /Your team\. One clear list\./);
  assert.match(app, /Claim your Username/);
  assert.match(app, /Create your first Group/);
});

test("keeps Firebase auth, the v1 API, storage, and social metadata wired", async () => {
  const [wrangler, storage, rules, layout, auth, api, firebase] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../db/firestore-rest.ts", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/firebase-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/openjob-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../firebase.json", import.meta.url), "utf8"),
  ]);

  assert.match(wrangler, /"FIREBASE_PROJECT_ID": "openjob-dev"/);
  assert.match(wrangler, /"pattern": "openjob\.dev"/);
  assert.match(storage, /firestore\.googleapis\.com/);
  assert.match(rules, /allow read, write: if false/);
  assert.match(layout, /\/og\.png/);
  assert.match(auth, /browserLocalPersistence/);
  assert.match(auth, /GoogleAuthProvider/);
  assert.match(api, /\/api\/v1\/me/);
  assert.match(api, /\/api\/v1\/groups/);
  assert.match(firebase, /"googleSignIn"/);
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
});
