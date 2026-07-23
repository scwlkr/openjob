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

test("distinguishes recoverable offline state from revoked refresh credentials", async () => {
  const offline = createFirebaseAuthClient({
    apiKey: "key",
    authDomain: "example.firebaseapp.com",
    fetchImplementation: jest.fn(async () => {
      throw new TypeError("Network request failed");
    }),
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
  });
  await expect(
    revoked.refresh({
      provider: "google",
      refreshToken: "stored",
      version: 1,
    }),
  ).rejects.toEqual(new ProviderSignInError("revoked"));
});
