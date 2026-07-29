import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  qaPasswordTenantIdFor,
  webFirebaseConfigFor,
} from "../config/web-firebase-config.mjs";
import { GOOGLE_PREVIEW_OWNER_DESKTOP_CLIENT_ID } from "../cli/lib/oauth-config.mjs";

const root = new URL("../", import.meta.url);

test("preview deployment cannot inherit the production Worker or Firebase project", async () => {
  const [wrangler, packageJson, identities, fixture] = await Promise.all([
    readFile(new URL("wrangler.jsonc", root), "utf8").then(JSON.parse),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("config/native-identities.json", root), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("config/qa-fixture.json", root), "utf8").then(JSON.parse),
  ]);

  const productionGoogleDeletionClientIds = [
    identities.environments.production.firebase.googleWebClientId,
    identities.environments.production.ios.googleClientId,
    identities.environments.production.android.googleClientId,
  ].join(",");
  const previewGoogleDeletionClientIds = [
    identities.environments.preview.firebase.googleWebClientId,
    identities.environments.development.ios.googleClientId,
    identities.environments.development.android.googleClientId,
    identities.environments.preview.ios.googleClientId,
    identities.environments.preview.android.googleClientId,
  ].join(",");

  assert.deepEqual(wrangler.env.preview, {
    name: "openjob-preview",
    routes: [],
    vars: {
      APPLE_ACCOUNT_DELETION_CLIENT_IDS:
        "dev.openjob.app.preview,dev.openjob.auth.nonprod",
      APPLE_ACCOUNT_DELETION_REDIRECT_URI:
        identities.apple.signInServices.nonproduction.returnUrl,
      APPLE_ACCOUNT_DELETION_SERVICE_ID:
        identities.apple.signInServices.nonproduction.serviceId,
      FIREBASE_API_KEY: identities.environments.preview.firebase.apiKey,
      FIREBASE_PROJECT_ID: "openjob-nonprod",
      GOOGLE_ACCOUNT_DELETION_CLIENT_IDS: previewGoogleDeletionClientIds,
      GOOGLE_OAUTH_CLIENT_ID: GOOGLE_PREVIEW_OWNER_DESKTOP_CLIENT_ID,
      OPENJOB_QA_PASSWORD_TENANT_ID: "OpenJob-QA-Two-mvz9m",
      OPENJOB_RUNTIME_TIER: "preview",
    },
    workers_dev: true,
  });
  const qaPasswordTenantId = qaPasswordTenantIdFor("preview");
  assert.equal(
    qaPasswordTenantId,
    identities.environments.preview.firebase.qaPasswordTenantId,
  );
  assert.equal(
    wrangler.env.preview.vars.OPENJOB_QA_PASSWORD_TENANT_ID,
    qaPasswordTenantId,
  );
  assert.equal(
    fixture.users.qaTwo.authentication.tenantId,
    qaPasswordTenantId,
  );
  assert.equal(qaPasswordTenantIdFor("production"), null);
  assert.equal(
    wrangler.vars.APPLE_ACCOUNT_DELETION_REDIRECT_URI,
    identities.apple.signInServices.production.returnUrl,
  );
  assert.equal(
    wrangler.vars.APPLE_ACCOUNT_DELETION_SERVICE_ID,
    identities.apple.signInServices.production.serviceId,
  );
  assert.equal(
    wrangler.vars.FIREBASE_API_KEY,
    identities.environments.production.firebase.apiKey,
  );
  assert.equal(wrangler.vars.FIREBASE_PROJECT_ID, "openjob-dev");
  assert.equal(
    wrangler.vars.GOOGLE_ACCOUNT_DELETION_CLIENT_IDS,
    productionGoogleDeletionClientIds,
  );
  assert.notEqual(
    wrangler.vars.GOOGLE_ACCOUNT_DELETION_CLIENT_IDS,
    wrangler.vars.GOOGLE_OAUTH_CLIENT_ID,
  );
  assert.notEqual(
    wrangler.env.preview.vars.GOOGLE_ACCOUNT_DELETION_CLIENT_IDS,
    wrangler.env.preview.vars.GOOGLE_OAUTH_CLIENT_ID,
  );
  assert.equal(
    wrangler.vars.GOOGLE_ACCOUNT_DELETION_CLIENT_IDS
      .split(",")
      .includes(wrangler.vars.GOOGLE_OAUTH_CLIENT_ID),
    false,
  );
  assert.equal(
    wrangler.env.preview.vars.GOOGLE_ACCOUNT_DELETION_CLIENT_IDS
      .split(",")
      .includes(wrangler.env.preview.vars.GOOGLE_OAUTH_CLIENT_ID),
    false,
  );
  assert.equal(wrangler.vars.OPENJOB_RUNTIME_TIER, "production");
  assert.equal(
    Object.hasOwn(wrangler.vars, "OPENJOB_QA_PASSWORD_TENANT_ID"),
    false,
  );
  assert.deepEqual(wrangler.routes, [
    { custom_domain: true, pattern: "openjob.dev" },
  ]);
  assert.deepEqual(wrangler.triggers.crons, ["*/15 * * * *"]);
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
