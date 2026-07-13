export type TaskRecord = {
  id: string;
  assignee: string;
  description: string;
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

type FirestoreValue = {
  booleanValue?: boolean;
  stringValue?: string;
  timestampValue?: string;
};

type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
};

type FirebaseConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type CachedToken = {
  value: string;
  expiresAt: number;
};

function bytesToBase64Url(bytes: Uint8Array) {
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

function fromFirestoreDocument(document: FirestoreDocument): TaskRecord {
  const fields = document.fields ?? {};
  const id = decodeURIComponent(document.name.split("/").at(-1) ?? "");
  const assignee = fields.assignee?.stringValue;
  const description = fields.description?.stringValue;
  const createdAt = fields.createdAt?.timestampValue;
  const updatedAt = fields.updatedAt?.timestampValue;

  if (!id || !assignee || !description || !createdAt || !updatedAt) {
    throw new Error("Firestore returned an invalid task record.");
  }

  return {
    id,
    assignee,
    description,
    dueDate: fields.dueDate?.stringValue ?? null,
    completed: fields.completed?.booleanValue ?? false,
    createdAt,
    updatedAt,
  };
}

function toFirestoreFields(task: Omit<TaskRecord, "id">) {
  const fields: Record<string, FirestoreValue> = {
    assignee: { stringValue: task.assignee },
    description: { stringValue: task.description },
    completed: { booleanValue: task.completed },
    createdAt: { timestampValue: task.createdAt },
    updatedAt: { timestampValue: task.updatedAt },
  };
  if (task.dueDate) fields.dueDate = { stringValue: task.dueDate };
  return fields;
}

function compareTasks(left: TaskRecord, right: TaskRecord) {
  if (left.completed !== right.completed) return left.completed ? 1 : -1;
  if (left.dueDate !== right.dueDate) {
    if (left.dueDate === null) return 1;
    if (right.dueDate === null) return -1;
    return left.dueDate.localeCompare(right.dueDate);
  }
  return right.createdAt.localeCompare(left.createdAt);
}

export function createFirestoreStore(
  config: FirebaseConfig,
  fetchImplementation: typeof fetch = fetch,
) {
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents`;
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
    retryAuthentication = true,
    allowNotFound = false,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${await getAccessToken()}`);
    if (init.body) headers.set("content-type", "application/json");

    const response = await fetchImplementation(`${baseUrl}/${path}`, {
      ...init,
      headers,
    });
    if (response.status === 401 && retryAuthentication) {
      cachedToken = null;
      return request(path, init, false, allowNotFound);
    }
    if (response.status === 404 && allowNotFound) return response;
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(result?.error?.message ?? `Firestore request failed (${response.status}).`);
    }
    return response;
  }

  return {
    async listTasks() {
      const tasks: TaskRecord[] = [];
      let pageToken: string | undefined;

      do {
        const query = new URLSearchParams({ pageSize: "1000" });
        if (pageToken) query.set("pageToken", pageToken);
        const response = await request(`tasks?${query}`);
        const result = (await response.json()) as {
          documents?: FirestoreDocument[];
          nextPageToken?: string;
        };
        tasks.push(...(result.documents ?? []).map(fromFirestoreDocument));
        pageToken = result.nextPageToken;
      } while (pageToken);

      return tasks.sort(compareTasks);
    },

    async createTask(input: {
      assignee: string;
      description: string;
      dueDate: string | null;
    }) {
      const now = new Date().toISOString();
      const task: TaskRecord = {
        id: crypto.randomUUID(),
        ...input,
        completed: false,
        createdAt: now,
        updatedAt: now,
      };
      const response = await request(
        `tasks?documentId=${encodeURIComponent(task.id)}`,
        {
          method: "POST",
          body: JSON.stringify({ fields: toFirestoreFields(task) }),
        },
      );
      return fromFirestoreDocument((await response.json()) as FirestoreDocument);
    },

    async setTaskCompleted(id: string, completed: boolean) {
      const query = new URLSearchParams();
      query.append("updateMask.fieldPaths", "completed");
      query.append("updateMask.fieldPaths", "updatedAt");
      const response = await request(
        `tasks/${encodeURIComponent(id)}?${query}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            fields: {
              completed: { booleanValue: completed },
              updatedAt: { timestampValue: new Date().toISOString() },
            },
          }),
        },
        true,
        true,
      );
      if (response.status === 404) return null;
      return fromFirestoreDocument((await response.json()) as FirestoreDocument);
    },
  };
}
