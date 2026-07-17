import assert from "node:assert/strict";
import test from "node:test";
import { createCliAuthExchangeHandler } from "../server/cli-auth-exchange.ts";

const clientId = "desktop-client.apps.googleusercontent.com";
const clientSecret = "test-client-secret-process-only";
const redirectUri = "http://127.0.0.1:43123/callback";
const codeVerifier = "v".repeat(64);

function exchangeRequest(body) {
  return new Request("https://openjob.test/api/cli-auth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("the CLI exchange bridge keeps the client secret server-side", async () => {
  let providerBody;
  const handle = createCliAuthExchangeHandler({
    clientId,
    clientSecret,
    fetchImplementation: async (url, init) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(init.method, "POST");
      providerBody = new URLSearchParams(init.body);
      return Response.json({ id_token: "google-id-token-process-only" });
    },
    requestId: () => "req_cli_auth",
  });

  const response = await handle(
    exchangeRequest({ code: "one-time-code", codeVerifier, redirectUri }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    data: { idToken: "google-id-token-process-only" },
  });
  assert.deepEqual(Object.fromEntries(providerBody), {
    client_id: clientId,
    client_secret: clientSecret,
    code: "one-time-code",
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
});

test("the CLI exchange bridge rejects invalid loopback and PKCE input", async () => {
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
