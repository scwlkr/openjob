import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountDeletionReauthenticationRequiredError,
  createAccountDeletionProviderGateway,
} from "../server/account-deletion-providers.ts";
import { createPrivateKey } from "./support/fake-firestore.mjs";

async function createApplePrivateKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const base64 = Buffer.from(exported).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

async function createAppleTokenAuthority() {
  const pair = await crypto.subtle.generateKey(
    {
      hash: "SHA-256",
      modulusLength: 2048,
      name: "RSASSA-PKCS1-v1_5",
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    jwk: { ...publicKey, alg: "RS256", kid: "APPLE-ID-KEY", use: "sig" },
    async issue(claims) {
      const header = Buffer.from(JSON.stringify({
        alg: "RS256",
        kid: "APPLE-ID-KEY",
        typ: "JWT",
      })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const input = `${header}.${payload}`;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        pair.privateKey,
        new TextEncoder().encode(input),
      );
      return `${input}.${Buffer.from(signature).toString("base64url")}`;
    },
  };
}

async function createGoogleTokenAuthority(kid = "GOOGLE-ID-KEY") {
  const pair = await crypto.subtle.generateKey(
    {
      hash: "SHA-256",
      modulusLength: 2048,
      name: "RSASSA-PKCS1-v1_5",
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    jwk: { ...publicKey, alg: "RS256", kid, use: "sig" },
    async issue(claims) {
      const header = Buffer.from(JSON.stringify({
        alg: "RS256",
        kid,
        typ: "JWT",
      })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const input = `${header}.${payload}`;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        pair.privateKey,
        new TextEncoder().encode(input),
      );
      return `${input}.${Buffer.from(signature).toString("base64url")}`;
    },
  };
}

async function oidcAccessTokenHash(accessToken) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(accessToken),
  ));
  return Buffer.from(digest.slice(0, digest.byteLength / 2)).toString("base64url");
}

async function createGateway(fetchImplementation, overrides = {}) {
  return createAccountDeletionProviderGateway({
    apple: {
      allowedClientIds: ["dev.openjob.app", "dev.openjob.auth"],
      keyId: "APPLEKEY1",
      privateKey: await createApplePrivateKey(),
      redirectUrisByClientId: {
        "dev.openjob.auth": [
          "https://openjob-dev.firebaseapp.com/__/auth/handler",
        ],
      },
      teamId: "TEAMOPENJOB",
    },
    fetchImplementation,
    firebase: {
      apiKey: "firebase-web-api-key",
      clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
      privateKey: await createPrivateKey(),
      projectId: "openjob-dev",
    },
    google: {
      allowedClientIds: [
        "google-web-client.apps.googleusercontent.com",
        "google-ios-client.apps.googleusercontent.com",
      ],
    },
    now: () => Date.parse("2026-07-28T12:00:00.000Z"),
    ...overrides,
  });
}

test("provider gateway revokes Firebase sessions and deletes Firebase Users", async () => {
  const requests = [];
  const gateway = await createGateway(async (input, init = {}) => {
    requests.push({ body: init.body, headers: new Headers(init.headers), url: String(input) });
    if (String(input) === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "firebase-admin-access" });
    }
    return Response.json({ localId: "firebase_delete" });
  });
  gateway.assertReady();
  await gateway.revokeFirebaseSessions("firebase_delete");
  await gateway.deleteFirebaseUser("firebase_delete");
  const identityRequests = requests.filter(({ url }) =>
    url.includes("identitytoolkit.googleapis.com"),
  );
  assert.equal(identityRequests.length, 2);
  assert.ok(identityRequests[0].url.endsWith("/accounts:update"));
  assert.deepEqual(JSON.parse(identityRequests[0].body), {
    localId: "firebase_delete",
    validSince: "1785240000",
  });
  assert.ok(identityRequests[1].url.endsWith("/accounts:delete"));
  assert.equal(
    identityRequests.every(
      ({ headers }) => headers.get("authorization") === "Bearer firebase-admin-access",
    ),
    true,
  );
});

test("provider gateway binds Google proof to the fresh subject and client without URL secrets", async () => {
  const authority = await createGoogleTokenAuthority();
  const requests = [];
  const gateway = await createGateway(async (input, init = {}) => {
    requests.push({
      body: String(init.body ?? ""),
      method: init.method,
      url: String(input),
    });
    if (String(input).endsWith("/oauth2/v3/certs")) {
      return Response.json({ keys: [authority.jwk] });
    }
    return new Response(null, { status: 200 });
  });
  const providerIdToken = await authority.issue({
    at_hash: await oidcAccessTokenHash("google-proof"),
    aud: "google-web-client.apps.googleusercontent.com",
    azp: "google-ios-client.apps.googleusercontent.com",
    exp: 1785241800,
    iat: 1785240000,
    iss: "https://accounts.google.com",
    sub: "google-subject",
  });
  const prepared = await gateway.prepareAuthorization({
    firebaseUid: "firebase_google",
    provider: "google",
    providerSubject: "google-subject",
    revocation: {
      idToken: providerIdToken,
      kind: "access_token",
      value: "google-proof",
    },
  });
  assert.deepEqual(prepared, {
    firebaseUid: "firebase_google",
    provider: "google",
    providerSubject: "google-subject",
    revocation: {
      clientId: "google-ios-client.apps.googleusercontent.com",
      expiresAt: "2026-07-28T12:30:00.000Z",
      kind: "validated_access_token",
      value: "google-proof",
    },
  });
  await gateway.revokeAuthorization(prepared);
  assert.deepEqual(requests, [
    {
      body: "",
      method: undefined,
      url: "https://www.googleapis.com/oauth2/v3/certs",
    },
    {
      body: "token=google-proof",
      method: "POST",
      url: "https://oauth2.googleapis.com/revoke",
    },
  ]);
  assert.equal(requests.some(({ url }) => url.includes("google-proof")), false);
});

test("provider gateway rejects wrong, unrelated, or expired Google proof before revocation", async () => {
  const authority = await createGoogleTokenAuthority();
  for (const claims of [
    {
      at_hash: await oidcAccessTokenHash("google-proof"),
      aud: "google-web-client.apps.googleusercontent.com",
      azp: "google-ios-client.apps.googleusercontent.com",
      exp: 1785241800,
      iat: 1785240000,
      iss: "https://accounts.google.com",
      sub: "another-google-subject",
    },
    {
      at_hash: await oidcAccessTokenHash("google-proof"),
      aud: "unrelated-client.apps.googleusercontent.com",
      azp: "unrelated-client.apps.googleusercontent.com",
      exp: 1785241800,
      iat: 1785240000,
      iss: "https://accounts.google.com",
      sub: "google-subject",
    },
    {
      at_hash: await oidcAccessTokenHash("google-proof"),
      aud: "google-web-client.apps.googleusercontent.com",
      azp: "google-ios-client.apps.googleusercontent.com",
      exp: 1785239999,
      iat: 1785239000,
      iss: "https://accounts.google.com",
      sub: "google-subject",
    },
    {
      at_hash: await oidcAccessTokenHash("different-access-token"),
      aud: "google-web-client.apps.googleusercontent.com",
      exp: 1785241800,
      iat: 1785240000,
      iss: "https://accounts.google.com",
      sub: "google-subject",
    },
  ]) {
    const requests = [];
    const gateway = await createGateway(async (input, init = {}) => {
      requests.push({ body: String(init.body ?? ""), url: String(input) });
      return Response.json({ keys: [authority.jwk] });
    });
    const idToken = await authority.issue(claims);
    await assert.rejects(() => gateway.prepareAuthorization({
      firebaseUid: "firebase_google",
      provider: "google",
      providerSubject: "google-subject",
      revocation: { idToken, kind: "access_token", value: "google-proof" },
    }));
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://www.googleapis.com/oauth2/v3/certs",
    );
  }
});

test("provider gateway refreshes a cached Google key set for an unknown key id", async () => {
  const first = await createGoogleTokenAuthority("GOOGLE-KEY-ONE");
  const second = await createGoogleTokenAuthority("GOOGLE-KEY-TWO");
  let keyRequests = 0;
  const gateway = await createGateway(async (input) => {
    if (String(input).endsWith("/oauth2/v3/certs")) {
      keyRequests += 1;
      return Response.json(
        { keys: [keyRequests === 1 ? first.jwk : second.jwk] },
        { headers: { "cache-control": "public, max-age=3600" } },
      );
    }
    throw new Error("Unexpected request.");
  });
  for (const [authority, suffix] of [[first, "one"], [second, "two"]]) {
    const accessToken = `google-proof-${suffix}`;
    const idToken = await authority.issue({
      at_hash: await oidcAccessTokenHash(accessToken),
      aud: "google-web-client.apps.googleusercontent.com",
      exp: 1785241800,
      iat: 1785240000,
      iss: "https://accounts.google.com",
      sub: "google-subject",
    });
    await gateway.prepareAuthorization({
      firebaseUid: "firebase_google",
      provider: "google",
      providerSubject: "google-subject",
      revocation: { idToken, kind: "access_token", value: accessToken },
    });
  }
  assert.equal(keyRequests, 2);
});

test("provider gateway never infers Google completion from a 400 response or expired handle", async () => {
  const gateway = await createGateway(async (input) => {
    if (String(input).endsWith("/revoke")) {
      return Response.json({ error: "invalid_token" }, { status: 400 });
    }
    throw new Error("Unexpected request.");
  });
  const prepared = {
    firebaseUid: "firebase_google",
    provider: "google",
    providerSubject: "google-subject",
    revocation: {
      clientId: "google-web-client.apps.googleusercontent.com",
      expiresAt: "2026-07-28T12:30:00.000Z",
      kind: "validated_access_token",
      value: "google-proof",
    },
  };
  await assert.rejects(() => gateway.revokeAuthorization(prepared));
  await assert.rejects(() => gateway.revokeAuthorization({
    ...prepared,
    revocation: {
      ...prepared.revocation,
      expiresAt: "2026-07-28T11:59:59.999Z",
    },
  }));
});

test("provider gateway durably prepares a subject-bound Apple code handle before revocation", async () => {
  const authority = await createAppleTokenAuthority();
  const requests = [];
  const gateway = await createGateway(async (input, init = {}) => {
    requests.push({ body: String(init.body ?? ""), url: String(input) });
    if (String(input).endsWith("/auth/keys")) {
      return Response.json({ keys: [authority.jwk] });
    }
    if (String(input).endsWith("/auth/token")) {
      return Response.json({
        id_token: await authority.issue({
          aud: "dev.openjob.app",
          exp: 1785241800,
          iat: 1785240000,
          iss: "https://appleid.apple.com",
          sub: "apple-subject",
        }),
        refresh_token: "apple-refresh",
      });
    }
    return new Response(null, { status: 200 });
  });
  const providerIdToken = await authority.issue({
    aud: "dev.openjob.app",
    exp: 1785241800,
    iat: 1785240000,
    iss: "https://appleid.apple.com",
    sub: "apple-subject",
  });
  const prepared = await gateway.prepareAuthorization({
    firebaseUid: "firebase_apple",
    provider: "apple",
    providerSubject: "apple-subject",
    revocation: {
      clientId: "dev.openjob.app",
      idToken: providerIdToken,
      kind: "authorization_code",
      value: "fresh-apple-code",
    },
  });
  assert.deepEqual(prepared, {
    firebaseUid: "firebase_apple",
    provider: "apple",
    providerSubject: "apple-subject",
    revocation: {
      clientId: "dev.openjob.app",
      kind: "refresh_token",
      value: "apple-refresh",
    },
  });
  await gateway.revokeAuthorization(prepared);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, "https://appleid.apple.com/auth/keys");
  assert.ok(requests[1].body.includes("code=fresh-apple-code"));
  assert.ok(requests[1].body.includes("client_id=dev.openjob.app"));
  assert.ok(requests[2].body.includes("token=apple-refresh"));
  assert.ok(requests[2].body.includes("token_type_hint=refresh_token"));
});

test("provider gateway rejects an Apple exchange for a different fresh subject", async () => {
  const authority = await createAppleTokenAuthority();
  const requests = [];
  const gateway = await createGateway(async (input, init = {}) => {
    requests.push({ body: String(init.body ?? ""), url: String(input) });
    if (String(input).endsWith("/auth/token")) {
      return Response.json({
        id_token: await authority.issue({
          aud: "dev.openjob.app",
          exp: 1785241800,
          iat: 1785240000,
          iss: "https://appleid.apple.com",
          sub: "another-apple-subject",
        }),
        refresh_token: "apple-refresh",
      });
    }
    return Response.json({ keys: [authority.jwk] });
  });
  const providerIdToken = await authority.issue({
    aud: "dev.openjob.app",
    exp: 1785241800,
    iat: 1785240000,
    iss: "https://appleid.apple.com",
    sub: "apple-subject",
  });
  await assert.rejects(() => gateway.prepareAuthorization({
    firebaseUid: "firebase_apple",
    provider: "apple",
    providerSubject: "apple-subject",
    revocation: {
      clientId: "dev.openjob.app",
      idToken: providerIdToken,
      kind: "authorization_code",
      value: "fresh-apple-code",
    },
  }));
  assert.equal(
    requests.some(({ url }) => url.endsWith("/auth/revoke")),
    false,
  );
});

test("provider gateway never retries an Apple authorization code after exchange begins", async () => {
  const authority = await createAppleTokenAuthority();
  const requests = [];
  const gateway = await createGateway(async (input) => {
    requests.push(String(input));
    if (String(input).endsWith("/auth/keys")) {
      return Response.json({ keys: [authority.jwk] });
    }
    if (String(input).endsWith("/auth/token")) {
      return new Response(null, { status: 503 });
    }
    throw new Error("Unexpected provider request.");
  });
  const idToken = await authority.issue({
    aud: "dev.openjob.app",
    exp: 1785241800,
    iat: 1785240000,
    iss: "https://appleid.apple.com",
    sub: "apple-subject",
  });

  await assert.rejects(
    () => gateway.prepareAuthorization({
      firebaseUid: "firebase_apple",
      provider: "apple",
      providerSubject: "apple-subject",
      revocation: {
        clientId: "dev.openjob.app",
        idToken,
        kind: "authorization_code",
        value: "single-use-code",
      },
    }),
    (error) => error instanceof AccountDeletionReauthenticationRequiredError,
  );
  assert.deepEqual(requests, [
    "https://appleid.apple.com/auth/keys",
    "https://appleid.apple.com/auth/token",
  ]);
});

test("provider gateway sends the exact allowlisted Apple redirect URI during code exchange", async () => {
  const authority = await createAppleTokenAuthority();
  const requests = [];
  const gateway = await createGateway(async (input, init = {}) => {
    requests.push({ body: String(init.body ?? ""), url: String(input) });
    if (String(input).endsWith("/auth/keys")) {
      return Response.json({ keys: [authority.jwk] });
    }
    if (String(input).endsWith("/auth/token")) {
      return Response.json({
        id_token: await authority.issue({
          aud: "dev.openjob.auth",
          exp: 1785241800,
          iat: 1785240000,
          iss: "https://appleid.apple.com",
          sub: "apple-subject",
        }),
        refresh_token: "apple-refresh",
      });
    }
    throw new Error("Unexpected request.");
  });
  const idToken = await authority.issue({
    aud: "dev.openjob.auth",
    exp: 1785241800,
    iat: 1785240000,
    iss: "https://appleid.apple.com",
    sub: "apple-subject",
  });
  await gateway.prepareAuthorization({
    firebaseUid: "firebase_apple",
    provider: "apple",
    providerSubject: "apple-subject",
    revocation: {
      clientId: "dev.openjob.auth",
      idToken,
      kind: "authorization_code",
      redirectUri: "https://openjob-dev.firebaseapp.com/__/auth/handler",
      value: "fresh-apple-code",
    },
  });
  assert.equal(requests[0].url, "https://appleid.apple.com/auth/keys");
  assert.ok(requests[1].body.includes(
    "redirect_uri=https%3A%2F%2Fopenjob-dev.firebaseapp.com%2F__%2Fauth%2Fhandler",
  ));

  const invalidGateway = await createGateway(async () => {
    throw new Error("The invalid redirect must fail before a provider call.");
  });
  await assert.rejects(() => invalidGateway.prepareAuthorization({
    firebaseUid: "firebase_apple",
    provider: "apple",
    providerSubject: "apple-subject",
    revocation: {
      clientId: "dev.openjob.auth",
      idToken,
      kind: "authorization_code",
      redirectUri: "https://attacker.example/callback",
      value: "fresh-apple-code",
    },
  }));
  await assert.rejects(() => invalidGateway.prepareAuthorization({
    firebaseUid: "firebase_apple",
    provider: "apple",
    providerSubject: "apple-subject",
    revocation: {
      clientId: "dev.openjob.auth",
      idToken,
      kind: "authorization_code",
      value: "fresh-apple-code",
    },
  }));
});

test("provider gateway binds web Apple access-token revocation through Identity Platform", async () => {
  const requests = [];
  const gateway = await createGateway(async (input, init = {}) => {
    requests.push({
      body: String(init.body ?? ""),
      headers: Object.fromEntries(new Headers(init.headers)),
      url: String(input),
    });
    if (String(input) === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "firebase-admin-access" });
    }
    return new Response(null, { status: 200 });
  });
  await gateway.revokeAuthorization({
    firebaseIdToken: "fresh-firebase-apple-id-token",
    firebaseIdTokenExpiresAt: "2026-07-28T12:30:00.000Z",
    firebaseUid: "firebase_apple",
    provider: "apple",
    providerSubject: "apple-subject",
    revocation: {
      clientId: "dev.openjob.auth",
      kind: "access_token",
      value: "apple-access-token",
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].url,
    "https://identitytoolkit.googleapis.com/v2/accounts:revokeToken",
  );
  assert.equal(requests[1].headers["x-goog-api-key"], "firebase-web-api-key");
  assert.equal(
    requests[1].headers.authorization,
    "Bearer firebase-admin-access",
  );
  assert.deepEqual(JSON.parse(requests[1].body), {
    idToken: "fresh-firebase-apple-id-token",
    providerId: "apple.com",
    token: "apple-access-token",
    tokenType: "ACCESS_TOKEN",
  });
  assert.equal(
    requests.some(({ url }) =>
      url.includes("apple-access-token") ||
      url.includes("fresh-firebase-apple-id-token")
    ),
    false,
  );
});

test("expired web Apple proof requires reauthentication without a provider call", async () => {
  let requests = 0;
  const gateway = await createGateway(async () => {
    requests += 1;
    throw new Error("Unexpected request.");
  });
  await assert.rejects(
    () => gateway.revokeAuthorization({
      firebaseIdToken: "expired-firebase-apple-id-token",
      firebaseIdTokenExpiresAt: "2026-07-28T12:00:00.000Z",
      firebaseUid: "firebase_apple",
      provider: "apple",
      providerSubject: "apple-subject",
      revocation: {
        clientId: "dev.openjob.auth",
        kind: "access_token",
        value: "apple-access-token",
      },
    }),
    AccountDeletionReauthenticationRequiredError,
  );
  assert.equal(requests, 0);
});

test("provider signing-key outage remains automatically retryable", async () => {
  const gateway = await createGateway(async () =>
    Response.json({ error: "unavailable" }, { status: 503 })
  );
  await assert.rejects(
    () => gateway.prepareAuthorization({
      firebaseUid: "firebase_google",
      provider: "google",
      providerSubject: "google-subject",
      revocation: {
        idToken: "eyJhbGciOiJSUzI1NiIsImtpZCI6ImtleSJ9.e30.signature",
        kind: "access_token",
        value: "google-proof",
      },
    }),
    (error) =>
      !(error instanceof AccountDeletionReauthenticationRequiredError) &&
      error.message === "Provider signing keys are unavailable.",
  );
});

test("provider gateway rejects an unapproved Apple client before exchange", async () => {
  let requests = 0;
  const gateway = await createGateway(async () => {
    requests += 1;
    return new Response(null, { status: 200 });
  });
  await assert.rejects(() =>
    gateway.revokeAuthorization({
      firebaseUid: "firebase_apple",
      provider: "apple",
      providerSubject: "apple-subject",
      revocation: {
        clientId: "example.attacker",
        idToken: "provider-id-token",
        kind: "authorization_code",
        value: "fresh-apple-code",
      },
    }),
  );
  assert.equal(requests, 0);
});
