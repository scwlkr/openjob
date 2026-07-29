import { bytesToBase64Url, type FirebaseConfig } from "../db/firestore-rest.ts";
import type { AccountDeletionCredential } from "./v1-account-deletion.ts";

type AppleConfig = {
  allowedClientIds: string[];
  keyId: string;
  privateKey: string;
  redirectUrisByClientId: Record<string, string[]>;
  teamId: string;
};

type GoogleConfig = {
  allowedClientIds: string[];
};

type FirebaseAccountDeletionConfig = FirebaseConfig & {
  apiKey: string;
};

type AppleJwk = JsonWebKey & {
  alg?: unknown;
  kid?: unknown;
  use?: unknown;
};

export class AccountDeletionReauthenticationRequiredError extends Error {
  constructor(provider: "apple" | "google") {
    super(`Fresh ${provider} authentication is required.`);
    this.name = "AccountDeletionReauthenticationRequiredError";
  }
}

function jsonBase64Url(value: unknown) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function privateKeyBytes(privateKey: string) {
  const base64 = privateKey
    .replaceAll("\\n", "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function signedServiceAccountJwt(
  firebase: FirebaseConfig,
  scope: string,
) {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = jsonBase64Url({ alg: "RS256", typ: "JWT" });
  const payload = jsonBase64Url({
    aud: "https://oauth2.googleapis.com/token",
    exp: issuedAt + 3_600,
    iat: issuedAt,
    iss: firebase.clientEmail,
    scope,
  });
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(firebase.privateKey),
    { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function firebaseAccessToken(
  firebase: FirebaseAccountDeletionConfig,
  fetchImplementation: typeof fetch,
) {
  const assertion = await signedServiceAccountJwt(
    firebase,
    "https://www.googleapis.com/auth/identitytoolkit",
  );
  const response = await fetchImplementation("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      assertion,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = (await response.json()) as { access_token?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error("Firebase account administration is unavailable.");
  }
  return payload.access_token;
}

async function appleClientSecret(
  apple: AppleConfig,
  clientId: string,
  now: () => number,
) {
  const issuedAt = Math.floor(now() / 1_000);
  const header = jsonBase64Url({ alg: "ES256", kid: apple.keyId });
  const payload = jsonBase64Url({
    aud: "https://appleid.apple.com",
    exp: issuedAt + 300,
    iat: issuedAt,
    iss: apple.teamId,
    sub: clientId,
  });
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(apple.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function decodeBase64Url(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url value.");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeJson(value: string) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as unknown;
}

function numericDate(value: unknown) {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return value;
  }
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

async function verifyRsaIdentityToken(token: string, keys: AppleJwk[]) {
  try {
    const segments = token.split(".");
    if (segments.length !== 3) return null;
    const header = decodeJson(segments[0]) as {
      alg?: unknown;
      kid?: unknown;
    };
    const payload = decodeJson(segments[1]) as Record<string, unknown>;
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    const jwk = keys.find((candidate) =>
      candidate.kid === header.kid &&
      (candidate.alg === undefined || candidate.alg === "RS256") &&
      (candidate.use === undefined || candidate.use === "sig")
    );
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
      decodeBase64Url(segments[2]),
      new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
    );
    return validSignature ? payload : null;
  } catch {
    return null;
  }
}

function validIdentityTokenTimes(
  payload: Record<string, unknown>,
  now: () => number,
) {
  const expiresAt = numericDate(payload.exp);
  const issuedAt = numericDate(payload.iat);
  const nowSeconds = Math.floor(now() / 1_000);
  return expiresAt !== null && expiresAt > nowSeconds &&
    issuedAt !== null && issuedAt <= nowSeconds
    ? { expiresAt }
    : null;
}

async function accessTokenHash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
  return bytesToBase64Url(digest.slice(0, digest.byteLength / 2));
}

export function createAccountDeletionProviderGateway({
  apple,
  fetchImplementation = fetch,
  firebase,
  google,
  now = Date.now,
}: {
  apple: AppleConfig;
  fetchImplementation?: typeof fetch;
  firebase: FirebaseAccountDeletionConfig;
  google: GoogleConfig;
  now?: () => number;
}) {
  const jwks = new Map<
    string,
    { expiresAt: number; keys: AppleJwk[] }
  >();
  const jwksRequests = new Map<string, Promise<AppleJwk[]>>();

  function identityTokenKeyId(token: string) {
    try {
      const segments = token.split(".");
      if (segments.length !== 3) return null;
      const header = decodeJson(segments[0]) as { kid?: unknown };
      return typeof header.kid === "string" ? header.kid : null;
    } catch {
      return null;
    }
  }

  async function providerKeys(url: string, kid: string) {
    const cached = jwks.get(url);
    if (
      cached &&
      cached.expiresAt > now() &&
      cached.keys.some((key) => key.kid === kid)
    ) {
      return cached.keys;
    }
    let request = jwksRequests.get(url);
    if (!request) {
      request = (async () => {
        const response = await fetchImplementation(url, {
          headers: { accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as {
          keys?: AppleJwk[];
        } | null;
        if (!response.ok || !Array.isArray(body?.keys)) {
          throw new Error("Provider signing keys are unavailable.");
        }
        const maxAge = response.headers.get("cache-control")?.match(
          /(?:^|,)\s*max-age=(\d+)/i,
        );
        jwks.set(url, {
          expiresAt: now() + (maxAge ? Number(maxAge[1]) * 1_000 : 3_600_000),
          keys: body.keys,
        });
        return body.keys;
      })();
      jwksRequests.set(url, request);
    }
    try {
      return await request;
    } finally {
      if (jwksRequests.get(url) === request) jwksRequests.delete(url);
    }
  }

  async function appleIdentityToken(
    token: string,
    clientId: string,
    providerSubject: string,
    keys?: Promise<AppleJwk[]>,
  ) {
    const kid = identityTokenKeyId(token);
    if (!kid) return null;
    const payload = await verifyRsaIdentityToken(
      token,
      await (keys ?? providerKeys(
        "https://appleid.apple.com/auth/keys",
        kid,
      )),
    );
    return payload &&
        payload.iss === "https://appleid.apple.com" &&
        payload.aud === clientId &&
        payload.sub === providerSubject &&
        validIdentityTokenTimes(payload, now)
      ? payload
      : null;
  }

  async function googleIdentityToken(
    token: string,
    accessToken: string,
    providerSubject: string,
  ) {
    const kid = identityTokenKeyId(token);
    if (!kid) return null;
    const payload = await verifyRsaIdentityToken(
      token,
      await providerKeys("https://www.googleapis.com/oauth2/v3/certs", kid),
    );
    const times = payload ? validIdentityTokenTimes(payload, now) : null;
    const clientId = typeof payload?.azp === "string"
      ? payload.azp
      : payload?.aud;
    return payload &&
        (payload.iss === "https://accounts.google.com" ||
          payload.iss === "accounts.google.com") &&
        typeof payload.aud === "string" &&
        google.allowedClientIds.includes(payload.aud) &&
        typeof clientId === "string" &&
        google.allowedClientIds.includes(clientId) &&
        payload.sub === providerSubject &&
        typeof payload.at_hash === "string" &&
        payload.at_hash === await accessTokenHash(accessToken) &&
        times
      ? { clientId, expiresAt: times.expiresAt }
      : null;
  }

  async function firebaseAdminRequest(path: string, body: unknown) {
    const response = await fetchImplementation(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(firebase.projectId)}/accounts:${path}`,
      {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${await firebaseAccessToken(firebase, fetchImplementation)}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    if (response.ok) return;
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (payload?.error?.message?.includes("USER_NOT_FOUND")) {
      return;
    }
    throw new Error("Firebase account cleanup failed.");
  }

  return Object.freeze({
    assertReady() {
      const redirectEntries = Object.entries(apple.redirectUrisByClientId);
      if (
        apple.allowedClientIds.length === 0 ||
        !apple.keyId ||
        !apple.privateKey ||
        !apple.teamId ||
        redirectEntries.length === 0 ||
        redirectEntries.some(([clientId, redirectUris]) =>
          !apple.allowedClientIds.includes(clientId) ||
          redirectUris.length === 0 ||
          redirectUris.some((redirectUri) => !redirectUri)
        ) ||
        !firebase.apiKey ||
        google.allowedClientIds.length === 0
      ) {
        throw new Error("Account deletion provider cleanup is unavailable.");
      }
    },

    deleteFirebaseUser(firebaseUid: string) {
      return firebaseAdminRequest("delete", { localId: firebaseUid });
    },

    async prepareAuthorization(
      credential: AccountDeletionCredential,
    ): Promise<AccountDeletionCredential> {
      if (credential.provider === "google") {
        if (credential.revocation?.kind === "validated_access_token") {
          return credential;
        }
        if (
          credential.revocation?.kind !== "access_token" ||
          !("idToken" in credential.revocation) ||
          !credential.providerSubject
        ) {
          throw new AccountDeletionReauthenticationRequiredError("google");
        }
        const verified = await googleIdentityToken(
          credential.revocation.idToken,
          credential.revocation.value,
          credential.providerSubject,
        );
        if (!verified) {
          throw new AccountDeletionReauthenticationRequiredError("google");
        }
        return {
          ...credential,
          revocation: {
            clientId: verified.clientId,
            expiresAt: new Date(verified.expiresAt * 1_000).toISOString(),
            kind: "validated_access_token",
            value: credential.revocation.value,
          },
        };
      }

      const revocation = credential.revocation;
      if (
        !revocation ||
        !("clientId" in revocation) ||
        !apple.allowedClientIds.includes(revocation.clientId)
      ) {
        throw new Error("Apple revocation proof is invalid.");
      }
      const clientId = revocation.clientId;
      if (
        revocation.kind === "access_token" ||
        revocation.kind === "refresh_token"
      ) {
        return credential;
      }
      if (revocation.kind !== "authorization_code") {
        throw new Error("Apple revocation proof is invalid.");
      }
      if (!credential.providerSubject || !("idToken" in revocation)) {
        throw new AccountDeletionReauthenticationRequiredError("apple");
      }
      const allowedRedirectUris = apple.redirectUrisByClientId[clientId] ?? [];
      const redirectUri = revocation.redirectUri;
      if (
        (allowedRedirectUris.length > 0 &&
          (!redirectUri || !allowedRedirectUris.includes(redirectUri))) ||
        (allowedRedirectUris.length === 0 && redirectUri !== undefined)
      ) {
        throw new AccountDeletionReauthenticationRequiredError("apple");
      }
      const appleKid = identityTokenKeyId(revocation.idToken);
      if (!appleKid) {
        throw new AccountDeletionReauthenticationRequiredError("apple");
      }
      const keys = providerKeys(
        "https://appleid.apple.com/auth/keys",
        appleKid,
      );
      if (
        !(await appleIdentityToken(
          revocation.idToken,
          clientId,
          credential.providerSubject,
          keys,
        ))
      ) {
        throw new AccountDeletionReauthenticationRequiredError("apple");
      }
      const clientSecret = await appleClientSecret(apple, clientId, now);
      const exchange = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: revocation.value,
        grant_type: "authorization_code",
      });
      if (redirectUri) exchange.set("redirect_uri", redirectUri);
      let tokenResponse: Response;
      try {
        tokenResponse = await fetchImplementation(
          "https://appleid.apple.com/auth/token",
          {
            body: exchange,
            headers: { "content-type": "application/x-www-form-urlencoded" },
            method: "POST",
          },
        );
      } catch {
        // An authorization code is single-use. Once submission is attempted,
        // its outcome is ambiguous and automatic retry must require a new code.
        throw new AccountDeletionReauthenticationRequiredError("apple");
      }
      const exchanged = (await tokenResponse.json().catch(() => null)) as {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
      } | null;
      if (
        !tokenResponse.ok ||
        !exchanged?.refresh_token ||
        !exchanged.id_token ||
        !(await appleIdentityToken(
          exchanged.id_token,
          clientId,
          credential.providerSubject,
          keys,
        ))
      ) {
        throw new AccountDeletionReauthenticationRequiredError("apple");
      }
      return {
        ...credential,
        revocation: {
          clientId,
          kind: "refresh_token",
          value: exchanged.refresh_token,
        },
      };
    },

    async revokeAuthorization(credential: AccountDeletionCredential) {
      if (credential.provider === "google") {
        if (
          credential.revocation?.kind !== "validated_access_token" ||
          !google.allowedClientIds.includes(credential.revocation.clientId) ||
          Date.parse(credential.revocation.expiresAt) <= now()
        ) {
          throw new AccountDeletionReauthenticationRequiredError("google");
        }
        const response = await fetchImplementation(
          "https://oauth2.googleapis.com/revoke",
          {
            body: new URLSearchParams({ token: credential.revocation.value }),
            headers: { "content-type": "application/x-www-form-urlencoded" },
            method: "POST",
          },
        );
        if (response.ok) return;
        if (response.status === 400 || response.status === 401) {
          throw new AccountDeletionReauthenticationRequiredError("google");
        }
        throw new Error("Google authorization revocation failed.");
      }

      const revocation = credential.revocation;
      if (
        !revocation ||
        !("clientId" in revocation) ||
        !apple.allowedClientIds.includes(revocation.clientId)
      ) {
        throw new Error("Apple revocation proof is invalid.");
      }
      const clientId = revocation.clientId;
      if (revocation.kind === "access_token") {
        if (
          !credential.firebaseIdToken ||
          !credential.firebaseIdTokenExpiresAt ||
          Date.parse(credential.firebaseIdTokenExpiresAt) <= now()
        ) {
          throw new AccountDeletionReauthenticationRequiredError("apple");
        }
        const response = await fetchImplementation(
          "https://identitytoolkit.googleapis.com/v2/accounts:revokeToken",
          {
            body: JSON.stringify({
              idToken: credential.firebaseIdToken,
              providerId: "apple.com",
              token: revocation.value,
              tokenType: "ACCESS_TOKEN",
            }),
            headers: {
              authorization:
                `Bearer ${await firebaseAccessToken(firebase, fetchImplementation)}`,
              "content-type": "application/json",
              "x-goog-api-key": firebase.apiKey,
            },
            method: "POST",
          },
        );
        if (response.ok) return;
        if (response.status === 400 || response.status === 401) {
          throw new AccountDeletionReauthenticationRequiredError("apple");
        }
        throw new Error("Apple authorization revocation failed.");
      }
      if (revocation.kind !== "refresh_token") {
        throw new Error("Apple revocation proof is invalid.");
      }
      const clientSecret = await appleClientSecret(apple, clientId, now);
      const revokeResponse = await fetchImplementation(
        "https://appleid.apple.com/auth/revoke",
        {
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            token: revocation.value,
            token_type_hint: "refresh_token",
          }),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        },
      );
      if (!revokeResponse.ok) {
        if (revokeResponse.status === 400 || revokeResponse.status === 401) {
          throw new AccountDeletionReauthenticationRequiredError("apple");
        }
        throw new Error("Apple authorization revocation failed.");
      }
    },

    revokeFirebaseSessions(firebaseUid: string) {
      return firebaseAdminRequest("update", {
        localId: firebaseUid,
        validSince: String(Math.floor(now() / 1_000)),
      });
    },
  });
}
