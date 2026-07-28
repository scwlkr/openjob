import type {
  FirebaseTokenIdentity,
  LinkableSignInProvider,
} from "./firebase-id-token";
import type { GroupStore } from "./v1-groups";
import type { OpenJobUser } from "./v1-identity";
import {
  defaultRequestId,
  errorResponse,
  internalErrorResponse,
  isRateLimitError,
  jsonResponse,
  rateLimitedErrorResponse,
  signInMethodUnrecognizedResponse,
} from "./v1-http.ts";

const DELETION_PATH = "/api/v1/me/deletion";
const FRESH_AUTHENTICATION_WINDOW_MS = 5 * 60_000;
const PROCESSING_LEASE_MS = 15 * 60_000;

export type AccountDeletionCredential = {
  firebaseUid: string;
  provider: LinkableSignInProvider;
  revocation:
    | { clientId?: string; kind: "access_token"; value: string }
    | { clientId: string; kind: "authorization_code"; value: string };
};

export type AccountDeletionJob = {
  completedSteps: string[];
  credentials: AccountDeletionCredential[];
  deadline: string;
  escalatedAt?: string;
  requestId: string;
  processingLeaseUntil?: string;
  startedAt: string;
  userId: string;
};

type AccountDeletionUsers = {
  deleteForAccount(userId: string, firebaseUids: string[]): Promise<boolean>;
  listSignInMethods(userId: string): Promise<FirebaseTokenIdentity["provider"][]>;
  resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null>;
};

type AccountDeletionOptions = {
  groups: Pick<
    GroupStore,
    "list" | "removeDetachedUserData" | "removeUserForDeletion"
  >;
  jobs: {
    assertReady(): void;
    claim(userId: string, leaseUntil: string): Promise<boolean>;
    listPending(): Promise<AccountDeletionJob[]>;
    markCompletedStep(userId: string, step: string): Promise<void>;
    markEscalated(userId: string, escalatedAt: string): Promise<boolean>;
    release(userId: string, releasedAt: string): Promise<void>;
    start(
      userId: string,
      credentials: AccountDeletionCredential[],
    ): Promise<AccountDeletionJob | null>;
  };
  notifications: { removeAllForUser(userId: string): Promise<number> };
  now?: () => number;
  reportEscalation?: (requestId: string) => void;
  providers: {
    assertReady(): void;
    deleteFirebaseUser(firebaseUid: string): Promise<void>;
    revokeAuthorization(credential: AccountDeletionCredential): Promise<void>;
    revokeFirebaseSessions(firebaseUid: string): Promise<void>;
  };
  requestId?: () => string;
  users: AccountDeletionUsers;
  verifyCredentialToken(token: string): Promise<FirebaseTokenIdentity | null>;
  verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null>;
};

type SubmittedCredential = {
  credentialToken: string;
  provider: LinkableSignInProvider;
  revocation: AccountDeletionCredential["revocation"];
};

function isLinkableProvider(value: unknown): value is LinkableSignInProvider {
  return value === "apple" || value === "google";
}

function validSecret(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function parseSubmittedCredential(value: unknown): SubmittedCredential | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(",") !==
      "credentialToken,provider,revocation" ||
    !isLinkableProvider(input.provider) ||
    !validSecret(input.credentialToken, 8_192) ||
    !input.revocation ||
    typeof input.revocation !== "object" ||
    Array.isArray(input.revocation)
  ) {
    return null;
  }
  const revocation = input.revocation as Record<string, unknown>;
  if (
    input.provider === "google" &&
    Object.keys(revocation).sort().join(",") === "kind,value" &&
    revocation.kind === "access_token" &&
    validSecret(revocation.value, 8_192)
  ) {
    return {
      credentialToken: input.credentialToken,
      provider: input.provider,
      revocation: { kind: "access_token", value: revocation.value },
    };
  }
  if (
    input.provider === "apple" &&
    Object.keys(revocation).sort().join(",") === "clientId,kind,value" &&
    validSecret(revocation.clientId, 256) &&
    revocation.kind === "access_token" &&
    validSecret(revocation.value, 8_192)
  ) {
    return {
      credentialToken: input.credentialToken,
      provider: input.provider,
      revocation: {
        clientId: revocation.clientId,
        kind: "access_token",
        value: revocation.value,
      },
    };
  }
  if (
    input.provider === "apple" &&
    Object.keys(revocation).sort().join(",") === "clientId,kind,value" &&
    validSecret(revocation.clientId, 256) &&
    revocation.kind === "authorization_code" &&
    validSecret(revocation.value, 8_192)
  ) {
    return {
      credentialToken: input.credentialToken,
      provider: input.provider,
      revocation: {
        clientId: revocation.clientId,
        kind: "authorization_code",
        value: revocation.value,
      },
    };
  }
  return null;
}

async function readDeletionRequest(request: Request) {
  try {
    const value = (await request.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    if (
      Object.keys(input).sort().join(",") !== "confirmation,credentials" ||
      input.confirmation !== "delete" ||
      !Array.isArray(input.credentials) ||
      input.credentials.length < 1 ||
      input.credentials.length > 2
    ) {
      return null;
    }
    const credentials = input.credentials.map(parseSubmittedCredential);
    return credentials.every(
      (credential): credential is SubmittedCredential => credential !== null,
    )
      ? credentials
      : null;
  } catch {
    return null;
  }
}

export function createV1AccountDeletionApi({
  groups,
  jobs,
  notifications,
  now = Date.now,
  providers,
  reportEscalation = () => undefined,
  requestId = defaultRequestId,
  users,
  verifyCredentialToken,
  verifyIdToken,
}: AccountDeletionOptions) {
  async function process(job: AccountDeletionJob) {
    for (const credential of job.credentials) {
      await providers.revokeFirebaseSessions(credential.firebaseUid);
    }
    for (const credential of job.credentials) {
      const step = `provider:${credential.provider}:${credential.firebaseUid}`;
      if (!job.completedSteps.includes(step)) {
        await providers.revokeAuthorization(credential);
        await jobs.markCompletedStep(job.userId, step);
        job.completedSteps.push(step);
      }
    }
    const accessibleGroups = [];
    let cursor: string | null = null;
    do {
      const page = await groups.list(job.userId, { cursor, limit: 500 });
      accessibleGroups.push(...page.groups);
      cursor = page.nextCursor;
    } while (cursor !== null);
    for (const group of accessibleGroups) {
      await groups.removeUserForDeletion(job.userId, group.groupId);
    }
    await groups.removeDetachedUserData(job.userId);
    await notifications.removeAllForUser(job.userId);
    for (const credential of job.credentials) {
      await providers.deleteFirebaseUser(credential.firebaseUid);
    }
    await users.deleteForAccount(
      job.userId,
      job.credentials.map(({ firebaseUid }) => firebaseUid),
    );
  }

  return Object.freeze({
    async retryPending() {
      jobs.assertReady();
      providers.assertReady();
      const jobsToRetry = await jobs.listPending();
      let completed = 0;
      let escalated = 0;
      for (const job of jobsToRetry) {
        if (Date.parse(job.deadline) <= now()) {
          if (
            !job.escalatedAt &&
            (await jobs.markEscalated(
              job.userId,
              new Date(now()).toISOString(),
            ))
          ) {
            reportEscalation(job.requestId);
            escalated += 1;
          }
          continue;
        }
        if (
          !(await jobs.claim(
            job.userId,
            new Date(now() + PROCESSING_LEASE_MS).toISOString(),
          ))
        ) {
          continue;
        }
        try {
          await process(job);
          completed += 1;
        } catch {
          // The encrypted minimal job remains for the next bounded retry.
          await jobs.release(job.userId, new Date(now()).toISOString());
        }
      }
      return { completed, escalated, pending: jobsToRetry.length - completed };
    },

    async fetch(request: Request) {
      try {
        const url = new URL(request.url);
        if (url.pathname !== DELETION_PATH || request.method !== "POST") {
          return errorResponse(requestId, {
            code: "not_found",
            message: "The requested resource was not found.",
            status: 404,
          });
        }
        const identity = await verifyIdToken(request);
        if (!identity) {
          return errorResponse(requestId, {
            code: "authentication_required",
            message: "Authentication is required.",
            status: 401,
          });
        }
        const user = await users.resolve(identity);
        if (!user) return signInMethodUnrecognizedResponse(requestId);
        const submitted = await readDeletionRequest(request);
        if (!submitted) {
          return errorResponse(requestId, {
            code: "invalid_request",
            message: "One or more fields are invalid.",
            fields: {
              confirmation: "Explicitly confirm deletion with every linked Sign-in Method.",
            },
            status: 400,
          });
        }
        const linked = (await users.listSignInMethods(user.userId))
          .filter(isLinkableProvider)
          .sort();
        if (
          linked.length === 0 ||
          submitted.map(({ provider }) => provider).sort().join(",") !==
            linked.join(",")
        ) {
          return errorResponse(requestId, {
            code: "fresh_authentication_required",
            message: "Freshly authenticate every linked Sign-in Method.",
            status: 401,
          });
        }
        const checkedAt = now();
        const credentials: AccountDeletionCredential[] = [];
        for (const proof of submitted) {
          const candidate = await verifyCredentialToken(proof.credentialToken);
          const owner = candidate ? await users.resolve(candidate) : null;
          if (
            !candidate ||
            candidate.provider !== proof.provider ||
            candidate.authenticatedAt > checkedAt ||
            checkedAt - candidate.authenticatedAt >
              FRESH_AUTHENTICATION_WINDOW_MS ||
            owner?.userId !== user.userId
          ) {
            return errorResponse(requestId, {
              code: "fresh_authentication_required",
              message: "Freshly authenticate every linked Sign-in Method.",
              status: 401,
            });
          }
          credentials.push({
            firebaseUid: candidate.uid,
            provider: proof.provider,
            revocation: proof.revocation,
          });
        }

        try {
          jobs.assertReady();
          providers.assertReady();
        } catch {
          return errorResponse(requestId, {
            code: "account_deletion_unavailable",
            message: "Account deletion is temporarily unavailable.",
            status: 503,
          });
        }

        const job = await jobs.start(user.userId, credentials);
        if (!job) return signInMethodUnrecognizedResponse(requestId);
        if (
          !(await jobs.claim(
            job.userId,
            new Date(now() + PROCESSING_LEASE_MS).toISOString(),
          ))
        ) {
          return jsonResponse(
            {
              data: {
                deadline: job.deadline,
                requestedAt: job.startedAt,
                status: "pending",
              },
            },
            202,
          );
        }
        try {
          await process(job);
          return jsonResponse({
            data: {
              completedAt: new Date(now()).toISOString(),
              status: "completed",
            },
          });
        } catch {
          await jobs.release(job.userId, new Date(now()).toISOString());
          return jsonResponse(
            {
              data: {
                deadline: job.deadline,
                requestedAt: job.startedAt,
                status: "pending",
              },
            },
            202,
          );
        }
      } catch (error) {
        if (isRateLimitError(error)) return rateLimitedErrorResponse(requestId);
        return internalErrorResponse(requestId);
      }
    },
  });
}

export function createV1AccountDeletionHandler(
  getApi: () => ReturnType<typeof createV1AccountDeletionApi>,
  requestId = defaultRequestId,
) {
  return async function handleV1AccountDeletionRequest(request: Request) {
    try {
      return await getApi().fetch(request);
    } catch {
      return internalErrorResponse(requestId);
    }
  };
}
