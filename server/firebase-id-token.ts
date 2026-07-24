const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const UNKNOWN_KEY_REFRESH_COOLDOWN_MS = 60_000;

export type SignInProvider = "apple" | "google";

export type FirebaseTokenIdentity = {
  authenticatedAt: number;
  provider: SignInProvider;
  uid: string;
};

type FirebaseTokenPayload = {
  aud?: unknown;
  auth_time?: unknown;
  exp?: unknown;
  firebase?: { sign_in_provider?: unknown };
  iat?: unknown;
  iss?: unknown;
  sub?: unknown;
};

type FirebaseJwk = JsonWebKey & {
  kid?: string;
};

type FirebaseTokenVerifierOptions = {
  fetchImplementation?: typeof fetch;
  now?: () => number;
  projectId: string;
};

export type FirebaseIdTokenVerifier = ((
  request: Request,
) => Promise<FirebaseTokenIdentity | null>) & {
  verifyToken(token: string): Promise<FirebaseTokenIdentity | null>;
};

function decodeBase64Url(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url value.");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson(value: string) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as unknown;
}

function cacheLifetime(response: Response) {
  const match = response.headers.get("cache-control")?.match(/(?:^|,)\s*max-age=(\d+)/i);
  return match ? Number(match[1]) * 1000 : 60 * 60 * 1000;
}

function isNumericDate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function signInProvider(value: unknown): SignInProvider | null {
  if (value === "google.com") return "google";
  if (value === "apple.com") return "apple";
  return null;
}

function validPayload(
  payload: FirebaseTokenPayload,
  projectId: string,
  nowSeconds: number,
): payload is FirebaseTokenPayload & {
  auth_time: number;
  firebase: { sign_in_provider: "apple.com" | "google.com" };
  sub: string;
} {
  return (
    payload.aud === projectId &&
    payload.iss === `https://securetoken.google.com/${projectId}` &&
    isNumericDate(payload.exp) &&
    payload.exp > nowSeconds &&
    isNumericDate(payload.iat) &&
    payload.iat <= nowSeconds &&
    isNumericDate(payload.auth_time) &&
    payload.auth_time <= nowSeconds &&
    typeof payload.sub === "string" &&
    payload.sub.length > 0 &&
    payload.sub.length <= 128 &&
    signInProvider(payload.firebase?.sign_in_provider) !== null
  );
}

export function createFirebaseIdTokenVerifier({
  fetchImplementation = fetch,
  now = Date.now,
  projectId,
}: FirebaseTokenVerifierOptions) {
  let cachedKeys: { expiresAt: number; keys: Map<string, FirebaseJwk> } | null = null;
  let lastRefreshAt = Number.NEGATIVE_INFINITY;
  let refreshPromise: Promise<Map<string, FirebaseJwk>> | null = null;

  async function refreshKeys() {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const response = await fetchImplementation(FIREBASE_JWKS_URL, {
            headers: { accept: "application/json" },
          });
          if (!response.ok) throw new Error("Signing-key request failed.");
          const body = (await response.json()) as { keys?: FirebaseJwk[] };
          if (!Array.isArray(body.keys)) throw new Error("Signing-key response is invalid.");
          const keys = new Map<string, FirebaseJwk>();
          for (const key of body.keys) {
            if (typeof key.kid === "string") keys.set(key.kid, key);
          }
          const refreshedAt = now();
          lastRefreshAt = refreshedAt;
          cachedKeys = {
            expiresAt: refreshedAt + cacheLifetime(response),
            keys,
          };
          return keys;
        } catch {
          throw new Error("Firebase signing keys are unavailable.");
        }
      })();
    }
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function signingKey(kid: string) {
    let keys =
      cachedKeys && cachedKeys.expiresAt > now()
        ? cachedKeys.keys
        : await refreshKeys();
    if (
      !keys.has(kid) &&
      now() - lastRefreshAt >= UNKNOWN_KEY_REFRESH_COOLDOWN_MS
    ) {
      keys = await refreshKeys();
    }
    return keys.get(kid) ?? null;
  }

  async function verifyToken(
    token: string,
  ): Promise<FirebaseTokenIdentity | null> {
    let segments: string[];
    let header: { alg?: unknown; kid?: unknown };
    try {
      segments = token.split(".");
      if (segments.length !== 3) return null;
      header = decodeJson(segments[0]) as {
        alg?: unknown;
        kid?: unknown;
      };
      if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    } catch {
      return null;
    }

    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    const jwk = await signingKey(header.kid);
    if (!jwk) return null;
    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
        false,
        ["verify"],
      );
    } catch {
      throw new Error("Firebase signing keys are unavailable.");
    }

    try {
      const validSignature = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        decodeBase64Url(encodedSignature),
        new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
      );
      if (!validSignature) return null;

      const payload = decodeJson(encodedPayload) as FirebaseTokenPayload;
      const nowSeconds = Math.floor(now() / 1000);
      if (!validPayload(payload, projectId, nowSeconds)) return null;
      const provider = signInProvider(payload.firebase.sign_in_provider);
      if (!provider) return null;
      return {
        authenticatedAt: payload.auth_time * 1000,
        provider,
        uid: payload.sub,
      };
    } catch {
      return null;
    }
  }

  const verifyIdToken = async function verifyIdToken(
    request: Request,
  ): Promise<FirebaseTokenIdentity | null> {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/);
    return match ? verifyToken(match[1]) : null;
  };

  return Object.assign(verifyIdToken, { verifyToken }) as FirebaseIdTokenVerifier;
}
