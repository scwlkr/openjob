import {
  type FirebaseSession,
  type ProviderCredential,
  ProviderSignInError,
  type StoredSession,
} from "./coordinator";

export type FetchImplementation = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type FirebaseAuthClientConfig = {
  apiKey: string;
  authDomain: string;
  fetchImplementation?: FetchImplementation;
  now?: () => number;
};

type FirebaseExchangeResponse = {
  expiresIn?: unknown;
  idToken?: unknown;
  refreshToken?: unknown;
};

type FirebaseRefreshResponse = {
  expires_in?: unknown;
  id_token?: unknown;
  refresh_token?: unknown;
};

const revokedRefreshErrors = new Set([
  "INVALID_REFRESH_TOKEN",
  "TOKEN_EXPIRED",
  "USER_DISABLED",
  "USER_NOT_FOUND",
]);

async function request(
  fetchImplementation: FetchImplementation,
  input: string,
  init: RequestInit,
) {
  try {
    return await fetchImplementation(input, init);
  } catch {
    throw new ProviderSignInError("offline");
  }
}

async function firebaseError(response: Response) {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
    };
    return typeof body.error?.message === "string"
      ? (body.error.message.split(" : ")[0] ?? "")
      : "";
  } catch {
    return "";
  }
}

function seconds(value: unknown) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ProviderSignInError("unavailable");
  }
  return parsed;
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProviderSignInError("unavailable");
  }
  return value;
}

export function createFirebaseAuthClient({
  apiKey,
  authDomain,
  fetchImplementation = fetch,
  now = Date.now,
}: FirebaseAuthClientConfig) {
  return {
    async exchange(
      credential: ProviderCredential,
    ): Promise<FirebaseSession> {
      const postBody = new URLSearchParams({
        id_token: credential.idToken,
        providerId:
          credential.provider === "apple" ? "apple.com" : "google.com",
      });
      if (credential.nonce) postBody.set("nonce", credential.nonce);

      const response = await request(
        fetchImplementation,
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(apiKey)}`,
        {
          body: JSON.stringify({
            postBody: postBody.toString(),
            requestUri: `https://${authDomain}/__/auth/handler`,
            returnSecureToken: true,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        await firebaseError(response);
        throw new ProviderSignInError("unavailable");
      }
      const body = (await response.json()) as FirebaseExchangeResponse;
      return {
        expiresAt: now() + seconds(body.expiresIn) * 1_000,
        idToken: requiredString(body.idToken),
        provider: credential.provider,
        refreshToken: requiredString(body.refreshToken),
      };
    },

    async refresh(stored: StoredSession): Promise<FirebaseSession> {
      const response = await request(
        fetchImplementation,
        `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
        {
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: stored.refreshToken,
          }).toString(),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        const code = await firebaseError(response);
        throw new ProviderSignInError(
          revokedRefreshErrors.has(code) ? "revoked" : "unavailable",
        );
      }
      const body = (await response.json()) as FirebaseRefreshResponse;
      return {
        expiresAt: now() + seconds(body.expires_in) * 1_000,
        idToken: requiredString(body.id_token),
        provider: stored.provider,
        refreshToken: requiredString(body.refresh_token),
      };
    },
  };
}
