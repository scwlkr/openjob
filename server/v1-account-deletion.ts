import type {
  FirebaseTokenIdentity,
  LinkableSignInProvider,
} from "./firebase-id-token";
import type { GroupStore } from "./v1-groups";
import type { OpenJobUser } from "./v1-identity";
import { AccountDeletionReauthenticationRequiredError } from "./account-deletion-providers.ts";
import {
  type AccountDeletionOperatorTarget,
  prioritizeAccountDeletionJobs,
} from "./account-deletion-operator.ts";
import {
  accountDeletionPendingResponse,
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
const STATUS_AUTHORIZATION_PREFIX = "Bearer ";
const STATUS_SUBMISSION_HEADER = "x-openjob-deletion-status";
const STATUS_TOKEN_MINIMUM_LENGTH = 32;
const STATUS_TOKEN_MAXIMUM_LENGTH = 8_192;

export type AccountDeletionSubmittedRevocation =
  | { idToken: string; kind: "access_token"; value: string }
  | { clientId: string; kind: "access_token"; value: string }
  | {
      clientId: string;
      idToken: string;
      kind: "authorization_code";
      redirectUri?: string;
      value: string;
    };

export type AccountDeletionPreparedRevocation =
  | {
      clientId: string;
      expiresAt: string;
      kind: "validated_access_token";
      value: string;
    }
  | { clientId: string; kind: "refresh_token"; value: string };

export type AccountDeletionCredential = {
  firebaseIdToken?: string;
  firebaseIdTokenExpiresAt?: string;
  firebaseUid: string;
  provider: LinkableSignInProvider;
  providerSubject?: string;
  revocation?:
    | AccountDeletionSubmittedRevocation
    | AccountDeletionPreparedRevocation;
};

export type AccountDeletionJob = {
  completedSteps: string[];
  credentials: AccountDeletionCredential[];
  deadline: string;
  escalatedAt?: string;
  intentId: string;
  requestId: string;
  processingLeaseUntil?: string;
  reauthenticationProviders: LinkableSignInProvider[];
  startedAt: string;
  submissionExpiresAt: string;
  userId: string;
};

export type AccountDeletionStartedJob = AccountDeletionJob & {
  statusToken: string;
};

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
      reauthenticationProviders: LinkableSignInProvider[];
      requestedAt: string;
    }
  | { kind: "unavailable" };

type AccountDeletionUsers = {
  deleteForAccount(
    job: AccountDeletionJob,
    firebaseUids: string[],
  ): Promise<boolean>;
  listSignInMethods(userId: string): Promise<FirebaseTokenIdentity["provider"][]>;
  resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null>;
};

type AccountDeletionPreparation =
  | { kind: "unavailable" }
  | { kind: "unrecognized" }
  | {
      kind: "prepared";
      statusToken: string;
      submissionExpiresAt: string;
    }
  | {
      deadline: string;
      kind: "pending";
      reauthenticationProviders: LinkableSignInProvider[];
      requestedAt: string;
      statusToken: string;
    };

type AccountDeletionStart =
  | { kind: "invalid" }
  | { kind: "provider_mismatch" }
  | { kind: "unavailable" }
  | { kind: "unrecognized" }
  | { job: AccountDeletionStartedJob; kind: "started" };

type AccountDeletionRefreshTarget =
  | { kind: "completed" }
  | { kind: "invalid" }
  | { kind: "not_required" }
  | { kind: "unavailable" }
  | {
      credential: AccountDeletionCredential;
      job: AccountDeletionJob;
      kind: "target";
    };

type AccountDeletionOptions = {
  groups: Pick<
    GroupStore,
    "listForDeletion" | "removeDetachedUserData" | "removeUserForDeletion"
  >;
  jobs: {
    assertReady(): void;
    claim(userId: string, leaseUntil: string): Promise<boolean>;
    completeProvider(
      userId: string,
      expected: AccountDeletionCredential,
      expectedLeaseUntil: string,
    ): Promise<boolean>;
    listPending(): Promise<AccountDeletionJob[]>;
    isFinalized(userId: string): Promise<boolean>;
    markCompletedStep(
      userId: string,
      step: string,
      expectedLeaseUntil: string,
    ): Promise<void>;
    markEscalated(userId: string, escalatedAt: string): Promise<boolean>;
    markReauthenticationRequired(
      userId: string,
      expected: AccountDeletionCredential,
      expectedLeaseUntil: string,
    ): Promise<boolean>;
    prepareStatusToken(userId: string): Promise<AccountDeletionPreparation>;
    readRefreshTarget(
      statusToken: string,
      provider: LinkableSignInProvider,
    ): Promise<AccountDeletionRefreshTarget>;
    reopenCredential(
      userId: string,
      replacement: AccountDeletionCredential,
      leaseUntil: string,
    ): Promise<AccountDeletionJob | null>;
    release(
      userId: string,
      expectedLeaseUntil: string,
      releasedAt: string,
    ): Promise<void>;
    replaceCredential(
      userId: string,
      expected: AccountDeletionCredential,
      replacement: AccountDeletionCredential,
      expectedLeaseUntil: string,
      clearReauthentication?: boolean,
    ): Promise<boolean>;
    readStatus(statusToken: string): Promise<AccountDeletionStatusLookup>;
    start(
      userId: string,
      credentials: AccountDeletionCredential[],
      statusToken: string,
    ): Promise<AccountDeletionStart>;
    validatePending(job: AccountDeletionJob): Promise<boolean>;
  };
  notifications: { removeAllForUser(userId: string): Promise<number> };
  now?: () => number;
  reportEscalation?: () => void;
  providers: {
    assertReady(): void;
    deleteFirebaseUser(firebaseUid: string): Promise<void>;
    prepareAuthorization(
      credential: AccountDeletionCredential,
    ): Promise<AccountDeletionCredential>;
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
  revocation: AccountDeletionSubmittedRevocation;
};

function isLinkableProvider(value: unknown): value is LinkableSignInProvider {
  return value === "apple" || value === "google";
}

function statusTokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (
    !authorization ||
    authorization.length <
      STATUS_AUTHORIZATION_PREFIX.length + STATUS_TOKEN_MINIMUM_LENGTH ||
    authorization.length >
      STATUS_AUTHORIZATION_PREFIX.length + STATUS_TOKEN_MAXIMUM_LENGTH
  ) {
    return null;
  }
  const match = authorization?.match(
    /^Bearer (v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/,
  );
  return match?.[1] ?? null;
}

function submittedStatusTokenFromRequest(request: Request) {
  const statusToken = request.headers.get(STATUS_SUBMISSION_HEADER);
  if (statusToken === null) return { kind: "absent" as const };
  if (
    statusToken.length < STATUS_TOKEN_MINIMUM_LENGTH ||
    statusToken.length > STATUS_TOKEN_MAXIMUM_LENGTH ||
    !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(statusToken)
  ) {
    return { kind: "invalid" as const };
  }
  return { kind: "valid" as const, statusToken };
}

function statusAuthenticationRequiredResponse(requestId: () => string) {
  return errorResponse(requestId, {
    code: "authentication_required",
    message: "Authentication is required.",
    status: 401,
  });
}

function deletionUnavailableResponse(requestId: () => string) {
  return errorResponse(requestId, {
    code: "account_deletion_unavailable",
    message: "Account deletion is temporarily unavailable.",
    status: 503,
  });
}

function invalidSubmittedStatusResponse(requestId: () => string) {
  return errorResponse(requestId, {
    code: "invalid_request",
    fields: {
      statusToken: "Prepare account deletion again before submitting.",
    },
    message: "One or more fields are invalid.",
    status: 400,
  });
}

function invalidRecoveryProofResponse(requestId: () => string) {
  return errorResponse(requestId, {
    code: "invalid_request",
    fields: { credential: "Provide one fresh Sign-in Method proof." },
    message: "One or more fields are invalid.",
    status: 400,
  });
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
    Object.keys(revocation).sort().join(",") === "idToken,kind,value" &&
    validSecret(revocation.idToken, 8_192) &&
    revocation.kind === "access_token" &&
    validSecret(revocation.value, 8_192)
  ) {
    return {
      credentialToken: input.credentialToken,
      provider: input.provider,
      revocation: {
        idToken: revocation.idToken,
        kind: "access_token",
        value: revocation.value,
      },
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
    [
      "clientId,idToken,kind,value",
      "clientId,idToken,kind,redirectUri,value",
    ].includes(Object.keys(revocation).sort().join(",")) &&
    validSecret(revocation.clientId, 256) &&
    validSecret(revocation.idToken, 8_192) &&
    revocation.kind === "authorization_code" &&
    (revocation.redirectUri === undefined ||
      validSecret(revocation.redirectUri, 2_048)) &&
    validSecret(revocation.value, 8_192)
  ) {
    return {
      credentialToken: input.credentialToken,
      provider: input.provider,
      revocation: {
        clientId: revocation.clientId,
        idToken: revocation.idToken,
        kind: "authorization_code",
        ...(revocation.redirectUri === undefined
          ? {}
          : { redirectUri: revocation.redirectUri }),
        value: revocation.value,
      },
    };
  }
  return null;
}

async function readDeletionRefreshRequest(request: Request) {
  const body = await request.text();
  if (body.length === 0) return { kind: "absent" } as const;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { kind: "invalid" } as const;
    }
    const input = value as Record<string, unknown>;
    if (Object.keys(input).join(",") !== "credential") {
      return { kind: "invalid" } as const;
    }
    const proof = parseSubmittedCredential(input.credential);
    return proof
      ? { kind: "valid", proof } as const
      : { kind: "invalid" } as const;
  } catch {
    return { kind: "invalid" } as const;
  }
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

function credentialForDeletion(
  proof: SubmittedCredential,
  candidate: FirebaseTokenIdentity,
) {
  if (
    candidate.provider !== proof.provider ||
    !candidate.providerSubject ||
    !candidate.expiresAt
  ) {
    return null;
  }
  return {
    ...(proof.provider === "apple" && proof.revocation.kind === "access_token"
      ? {
          firebaseIdToken: proof.credentialToken,
          firebaseIdTokenExpiresAt: new Date(candidate.expiresAt).toISOString(),
        }
      : {}),
    firebaseUid: candidate.uid,
    provider: proof.provider,
    providerSubject: candidate.providerSubject,
    revocation: proof.revocation,
  } satisfies AccountDeletionCredential;
}

function pendingData(
  job: AccountDeletionJob,
  statusToken?: string,
) {
  return {
    deadline: job.deadline,
    reauthenticationProviders: [...job.reauthenticationProviders].sort(),
    requestedAt: job.startedAt,
    status: "pending" as const,
    ...(statusToken ? { statusToken } : {}),
  };
}

function freshAuthenticationRequiredResponse(requestId: () => string) {
  return errorResponse(requestId, {
    code: "fresh_authentication_required",
    message: "Freshly authenticate the required Sign-in Method.",
    status: 401,
  });
}

function sameFirebaseIdentity(
  authenticated: FirebaseTokenIdentity,
  proof: FirebaseTokenIdentity,
) {
  return (
    authenticated.uid === proof.uid &&
    authenticated.provider === proof.provider &&
    authenticated.providerSubject === proof.providerSubject
  );
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
  async function process(job: AccountDeletionJob, leaseUntil: string) {
    job.processingLeaseUntil = leaseUntil;
    if (!(await jobs.validatePending(job))) {
      throw new Error("Account deletion pending state is inconsistent.");
    }
    for (const credential of job.credentials) {
      const step = `firebase-sessions:${credential.provider}`;
      if (job.completedSteps.includes(step)) continue;
      await providers.revokeFirebaseSessions(credential.firebaseUid);
      await jobs.markCompletedStep(job.userId, step, leaseUntil);
      job.completedSteps.push(step);
    }
    for (let index = 0; index < job.credentials.length; index += 1) {
      let credential = job.credentials[index];
      const step = `provider:${credential.provider}`;
      if (job.completedSteps.includes(step)) continue;
      const attempted = `provider-attempted:${credential.provider}`;
      if (!job.completedSteps.includes(attempted)) {
        await jobs.markCompletedStep(job.userId, attempted, leaseUntil);
        job.completedSteps.push(attempted);
      }
      try {
        const prepared = await providers.prepareAuthorization(credential);
        if (JSON.stringify(prepared) !== JSON.stringify(credential)) {
          if (!(await jobs.replaceCredential(
            job.userId,
            credential,
            prepared,
            leaseUntil,
          ))) {
            throw new Error("Account deletion credential changed concurrently.");
          }
          credential = prepared;
          job.credentials[index] = prepared;
        }
        await providers.revokeAuthorization(credential);
        if (!(await jobs.completeProvider(
          job.userId,
          credential,
          leaseUntil,
        ))) {
          throw new Error("Account deletion provider checkpoint failed.");
        }
        job.credentials[index] = {
          firebaseUid: credential.firebaseUid,
          provider: credential.provider,
          providerSubject: credential.providerSubject,
        };
        job.completedSteps.push(step);
        job.reauthenticationProviders = job.reauthenticationProviders.filter(
          (provider) => provider !== credential.provider,
        );
      } catch (error) {
        if (error instanceof AccountDeletionReauthenticationRequiredError) {
          if (!(await jobs.markReauthenticationRequired(
            job.userId,
            credential,
            leaseUntil,
          ))) {
            throw new Error("Account deletion reauthentication state changed.");
          }
          job.reauthenticationProviders = [...new Set([
            ...job.reauthenticationProviders,
            credential.provider,
          ])].sort();
        }
        throw error;
      }
    }
    const accessibleGroups = [];
    let cursor: string | null = null;
    do {
      const page = await groups.listForDeletion(job.userId, {
        cursor,
        limit: 500,
      });
      accessibleGroups.push(...page.groups);
      cursor = page.nextCursor;
    } while (cursor !== null);
    for (const group of accessibleGroups) {
      await groups.removeUserForDeletion(job.userId, group.groupId);
    }
    await groups.removeDetachedUserData(job.userId);
    await notifications.removeAllForUser(job.userId);
    const firebaseUids = [...new Set(
      job.credentials.map(({ firebaseUid }) => firebaseUid),
    )];
    for (const firebaseUid of firebaseUids) {
      await providers.deleteFirebaseUser(firebaseUid);
    }
    const deleted = await users.deleteForAccount(
      job,
      firebaseUids,
    );
    if (!deleted && !(await jobs.isFinalized(job.userId))) {
      throw new Error("Account deletion finalization is inconsistent.");
    }
  }

  async function revokeReopenedProvider(
    job: AccountDeletionJob,
    replacement: AccountDeletionCredential,
    leaseUntil: string,
  ) {
    let current = replacement;
    await providers.revokeFirebaseSessions(current.firebaseUid);
    await jobs.markCompletedStep(
      job.userId,
      `firebase-sessions:${current.provider}`,
      leaseUntil,
    );
    job.completedSteps.push(`firebase-sessions:${current.provider}`);
    await jobs.markCompletedStep(
      job.userId,
      `provider-attempted:${current.provider}`,
      leaseUntil,
    );
    job.completedSteps.push(`provider-attempted:${current.provider}`);
    const providerPrepared = await providers.prepareAuthorization(current);
    if (JSON.stringify(providerPrepared) !== JSON.stringify(current)) {
      if (!(await jobs.replaceCredential(
        job.userId,
        current,
        providerPrepared,
        leaseUntil,
      ))) {
        await providers.revokeAuthorization(providerPrepared);
        throw new Error("Account deletion recovery proof changed concurrently.");
      }
      current = providerPrepared;
      const index = job.credentials.findIndex((credential) =>
        credential.provider === current.provider
      );
      job.credentials[index] = current;
    }
    await providers.revokeAuthorization(current);
    if (!(await jobs.completeProvider(job.userId, current, leaseUntil))) {
      throw new Error("Account deletion recovery checkpoint changed.");
    }
    const index = job.credentials.findIndex((credential) =>
      credential.provider === current.provider
    );
    job.credentials[index] = {
      firebaseUid: current.firebaseUid,
      provider: current.provider,
      providerSubject: current.providerSubject,
    };
    job.completedSteps.push(`provider:${current.provider}`);
    job.reauthenticationProviders = job.reauthenticationProviders.filter(
      (provider) => provider !== current.provider,
    );
  }

  async function revokeDirectRecovery(
    replacement: AccountDeletionCredential,
  ) {
    await providers.revokeFirebaseSessions(replacement.firebaseUid);
    if (replacement.firebaseIdToken) {
      const prepared = await providers.prepareAuthorization(replacement);
      await providers.revokeAuthorization(prepared);
      await providers.deleteFirebaseUser(replacement.firebaseUid);
      return;
    }
    await providers.deleteFirebaseUser(replacement.firebaseUid);
    const prepared = await providers.prepareAuthorization(replacement);
    await providers.revokeAuthorization(prepared);
  }

  return Object.freeze({
    async retryPending(
      exact?: AccountDeletionOperatorTarget,
      { priority }: { priority?: AccountDeletionOperatorTarget } = {},
    ) {
      jobs.assertReady();
      providers.assertReady();
      const pendingJobs = await jobs.listPending();
      const jobsToRetry = exact === undefined
        ? prioritizeAccountDeletionJobs(pendingJobs, priority ?? null)
        : pendingJobs.filter((job) =>
            job.requestId === exact.requestId && job.userId === exact.userId
          );
      const operatorTarget = exact ?? priority;
      let completed = 0;
      let escalated = 0;
      for (const job of jobsToRetry) {
        let requiresOperator = Boolean(job.escalatedAt);
        if (Date.parse(job.deadline) <= now()) {
          requiresOperator = true;
          if (
            !job.escalatedAt &&
            (await jobs.markEscalated(
              job.userId,
              new Date(now()).toISOString(),
            ))
          ) {
            reportEscalation();
            escalated += 1;
          }
        }
        const operatorSelected = Boolean(
          operatorTarget &&
            job.requestId === operatorTarget.requestId &&
            job.userId === operatorTarget.userId,
        );
        if (requiresOperator && !operatorSelected) continue;
        const leaseUntil = new Date(
          now() + PROCESSING_LEASE_MS,
        ).toISOString();
        if (!(await jobs.claim(job.userId, leaseUntil))) {
          continue;
        }
        try {
          await process(job, leaseUntil);
          completed += 1;
        } catch {
          // The encrypted minimal job remains for the next bounded retry.
          await jobs.release(
            job.userId,
            leaseUntil,
            new Date(now()).toISOString(),
          );
        }
      }
      return { completed, escalated, pending: jobsToRetry.length - completed };
    },

    async fetch(request: Request) {
      try {
        const url = new URL(request.url);
        if (
          url.pathname !== DELETION_PATH ||
          !["GET", "PATCH", "POST", "PUT"].includes(request.method)
        ) {
          return errorResponse(requestId, {
            code: "not_found",
            message: "The requested resource was not found.",
            status: 404,
          });
        }
        if (request.method === "GET") {
          const statusToken = url.search === ""
            ? statusTokenFromRequest(request)
            : null;
          if (!statusToken) {
            return statusAuthenticationRequiredResponse(requestId);
          }
          let status: AccountDeletionStatusLookup;
          try {
            jobs.assertReady();
            status = await jobs.readStatus(statusToken);
          } catch {
            return deletionUnavailableResponse(requestId);
          }
          if (status.kind === "invalid") {
            return statusAuthenticationRequiredResponse(requestId);
          }
          if (status.kind === "unavailable") {
            return deletionUnavailableResponse(requestId);
          }
          return jsonResponse({
            data:
              status.kind === "completed"
                ? { status: "completed" }
                : status.kind === "not_started"
                  ? {
                      status: "not_started",
                      submissionExpired: status.submissionExpired,
                      submissionExpiresAt: status.submissionExpiresAt,
                    }
                  : {
                      deadline: status.deadline,
                      reauthenticationProviders:
                        status.reauthenticationProviders,
                      requestedAt: status.requestedAt,
                      status: "pending",
                    },
          });
        }
        if (request.method === "PATCH") {
          const statusToken = url.search === ""
            ? statusTokenFromRequest(request)
            : null;
          if (!statusToken) {
            return statusAuthenticationRequiredResponse(requestId);
          }
          let proof: SubmittedCredential | null;
          try {
            jobs.assertReady();
            providers.assertReady();
            const submitted = await readDeletionRefreshRequest(request);
            proof = submitted.kind === "valid" ? submitted.proof : null;
          } catch {
            return deletionUnavailableResponse(requestId);
          }
          if (!proof) {
            return invalidRecoveryProofResponse(requestId);
          }
          let target: AccountDeletionRefreshTarget;
          try {
            target = await jobs.readRefreshTarget(statusToken, proof.provider);
          } catch {
            return deletionUnavailableResponse(requestId);
          }
          if (target.kind === "invalid") {
            return statusAuthenticationRequiredResponse(requestId);
          }
          if (target.kind === "completed") {
            return jsonResponse({
              data: {
                completedAt: new Date(now()).toISOString(),
                status: "completed",
              },
            });
          }
          if (target.kind === "not_required") {
            return errorResponse(requestId, {
              code: "invalid_request",
              fields: {
                credential: "This Sign-in Method does not require fresh authentication.",
              },
              message: "One or more fields are invalid.",
              status: 400,
            });
          }
          if (target.kind === "unavailable") {
            return deletionUnavailableResponse(requestId);
          }
          const candidate = await verifyCredentialToken(proof.credentialToken);
          const replacement = candidate
            ? credentialForDeletion(proof, candidate)
            : null;
          if (
            !replacement ||
            candidate!.authenticatedAt > now() ||
            now() - candidate!.authenticatedAt > FRESH_AUTHENTICATION_WINDOW_MS ||
            replacement.firebaseUid !== target.credential.firebaseUid ||
            replacement.provider !== target.credential.provider ||
            replacement.providerSubject !== target.credential.providerSubject
          ) {
            return errorResponse(requestId, {
              code: "fresh_authentication_required",
              message: "Freshly authenticate the required Sign-in Method.",
              status: 401,
            });
          }
          const leaseUntil = new Date(
            now() + PROCESSING_LEASE_MS,
          ).toISOString();
          const reopened = await jobs.reopenCredential(
            target.job.userId,
            replacement,
            leaseUntil,
          );
          if (!reopened) {
            try {
              await revokeDirectRecovery(replacement);
            } catch (error) {
              return error instanceof AccountDeletionReauthenticationRequiredError
                ? freshAuthenticationRequiredResponse(requestId)
                : deletionUnavailableResponse(requestId);
            }
            if (await jobs.isFinalized(target.job.userId)) {
              return jsonResponse({
                data: {
                  completedAt: new Date(now()).toISOString(),
                  status: "completed",
                },
              });
            }
            return jsonResponse(
              { data: pendingData(target.job, statusToken) },
              202,
            );
          }
          try {
            await revokeReopenedProvider(reopened, replacement, leaseUntil);
            await process(reopened, leaseUntil);
            return jsonResponse({
              data: {
                completedAt: new Date(now()).toISOString(),
                status: "completed",
              },
            });
          } catch (error) {
            if (error instanceof AccountDeletionReauthenticationRequiredError) {
              return freshAuthenticationRequiredResponse(requestId);
            }
            return jsonResponse(
              { data: pendingData(reopened, statusToken) },
              202,
            );
          } finally {
            await jobs.release(
              reopened.userId,
              leaseUntil,
              new Date(now()).toISOString(),
            );
          }
        }
        const identity = await verifyIdToken(request);
        if (!identity) {
          return errorResponse(requestId, {
            code: "authentication_required",
            message: "Authentication is required.",
            status: 401,
          });
        }
        const recoveryRequest = request.method === "PUT"
          ? await readDeletionRefreshRequest(request)
          : { kind: "absent" } as const;
        if (recoveryRequest.kind === "invalid") {
          return invalidRecoveryProofResponse(requestId);
        }
        const recoveryProof = recoveryRequest.kind === "valid"
          ? recoveryRequest.proof
          : null;
        const user = await users.resolve(identity);
        if (!user) {
          if (recoveryProof) {
            try {
              jobs.assertReady();
              providers.assertReady();
              const candidate = await verifyCredentialToken(
                recoveryProof.credentialToken,
              );
              const replacement = candidate
                ? credentialForDeletion(recoveryProof, candidate)
                : null;
              if (
                !candidate ||
                !replacement ||
                !sameFirebaseIdentity(identity, candidate) ||
                candidate.authenticatedAt > now() ||
                now() - candidate.authenticatedAt >
                  FRESH_AUTHENTICATION_WINDOW_MS
              ) {
                return freshAuthenticationRequiredResponse(requestId);
              }
              await revokeDirectRecovery(replacement);
              return jsonResponse({
                data: {
                  completedAt: new Date(now()).toISOString(),
                  status: "completed",
                },
              });
            } catch (error) {
              return error instanceof AccountDeletionReauthenticationRequiredError
                ? freshAuthenticationRequiredResponse(requestId)
                : deletionUnavailableResponse(requestId);
            }
          }
          return signInMethodUnrecognizedResponse(requestId);
        }
        if (url.search !== "") {
          return invalidSubmittedStatusResponse(requestId);
        }
        if (request.method === "PUT") {
          try {
            jobs.assertReady();
            const prepared = await jobs.prepareStatusToken(user.userId);
            if (prepared.kind === "unrecognized") {
              return signInMethodUnrecognizedResponse(requestId);
            }
            if (prepared.kind === "unavailable") {
              return deletionUnavailableResponse(requestId);
            }
            if (prepared.kind === "pending") {
              providers.assertReady();
              if (!recoveryProof) {
                return freshAuthenticationRequiredResponse(requestId);
              }
              const checkedAt = now();
              const candidate = await verifyCredentialToken(
                recoveryProof.credentialToken,
              );
              const replacement = candidate
                ? credentialForDeletion(recoveryProof, candidate)
                : null;
              if (
                !candidate ||
                !replacement ||
                !sameFirebaseIdentity(identity, candidate) ||
                candidate.authenticatedAt > checkedAt ||
                checkedAt - candidate.authenticatedAt >
                  FRESH_AUTHENTICATION_WINDOW_MS
              ) {
                return freshAuthenticationRequiredResponse(requestId);
              }
              const recoveryLeaseUntil = new Date(
                now() + PROCESSING_LEASE_MS,
              ).toISOString();
              const reopened = await jobs.reopenCredential(
                user.userId,
                replacement,
                recoveryLeaseUntil,
              );
              if (!reopened) {
                await revokeDirectRecovery(replacement);
                if (await jobs.isFinalized(user.userId)) {
                  return jsonResponse({
                    data: {
                      completedAt: new Date(now()).toISOString(),
                      status: "completed",
                    },
                  });
                }
                return jsonResponse(
                  {
                    data: {
                      deadline: prepared.deadline,
                      reauthenticationProviders:
                        prepared.reauthenticationProviders,
                      requestedAt: prepared.requestedAt,
                      status: "pending",
                      statusToken: prepared.statusToken,
                    },
                  },
                  202,
                );
              }
              try {
                await revokeReopenedProvider(
                  reopened,
                  replacement,
                  recoveryLeaseUntil,
                );
              } catch (error) {
                if (error instanceof AccountDeletionReauthenticationRequiredError) {
                  return freshAuthenticationRequiredResponse(requestId);
                }
                return jsonResponse(
                  { data: pendingData(reopened, prepared.statusToken) },
                  202,
                );
              } finally {
                await jobs.release(
                  reopened.userId,
                  recoveryLeaseUntil,
                  new Date(now()).toISOString(),
                );
              }
              return jsonResponse(
                {
                  data: pendingData(reopened, prepared.statusToken),
                },
                202,
              );
            }
            return jsonResponse({
              data: {
                status: "not_started",
                statusToken: prepared.statusToken,
                submissionExpiresAt: prepared.submissionExpiresAt,
              },
            });
          } catch {
            return deletionUnavailableResponse(requestId);
          }
        }
        if (user.deletionPending) {
          try {
            jobs.assertReady();
            const pending = await jobs.prepareStatusToken(user.userId);
            return pending.kind === "pending"
              ? accountDeletionPendingResponse(requestId)
              : deletionUnavailableResponse(requestId);
          } catch {
            return deletionUnavailableResponse(requestId);
          }
        }
        const preparedStatus = submittedStatusTokenFromRequest(request);
        if (preparedStatus.kind !== "valid") {
          return invalidSubmittedStatusResponse(requestId);
        }
        try {
          jobs.assertReady();
          providers.assertReady();
        } catch {
          return deletionUnavailableResponse(requestId);
        }
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
          const credential = candidate
            ? credentialForDeletion(proof, candidate)
            : null;
          if (
            !candidate ||
            !credential ||
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
          credentials.push(credential);
        }
        let started: AccountDeletionStart;
        try {
          started = await jobs.start(
            user.userId,
            credentials,
            preparedStatus.statusToken,
          );
        } catch {
          return deletionUnavailableResponse(requestId);
        }
        if (started.kind === "invalid") {
          return invalidSubmittedStatusResponse(requestId);
        }
        if (started.kind === "provider_mismatch") {
          return errorResponse(requestId, {
            code: "fresh_authentication_required",
            message: "Freshly authenticate every linked Sign-in Method.",
            status: 401,
          });
        }
        if (started.kind === "unavailable") {
          return deletionUnavailableResponse(requestId);
        }
        if (started.kind === "unrecognized") {
          return signInMethodUnrecognizedResponse(requestId);
        }
        const job = started.job;
        const leaseUntil = new Date(
          now() + PROCESSING_LEASE_MS,
        ).toISOString();
        if (!(await jobs.claim(job.userId, leaseUntil))) {
          return jsonResponse(
            { data: pendingData(job, job.statusToken) },
            202,
          );
        }
        try {
          await process(job, leaseUntil);
          return jsonResponse({
            data: {
              completedAt: new Date(now()).toISOString(),
              status: "completed",
            },
          });
        } catch {
          await jobs.release(
            job.userId,
            leaseUntil,
            new Date(now()).toISOString(),
          );
          return jsonResponse(
            { data: pendingData(job, job.statusToken) },
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
