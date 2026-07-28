import {
  bytesToBase64Url,
  createFirestoreRestClient,
  FirestoreRequestError,
  type FirebaseConfig,
  type FirestoreDocument,
} from "./firestore-rest.ts";
import type {
  AccountDeletionCredential,
  AccountDeletionJob,
} from "../server/v1-account-deletion.ts";

const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

function validEncryptionKey(value: string) {
  try {
    return base64UrlToBytes(value).byteLength === 32;
  } catch {
    return false;
  }
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(value: string) {
  const bytes = base64UrlToBytes(value);
  if (bytes.byteLength !== 32) {
    throw new Error("ACCOUNT_DELETION_KEY must contain 32 base64url bytes.");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
}

async function encryptCredentials(
  keyValue: string,
  credentials: AccountDeletionCredential[],
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(keyValue),
    new TextEncoder().encode(JSON.stringify(credentials)),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptCredentials(
  keyValue: string,
  ciphertext: string,
  iv: string,
) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv) },
    await encryptionKey(keyValue),
    base64UrlToBytes(ciphertext),
  );
  const value = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  if (!Array.isArray(value)) {
    throw new Error("Firestore returned an invalid Account Deletion job.");
  }
  return value as AccountDeletionCredential[];
}

function isConcurrentWrite(error: unknown) {
  return (
    error instanceof FirestoreRequestError &&
    ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION", "NOT_FOUND"].includes(
      error.code ?? "",
    )
  );
}

export function createFirestoreAccountDeletionJobStore(
  config: FirebaseConfig,
  keyValue: string,
  fetchImplementation: typeof fetch = fetch,
  {
    now = Date.now,
    randomUUID = () => crypto.randomUUID(),
  }: { now?: () => number; randomUUID?: () => string } = {},
) {
  const firestore = createFirestoreRestClient(config, fetchImplementation);

  function jobPath(userId: string) {
    return `v1AccountDeletions/${userId}`;
  }

  function userPath(userId: string) {
    return `v1UserDirectory/${userId}`;
  }

  async function read(path: string) {
    const response = await firestore.request(path, {}, { allowNotFound: true });
    return response.status === 404
      ? null
      : ((await response.json()) as FirestoreDocument);
  }

  async function parseJob(document: FirestoreDocument): Promise<AccountDeletionJob> {
    const requestId = document.fields?.requestId?.stringValue;
    const userId = document.fields?.userId?.stringValue;
    const startedAt = document.fields?.startedAt?.timestampValue;
    const deadline = document.fields?.deadline?.timestampValue;
    const ciphertext = document.fields?.credentialCiphertext?.stringValue;
    const iv = document.fields?.credentialIv?.stringValue;
    const completedStepsValue =
      document.fields?.completedSteps?.stringValue ?? "[]";
    if (!requestId || !userId || !startedAt || !deadline || !ciphertext || !iv) {
      throw new Error("Firestore returned an invalid Account Deletion job.");
    }
    const completedSteps = JSON.parse(completedStepsValue) as unknown;
    if (
      !Array.isArray(completedSteps) ||
      completedSteps.some((step) => typeof step !== "string")
    ) {
      throw new Error("Firestore returned an invalid Account Deletion job.");
    }
    return {
      credentials: await decryptCredentials(keyValue, ciphertext, iv),
      completedSteps,
      deadline,
      ...(document.fields?.escalatedAt?.timestampValue
        ? { escalatedAt: document.fields.escalatedAt.timestampValue }
        : {}),
      requestId,
      ...(document.fields?.processingLeaseUntil?.timestampValue
        ? {
            processingLeaseUntil:
              document.fields.processingLeaseUntil.timestampValue,
          }
        : {}),
      startedAt,
      userId,
    };
  }

  return Object.freeze({
    assertReady() {
      if (!validEncryptionKey(keyValue)) {
        throw new Error("Account deletion encryption is unavailable.");
      }
    },

    async claim(userId: string, leaseUntil: string) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await read(jobPath(userId));
        if (!existing) return false;
        const activeLease = existing.fields?.processingLeaseUntil?.timestampValue;
        if (activeLease && Date.parse(activeLease) > now()) return false;
        try {
          await firestore.request(":commit", {
            method: "POST",
            body: JSON.stringify({
              writes: [{
                update: {
                  name: existing.name,
                  fields: {
                    processingLeaseUntil: { timestampValue: leaseUntil },
                  },
                },
                updateMask: { fieldPaths: ["processingLeaseUntil"] },
                currentDocument: { updateTime: existing.updateTime },
              }],
            }),
          });
          return true;
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      return false;
    },

    async listPending() {
      const jobs: AccountDeletionJob[] = [];
      let pageToken: string | null = null;
      do {
        const parameters = new URLSearchParams({
          orderBy: "__name__",
          pageSize: "100",
        });
        if (pageToken) parameters.set("pageToken", pageToken);
        const response = await firestore.request(
          `v1AccountDeletions?${parameters}`,
        );
        const page = (await response.json()) as {
          documents?: FirestoreDocument[];
          nextPageToken?: string;
        };
        for (const document of page.documents ?? []) {
          jobs.push(await parseJob(document));
        }
        pageToken = page.nextPageToken ?? null;
      } while (pageToken);
      return jobs;
    },

    async markEscalated(userId: string, escalatedAt: string) {
      const existing = await read(jobPath(userId));
      if (!existing || existing.fields?.escalatedAt?.timestampValue) return false;
      try {
        await firestore.request(":commit", {
          method: "POST",
          body: JSON.stringify({
            writes: [{
              update: {
                name: existing.name,
                fields: { escalatedAt: { timestampValue: escalatedAt } },
              },
              updateMask: { fieldPaths: ["escalatedAt"] },
              currentDocument: { updateTime: existing.updateTime },
            }],
          }),
        });
        return true;
      } catch (error) {
        if (isConcurrentWrite(error)) return false;
        throw error;
      }
    },

    async markCompletedStep(userId: string, step: string) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await read(jobPath(userId));
        if (!existing) return;
        const currentValue = existing.fields?.completedSteps?.stringValue ?? "[]";
        const current = JSON.parse(currentValue) as unknown;
        if (!Array.isArray(current)) {
          throw new Error("Firestore returned an invalid Account Deletion job.");
        }
        if (current.includes(step)) return;
        try {
          await firestore.request(":commit", {
            method: "POST",
            body: JSON.stringify({
              writes: [{
                update: {
                  name: existing.name,
                  fields: {
                    completedSteps: {
                      stringValue: JSON.stringify([...current, step]),
                    },
                  },
                },
                updateMask: { fieldPaths: ["completedSteps"] },
                currentDocument: { updateTime: existing.updateTime },
              }],
            }),
          });
          return;
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Account deletion checkpoint could not be persisted.");
    },

    async release(userId: string, releasedAt: string) {
      const existing = await read(jobPath(userId));
      if (!existing) return;
      try {
        await firestore.request(":commit", {
          method: "POST",
          body: JSON.stringify({
            writes: [{
              update: {
                name: existing.name,
                fields: {
                  processingLeaseUntil: { timestampValue: releasedAt },
                },
              },
              updateMask: { fieldPaths: ["processingLeaseUntil"] },
              currentDocument: { updateTime: existing.updateTime },
            }],
          }),
        });
      } catch (error) {
        if (!isConcurrentWrite(error)) throw error;
      }
    },

    async start(userId: string, credentials: AccountDeletionCredential[]) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await read(jobPath(userId));
        if (existing) return parseJob(existing);
        const user = await read(userPath(userId));
        if (!user) return null;
        const startedAt = new Date(now()).toISOString();
        const deadline = new Date(now() + RETRY_WINDOW_MS).toISOString();
        const requestId = `del_${randomUUID().replaceAll("-", "")}`;
        const encrypted = await encryptCredentials(keyValue, credentials);
        try {
          await firestore.request(":commit", {
            method: "POST",
            body: JSON.stringify({
              writes: [
                {
                  update: {
                    name: firestore.documentName(userPath(userId)),
                    fields: {
                      deletionDeadline: { timestampValue: deadline },
                      deletionRequestId: { stringValue: requestId },
                      deletionStartedAt: { timestampValue: startedAt },
                      deletionState: { stringValue: "pending" },
                    },
                  },
                  updateMask: {
                    fieldPaths: [
                      "deletionDeadline",
                      "deletionRequestId",
                      "deletionStartedAt",
                      "deletionState",
                    ],
                  },
                  currentDocument: { updateTime: user.updateTime },
                },
                {
                  update: {
                    name: firestore.documentName(jobPath(userId)),
                    fields: {
                      completedSteps: { stringValue: "[]" },
                      credentialCiphertext: { stringValue: encrypted.ciphertext },
                      credentialIv: { stringValue: encrypted.iv },
                      deadline: { timestampValue: deadline },
                      requestId: { stringValue: requestId },
                      startedAt: { timestampValue: startedAt },
                      userId: { stringValue: userId },
                    },
                  },
                  currentDocument: { exists: false },
                },
              ],
            }),
          });
          return {
            completedSteps: [],
            credentials,
            deadline,
            requestId,
            startedAt,
            userId,
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Account deletion start could not resolve concurrent writes.");
    },
  });
}
