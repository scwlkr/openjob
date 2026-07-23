import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { webFirebaseConfigFor } from "../config/web-firebase-config.mjs";

const root = new URL("../", import.meta.url);

test("preview deployment cannot inherit the production Worker or Firebase project", async () => {
  const [wrangler, packageJson, identities] = await Promise.all([
    readFile(new URL("wrangler.jsonc", root), "utf8").then(JSON.parse),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("config/native-identities.json", root), "utf8").then(
      JSON.parse,
    ),
  ]);

  assert.deepEqual(wrangler.env.preview, {
    name: "openjob-preview",
    routes: [],
    vars: {
      FIREBASE_PROJECT_ID: "openjob-nonprod",
    },
    workers_dev: true,
  });
  assert.equal(wrangler.vars.FIREBASE_PROJECT_ID, "openjob-dev");
  assert.deepEqual(wrangler.routes, [
    { custom_domain: true, pattern: "openjob.dev" },
  ]);
  assert.match(
    packageJson.scripts["deploy:preview"],
    /^CLOUDFLARE_ENV=preview /u,
  );
  assert.equal(
    identities.environments.preview.api.baseUrl,
    "https://openjob-preview.walkerworlddiscord.workers.dev/api/v1",
  );
  assert.notEqual(
    identities.environments.preview.api.baseUrl,
    identities.environments.production.api.baseUrl,
  );
  assert.deepEqual(webFirebaseConfigFor("preview"), {
    apiKey: identities.environments.preview.firebase.apiKey,
    appId: identities.environments.preview.firebase.webAppId,
    authDomain: identities.environments.preview.firebase.authDomain,
    projectId: "openjob-nonprod",
  });
  assert.deepEqual(webFirebaseConfigFor(undefined), {
    apiKey: identities.environments.production.firebase.apiKey,
    appId: identities.environments.production.firebase.webAppId,
    authDomain: identities.environments.production.firebase.authDomain,
    projectId: "openjob-dev",
  });
});
