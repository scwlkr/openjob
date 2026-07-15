export type FirebaseConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export type FirestoreValue = {
  booleanValue?: boolean;
  integerValue?: number | string;
  stringValue?: string;
  timestampValue?: string;
};

export type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
  updateTime?: string;
};

type CachedToken = {
  value: string;
  expiresAt: number;
};

type FirestoreRequestOptions = {
  allowNotFound?: boolean;
};

export class FirestoreRequestError extends Error {
  code: string | null;
  httpStatus: number;

  constructor(message: string, httpStatus: number, code: string | null) {
    super(message);
    this.name = "FirestoreRequestError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function jsonToBase64Url(value: unknown) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function privateKeyBytes(privateKey: string) {
  const base64 = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function createServiceAccountJwt(config: FirebaseConfig) {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = jsonToBase64Url({ alg: "RS256", typ: "JWT" });
  const encodedPayload = jsonToBase64Url({
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const keyBytes = privateKeyBytes(config.privateKey);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken),
  );
  return `${unsignedToken}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export function createFirestoreRestClient(
  config: FirebaseConfig,
  fetchImplementation: typeof fetch = fetch,
) {
  const databaseName = `projects/${config.projectId}/databases/(default)`;
  const documentsUrl = `https://firestore.googleapis.com/v1/${databaseName}/documents`;
  let cachedToken: CachedToken | null = null;

  async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.value;
    }

    const assertion = await createServiceAccountJwt(config);
    const response = await fetchImplementation(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      },
    );
    const result = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!response.ok || !result.access_token) {
      throw new Error(result.error_description ?? "Firebase authentication failed.");
    }

    cachedToken = {
      value: result.access_token,
      expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000,
    };
    return cachedToken.value;
  }

  async function request(
    path: string,
    init: RequestInit = {},
    options: FirestoreRequestOptions = {},
    retryAuthentication = true,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${await getAccessToken()}`);
    if (init.body) headers.set("content-type", "application/json");
    const url = path.startsWith(":")
      ? `${documentsUrl}${path}`
      : `${documentsUrl}/${path}`;
    const response = await fetchImplementation(url, { ...init, headers });

    if (response.status === 401 && retryAuthentication) {
      cachedToken = null;
      return request(path, init, options, false);
    }
    if (response.status === 404 && options.allowNotFound) return response;
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as {
        error?: { message?: string; status?: string };
      } | null;
      throw new FirestoreRequestError(
        result?.error?.message ?? `Firestore request failed (${response.status}).`,
        response.status,
        result?.error?.status ?? null,
      );
    }
    return response;
  }

  return Object.freeze({
    databaseName,
    documentName(path: string) {
      return `${databaseName}/documents/${path}`;
    },
    request,
  });
}
