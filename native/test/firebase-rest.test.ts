import {
  createFirebaseAuthClient,
  type FetchImplementation,
} from "../src/auth/firebase-rest";
import { ProviderSignInError } from "../src/auth/coordinator";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

test("exchanges only the provider token and Apple nonce for a memory session", async () => {
  const fetchImplementation = jest.fn<ReturnType<FetchImplementation>, Parameters<FetchImplementation>>(
    async () =>
      jsonResponse({
        expiresIn: "3600",
        idToken: "firebase-id",
        refreshToken: "firebase-refresh",
      }),
  );
  const client = createFirebaseAuthClient({
    apiKey: "public-api-key",
    authDomain: "openjob-nonprod.firebaseapp.com",
    fetchImplementation,
    now: () => 1_000,
    qaPasswordTenantId: null,
  });

  await expect(
    client.exchange({
      idToken: "apple-id",
      nonce: "raw-nonce",
      provider: "apple",
    }),
  ).resolves.toEqual({
    expiresAt: 3_601_000,
    idToken: "firebase-id",
    provider: "apple",
    refreshToken: "firebase-refresh",
  });

  const [url, init] = fetchImplementation.mock.calls[0]!;
  expect(url).toBe(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=public-api-key",
  );
  expect(JSON.parse(String(init?.body))).toEqual({
    postBody: "id_token=apple-id&providerId=apple.com&nonce=raw-nonce",
    requestUri: "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
    returnSecureToken: true,
  });
  expect(String(init?.body)).not.toMatch(/email|name/iu);
});

test("refreshes from the secure refresh credential and rotates it in memory", async () => {
  const fetchImplementation = jest.fn(async () =>
    jsonResponse({
      expires_in: "1800",
      id_token: "rotated-id",
      refresh_token: "rotated-refresh",
    }),
  );
  const client = createFirebaseAuthClient({
    apiKey: "public-api-key",
    authDomain: "openjob-nonprod.firebaseapp.com",
    fetchImplementation,
    now: () => 5_000,
    qaPasswordTenantId: null,
  });

  await expect(
    client.refresh({
      provider: "google",
      refreshToken: "stored-refresh",
      version: 1,
    }),
  ).resolves.toEqual({
    expiresAt: 1_805_000,
    idToken: "rotated-id",
    provider: "google",
    refreshToken: "rotated-refresh",
  });
  expect(fetchImplementation).toHaveBeenCalledWith(
    "https://securetoken.googleapis.com/v1/token?key=public-api-key",
    expect.objectContaining({
      body: "grant_type=refresh_token&refresh_token=stored-refresh",
    }),
  );
});

test("signs in only to the configured Preview QA tenant without creating an account", async () => {
  const fetchImplementation = jest.fn<
    ReturnType<FetchImplementation>,
    Parameters<FetchImplementation>
  >(
    async () =>
      jsonResponse({
        expiresIn: "3600",
        idToken: "qa-id",
        refreshToken: "qa-refresh",
      }),
  );
  const client = createFirebaseAuthClient({
    apiKey: "public-api-key",
    authDomain: "openjob-nonprod.firebaseapp.com",
    fetchImplementation,
    now: () => 2_000,
    qaPasswordTenantId: "OpenJob-QA-Two-mvz9m",
  });

  await expect(
    client.signInWithPassword(
      "qa@example.invalid",
      "fixture-password",
    ),
  ).resolves.toEqual({
    expiresAt: 3_602_000,
    idToken: "qa-id",
    provider: "qa-password",
    refreshToken: "qa-refresh",
  });

  const [url, init] = fetchImplementation.mock.calls[0]!;
  expect(url).toBe(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=public-api-key",
  );
  expect(url).not.toContain("signUp");
  expect(JSON.parse(String(init?.body))).toEqual({
    email: "qa@example.invalid",
    password: "fixture-password",
    returnSecureToken: true,
    tenantId: "OpenJob-QA-Two-mvz9m",
  });
});

test("fails closed and generically for unavailable Preview QA password sign-in", async () => {
  const fetchImplementation = jest.fn(async () =>
    jsonResponse({ error: { message: "INVALID_PASSWORD" } }, 400),
  );
  const client = createFirebaseAuthClient({
    apiKey: "public-api-key",
    authDomain: "openjob-nonprod.firebaseapp.com",
    fetchImplementation,
    qaPasswordTenantId: "OpenJob-QA-Two-mvz9m",
  });

  await expect(
    client.signInWithPassword(
      "qa@example.invalid",
      "wrong-password",
    ),
  ).rejects.toEqual(new ProviderSignInError("unavailable"));

  const disabledFetch = jest.fn();
  const disabled = createFirebaseAuthClient({
    apiKey: "public-api-key",
    authDomain: "openjob-nonprod.firebaseapp.com",
    fetchImplementation: disabledFetch,
    qaPasswordTenantId: null,
  });
  await expect(
    disabled.signInWithPassword(
      "qa@example.invalid",
      "fixture-password",
    ),
  ).rejects.toEqual(new ProviderSignInError("unavailable"));
  expect(disabledFetch).not.toHaveBeenCalled();
});

test("keeps the Preview QA authentication method through refresh rotation", async () => {
  const client = createFirebaseAuthClient({
    apiKey: "public-api-key",
    authDomain: "openjob-nonprod.firebaseapp.com",
    fetchImplementation: jest.fn(async () =>
      jsonResponse({
        expires_in: "1800",
        id_token: "rotated-id",
        refresh_token: "rotated-refresh",
      }),
    ),
    now: () => 5_000,
    qaPasswordTenantId: "OpenJob-QA-Two-mvz9m",
  });

  await expect(
    client.refresh({
      provider: "qa-password",
      refreshToken: "stored-refresh",
      version: 1,
    }),
  ).resolves.toMatchObject({
    provider: "qa-password",
    refreshToken: "rotated-refresh",
  });
});

test("distinguishes recoverable offline state from revoked refresh credentials", async () => {
  const offline = createFirebaseAuthClient({
    apiKey: "key",
    authDomain: "example.firebaseapp.com",
    fetchImplementation: jest.fn(async () => {
      throw new TypeError("Network request failed");
    }),
    qaPasswordTenantId: null,
  });
  await expect(
    offline.refresh({
      provider: "google",
      refreshToken: "stored",
      version: 1,
    }),
  ).rejects.toEqual(new ProviderSignInError("offline"));

  const revoked = createFirebaseAuthClient({
    apiKey: "key",
    authDomain: "example.firebaseapp.com",
    fetchImplementation: jest.fn(async () =>
      jsonResponse({ error: { message: "TOKEN_EXPIRED" } }, 400),
    ),
    qaPasswordTenantId: null,
  });
  await expect(
    revoked.refresh({
      provider: "google",
      refreshToken: "stored",
      version: 1,
    }),
  ).rejects.toEqual(new ProviderSignInError("revoked"));
});
