import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createCliAuthExchangeHandler,
  createCliAuthExchangeRuntimeHandler,
} from "../server/cli-auth-exchange.ts";
import {
  GOOGLE_DESKTOP_CLIENT_ID,
  GOOGLE_PREVIEW_QA_DESKTOP_CLIENT_ID,
} from "../cli/lib/oauth-config.mjs";

const redirectUri = "http://127.0.0.1:43123/callback";
const codeVerifier = "v".repeat(64);

function exchangeRequest(body) {
  return new Request("https://openjob.test/api/cli-auth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Wrangler binds distinct public OAuth clients without storing their secrets", async () => {
  const config = JSON.parse(
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  const productionClientId = config.vars.GOOGLE_OAUTH_CLIENT_ID;
  const previewClientId =
    config.env.preview.vars.GOOGLE_OAUTH_CLIENT_ID;

  assert.equal(
    productionClientId,
    GOOGLE_DESKTOP_CLIENT_ID,
  );
  assert.equal(previewClientId, GOOGLE_PREVIEW_QA_DESKTOP_CLIENT_ID);
  assert.notEqual(
    GOOGLE_PREVIEW_QA_DESKTOP_CLIENT_ID,
    GOOGLE_DESKTOP_CLIENT_ID,
  );
  assert.match(
    previewClientId,
    /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
  );
  assert.equal(JSON.stringify(config).includes("GOOGLE_OAUTH_CLIENT_SECRET"), false);
});

test("the CLI exchange bridge uses only its configured environment client", async () => {
  for (const environment of [
    {
      name: "production",
      clientId: "production-desktop.apps.googleusercontent.com",
      clientSecret: "production-client-secret-process-only",
    },
    {
      name: "preview",
      clientId: "preview-desktop.apps.googleusercontent.com",
      clientSecret: "preview-client-secret-process-only",
    },
  ]) {
    let providerBody;
    const handle = createCliAuthExchangeHandler({
      clientId: environment.clientId,
      clientSecret: environment.clientSecret,
      fetchImplementation: async (url, init) => {
        assert.equal(url, "https://oauth2.googleapis.com/token");
        assert.equal(init.method, "POST");
        providerBody = new URLSearchParams(init.body);
        return Response.json({ id_token: `${environment.name}-google-id-token` });
      },
      requestId: () => `req_cli_auth_${environment.name}`,
    });

    const response = await handle(
      exchangeRequest({
        clientId: "request-selected-client.apps.googleusercontent.com",
        clientSecret: "request-selected-secret",
        code: "one-time-code",
        codeVerifier,
        redirectUri,
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      data: { idToken: `${environment.name}-google-id-token` },
    });
    assert.deepEqual(Object.fromEntries(providerBody), {
      client_id: environment.clientId,
      client_secret: environment.clientSecret,
      code: "one-time-code",
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
  }
});

test("the CLI exchange bridge fails closed when an environment binding is missing", async () => {
  for (const bindings of [
    {
      clientId: "",
      clientSecret: "configured-secret-process-only",
    },
    {
      clientId: "configured-client.apps.googleusercontent.com",
      clientSecret: "",
    },
  ]) {
    const handle = createCliAuthExchangeRuntimeHandler(
      () => bindings,
      () => "req_missing_oauth_binding",
    );
    const response = await handle(
      exchangeRequest({ code: "one-time-code", codeVerifier, redirectUri }),
    );
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.match(text, /internal_error/);
    assert.doesNotMatch(
      text,
      /configured-client|configured-secret|GOOGLE_OAUTH|clientSecret/,
    );
  }
});

test("the CLI exchange bridge rejects invalid loopback and PKCE input", async () => {
  const clientId = "desktop-client.apps.googleusercontent.com";
  const clientSecret = "test-client-secret-process-only";
  let providerCalls = 0;
  const handle = createCliAuthExchangeHandler({
    clientId,
    clientSecret,
    fetchImplementation: async () => {
      providerCalls += 1;
      return Response.json({});
    },
    requestId: () => "req_invalid_handoff",
  });

  for (const body of [
    { code: "one-time-code", codeVerifier: "short", redirectUri },
    {
      code: "one-time-code",
      codeVerifier,
      redirectUri: "http://localhost:43123/callback",
    },
  ]) {
    const response = await handle(exchangeRequest(body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
  }
  assert.equal(providerCalls, 0);
});

test("the CLI exchange bridge does not expose provider failures", async () => {
  const clientId = "desktop-client.apps.googleusercontent.com";
  const clientSecret = "test-client-secret-process-only";
  const handle = createCliAuthExchangeHandler({
    clientId,
    clientSecret,
    fetchImplementation: async () =>
      Response.json(
        { error: "invalid_grant", error_description: "provider detail" },
        { status: 400 },
      ),
    requestId: () => "req_rejected_handoff",
  });

  const response = await handle(
    exchangeRequest({ code: "expired-code", codeVerifier, redirectUri }),
  );
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.match(text, /auth_failed/);
  assert.doesNotMatch(text, /invalid_grant|provider detail|client-secret/);
});

test("the CLI exchange bridge preserves provider rate limits and outages", async () => {
  const clientId = "desktop-client.apps.googleusercontent.com";
  const clientSecret = "test-client-secret-process-only";
  for (const { providerStatus, expectedStatus, expectedCode } of [
    { providerStatus: 429, expectedStatus: 429, expectedCode: "rate_limited" },
    { providerStatus: 503, expectedStatus: 503, expectedCode: "service_unavailable" },
  ]) {
    const handle = createCliAuthExchangeHandler({
      clientId,
      clientSecret,
      fetchImplementation: async () =>
        Response.json({ error: "provider_failure" }, { status: providerStatus }),
      requestId: () => `req_provider_${providerStatus}`,
    });
    const response = await handle(
      exchangeRequest({ code: "one-time-code", codeVerifier, redirectUri }),
    );
    assert.equal(response.status, expectedStatus);
    assert.equal((await response.json()).error.code, expectedCode);
  }
});
