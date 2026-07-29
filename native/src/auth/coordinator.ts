import type {
  NativeCachedTaskList,
  NativeGroup,
  NativeMember,
  NativeTaskListController,
  NativeTaskListReadResult,
  NativeTaskListSyncResult,
} from "../task-list-contracts";
import type { LocalTaskListCacheEntry } from "../domain-cache";

export type SignInMethod = "apple" | "google";
export type AuthenticationMethod = SignInMethod | "qa-password";

export type OpenJobUser = {
  userId: string;
  username: string | null;
  usernameRequired: boolean;
};

export type ProviderCredential = {
  idToken: string;
  nonce?: string;
  provider: SignInMethod;
  revocation?:
    | { idToken: string; kind: "access_token"; value: string }
    | { clientId: string; kind: "access_token"; value: string }
    | {
        clientId: string;
        idToken: string;
        kind: "authorization_code";
        redirectUri?: string;
        value: string;
      };
};

export type FirebaseAccessSession = {
  expiresAt: number;
  idToken: string;
  provider: AuthenticationMethod;
};

export type FirebaseSession = FirebaseAccessSession & {
  refreshToken: string;
};

export type StoredSession =
  | {
      provider: AuthenticationMethod;
      refreshToken: string;
      version: 1;
    }
  | {
      ownerUserId: string;
      provider: AuthenticationMethod;
      refreshToken: string;
      version: 2;
    };

export type DeletionReceipt = {
  phase: "completed" | "prepared" | "submitting";
  statusToken: string;
  version: 1;
};

export type DeletionProviderCredential = {
  credentialToken: string;
  provider: SignInMethod;
  revocation: NonNullable<ProviderCredential["revocation"]>;
};

export type DeletionStatus =
  | {
      status: "not_started";
      submissionExpired: boolean;
      submissionExpiresAt: string;
    }
  | { status: "completed" }
  | {
      deadline: string;
      reauthenticationProviders: SignInMethod[];
      requestedAt: string;
      status: "pending";
    };

export type DeletionStartResult =
  | { status: "completed" }
  | (Extract<DeletionStatus, { status: "pending" }> & {
      statusToken: string;
    });

export type DeletionPrepareResult =
  | { status: "completed" }
  | {
      status: "not_started";
      statusToken: string;
      submissionExpiresAt: string;
    }
  | (Extract<DeletionStatus, { status: "pending" }> & {
      statusToken: string;
    });

export function isDeletionStatusToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 8192 &&
    /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)
  );
}

const OPENJOB_RFC3339_TIMESTAMP =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{3}|\d{6}|\d{9}))?Z$/;

export function isFiniteTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = OPENJOB_RFC3339_TIMESTAMP.exec(value);
  if (!match || match[1] === "0000") return false;
  const [, year, month, day, hour, minute, second] = match;
  const wholeSecond = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const milliseconds = Date.parse(wholeSecond);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() ===
      `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`
  );
}

export function hasValidDeletionTimeline(
  value: unknown,
): value is { deadline: string; requestedAt: string } {
  if (!value || typeof value !== "object") return false;
  const timeline = value as {
    deadline?: unknown;
    requestedAt?: unknown;
  };
  if (
    !isFiniteTimestamp(timeline.requestedAt) ||
    !isFiniteTimestamp(timeline.deadline)
  ) {
    return false;
  }
  return Date.parse(timeline.deadline) >= Date.parse(timeline.requestedAt);
}

export type SignedInResult = {
  kind: "signed-in";
  methods: SignInMethod[];
  notice?: "fresh_authentication_required" | "link_target_changed";
  provisional?: boolean;
  restoreReason?: "offline" | "unavailable";
  user: OpenJobUser;
};

export type AuthFlowResult =
  | SignedInResult
  | { kind: "deletion-completed" }
  | {
      kind: "deletion-clear-retry";
      status: "completed" | "not_started";
    }
  | {
      deadline: string;
      kind: "deletion-pending";
      reauthenticationProviders: SignInMethod[];
      requestedAt: string;
    }
  | {
      kind: "deletion-status-retry";
      reason:
        | "invalid-response"
        | "offline"
        | "proof-retry"
        | "storage-unavailable"
        | "unavailable";
    }
  | {
      kind: "unrecognized";
      notice?: "fresh_authentication_required" | "link_target_changed";
      provider: AuthenticationMethod;
    }
  | {
      existingProvider: SignInMethod;
      kind: "confirm-link";
      newProvider: SignInMethod;
      user: OpenJobUser;
    }
  | { kind: "offline"; provider: SignInMethod }
  | {
      kind: "restore-retry";
      reason: "offline" | "unavailable";
    }
  | { kind: "cleanup-retry" }
  | {
      kind: "signed-out";
      reason?:
        | "cancelled"
        | "deleted"
        | "deletion-pending"
        | "expired"
        | "interrupted"
        | "revoked"
        | "unavailable";
    };

export type ProviderSignInFailure =
  | "cancelled"
  | "interrupted"
  | "offline"
  | "revoked"
  | "unavailable";

export class ProviderSignInError extends Error {
  constructor(readonly code: ProviderSignInFailure) {
    super(code);
    this.name = "ProviderSignInError";
  }
}

export class OpenJobApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "OpenJobApiError";
  }
}

export type NativeAuthDependencies = {
  claimUsername(
    idToken: string,
    username: string,
  ): Promise<OpenJobUser>;
  clearCleanupPending(): Promise<void>;
  clearDeletionReceipt(): Promise<void>;
  clearProviderSession(): Promise<void>;
  clearStoredSession(): Promise<void>;
  createUser(idToken: string): Promise<OpenJobUser>;
  deleteUser(
    idToken: string,
    credentials: DeletionProviderCredential[],
    statusToken: string,
  ): Promise<DeletionStartResult>;
  exchangeProviderCredential(
    credential: ProviderCredential,
  ): Promise<FirebaseSession>;
  getMe(idToken: string): Promise<OpenJobUser>;
  getDeletionStatus(statusToken: string): Promise<DeletionStatus>;
  linkSignInMethod(
    idToken: string,
    credentialToken: string,
    expectedTargetUserId: string,
  ): Promise<OpenJobUser>;
  listGroups(idToken: string): Promise<NativeGroup[]>;
  listMembers(
    idToken: string,
    groupId: string,
  ): Promise<NativeMember[]>;
  listSignInMethods(idToken: string): Promise<SignInMethod[]>;
  listTasks(
    idToken: string,
    groupId: string,
    validator?: string | null,
  ): Promise<NativeTaskListReadResult>;
  loadLocalTaskListCache(
    ownerUserId: string,
  ): Promise<LocalTaskListCacheEntry | null>;
  loadCleanupPending(): Promise<boolean>;
  loadDeletionReceipt(): Promise<DeletionReceipt | null>;
  loadStoredSession(): Promise<StoredSession | null>;
  markCleanupPending(): Promise<void>;
  now(): number;
  prepareDeletionStatus(
    idToken: string,
    credential?: DeletionProviderCredential,
  ): Promise<DeletionPrepareResult>;
  purgeLocalDomainCache(): Promise<void>;
  refreshDeletionProvider(
    statusToken: string,
    credential: DeletionProviderCredential,
  ): Promise<DeletionStartResult>;
  refreshSession(stored: StoredSession): Promise<FirebaseSession>;
  saveStoredSession(stored: StoredSession): Promise<void>;
  saveDeletionReceipt(receipt: DeletionReceipt): Promise<void>;
  saveLocalTaskListCache(entry: LocalTaskListCacheEntry): Promise<void>;
  signInWithQaPassword(
    email: string,
    password: string,
  ): Promise<FirebaseSession>;
  signInWithProvider(provider: SignInMethod): Promise<ProviderCredential>;
  subscribeToCredentialRevocation?(
    listener: () => void,
  ): () => void;
};

function otherProvider(provider: SignInMethod): SignInMethod {
  return provider === "google" ? "apple" : "google";
}

function isUnrecognized(error: unknown) {
  return (
    error instanceof OpenJobApiError &&
    error.status === 409 &&
    error.code === "sign_in_method_unrecognized"
  );
}

function isAccountDeletionPending(error: unknown) {
  return (
    error instanceof OpenJobApiError &&
    error.status === 410 &&
    error.code === "account_deletion_pending"
  );
}

function isTransientDeletionRecoveryError(error: unknown) {
  return (
    (error instanceof ProviderSignInError && error.code === "offline") ||
    (error instanceof OpenJobApiError &&
      error.code !== "invalid_response" &&
      (error.status === 429 || error.status >= 500))
  );
}

function sortedMethods(methods: SignInMethod[]) {
  return [...new Set(methods)].sort();
}

const LINK_CONFIRMATION_VALIDITY_MS = 5 * 60_000;
const DELETION_RECOVERY_PROOF_VALIDITY_MS = 5 * 60_000;
const MAX_DELETION_RECOVERY_ATTEMPTS = 3;

type PendingDeletionRecovery = {
  attempts: number;
  credential: DeletionProviderCredential;
  epoch: number;
  expiresAt: number;
};

export class NativeAuthCoordinator implements NativeTaskListController {
  private activeResult: SignedInResult | null = null;
  private activeSession: FirebaseAccessSession | null = null;
  private candidateSession: FirebaseAccessSession | null = null;
  private existingSession: FirebaseAccessSession | null = null;
  private deletionReceipt: DeletionReceipt | null = null;
  private deletionReceiptNeedsSave = false;
  private linkMode: "existing-current" | "unknown-current" | null = null;
  private expectedTargetUserId: string | null = null;
  private operationEpoch = 0;
  private pendingDeletionRecovery: PendingDeletionRecovery | null = null;
  private storedSession: StoredSession | null = null;
  private operationTails = {
    deletion: Promise.resolve(),
    provider: Promise.resolve(),
    receipt: Promise.resolve(),
    stored: Promise.resolve(),
  };

  constructor(private readonly dependencies: NativeAuthDependencies) {}

  async restoreCachedSession(): Promise<SignedInResult | null> {
    const epoch = this.operationEpoch;
    if (this.deletionReceipt) return null;
    const cleanupPending = await this.dependencies.loadCleanupPending();
    this.assertCurrentOperation(epoch);
    if (cleanupPending) return null;
    const deletionReceipt = await this.loadDeletionReceipt(epoch);
    if (deletionReceipt) return null;
    const stored = await this.dependencies.loadStoredSession();
    this.assertCurrentOperation(epoch);
    this.storedSession = stored;
    if (!stored || stored.version !== 2) return null;
    const cached = await this.dependencies.loadLocalTaskListCache(
      stored.ownerUserId,
    );
    this.assertCurrentOperation(epoch);
    if (!cached) return null;
    const result: SignedInResult = {
      kind: "signed-in",
      methods: [],
      provisional: true,
      user: {
        userId: stored.ownerUserId,
        username: null,
        usernameRequired: false,
      },
    };
    this.activeResult = result;
    return result;
  }

  async restore(): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    try {
      const deletion = await this.resolveStoredDeletionReceipt(epoch);
      if (deletion) return deletion;
      const cleanupPending =
        await this.dependencies.loadCleanupPending();
      this.assertCurrentOperation(epoch);
      if (cleanupPending) {
        return (await this.removePrivateData())
          ? { kind: "signed-out" }
          : { kind: "cleanup-retry" };
      }
      const stored = await this.dependencies.loadStoredSession();
      this.assertCurrentOperation(epoch);
      this.storedSession = stored;
      if (!stored) return { kind: "signed-out" };
      const refreshed = await this.dependencies.refreshSession(stored);
      this.assertCurrentOperation(epoch);
      const session = this.accessSession(refreshed);
      let user: OpenJobUser;
      try {
        user = await this.dependencies.getMe(session.idToken);
      } catch (error) {
        if (isAccountDeletionPending(error)) {
          this.assertCurrentOperation(epoch);
          return await this.blockPendingDeletionWithoutFreshProof();
        }
        if (!isUnrecognized(error)) throw error;
        this.assertCurrentOperation(epoch);
        try {
          await this.dependencies.purgeLocalDomainCache();
        } catch {
          return (await this.removePrivateData())
            ? { kind: "signed-out" }
            : { kind: "cleanup-retry" };
        }
        this.candidateSession = await this.persistSession(refreshed, epoch);
        return {
          kind: "unrecognized",
          provider: session.provider,
        };
      }
      this.assertCurrentOperation(epoch);
      if (stored.version === 2 && stored.ownerUserId !== user.userId) {
        return (await this.removePrivateData())
          ? { kind: "signed-out", reason: "revoked" }
          : { kind: "cleanup-retry" };
      }
      const persisted = await this.persistSession(
        refreshed,
        epoch,
        user.userId,
      );
      return await this.finishSignedIn(persisted, user, epoch);
    } catch (error) {
      if (
        error instanceof ProviderSignInError &&
        (error.code === "offline" || error.code === "unavailable")
      ) {
        return { kind: "restore-retry", reason: error.code };
      }
      if (
        (error instanceof ProviderSignInError &&
          error.code === "revoked") ||
        (error instanceof OpenJobApiError && error.status === 401)
      ) {
        return (await this.removePrivateData())
          ? { kind: "signed-out", reason: "revoked" }
          : { kind: "cleanup-retry" };
      }
      if (
        error instanceof OpenJobApiError &&
        (error.status === 429 || error.status >= 500)
      ) {
        return { kind: "restore-retry", reason: "unavailable" };
      }
      return { kind: "restore-retry", reason: "unavailable" };
    }
  }

  async signIn(provider: SignInMethod): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    let providerAuthenticated = false;
    this.candidateSession = null;
    this.existingSession = null;
    try {
      const deletion = await this.resolveStoredDeletionReceipt(epoch);
      if (deletion) return deletion;
      const credential =
        await this.withOperationLock("provider", () =>
          this.dependencies.signInWithProvider(provider),
        );
      providerAuthenticated = true;
      this.assertCurrentOperation(epoch);
      const firebaseSession =
        await this.dependencies.exchangeProviderCredential(credential);
      this.assertCurrentOperation(epoch);
      const accessSession = this.accessSession(firebaseSession);
      let user: OpenJobUser;
      try {
        user = await this.dependencies.getMe(accessSession.idToken);
      } catch (error) {
        if (isAccountDeletionPending(error)) {
          this.assertCurrentOperation(epoch);
          return await this.recoverPendingDeletion(
            accessSession.idToken,
            credential,
            provider,
            epoch,
          );
        }
        if (!isUnrecognized(error)) throw error;
        const session = await this.persistSession(firebaseSession, epoch);
        this.candidateSession = session;
        return { kind: "unrecognized", provider };
      }
      this.assertCurrentOperation(epoch);
      const methods = sortedMethods(
        await this.dependencies.listSignInMethods(accessSession.idToken),
      );
      this.assertCurrentOperation(epoch);
      const session = await this.persistSession(
        firebaseSession,
        epoch,
        user.userId,
      );
      return this.setSignedIn(session, user, methods, epoch);
    } catch (error) {
      this.assertCurrentOperation(epoch);
      if (providerAuthenticated) {
        const removed = await this.removePrivateData();
        if (!removed) return { kind: "cleanup-retry" };
      }
      if (error instanceof ProviderSignInError) {
        if (error.code === "offline") return { kind: "offline", provider };
        return { kind: "signed-out", reason: error.code };
      }
      throw error;
    }
  }

  async signInWithQaPassword(
    email: string,
    password: string,
  ): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    this.candidateSession = null;
    this.existingSession = null;
    try {
      const deletion = await this.resolveStoredDeletionReceipt(epoch);
      if (deletion) return deletion;
      const firebaseSession =
        await this.dependencies.signInWithQaPassword(email, password);
      this.assertCurrentOperation(epoch);
      const accessSession = this.accessSession(firebaseSession);
      let user: OpenJobUser;
      try {
        user = await this.dependencies.getMe(accessSession.idToken);
      } catch (error) {
        if (isAccountDeletionPending(error)) {
          this.assertCurrentOperation(epoch);
          return await this.blockPendingDeletionWithoutFreshProof();
        }
        if (!isUnrecognized(error)) throw error;
        const session = await this.persistSession(firebaseSession, epoch);
        this.candidateSession = session;
        return { kind: "unrecognized", provider: "qa-password" };
      }
      this.assertCurrentOperation(epoch);
      const methods = sortedMethods(
        await this.dependencies.listSignInMethods(accessSession.idToken),
      );
      this.assertCurrentOperation(epoch);
      const session = await this.persistSession(
        firebaseSession,
        epoch,
        user.userId,
      );
      return this.setSignedIn(session, user, methods, epoch);
    } catch (error) {
      this.assertCurrentOperation(epoch);
      if (error instanceof ProviderSignInError) {
        return { kind: "signed-out", reason: "unavailable" };
      }
      throw error;
    }
  }

  async createUser(): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    try {
      const candidate = await this.currentCandidateSession(epoch);
      if (candidate.provider === "qa-password") {
        throw new Error(
          "Preview QA password sign-in cannot create a User.",
        );
      }
      const user = await this.dependencies.createUser(candidate.idToken);
      this.assertCurrentOperation(epoch);
      return this.finishSignedIn(candidate, user, epoch);
    } catch (error) {
      this.assertCurrentOperation(epoch);
      if (
        (error instanceof ProviderSignInError &&
          error.code === "revoked") ||
        (error instanceof OpenJobApiError && error.status === 401)
      ) {
        return (await this.removePrivateData())
          ? { kind: "signed-out", reason: "revoked" }
          : { kind: "cleanup-retry" };
      }
      throw error;
    }
  }

  async claimUsername(username: string): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    try {
      const session = await this.currentSession(epoch);
      const methods = this.activeResult?.methods;
      if (!methods) {
        throw new Error("An authenticated OpenJob User is required.");
      }
      let user: OpenJobUser;
      try {
        user = await this.dependencies.claimUsername(
          session.idToken,
          username,
        );
      } catch (claimError) {
        if (
          !(
            claimError instanceof OpenJobApiError &&
            claimError.code === "username_immutable"
          )
        ) {
          throw claimError;
        }
        try {
          user = await this.dependencies.getMe(session.idToken);
        } catch (reconciliationError) {
          if (
            (reconciliationError instanceof ProviderSignInError &&
              reconciliationError.code === "revoked") ||
            (reconciliationError instanceof OpenJobApiError &&
              reconciliationError.status === 401)
          ) {
            throw reconciliationError;
          }
          throw claimError;
        }
        this.assertCurrentOperation(epoch);
        if (user.usernameRequired) throw claimError;
      }
      this.assertCurrentOperation(epoch);
      return this.setSignedIn(session, user, methods, epoch);
    } catch (error) {
      this.assertCurrentOperation(epoch);
      if (
        (error instanceof ProviderSignInError &&
          error.code === "revoked") ||
        (error instanceof OpenJobApiError && error.status === 401)
      ) {
        return (await this.removePrivateData())
          ? { kind: "signed-out", reason: "revoked" }
          : { kind: "cleanup-retry" };
      }
      throw error;
    }
  }

  async authenticateExistingUser(): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    const candidate = this.requireCandidate();
    if (candidate.provider === "qa-password") {
      throw new Error("Preview QA password sign-in cannot be linked.");
    }
    const existingProvider = otherProvider(candidate.provider);
    const credential =
      await this.withOperationLock("provider", () =>
        this.dependencies.signInWithProvider(existingProvider),
      );
    this.assertCurrentOperation(epoch);
    let existing: FirebaseAccessSession;
    let user: OpenJobUser;
    try {
      existing = this.accessSession(
        await this.dependencies.exchangeProviderCredential(credential),
      );
      this.assertCurrentOperation(epoch);
      user = await this.dependencies.getMe(existing.idToken);
    } catch (error) {
      await this.withOperationLock("provider", () =>
        this.dependencies.clearProviderSession(),
      );
      throw error;
    }
    this.assertCurrentOperation(epoch);
    this.existingSession = existing;
    this.linkMode = "unknown-current";
    this.expectedTargetUserId = user.userId;
    return {
      existingProvider,
      kind: "confirm-link",
      newProvider: candidate.provider,
      user,
    };
  }

  async authenticateNewMethod(
    provider: SignInMethod,
  ): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    let existing: FirebaseAccessSession;
    try {
      existing = await this.currentSession(
        epoch,
        LINK_CONFIRMATION_VALIDITY_MS,
      );
    } catch (error) {
      if (
        error instanceof ProviderSignInError &&
        error.code === "revoked"
      ) {
        return (await this.removePrivateData())
          ? { kind: "signed-out", reason: "revoked" }
          : { kind: "cleanup-retry" };
      }
      throw error;
    }
    if (existing.provider === "qa-password") {
      throw new Error("Preview QA password sign-in cannot link providers.");
    }
    const credential = await this.withOperationLock("provider", () =>
      this.dependencies.signInWithProvider(provider),
    );
    this.assertCurrentOperation(epoch);
    let candidate: FirebaseAccessSession | null = null;
    let user = this.activeResult?.user;
    if (!user) throw new Error("An authenticated OpenJob User is required.");
    try {
      candidate = this.accessSession(
        await this.dependencies.exchangeProviderCredential(credential),
      );
      this.assertCurrentOperation(epoch);
      if (user.usernameRequired) {
        user = await this.dependencies.getMe(candidate.idToken);
      }
    } catch (error) {
      if (!isUnrecognized(error)) {
        await this.withOperationLock("provider", () =>
          this.dependencies.clearProviderSession(),
        );
        throw error;
      }
    }
    if (!candidate) throw new Error("A new Sign-in Method is required.");
    this.assertCurrentOperation(epoch);
    this.existingSession = existing;
    this.candidateSession = candidate;
    this.linkMode = "existing-current";
    this.expectedTargetUserId = user.userId;
    return {
      existingProvider: existing.provider,
      kind: "confirm-link",
      newProvider: provider,
      user,
    };
  }

  async confirmLink(): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    const candidate = this.requireCandidate();
    const expectedTargetUserId = this.expectedTargetUserId;
    if (!expectedTargetUserId) {
      throw new Error("The confirmed OpenJob User is required.");
    }
    const existingCurrent = this.linkMode === "existing-current";
    try {
      const existing = existingCurrent
        ? await this.currentSession(
            epoch,
            LINK_CONFIRMATION_VALIDITY_MS,
          )
        : this.existingSession ?? (await this.currentSession(epoch));
      const authorizationSession = existingCurrent ? existing : candidate;
      const additionalProof = existingCurrent ? candidate : existing;
      const user = await this.dependencies.linkSignInMethod(
        authorizationSession.idToken,
        additionalProof.idToken,
        expectedTargetUserId,
      );
      this.assertCurrentOperation(epoch);
      return this.finishSignedIn(
        authorizationSession,
        user,
        epoch,
      );
    } catch (error) {
      this.assertCurrentOperation(epoch);
      if (
        error instanceof OpenJobApiError &&
        error.code === "fresh_authentication_required"
      ) {
        await this.discardAdditionalLinkProof(epoch, existingCurrent);
        if (existingCurrent && this.activeResult) {
          return {
            ...this.activeResult,
            notice: "fresh_authentication_required",
          };
        }
        return {
          kind: "unrecognized",
          notice: "fresh_authentication_required",
          provider: candidate.provider,
        };
      }
      if (
        error instanceof OpenJobApiError &&
        error.code === "link_target_changed"
      ) {
        await this.discardAdditionalLinkProof(epoch, existingCurrent);
        if (existingCurrent && this.activeResult) {
          return {
            ...this.activeResult,
            notice: "link_target_changed",
          };
        }
        return {
          kind: "unrecognized",
          notice: "link_target_changed",
          provider: candidate.provider,
        };
      }
      if (
        (error instanceof ProviderSignInError &&
          error.code === "revoked") ||
        (error instanceof OpenJobApiError &&
          error.status === 401 &&
          error.code === "authentication_required")
      ) {
        return (await this.removePrivateData())
          ? { kind: "signed-out", reason: "revoked" }
          : { kind: "cleanup-retry" };
      }
      throw error;
    }
  }

  async cancelPending(): Promise<AuthFlowResult> {
    if (!this.activeResult) {
      return (await this.removePrivateData())
        ? { kind: "signed-out" }
        : { kind: "cleanup-retry" };
    }
    const epoch = this.operationEpoch;
    await this.withOperationLock("provider", () =>
      this.dependencies.clearProviderSession(),
    );
    this.assertCurrentOperation(epoch);
    this.candidateSession = null;
    this.existingSession = null;
    this.linkMode = null;
    this.expectedTargetUserId = null;
    return this.activeResult;
  }

  async signOut(): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    try {
      const deletion = await this.resolveStoredDeletionReceipt(epoch);
      if (deletion) return deletion;
    } catch {
      await this.removePrivateData();
      return { kind: "cleanup-retry" };
    }
    return (await this.removePrivateData())
      ? { kind: "signed-out" }
      : { kind: "cleanup-retry" };
  }

  async deleteUser(): Promise<AuthFlowResult> {
    return await this.withOperationLock("deletion", () =>
      this.deleteUserOnce(),
    );
  }

  private async deleteUserOnce(): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    const active = await this.currentSession(epoch);
    const methods = this.activeResult?.methods;
    if (!methods || methods.length === 0) {
      throw new Error("Linked Sign-in Methods are required for deletion.");
    }
    const prepared = await this.dependencies.prepareDeletionStatus(
      active.idToken,
    );
    this.assertCurrentOperation(epoch);
    if (prepared.status === "completed") {
      return (await this.removePrivateData())
        ? { kind: "deletion-completed" }
        : { kind: "cleanup-retry" };
    }
    const preparedReceipt: DeletionReceipt = {
      phase: prepared.status === "pending" ? "submitting" : "prepared",
      statusToken: prepared.statusToken,
      version: 1,
    };
    try {
      await this.persistDeletionReceipt(preparedReceipt, epoch);
    } catch (error) {
      if (prepared.status !== "pending") throw error;
      return (await this.removePrivateData())
        ? {
            kind: "deletion-status-retry",
            reason: "storage-unavailable",
          }
        : { kind: "cleanup-retry" };
    }
    if (prepared.status === "pending") {
      if (!(await this.removePrivateData())) {
        return { kind: "cleanup-retry" };
      }
      return {
        deadline: prepared.deadline,
        kind: "deletion-pending",
        reauthenticationProviders: prepared.reauthenticationProviders,
        requestedAt: prepared.requestedAt,
      };
    }

    const credentials = [];
    for (const provider of methods) {
      const providerCredential = await this.withOperationLock("provider", () =>
        this.dependencies.signInWithProvider(provider),
      );
      this.assertCurrentOperation(epoch);
      const proof = await this.dependencies.exchangeProviderCredential(
        providerCredential,
      );
      this.assertCurrentOperation(epoch);
      if (!providerCredential.revocation) {
        throw new ProviderSignInError("unavailable");
      }
      credentials.push({
        credentialToken: proof.idToken,
        provider,
        revocation: providerCredential.revocation,
      });
    }
    const submittingReceipt: DeletionReceipt = {
      ...preparedReceipt,
      phase: "submitting",
    };
    await this.persistDeletionReceipt(submittingReceipt, epoch);

    let deletion: DeletionStartResult;
    try {
      deletion = await this.dependencies.deleteUser(
        active.idToken,
        credentials,
        submittingReceipt.statusToken,
      );
      this.assertCurrentOperation(epoch);
    } catch (error) {
      const resolution = await this.resolveDeletionReceipt(
        submittingReceipt,
        epoch,
      );
      if (resolution) return resolution;
      throw error;
    }
    return await this.finishDeletion(deletion, submittingReceipt);
  }

  async acknowledgeDeletionCompletion(): Promise<AuthFlowResult> {
    const epoch = this.operationEpoch;
    let receipt: DeletionReceipt | null;
    try {
      receipt = await this.loadDeletionReceipt(epoch);
    } catch {
      return { kind: "deletion-clear-retry", status: "completed" };
    }
    if (!receipt) return { kind: "signed-out", reason: "deleted" };
    if (receipt.phase !== "completed") {
      return { kind: "deletion-status-retry", reason: "unavailable" };
    }
    const clear = await this.clearDeletionReceipt(epoch, "completed");
    return clear ?? { kind: "signed-out", reason: "deleted" };
  }

  async refreshDeletionStatus(): Promise<AuthFlowResult> {
    return await this.withOperationLock("deletion", async () => {
      const epoch = this.operationEpoch;
      const recovery = this.pendingDeletionRecovery;
      if (recovery) {
        if (recovery.epoch !== epoch) {
          this.pendingDeletionRecovery = null;
          return await this.blockPendingDeletionWithoutFreshProof();
        }
        return await this.submitPendingDeletionRecovery(recovery, epoch);
      }
      const deletion = await this.resolveStoredDeletionReceipt(epoch);
      return deletion ?? (await this.restore());
    });
  }

  async reauthenticateDeletionProvider(
    provider: SignInMethod,
  ): Promise<AuthFlowResult> {
    return await this.withOperationLock("deletion", async () => {
      const initialEpoch = this.operationEpoch;
      const receipt = await this.loadDeletionReceipt(initialEpoch);
      if (!receipt) {
        return { kind: "signed-out", reason: "deletion-pending" };
      }
      const status = await this.dependencies.getDeletionStatus(
        receipt.statusToken,
      );
      this.assertCurrentOperation(initialEpoch);
      if (status.status !== "pending") {
        return (await this.resolveDeletionReceipt(receipt, initialEpoch)) ??
          (await this.restore());
      }
      if (!(await this.removePrivateData())) {
        return { kind: "cleanup-retry" };
      }
      if (!status.reauthenticationProviders.includes(provider)) {
        return {
          deadline: status.deadline,
          kind: "deletion-pending",
          reauthenticationProviders: status.reauthenticationProviders,
          requestedAt: status.requestedAt,
        };
      }

      const epoch = this.operationEpoch;
      try {
        const providerCredential = await this.withOperationLock(
          "provider",
          () => this.dependencies.signInWithProvider(provider),
        );
        this.assertCurrentOperation(epoch);
        if (
          providerCredential.provider !== provider ||
          !providerCredential.revocation
        ) {
          throw new ProviderSignInError("unavailable");
        }
        const firebase = await this.dependencies.exchangeProviderCredential(
          providerCredential,
        );
        this.assertCurrentOperation(epoch);
        const deletion = await this.dependencies.refreshDeletionProvider(
          receipt.statusToken,
          {
            credentialToken: firebase.idToken,
            provider,
            revocation: providerCredential.revocation,
          },
        );
        this.assertCurrentOperation(epoch);
        return await this.finishDeletion(deletion, receipt);
      } catch (error) {
        await this.removePrivateData();
        throw error;
      }
    });
  }

  async revokeSession(): Promise<AuthFlowResult> {
    return (await this.removePrivateData())
      ? { kind: "signed-out", reason: "revoked" }
      : { kind: "cleanup-retry" };
  }

  async switchUser(): Promise<AuthFlowResult> {
    return (await this.removePrivateData())
      ? { kind: "signed-out" }
      : { kind: "cleanup-retry" };
  }

  subscribeToCredentialRevocation(
    listener: (result: AuthFlowResult) => void,
  ) {
    return (
      this.dependencies.subscribeToCredentialRevocation?.(() => {
        void this.removePrivateData().then((removed) => {
          listener(
            removed
              ? { kind: "signed-out", reason: "revoked" }
              : { kind: "cleanup-retry" },
          );
        });
      }) ?? (() => undefined)
    );
  }

  async listGroups() {
    const epoch = this.operationEpoch;
    const session = await this.currentSession(epoch);
    const groups = await this.dependencies.listGroups(session.idToken);
    this.assertCurrentOperation(epoch);
    return groups;
  }

  async loadCachedTaskList(): Promise<NativeCachedTaskList | null> {
    const ownerUserId = this.activeResult?.user.userId;
    if (!ownerUserId) {
      throw new Error("An authenticated OpenJob User is required.");
    }
    const cached = await this.dependencies.loadLocalTaskListCache(ownerUserId);
    if (!cached) return null;
    return {
      freshAt: cached.freshAt,
      group: cached.group,
      snapshot: cached.snapshot,
      status: cached.status,
      validator: cached.validator,
    };
  }

  async saveCachedTaskList(entry: NativeCachedTaskList) {
    const ownerUserId = this.activeResult?.user.userId;
    if (!ownerUserId) {
      throw new Error("An authenticated OpenJob User is required.");
    }
    await this.dependencies.saveLocalTaskListCache({
      ...entry,
      ownerUserId,
    });
  }

  async purgeCachedTaskList() {
    await this.dependencies.purgeLocalDomainCache();
  }

  async readTaskList(groupId: string) {
    const result = await this.syncTaskList(groupId);
    if (result.kind !== "changed") {
      throw new OpenJobApiError(
        502,
        "invalid_response",
        "OpenJob returned an unexpected Task List validator.",
      );
    }
    return result.snapshot;
  }

  async syncTaskList(
    groupId: string,
    validator?: string | null,
  ): Promise<NativeTaskListSyncResult> {
    const epoch = this.operationEpoch;
    const session = await this.currentSession(epoch);
    const tasks = await this.dependencies.listTasks(
      session.idToken,
      groupId,
      validator,
    );
    this.assertCurrentOperation(epoch);
    const freshAt = new Date(this.dependencies.now()).toISOString();
    if (tasks.kind === "not-modified") {
      return {
        freshAt,
        kind: "not-modified",
        validator: tasks.validator,
      };
    }
    const members = await this.dependencies.listMembers(
      session.idToken,
      groupId,
    );
    this.assertCurrentOperation(epoch);
    return {
      freshAt,
      kind: "changed",
      snapshot: { members, tasks: tasks.tasks },
      validator: tasks.validator,
    };
  }

  private async finishSignedIn(
    session: FirebaseAccessSession,
    user: OpenJobUser,
    epoch: number,
  ): Promise<SignedInResult> {
    const methods = sortedMethods(
      await this.dependencies.listSignInMethods(session.idToken),
    );
    return this.setSignedIn(session, user, methods, epoch);
  }

  private async setSignedIn(
    session: FirebaseAccessSession,
    user: OpenJobUser,
    methods: SignInMethod[],
    epoch: number,
  ): Promise<SignedInResult> {
    this.assertCurrentOperation(epoch);
    await this.bindStoredOwner(user.userId, epoch);
    this.activeSession = session;
    this.activeResult = { kind: "signed-in", methods, user };
    this.candidateSession = null;
    this.existingSession = null;
    this.linkMode = null;
    this.expectedTargetUserId = null;
    return this.activeResult;
  }

  private async currentSession(
    epoch: number,
    minimumValidityMs = 60_000,
  ): Promise<FirebaseAccessSession> {
    this.assertCurrentOperation(epoch);
    const current = this.activeSession ?? this.existingSession;
    if (!current) throw new Error("An authenticated OpenJob User is required.");
    if (current.expiresAt > this.dependencies.now() + minimumValidityMs) {
      return current;
    }
    const stored = await this.dependencies.loadStoredSession();
    this.assertCurrentOperation(epoch);
    this.storedSession = stored;
    if (!stored) throw new ProviderSignInError("revoked");
    const refreshed = await this.persistSession(
      await this.dependencies.refreshSession(stored),
      epoch,
      stored.version === 2
        ? stored.ownerUserId
        : this.activeResult?.user.userId,
    );
    this.assertCurrentOperation(epoch);
    this.activeSession = refreshed;
    return refreshed;
  }

  private async currentCandidateSession(
    epoch: number,
    minimumValidityMs = 60_000,
  ) {
    const candidate = this.requireCandidate();
    this.assertCurrentOperation(epoch);
    if (
      candidate.expiresAt >
      this.dependencies.now() + minimumValidityMs
    ) {
      return candidate;
    }
    const stored = await this.dependencies.loadStoredSession();
    this.assertCurrentOperation(epoch);
    this.storedSession = stored;
    if (!stored || stored.provider !== candidate.provider) {
      throw new ProviderSignInError("revoked");
    }
    const refreshed = await this.persistSession(
      await this.dependencies.refreshSession(stored),
      epoch,
      stored.version === 2 ? stored.ownerUserId : undefined,
    );
    this.assertCurrentOperation(epoch);
    this.candidateSession = refreshed;
    return refreshed;
  }

  private accessSession(session: FirebaseSession): FirebaseAccessSession {
    return {
      expiresAt: session.expiresAt,
      idToken: session.idToken,
      provider: session.provider,
    };
  }

  private async persistSession(
    session: FirebaseSession,
    epoch: number,
    ownerUserId?: string,
  ) {
    const stored: StoredSession = ownerUserId
      ? {
          ownerUserId,
          provider: session.provider,
          refreshToken: session.refreshToken,
          version: 2,
        }
      : {
          provider: session.provider,
          refreshToken: session.refreshToken,
          version: 1,
        };
    await this.withOperationLock("stored", async () => {
      this.assertCurrentOperation(epoch);
      await this.dependencies.saveStoredSession(stored);
      this.assertCurrentOperation(epoch);
      this.storedSession = stored;
    });
    return this.accessSession(session);
  }

  private async bindStoredOwner(ownerUserId: string, epoch: number) {
    let stored = this.storedSession;
    if (!stored) {
      stored = await this.dependencies.loadStoredSession();
      this.assertCurrentOperation(epoch);
      this.storedSession = stored;
    }
    if (!stored) throw new ProviderSignInError("revoked");
    if (stored.version === 2 && stored.ownerUserId === ownerUserId) return;
    const bound: StoredSession = {
      ownerUserId,
      provider: stored.provider,
      refreshToken: stored.refreshToken,
      version: 2,
    };
    await this.withOperationLock("stored", async () => {
      this.assertCurrentOperation(epoch);
      await this.dependencies.saveStoredSession(bound);
      this.assertCurrentOperation(epoch);
      this.storedSession = bound;
    });
  }

  private async withOperationLock<T>(
    queue: keyof typeof this.operationTails,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.operationTails[queue];
    let release: () => void = () => undefined;
    this.operationTails[queue] = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private assertCurrentOperation(epoch: number) {
    if (epoch !== this.operationEpoch) {
      throw new ProviderSignInError("revoked");
    }
  }

  private requireCandidate() {
    if (!this.candidateSession) {
      throw new Error("A new Sign-in Method is required.");
    }
    return this.candidateSession;
  }

  private async discardAdditionalLinkProof(
    epoch: number,
    existingCurrent: boolean,
  ) {
    await this.withOperationLock("provider", () =>
      this.dependencies.clearProviderSession(),
    );
    this.assertCurrentOperation(epoch);
    if (existingCurrent) this.candidateSession = null;
    this.existingSession = null;
    this.linkMode = null;
    this.expectedTargetUserId = null;
  }

  private async resolveStoredDeletionReceipt(epoch: number) {
    let receipt: DeletionReceipt | null;
    try {
      receipt = await this.loadDeletionReceipt(epoch);
    } catch (error) {
      if (!(await this.removePrivateData())) {
        return { kind: "cleanup-retry" } as const;
      }
      return {
        kind: "deletion-status-retry",
        reason:
          error instanceof ProviderSignInError && error.code === "offline"
            ? "offline"
            : "unavailable",
      } as const;
    }
    return receipt
      ? this.resolveDeletionReceipt(receipt, epoch)
      : null;
  }

  private async recoverPendingDeletion(
    idToken: string,
    credential: ProviderCredential,
    expectedProvider: SignInMethod,
    epoch: number,
  ): Promise<AuthFlowResult> {
    if (
      credential.provider !== expectedProvider ||
      !credential.revocation
    ) {
      return await this.blockPendingDeletionWithoutFreshProof();
    }
    const recovery: PendingDeletionRecovery = {
      attempts: 0,
      credential: {
        credentialToken: idToken,
        provider: credential.provider,
        revocation: credential.revocation,
      },
      epoch,
      expiresAt:
        this.dependencies.now() + DELETION_RECOVERY_PROOF_VALIDITY_MS,
    };
    this.pendingDeletionRecovery = recovery;
    return await this.submitPendingDeletionRecovery(recovery, epoch);
  }

  private async submitPendingDeletionRecovery(
    recovery: PendingDeletionRecovery,
    epoch: number,
  ): Promise<AuthFlowResult> {
    if (
      this.pendingDeletionRecovery !== recovery ||
      recovery.epoch !== epoch ||
      recovery.attempts >= MAX_DELETION_RECOVERY_ATTEMPTS ||
      this.dependencies.now() >= recovery.expiresAt
    ) {
      this.pendingDeletionRecovery = null;
      return await this.blockPendingDeletionWithoutFreshProof();
    }
    recovery.attempts += 1;
    let prepared: DeletionPrepareResult;
    try {
      prepared = await this.dependencies.prepareDeletionStatus(
        recovery.credential.credentialToken,
        recovery.credential,
      );
      this.assertCurrentOperation(epoch);
    } catch (error) {
      const retryable =
        isTransientDeletionRecoveryError(error) &&
        recovery.attempts < MAX_DELETION_RECOVERY_ATTEMPTS &&
        this.dependencies.now() < recovery.expiresAt;
      if (!retryable) this.pendingDeletionRecovery = null;
      const removed = await this.removePrivateData(
        retryable ? recovery : undefined,
      );
      if (!removed) return { kind: "cleanup-retry" };
      if (retryable) {
        return { kind: "deletion-status-retry", reason: "proof-retry" };
      }
      return { kind: "signed-out", reason: "deletion-pending" };
    }
    if (prepared.status === "completed") {
      this.pendingDeletionRecovery = null;
      return (await this.removePrivateData())
        ? { kind: "deletion-completed" }
        : { kind: "cleanup-retry" };
    }
    if (prepared.status !== "pending") {
      this.pendingDeletionRecovery = null;
      if (!(await this.removePrivateData())) {
        return { kind: "cleanup-retry" };
      }
      return {
        kind: "deletion-status-retry",
        reason: "invalid-response",
      };
    }
    const receipt: DeletionReceipt = {
      phase: "submitting",
      statusToken: prepared.statusToken,
      version: 1,
    };
    try {
      await this.persistDeletionReceipt(receipt, epoch);
    } catch {
      this.pendingDeletionRecovery = null;
      return (await this.removePrivateData())
        ? {
            kind: "deletion-status-retry",
            reason: "storage-unavailable",
          }
        : { kind: "cleanup-retry" };
    }
    this.pendingDeletionRecovery = null;
    return await this.finishDeletion(prepared, receipt);
  }

  private async blockPendingDeletionWithoutFreshProof(): Promise<AuthFlowResult> {
    return (await this.removePrivateData())
      ? { kind: "signed-out", reason: "deletion-pending" }
      : { kind: "cleanup-retry" };
  }

  private async loadDeletionReceipt(epoch: number) {
    if (this.deletionReceipt) return this.deletionReceipt;
    const receipt = await this.withOperationLock("receipt", () =>
      this.dependencies.loadDeletionReceipt(),
    );
    this.assertCurrentOperation(epoch);
    if (receipt) {
      this.deletionReceipt = receipt;
      this.deletionReceiptNeedsSave = false;
    }
    return receipt;
  }

  private async persistDeletionReceipt(
    receipt: DeletionReceipt,
    epoch: number,
  ) {
    this.deletionReceipt = receipt;
    this.deletionReceiptNeedsSave = true;
    await this.withOperationLock("receipt", () =>
      this.dependencies.saveDeletionReceipt(receipt),
    );
    this.assertCurrentOperation(epoch);
    this.deletionReceiptNeedsSave = false;
  }

  private async clearDeletionReceipt(
    epoch: number,
    status: "completed" | "not_started",
    expectedStatusToken?: string,
  ): Promise<AuthFlowResult | null> {
    if (
      expectedStatusToken !== undefined &&
      this.deletionReceipt?.statusToken !== expectedStatusToken
    ) {
      return { kind: "deletion-status-retry", reason: "unavailable" };
    }
    try {
      await this.withOperationLock("receipt", () =>
        this.dependencies.clearDeletionReceipt(),
      );
      this.assertCurrentOperation(epoch);
    } catch {
      return { kind: "deletion-clear-retry", status };
    }
    this.deletionReceipt = null;
    this.deletionReceiptNeedsSave = false;
    return null;
  }

  private async finishDeletion(
    deletion: DeletionStartResult,
    receipt: DeletionReceipt,
  ): Promise<AuthFlowResult> {
    if (!(await this.removePrivateData())) {
      return { kind: "cleanup-retry" };
    }
    if (deletion.status === "pending") {
      return {
        deadline: deletion.deadline,
        kind: "deletion-pending",
        reauthenticationProviders: deletion.reauthenticationProviders,
        requestedAt: deletion.requestedAt,
      };
    }
    return await this.persistCompletedDeletion(receipt);
  }

  private async resolveDeletionReceipt(
    receipt: DeletionReceipt,
    epoch: number,
  ): Promise<AuthFlowResult | null> {
    if (receipt.phase === "completed") {
      if (this.deletionReceiptNeedsSave) {
        try {
          await this.persistDeletionReceipt(receipt, epoch);
        } catch {
          return {
            kind: "deletion-status-retry",
            reason: "storage-unavailable",
          };
        }
      }
      return { kind: "deletion-completed" };
    }
    let status: DeletionStatus;
    try {
      status = await this.dependencies.getDeletionStatus(
        receipt.statusToken,
      );
      this.assertCurrentOperation(epoch);
    } catch (error) {
      if (!(await this.removePrivateData())) {
        return { kind: "cleanup-retry" };
      }
      return {
        kind: "deletion-status-retry",
        reason:
          error instanceof ProviderSignInError && error.code === "offline"
            ? "offline"
            : error instanceof OpenJobApiError &&
                error.code === "invalid_response"
              ? "invalid-response"
              : "unavailable",
      };
    }
    if (status.status === "not_started") {
      if (!status.submissionExpired) {
        if (!(await this.removePrivateData())) {
          return { kind: "cleanup-retry" };
        }
        return { kind: "deletion-status-retry", reason: "unavailable" };
      }
      return await this.clearDeletionReceipt(
        epoch,
        "not_started",
        receipt.statusToken,
      );
    }
    if (!(await this.removePrivateData())) {
      return { kind: "cleanup-retry" };
    }
    if (status.status === "pending") {
      if (this.deletionReceiptNeedsSave) {
        try {
          await this.persistDeletionReceipt(
            receipt,
            this.operationEpoch,
          );
        } catch {
          return {
            kind: "deletion-status-retry",
            reason: "storage-unavailable",
          };
        }
      }
      return {
        deadline: status.deadline,
        kind: "deletion-pending",
        reauthenticationProviders: status.reauthenticationProviders,
        requestedAt: status.requestedAt,
      };
    }
    return await this.persistCompletedDeletion(receipt);
  }

  private async persistCompletedDeletion(
    receipt: DeletionReceipt,
  ): Promise<AuthFlowResult> {
    try {
      await this.persistDeletionReceipt(
        { ...receipt, phase: "completed" },
        this.operationEpoch,
      );
    } catch {
      return { kind: "deletion-status-retry", reason: "unavailable" };
    }
    return { kind: "deletion-completed" };
  }

  private async removePrivateData(
    preservedRecovery?: PendingDeletionRecovery,
  ) {
    this.operationEpoch += 1;
    if (this.pendingDeletionRecovery !== preservedRecovery) {
      this.pendingDeletionRecovery = null;
    } else {
      preservedRecovery.epoch = this.operationEpoch;
    }
    let marked = false;
    try {
      await this.dependencies.markCleanupPending();
      marked = true;
    } catch {
      // The actual cleanup still runs even if neither marker store is writable.
    }
    const results = await Promise.allSettled([
      this.withOperationLock("provider", () =>
        this.dependencies.clearProviderSession(),
      ),
      this.dependencies.purgeLocalDomainCache(),
      this.withOperationLock("stored", () =>
        this.dependencies.clearStoredSession(),
      ),
    ]);
    let removed = results.every(
      (result) => result.status === "fulfilled",
    );
    if (removed && marked) {
      try {
        await this.dependencies.clearCleanupPending();
      } catch {
        // The retained marker forces cleanup to run again after relaunch.
        removed = false;
      }
    }
    this.activeSession = null;
    this.activeResult = null;
    this.candidateSession = null;
    this.existingSession = null;
    this.linkMode = null;
    this.expectedTargetUserId = null;
    this.storedSession = null;
    return removed;
  }
}
