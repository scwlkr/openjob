const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

type FirebaseTokenIdentity = {
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

function validPayload(
  payload: FirebaseTokenPayload,
  projectId: string,
  nowSeconds: number,
): payload is FirebaseTokenPayload & { sub: string } {
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
    payload.firebase?.sign_in_provider === "google.com"
  );
}

export function createFirebaseIdTokenVerifier({
  fetchImplementation = fetch,
  now = Date.now,
  projectId,
}: FirebaseTokenVerifierOptions) {
  let cachedKeys: { expiresAt: number; keys: Map<string, FirebaseJwk> } | null = null;

  async function refreshKeys() {
    const response = await fetchImplementation(FIREBASE_JWKS_URL, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("Firebase signing keys are unavailable.");
    const body = (await response.json()) as { keys?: FirebaseJwk[] };
    const keys = new Map<string, FirebaseJwk>();
    for (const key of body.keys ?? []) {
      if (typeof key.kid === "string") keys.set(key.kid, key);
    }
    cachedKeys = { expiresAt: now() + cacheLifetime(response), keys };
    return keys;
  }

  async function signingKey(kid: string) {
    let keys =
      cachedKeys && cachedKeys.expiresAt > now()
        ? cachedKeys.keys
        : await refreshKeys();
    if (!keys.has(kid)) keys = await refreshKeys();
    return keys.get(kid) ?? null;
  }

  return async function verifyIdToken(
    request: Request,
  ): Promise<FirebaseTokenIdentity | null> {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/);
    if (!match) return null;

    try {
      const segments = match[1].split(".");
      if (segments.length !== 3) return null;
      const [encodedHeader, encodedPayload, encodedSignature] = segments;
      const header = decodeJson(encodedHeader) as {
        alg?: unknown;
        kid?: unknown;
      };
      if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

      const jwk = await signingKey(header.kid);
      if (!jwk) return null;
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
        false,
        ["verify"],
      );
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
      return { uid: payload.sub };
    } catch {
      return null;
    }
  };
}
