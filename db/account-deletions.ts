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
  AccountDeletionStartedJob,
} from "../server/v1-account-deletion.ts";

const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const STATUS_TOKEN_VERSION = "v1";
const STATUS_TOKEN_IV_BYTES = 12;
const STATUS_TOKEN_MAXIMUM_LENGTH = 8_192;
const STATUS_SUBMISSION_ACCEPTANCE_WINDOW_MS = 5 * 60_000;
const STATUS_TOKEN_AAD = new TextEncoder().encode(
  "openjob:v1:account-deletion-status",
);
const STATUS_RECEIPT_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}|\d{6}|\d{9}))?Z$/;
const COMPLETED_STEPS = new Set([
  "firebase-sessions:apple",
  "firebase-sessions:google",
  "provider-attempted:apple",
  "provider-attempted:google",
  "provider:apple",
  "provider:google",
]);

type AccountDeletionStatusReceipt = {
  intentId: string;
  submissionExpiresAt: string;
  userId: string;
};

type AccountDeletionIntent = AccountDeletionStatusReceipt;

type AccountDeletionStatusLookup =
  | { kind: "completed" }
  | { kind: "invalid" }
  | {
      kind: "not_started";
      submissionExpired: boolean;
      submissionExpiresAt: string;
    }
  | {
      deadline: string;
      kind: "pending";
      reauthenticationProviders: Array<"apple" | "google">;
      requestedAt: string;
    }
  | { kind: "unavailable" };

function boundedIdentifier(value: string) {
  return value.length > 0 && value.length <= 256;
}

function validCompletedSteps(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((step) => typeof step === "string" && COMPLETED_STEPS.has(step)) &&
    new Set(value).size === value.length;
}

function validReauthenticationProviders(
  value: unknown,
): value is Array<"apple" | "google"> {
  return Array.isArray(value) &&
    value.every((provider) => provider === "apple" || provider === "google") &&
    new Set(value).size === value.length &&
    value.join(",") === [...value].sort().join(",");
}

function safeDocumentId(value: string) {
  return (
    boundedIdentifier(value) &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/")
  );
}

function timestampInstant(value: string) {
  const match = value.match(STATUS_RECEIPT_TIMESTAMP);
  if (!match || match[1] === "0000") return null;
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const wholeSecond = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const milliseconds = Date.parse(wholeSecond);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !==
      `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`
  ) {
    return null;
  }
  return (
    BigInt(milliseconds) * BigInt(1_000_000) +
    BigInt(fraction.padEnd(9, "0") || "0")
  );
}

function timestampsMatch(left: string, right: string) {
  const leftInstant = timestampInstant(left);
  const rightInstant = timestampInstant(right);
  return (
    leftInstant !== null &&
    rightInstant !== null &&
    leftInstant === rightInstant
  );
}

function canonicalMillisecondTimestamp(value: string) {
  const instant = timestampInstant(value);
  if (instant === null || instant % BigInt(1_000_000) !== BigInt(0)) {
    return null;
  }
  const timestamp = new Date(Number(instant / BigInt(1_000_000))).toISOString();
  return timestampInstant(timestamp) === instant ? timestamp : null;
}

function isActiveUserDocument(document: FirestoreDocument, userId: string) {
  const fields = document.fields ?? {};
  return (
    fields.userId?.stringValue === userId &&
    !Object.hasOwn(fields, "deletionState") &&
    !Object.hasOwn(fields, "deletionRequestId") &&
    !Object.hasOwn(fields, "deletionStartedAt") &&
    !Object.hasOwn(fields, "deletionDeadline") &&
    !Object.hasOwn(fields, "deletionIntentId")
  );
}

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

function canonicalBase64UrlToBytes(value: string) {
  if (
    value.length === 0 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }
  try {
    const bytes = base64UrlToBytes(value);
    return bytesToBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
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

function validReceipt(value: unknown): value is AccountDeletionStatusReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const submissionExpiresAt = typeof receipt.submissionExpiresAt === "string"
    ? Date.parse(receipt.submissionExpiresAt)
    : Number.NaN;
  return (
    Object.keys(receipt).sort().join(",") ===
      "intentId,submissionExpiresAt,userId" &&
    typeof receipt.intentId === "string" &&
    boundedIdentifier(receipt.intentId) &&
    Number.isFinite(submissionExpiresAt) &&
    new Date(submissionExpiresAt).toISOString() ===
      receipt.submissionExpiresAt &&
    typeof receipt.userId === "string" &&
    safeDocumentId(receipt.userId)
  );
}

async function encryptStatusReceipt(
  keyValue: string,
  receipt: AccountDeletionStatusReceipt,
) {
  const iv = crypto.getRandomValues(new Uint8Array(STATUS_TOKEN_IV_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { additionalData: STATUS_TOKEN_AAD, iv, name: "AES-GCM" },
    await encryptionKey(keyValue),
    new TextEncoder().encode(JSON.stringify(receipt)),
  ));
  return [
    STATUS_TOKEN_VERSION,
    bytesToBase64Url(iv),
    bytesToBase64Url(ciphertext),
  ].join(".");
}

async function decryptStatusReceipt(keyValue: string, token: string) {
  if (token.length > STATUS_TOKEN_MAXIMUM_LENGTH) return null;
  const [version, encodedIv, encodedCiphertext, extra] = token.split(".");
  const iv = canonicalBase64UrlToBytes(encodedIv ?? "");
  const ciphertext = canonicalBase64UrlToBytes(encodedCiphertext ?? "");
  if (
    version !== STATUS_TOKEN_VERSION ||
    extra !== undefined ||
    !iv ||
    iv.byteLength !== STATUS_TOKEN_IV_BYTES ||
    !ciphertext ||
    ciphertext.byteLength <= 16
  ) {
    return null;
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { additionalData: STATUS_TOKEN_AAD, iv, name: "AES-GCM" },
      await encryptionKey(keyValue),
      ciphertext,
    );
    const value = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    return validReceipt(value) ? value : null;
  } catch {
    return null;
  }
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

  function intentPath(userId: string) {
    return `v1AccountDeletionIntents/${userId}`;
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

  async function beginStateTransaction(
    userId: string,
    includeProviderSlots = false,
  ) {
    const response = await firestore.request(":beginTransaction", {
      body: JSON.stringify({ options: { readWrite: {} } }),
      method: "POST",
    });
    const transaction = ((await response.json()) as { transaction?: unknown })
      .transaction;
    if (typeof transaction !== "string" || transaction.length === 0) {
      throw new Error("Firestore did not start a status transaction.");
    }
    const parameter = new URLSearchParams({ transaction }).toString();
    let documents: {
      intent: FirestoreDocument | null;
      job: FirestoreDocument | null;
      providerSlots: FirestoreDocument[];
      user: FirestoreDocument | null;
    };
    try {
      const [intent, job, providerSlots, user] = await Promise.all([
        read(`${intentPath(userId)}?${parameter}`),
        read(`${jobPath(userId)}?${parameter}`),
        includeProviderSlots
          ? (async () => {
              const parameters = new URLSearchParams({
                orderBy: "__name__",
                pageSize: "10",
                transaction,
              });
              const response = await firestore.request(
                `v1UserSignInMethods/${userId}/providers?${parameters}`,
              );
              const page = (await response.json()) as {
                documents?: FirestoreDocument[];
                nextPageToken?: string;
              };
              if (page.nextPageToken) {
                throw new Error(
                  "Firestore returned too many Sign-in Method provider slots.",
                );
              }
              return page.documents ?? [];
            })()
          : Promise.resolve([]),
        read(`${userPath(userId)}?${parameter}`),
      ]);
      documents = { intent, job, providerSlots, user };
    } catch (error) {
      await firestore.request(":rollback", {
        body: JSON.stringify({ transaction }),
        method: "POST",
      });
      throw error;
    }
    return { ...documents, transaction };
  }

  async function rollback(transaction: string) {
    await firestore.request(":rollback", {
      body: JSON.stringify({ transaction }),
      method: "POST",
    });
  }

  async function commit(transaction: string, writes: unknown[]) {
    await firestore.request(":commit", {
      body: JSON.stringify({ transaction, writes }),
      method: "POST",
    });
  }

  function parseIntent(
    document: FirestoreDocument,
    expectedUserId: string,
  ): AccountDeletionIntent | null {
    const intentId = document.fields?.intentId?.stringValue;
    const submissionExpiresAt =
      document.fields?.submissionExpiresAt?.timestampValue;
    const userId = document.fields?.userId?.stringValue;
    const canonicalExpiry = submissionExpiresAt
      ? canonicalMillisecondTimestamp(submissionExpiresAt)
      : null;
    return (
        typeof intentId === "string" &&
        boundedIdentifier(intentId) &&
        canonicalExpiry &&
        userId === expectedUserId
      )
      ? { intentId, submissionExpiresAt: canonicalExpiry, userId }
      : null;
  }

  async function parseJob(
    document: FirestoreDocument,
    expectedUserId: string,
  ): Promise<AccountDeletionJob> {
    const requestId = document.fields?.requestId?.stringValue;
    const userId = document.fields?.userId?.stringValue;
    const startedAt = document.fields?.startedAt?.timestampValue;
    const deadline = document.fields?.deadline?.timestampValue;
    const intentId = document.fields?.intentId?.stringValue;
    const submissionExpiresAt =
      document.fields?.submissionExpiresAt?.timestampValue;
    const canonicalSubmissionExpiry = submissionExpiresAt
      ? canonicalMillisecondTimestamp(submissionExpiresAt)
      : null;
    const ciphertext = document.fields?.credentialCiphertext?.stringValue;
    const iv = document.fields?.credentialIv?.stringValue;
    const completedStepsValue =
      document.fields?.completedSteps?.stringValue ?? "[]";
    const reauthenticationProvidersValue =
      document.fields?.reauthenticationProviders?.stringValue ?? "[]";
    if (
      !requestId ||
      userId !== expectedUserId ||
      !startedAt ||
      !deadline ||
      !intentId ||
      !canonicalSubmissionExpiry ||
      !ciphertext ||
      !iv
    ) {
      throw new Error("Firestore returned an invalid Account Deletion job.");
    }
    const completedSteps = JSON.parse(completedStepsValue) as unknown;
    const reauthenticationProviders = JSON.parse(
      reauthenticationProvidersValue,
    ) as unknown;
    if (
      !validCompletedSteps(completedSteps) ||
      !validReauthenticationProviders(reauthenticationProviders) ||
      reauthenticationProviders.some((provider) =>
        completedSteps.includes(`provider:${provider}`)
      )
    ) {
      throw new Error("Firestore returned an invalid Account Deletion job.");
    }
    return {
      credentials: await decryptCredentials(keyValue, ciphertext, iv),
      completedSteps,
      deadline,
      intentId,
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
      reauthenticationProviders,
      startedAt,
      submissionExpiresAt: canonicalSubmissionExpiry,
      userId,
    };
  }

  function pendingStateMatches(
    user: FirestoreDocument,
    job: AccountDeletionJob,
    receipt?: AccountDeletionStatusReceipt,
  ) {
    return (
      user.fields?.userId?.stringValue === job.userId &&
      user.fields?.deletionState?.stringValue === "pending" &&
      user.fields?.deletionRequestId?.stringValue === job.requestId &&
      user.fields?.deletionIntentId?.stringValue === job.intentId &&
      timestampsMatch(
        user.fields?.deletionStartedAt?.timestampValue ?? "",
        job.startedAt,
      ) &&
      timestampsMatch(
        user.fields?.deletionDeadline?.timestampValue ?? "",
        job.deadline,
      ) &&
      (!receipt ||
        (receipt.userId === job.userId &&
          receipt.intentId === job.intentId &&
          timestampsMatch(receipt.submissionExpiresAt, job.submissionExpiresAt)))
    );
  }

  function jobIdentityMatches(
    expected: AccountDeletionJob,
    current: AccountDeletionJob,
  ) {
    return (
      expected.userId === current.userId &&
      expected.requestId === current.requestId &&
      expected.intentId === current.intentId &&
      timestampsMatch(expected.startedAt, current.startedAt) &&
      timestampsMatch(expected.deadline, current.deadline) &&
      timestampsMatch(
        expected.submissionExpiresAt,
        current.submissionExpiresAt,
      ) &&
      (expected.processingLeaseUntil === undefined
        ? current.processingLeaseUntil === undefined
        : typeof current.processingLeaseUntil === "string" &&
          timestampsMatch(
            expected.processingLeaseUntil,
            current.processingLeaseUntil,
          )) &&
      JSON.stringify(expected.credentials) === JSON.stringify(current.credentials)
      && JSON.stringify(expected.completedSteps) ===
        JSON.stringify(current.completedSteps)
      && JSON.stringify(expected.reauthenticationProviders) ===
        JSON.stringify(current.reauthenticationProviders)
    );
  }

  async function providerSetMatches(
    userId: string,
    documents: FirestoreDocument[],
    credentials: AccountDeletionCredential[],
  ) {
    const expected = await Promise.all(credentials.map(async (credential) => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          `${credential.provider}\0${credential.firebaseUid}`,
        ),
      );
      return `${credential.provider}:${bytesToBase64Url(new Uint8Array(digest))}`;
    }));
    if (new Set(expected).size !== expected.length) return false;

    const prefix = `${firestore.documentName(
      `v1UserSignInMethods/${userId}/providers`,
    )}/`;
    const actual: string[] = [];
    for (const document of documents) {
      const provider = document.fields?.provider?.stringValue;
      const methodId = document.fields?.methodId?.stringValue;
      const documentId = document.name.startsWith(prefix)
        ? document.name.slice(prefix.length)
        : "";
      if (
        (provider !== "apple" && provider !== "google") ||
        documentId !== provider ||
        document.fields?.userId?.stringValue !== userId ||
        typeof methodId !== "string" ||
        !safeDocumentId(methodId)
      ) {
        return false;
      }
      actual.push(`${provider}:${methodId}`);
    }
    return (
      new Set(actual).size === actual.length &&
      actual.sort().join(",") === expected.sort().join(",")
    );
  }

  function newIntent(userId: string): AccountDeletionIntent {
    return {
      intentId: `intent_${randomUUID().replaceAll("-", "")}`,
      submissionExpiresAt: new Date(
        now() + STATUS_SUBMISSION_ACCEPTANCE_WINDOW_MS,
      ).toISOString(),
      userId,
    };
  }

  function intentFields(intent: AccountDeletionIntent) {
    return {
      intentId: { stringValue: intent.intentId },
      submissionExpiresAt: { timestampValue: intent.submissionExpiresAt },
      userId: { stringValue: intent.userId },
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
          const prefix = `${firestore.documentName("v1AccountDeletions")}/`;
          const expectedUserId = document.name.startsWith(prefix)
            ? document.name.slice(prefix.length)
            : "";
          if (!safeDocumentId(expectedUserId)) {
            throw new Error("Firestore returned an invalid Account Deletion job.");
          }
          jobs.push(await parseJob(document, expectedUserId));
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

    async isFinalized(userId: string) {
      if (!safeDocumentId(userId)) return false;
      const { intent, job, transaction, user } =
        await beginStateTransaction(userId);
      await rollback(transaction);
      return !intent && !job && !user;
    },

    async validatePending(expected: AccountDeletionJob) {
      if (!safeDocumentId(expected.userId)) return false;
      const {
        intent,
        job: storedJob,
        providerSlots,
        transaction,
        user,
      } = await beginStateTransaction(expected.userId, true);
      if (intent || !storedJob || !user) {
        await rollback(transaction);
        return false;
      }
      let current: AccountDeletionJob;
      try {
        current = await parseJob(storedJob, expected.userId);
      } catch {
        await rollback(transaction);
        return false;
      }
      await rollback(transaction);
      return (
        jobIdentityMatches(expected, current) &&
        pendingStateMatches(user, current) &&
        await providerSetMatches(
          expected.userId,
          providerSlots,
          current.credentials,
        )
      );
    },

    async prepareStatusToken(userId: string) {
      if (!safeDocumentId(userId)) {
        throw new Error("Account deletion received an invalid User ID.");
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const {
          intent: storedIntent,
          job: storedJob,
          providerSlots,
          transaction,
          user,
        } = await beginStateTransaction(userId, true);
        try {
          if (!user && !storedJob && !storedIntent) {
            await rollback(transaction);
            return { kind: "unrecognized" as const };
          }

          if (user && storedJob && !storedIntent) {
            let job: AccountDeletionJob;
            try {
              job = await parseJob(storedJob, userId);
            } catch {
              await rollback(transaction);
              return { kind: "unavailable" as const };
            }
            if (
              job.userId !== userId ||
              !pendingStateMatches(user, job) ||
              !(await providerSetMatches(userId, providerSlots, job.credentials))
            ) {
              await rollback(transaction);
              return { kind: "unavailable" as const };
            }
            await commit(transaction, []);
            return {
              deadline: job.deadline,
              kind: "pending" as const,
              reauthenticationProviders: job.reauthenticationProviders,
              requestedAt: job.startedAt,
              statusToken: await encryptStatusReceipt(keyValue, {
                intentId: job.intentId,
                submissionExpiresAt: job.submissionExpiresAt,
                userId,
              }),
            };
          }

          if (!user || storedJob || !isActiveUserDocument(user, userId)) {
            await rollback(transaction);
            return { kind: "unavailable" as const };
          }

          let intent = storedIntent
            ? parseIntent(storedIntent, userId)
            : null;
          if (storedIntent && !intent) {
            await rollback(transaction);
            return { kind: "unavailable" as const };
          }
          if (!intent || Date.parse(intent.submissionExpiresAt) <= now()) {
            intent = newIntent(userId);
            await commit(transaction, [{
              update: {
                fields: intentFields(intent),
                name: firestore.documentName(intentPath(userId)),
              },
              currentDocument: storedIntent
                ? { updateTime: storedIntent.updateTime }
                : { exists: false },
            }]);
          } else {
            await commit(transaction, []);
          }
          return {
            kind: "prepared" as const,
            statusToken: await encryptStatusReceipt(keyValue, intent),
            submissionExpiresAt: intent.submissionExpiresAt,
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      return { kind: "unavailable" as const };
    },

    async readStatus(statusToken: string): Promise<AccountDeletionStatusLookup> {
      const receipt = await decryptStatusReceipt(keyValue, statusToken);
      if (!receipt) return { kind: "invalid" };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { intent: storedIntent, job: storedJob, transaction, user } =
          await beginStateTransaction(receipt.userId);
        try {
          if (!storedIntent && !storedJob && !user) {
            await rollback(transaction);
            return { kind: "completed" };
          }

          if (user && storedJob && !storedIntent) {
            let job: AccountDeletionJob;
            try {
              job = await parseJob(storedJob, receipt.userId);
            } catch {
              await rollback(transaction);
              return { kind: "unavailable" };
            }
            await rollback(transaction);
            return pendingStateMatches(user, job, receipt)
              ? {
                  deadline: job.deadline,
                  kind: "pending",
                  reauthenticationProviders: job.reauthenticationProviders,
                  requestedAt: job.startedAt,
                }
              : { kind: "unavailable" };
          }

          if (!storedJob && user && isActiveUserDocument(user, receipt.userId)) {
            if (!storedIntent) {
              await rollback(transaction);
              return Date.parse(receipt.submissionExpiresAt) <= now()
                ? {
                    kind: "not_started",
                    submissionExpired: true,
                    submissionExpiresAt: receipt.submissionExpiresAt,
                  }
                : { kind: "unavailable" };
            }
            const intent = parseIntent(storedIntent, receipt.userId);
            if (
              !intent ||
              intent.intentId !== receipt.intentId ||
              !timestampsMatch(
                intent.submissionExpiresAt,
                receipt.submissionExpiresAt,
              )
            ) {
              await rollback(transaction);
              return { kind: "unavailable" };
            }
            if (Date.parse(intent.submissionExpiresAt) > now()) {
              await rollback(transaction);
              return {
                kind: "not_started",
                submissionExpired: false,
                submissionExpiresAt: receipt.submissionExpiresAt,
              };
            }
            await commit(transaction, [{
              delete: storedIntent.name,
              currentDocument: { updateTime: storedIntent.updateTime },
            }]);
            return {
              kind: "not_started",
              submissionExpired: true,
              submissionExpiresAt: receipt.submissionExpiresAt,
            };
          }

          await rollback(transaction);
          return { kind: "unavailable" };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      return { kind: "unavailable" };
    },

    async readRefreshTarget(
      statusToken: string,
      provider: "apple" | "google",
    ) {
      const receipt = await decryptStatusReceipt(keyValue, statusToken);
      if (!receipt) return { kind: "invalid" as const };
      const {
        intent,
        job: storedJob,
        providerSlots,
        transaction,
        user,
      } = await beginStateTransaction(receipt.userId, true);
      if (!intent && !storedJob && !user) {
        await rollback(transaction);
        return { kind: "completed" as const };
      }
      if (intent || !storedJob || !user) {
        await rollback(transaction);
        return { kind: "unavailable" as const };
      }
      let job: AccountDeletionJob;
      try {
        job = await parseJob(storedJob, receipt.userId);
      } catch {
        await rollback(transaction);
        return { kind: "unavailable" as const };
      }
      const matches = pendingStateMatches(user, job, receipt) &&
        await providerSetMatches(receipt.userId, providerSlots, job.credentials);
      await rollback(transaction);
      if (!matches) return { kind: "unavailable" as const };
      if (
        !job.reauthenticationProviders.includes(provider) ||
        job.completedSteps.includes(`provider:${provider}`)
      ) {
        return { kind: "not_required" as const };
      }
      const candidates = job.credentials.filter((credential) =>
        credential.provider === provider
      );
      const credential = candidates[0];
      return candidates.length === 1 &&
          credential?.providerSubject &&
          credential.revocation
        ? { credential, job, kind: "target" as const }
        : { kind: "unavailable" as const };
    },

    async reopenCredential(
      userId: string,
      replacement: AccountDeletionCredential,
      leaseUntil: string,
    ) {
      if (
        !safeDocumentId(userId) ||
        !replacement.providerSubject ||
        !replacement.revocation ||
        canonicalMillisecondTimestamp(leaseUntil) === null
      ) {
        return null;
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const {
          intent,
          job: storedJob,
          providerSlots,
          transaction,
          user,
        } = await beginStateTransaction(userId, true);
        if (intent || !storedJob || !user) {
          await rollback(transaction);
          return null;
        }
        let current: AccountDeletionJob;
        try {
          current = await parseJob(storedJob, userId);
        } catch {
          await rollback(transaction);
          return null;
        }
        if (
          !pendingStateMatches(user, current) ||
          !(await providerSetMatches(userId, providerSlots, current.credentials))
        ) {
          await rollback(transaction);
          return null;
        }
        if (
          current.reauthenticationProviders.includes(replacement.provider) &&
          !current.completedSteps.includes(`provider:${replacement.provider}`) &&
          current.processingLeaseUntil &&
          Date.parse(current.processingLeaseUntil) > now()
        ) {
          await rollback(transaction);
          return null;
        }
        const matches = current.credentials
          .map((credential, index) =>
            credential.provider === replacement.provider &&
              credential.firebaseUid === replacement.firebaseUid &&
              credential.providerSubject === replacement.providerSubject
              ? index
              : -1
          )
          .filter((index) => index >= 0);
        if (matches.length !== 1) {
          await rollback(transaction);
          return null;
        }
        const credentials = [...current.credentials];
        credentials[matches[0]] = replacement;
        const completedSteps = current.completedSteps.filter((step) =>
          step !== `firebase-sessions:${replacement.provider}` &&
          step !== `provider-attempted:${replacement.provider}` &&
          step !== `provider:${replacement.provider}`
        );
        const reauthenticationProviders = [...new Set([
          ...current.reauthenticationProviders,
          replacement.provider,
        ])].sort();
        const encrypted = await encryptCredentials(keyValue, credentials);
        try {
          await commit(transaction, [{
            currentDocument: { updateTime: storedJob.updateTime },
            update: {
              fields: {
                completedSteps: {
                  stringValue: JSON.stringify(completedSteps),
                },
                credentialCiphertext: {
                  stringValue: encrypted.ciphertext,
                },
                credentialIv: { stringValue: encrypted.iv },
                processingLeaseUntil: { timestampValue: leaseUntil },
                reauthenticationProviders: {
                  stringValue: JSON.stringify(reauthenticationProviders),
                },
              },
              name: storedJob.name,
            },
            updateMask: {
              fieldPaths: [
                "completedSteps",
                "credentialCiphertext",
                "credentialIv",
                "processingLeaseUntil",
                "reauthenticationProviders",
              ],
            },
          }]);
          return {
            ...current,
            completedSteps,
            credentials,
            processingLeaseUntil: leaseUntil,
            reauthenticationProviders,
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      return null;
    },

    async replaceCredential(
      userId: string,
      expected: AccountDeletionCredential,
      replacement: AccountDeletionCredential,
      expectedLeaseUntil: string,
      clearReauthentication = false,
    ) {
      if (
        !safeDocumentId(userId) ||
        replacement.firebaseUid !== expected.firebaseUid ||
        replacement.provider !== expected.provider ||
        replacement.providerSubject !== expected.providerSubject
      ) {
        return false;
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await read(jobPath(userId));
        if (!existing) return false;
        const current = await parseJob(existing, userId);
        if (
          !current.processingLeaseUntil ||
          !timestampsMatch(
            current.processingLeaseUntil,
            expectedLeaseUntil,
          )
        ) {
          return false;
        }
        if (current.completedSteps.includes(`provider:${expected.provider}`)) {
          return false;
        }
        const serialized = JSON.stringify(expected);
        const matches = current.credentials
          .map((credential, index) =>
            JSON.stringify(credential) === serialized ? index : -1
          )
          .filter((index) => index >= 0);
        if (matches.length !== 1) return false;
        const credentials = [...current.credentials];
        credentials[matches[0]] = replacement;
        const reauthenticationProviders = clearReauthentication
          ? current.reauthenticationProviders.filter(
              (provider) => provider !== expected.provider,
            )
          : current.reauthenticationProviders;
        const encrypted = await encryptCredentials(keyValue, credentials);
        try {
          await firestore.request(":commit", {
            body: JSON.stringify({
              writes: [{
                currentDocument: { updateTime: existing.updateTime },
                update: {
                  fields: {
                    credentialCiphertext: {
                      stringValue: encrypted.ciphertext,
                    },
                    credentialIv: { stringValue: encrypted.iv },
                    reauthenticationProviders: {
                      stringValue: JSON.stringify(reauthenticationProviders),
                    },
                  },
                  name: existing.name,
                },
                updateMask: {
                  fieldPaths: [
                    "credentialCiphertext",
                    "credentialIv",
                    "reauthenticationProviders",
                  ],
                },
              }],
            }),
            method: "POST",
          });
          return true;
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      return false;
    },

    async markReauthenticationRequired(
      userId: string,
      expected: AccountDeletionCredential,
      expectedLeaseUntil: string,
    ) {
      if (!safeDocumentId(userId)) return false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await read(jobPath(userId));
        if (!existing) return false;
        const current = await parseJob(existing, userId);
        if (
          !current.processingLeaseUntil ||
          !timestampsMatch(
            current.processingLeaseUntil,
            expectedLeaseUntil,
          )
        ) {
          return false;
        }
        if (current.completedSteps.includes(`provider:${expected.provider}`)) {
          return false;
        }
        if (
          !current.credentials.some((credential) =>
            JSON.stringify(credential) === JSON.stringify(expected)
          )
        ) {
          return false;
        }
        if (current.reauthenticationProviders.includes(expected.provider)) {
          return true;
        }
        const providers = [...current.reauthenticationProviders, expected.provider]
          .sort();
        try {
          await firestore.request(":commit", {
            body: JSON.stringify({
              writes: [{
                currentDocument: { updateTime: existing.updateTime },
                update: {
                  fields: {
                    reauthenticationProviders: {
                      stringValue: JSON.stringify(providers),
                    },
                  },
                  name: existing.name,
                },
                updateMask: { fieldPaths: ["reauthenticationProviders"] },
              }],
            }),
            method: "POST",
          });
          return true;
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      return false;
    },

    async completeProvider(
      userId: string,
      expected: AccountDeletionCredential,
      expectedLeaseUntil: string,
    ) {
      if (!safeDocumentId(userId) || !expected.providerSubject) return false;
      const step = `provider:${expected.provider}`;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await read(jobPath(userId));
        if (!existing) return false;
        const current = await parseJob(existing, userId);
        if (
          !current.processingLeaseUntil ||
          !timestampsMatch(
            current.processingLeaseUntil,
            expectedLeaseUntil,
          )
        ) {
          return false;
        }
        if (current.completedSteps.includes(step)) {
          return current.credentials.some((credential) =>
            credential.provider === expected.provider &&
            credential.firebaseUid === expected.firebaseUid &&
            credential.providerSubject === expected.providerSubject &&
            !credential.revocation &&
            !credential.firebaseIdToken &&
            !credential.firebaseIdTokenExpiresAt
          );
        }
        const serialized = JSON.stringify(expected);
        const matches = current.credentials
          .map((credential, index) =>
            JSON.stringify(credential) === serialized ? index : -1
          )
          .filter((index) => index >= 0);
        if (matches.length !== 1) return false;
        const credentials = [...current.credentials];
        credentials[matches[0]] = {
          firebaseUid: expected.firebaseUid,
          provider: expected.provider,
          providerSubject: expected.providerSubject,
        };
        const completedSteps = [...current.completedSteps, step];
        const reauthenticationProviders = current.reauthenticationProviders
          .filter((provider) => provider !== expected.provider);
        const encrypted = await encryptCredentials(keyValue, credentials);
        try {
          await firestore.request(":commit", {
            body: JSON.stringify({
              writes: [{
                currentDocument: { updateTime: existing.updateTime },
                update: {
                  fields: {
                    completedSteps: {
                      stringValue: JSON.stringify(completedSteps),
                    },
                    credentialCiphertext: {
                      stringValue: encrypted.ciphertext,
                    },
                    credentialIv: { stringValue: encrypted.iv },
                    reauthenticationProviders: {
                      stringValue: JSON.stringify(reauthenticationProviders),
                    },
                  },
                  name: existing.name,
                },
                updateMask: {
                  fieldPaths: [
                    "completedSteps",
                    "credentialCiphertext",
                    "credentialIv",
                    "reauthenticationProviders",
                  ],
                },
              }],
            }),
            method: "POST",
          });
          return true;
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      return false;
    },

    async markCompletedStep(
      userId: string,
      step: string,
      expectedLeaseUntil: string,
    ) {
      if (
        (!step.startsWith("provider-attempted:") &&
          !step.startsWith("firebase-sessions:")) ||
        !COMPLETED_STEPS.has(step)
      ) {
        throw new Error("Account deletion checkpoint is invalid.");
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await read(jobPath(userId));
        if (!existing) return;
        const currentLeaseUntil =
          existing.fields?.processingLeaseUntil?.timestampValue;
        if (
          !currentLeaseUntil ||
          !timestampsMatch(currentLeaseUntil, expectedLeaseUntil)
        ) {
          throw new Error("Account deletion checkpoint lease changed.");
        }
        const currentValue = existing.fields?.completedSteps?.stringValue ?? "[]";
        const current = JSON.parse(currentValue) as unknown;
        if (!validCompletedSteps(current)) {
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

    async release(
      userId: string,
      expectedLeaseUntil: string,
      releasedAt: string,
    ) {
      const existing = await read(jobPath(userId));
      if (!existing) return;
      const currentLeaseUntil =
        existing.fields?.processingLeaseUntil?.timestampValue;
      if (
        !currentLeaseUntil ||
        !timestampsMatch(currentLeaseUntil, expectedLeaseUntil)
      ) {
        return;
      }
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

    async start(
      userId: string,
      credentials: AccountDeletionCredential[],
      statusToken: string,
    ) {
      if (!safeDocumentId(userId)) return { kind: "invalid" as const };
      const receipt = await decryptStatusReceipt(keyValue, statusToken);
      if (!receipt || receipt.userId !== userId) {
        return { kind: "invalid" as const };
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const {
          intent: storedIntent,
          job: storedJob,
          providerSlots,
          transaction,
          user,
        } = await beginStateTransaction(userId, true);
        if (!user && !storedJob && !storedIntent) {
          await rollback(transaction);
          return { kind: "unrecognized" as const };
        }
        if (user && storedJob && !storedIntent) {
          let existing: AccountDeletionJob;
          try {
            existing = await parseJob(storedJob, userId);
          } catch {
            await rollback(transaction);
            return { kind: "unavailable" as const };
          }
          const providersMatch = await providerSetMatches(
            userId,
            providerSlots,
            existing.credentials,
          );
          await rollback(transaction);
          return pendingStateMatches(user, existing, receipt) && providersMatch
            ? {
                job: { ...existing, statusToken },
                kind: "started" as const,
              }
            : { kind: "unavailable" as const };
        }
        if (
          !user ||
          storedJob ||
          !isActiveUserDocument(user, userId) ||
          !storedIntent
        ) {
          await rollback(transaction);
          return storedIntent || storedJob
            ? { kind: "unavailable" as const }
            : { kind: "invalid" as const };
        }
        const intent = parseIntent(storedIntent, userId);
        if (
          !intent ||
          intent.intentId !== receipt.intentId ||
          !timestampsMatch(intent.submissionExpiresAt, receipt.submissionExpiresAt)
        ) {
          await rollback(transaction);
          return { kind: "unavailable" as const };
        }
        if (Date.parse(intent.submissionExpiresAt) <= now()) {
          try {
            await commit(transaction, [{
              delete: storedIntent.name,
              currentDocument: { updateTime: storedIntent.updateTime },
            }]);
            return { kind: "invalid" as const };
          } catch (error) {
            if (!isConcurrentWrite(error)) throw error;
            continue;
          }
        }
        if (!(await providerSetMatches(userId, providerSlots, credentials))) {
          await rollback(transaction);
          return { kind: "provider_mismatch" as const };
        }
        const startedAt = new Date(now()).toISOString();
        const deadline = new Date(now() + RETRY_WINDOW_MS).toISOString();
        const requestId = `del_${randomUUID().replaceAll("-", "")}`;
        const encrypted = await encryptCredentials(keyValue, credentials);
        const job: AccountDeletionStartedJob = {
          completedSteps: [],
          credentials,
          deadline,
          intentId: intent.intentId,
          reauthenticationProviders: [],
          requestId,
          startedAt,
          statusToken,
          submissionExpiresAt: intent.submissionExpiresAt,
          userId,
        };
        try {
          await commit(transaction, [
                {
                  update: {
                    name: firestore.documentName(userPath(userId)),
                    fields: {
                      deletionDeadline: { timestampValue: deadline },
                      deletionIntentId: { stringValue: intent.intentId },
                      deletionRequestId: { stringValue: requestId },
                      deletionStartedAt: { timestampValue: startedAt },
                      deletionState: { stringValue: "pending" },
                    },
                  },
                  updateMask: {
                    fieldPaths: [
                      "deletionDeadline",
                      "deletionIntentId",
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
                      intentId: { stringValue: intent.intentId },
                      requestId: { stringValue: requestId },
                      reauthenticationProviders: { stringValue: "[]" },
                      startedAt: { timestampValue: startedAt },
                      submissionExpiresAt: {
                        timestampValue: intent.submissionExpiresAt,
                      },
                      userId: { stringValue: userId },
                    },
                  },
                  currentDocument: { exists: false },
                },
                {
                  delete: storedIntent.name,
                  currentDocument: { updateTime: storedIntent.updateTime },
                },
              ]);
          return { job, kind: "started" as const };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      return { kind: "unavailable" as const };
    },
  });
}
