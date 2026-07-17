import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

function pngDimensions(buffer) {
  assert.deepEqual(
    [...buffer.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("defines the OpenJob sign-in and Group entry", async () => {
  const [page, layout, screens] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/openjob-screens.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /OpenJob — One clear list for your team/);
  assert.match(page, /createFirebaseAuth/);
  assert.match(page, /createOpenJobApi/);
  assert.match(screens, /Your team\. One clear list\./);
  assert.match(screens, /Claim your Username/);
  assert.match(screens, /Create your first Group/);
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
  assert.match(layout, /\/favicon\.svg/);
  assert.match(layout, /\/apple-touch-icon\.png/);
  assert.match(layout, /\/site\.webmanifest/);
  assert.match(layout, /themeColor: "#1e4ed8"/);
  assert.match(auth, /browserLocalPersistence/);
  assert.match(auth, /GoogleAuthProvider/);
  assert.match(api, /\/api\/v1\/me/);
  assert.match(api, /\/api\/v1\/groups/);
  assert.match(firebase, /"googleSignIn"/);
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
});

test("publishes outlined brand masters and install-ready app icons", async () => {
  const [
    wordmark,
    brandmark,
    manifestSource,
    appleIcon,
    icon192,
    icon512,
    maskable192,
    maskable512,
  ] = await Promise.all([
      readFile(
        new URL("../public/brand/openjob-wordmark.svg", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../public/brand/openjob-brandmark.svg", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../public/site.webmanifest", import.meta.url), "utf8"),
      readFile(new URL("../public/apple-touch-icon.png", import.meta.url)),
      readFile(new URL("../public/icon-192.png", import.meta.url)),
      readFile(new URL("../public/icon-512.png", import.meta.url)),
      readFile(new URL("../public/icon-maskable-192.png", import.meta.url)),
      readFile(new URL("../public/icon-maskable-512.png", import.meta.url)),
    ]);
  const manifest = JSON.parse(manifestSource);

  assert.match(wordmark, /Outlined from the production Geist 900 wordmark/);
  assert.match(wordmark, /fill="#6387ff"/);
  assert.doesNotMatch(wordmark, /<text\b/);
  assert.match(brandmark, /fill="#151713"/);
  assert.match(brandmark, /fill="#1e4ed8"/);
  assert.equal(manifest.theme_color, "#1e4ed8");
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, purpose }) => [src, sizes, purpose]),
    [
      ["/icon-192.png", "192x192", "any"],
      ["/icon-512.png", "512x512", "any"],
      ["/icon-maskable-192.png", "192x192", "maskable"],
      ["/icon-maskable-512.png", "512x512", "maskable"],
    ],
  );
  assert.deepEqual(pngDimensions(appleIcon), { width: 180, height: 180 });
  assert.deepEqual(pngDimensions(icon192), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions(icon512), { width: 512, height: 512 });
  assert.deepEqual(pngDimensions(maskable192), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions(maskable512), { width: 512, height: 512 });

  await Promise.all([
    access(new URL("../public/brand/openjob-wordmark-inverse.svg", import.meta.url)),
    access(new URL("../public/brand/openjob-brandmark-mono.svg", import.meta.url)),
    access(new URL("../public/brand/openjob-brandmark-inverse.svg", import.meta.url)),
    access(new URL("../public/brand/openjob-app-icon.svg", import.meta.url)),
    access(new URL("../public/brand/openjob-app-icon-maskable.svg", import.meta.url)),
    access(new URL("../public/favicon.svg", import.meta.url)),
    access(new URL("../public/favicon.png", import.meta.url)),
    access(new URL("../public/favicon.ico", import.meta.url)),
  ]);
});

test("the cutover artifact publishes v1 without the legacy Task route", async () => {
  const worker = await readFile(
    new URL("../dist/server/index.js", import.meta.url),
    "utf8",
  );

  assert.match(worker, /route:\/api\/v1\/me/);
  assert.doesNotMatch(worker, /route:\/api\/tasks/);
});
