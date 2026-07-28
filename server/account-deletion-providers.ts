import { bytesToBase64Url, type FirebaseConfig } from "../db/firestore-rest.ts";
import type { AccountDeletionCredential } from "./v1-account-deletion.ts";

type AppleConfig = {
  allowedClientIds: string[];
  keyId: string;
  privateKey: string;
  teamId: string;
};

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
  firebase: FirebaseConfig,
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

async function appleClientSecret(apple: AppleConfig, clientId: string) {
  const issuedAt = Math.floor(Date.now() / 1_000);
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

export function createAccountDeletionProviderGateway({
  apple,
  fetchImplementation = fetch,
  firebase,
  now = Date.now,
}: {
  apple: AppleConfig;
  fetchImplementation?: typeof fetch;
  firebase: FirebaseConfig;
  now?: () => number;
}) {
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
      if (
        apple.allowedClientIds.length === 0 ||
        !apple.keyId ||
        !apple.privateKey ||
        !apple.teamId
      ) {
        throw new Error("Account deletion provider cleanup is unavailable.");
      }
    },

    deleteFirebaseUser(firebaseUid: string) {
      return firebaseAdminRequest("delete", { localId: firebaseUid });
    },

    async revokeAuthorization(credential: AccountDeletionCredential) {
      if (credential.provider === "google") {
        if (credential.revocation.kind !== "access_token") {
          throw new Error("Google revocation proof is invalid.");
        }
        const response = await fetchImplementation(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(credential.revocation.value)}`,
          {
            headers: { "content-type": "application/x-www-form-urlencoded" },
            method: "POST",
          },
        );
        if (response.ok || response.status === 400) return;
        throw new Error("Google authorization revocation failed.");
      }

      const clientId = credential.revocation.clientId;
      if (!clientId || !apple.allowedClientIds.includes(clientId)) {
        throw new Error("Apple revocation proof is invalid.");
      }
      const clientSecret = await appleClientSecret(apple, clientId);
      let token: { access_token?: string; refresh_token?: string };
      if (credential.revocation.kind === "access_token") {
        token = { access_token: credential.revocation.value };
      } else {
      const tokenResponse = await fetchImplementation(
        "https://appleid.apple.com/auth/token",
        {
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: credential.revocation.value,
            grant_type: "authorization_code",
          }),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        },
      );
      const exchanged = (await tokenResponse.json().catch(() => null)) as {
        access_token?: string;
        refresh_token?: string;
      } | null;
      if (
        !tokenResponse.ok ||
        (!exchanged?.refresh_token && !exchanged?.access_token)
      ) {
        throw new Error("Apple authorization exchange failed.");
      }
      token = exchanged;
      }
      const revokeResponse = await fetchImplementation(
        "https://appleid.apple.com/auth/revoke",
        {
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            token: token.refresh_token ?? token.access_token!,
            token_type_hint: token.refresh_token
              ? "refresh_token"
              : "access_token",
          }),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        },
      );
      if (!revokeResponse.ok) {
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
