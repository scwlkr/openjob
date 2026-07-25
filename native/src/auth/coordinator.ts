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
  clearProviderSession(): Promise<void>;
  clearStoredSession(): Promise<void>;
  createUser(idToken: string): Promise<OpenJobUser>;
  exchangeProviderCredential(
    credential: ProviderCredential,
  ): Promise<FirebaseSession>;
  getMe(idToken: string): Promise<OpenJobUser>;
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
  loadStoredSession(): Promise<StoredSession | null>;
  markCleanupPending(): Promise<void>;
  now(): number;
  purgeLocalDomainCache(): Promise<void>;
  refreshSession(stored: StoredSession): Promise<FirebaseSession>;
  saveStoredSession(stored: StoredSession): Promise<void>;
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

function sortedMethods(methods: SignInMethod[]) {
  return [...new Set(methods)].sort();
}

const LINK_CONFIRMATION_VALIDITY_MS = 5 * 60_000;

export class NativeAuthCoordinator implements NativeTaskListController {
  private activeResult: SignedInResult | null = null;
  private activeSession: FirebaseAccessSession | null = null;
  private candidateSession: FirebaseAccessSession | null = null;
  private existingSession: FirebaseAccessSession | null = null;
  private linkMode: "existing-current" | "unknown-current" | null = null;
  private expectedTargetUserId: string | null = null;
  private operationEpoch = 0;
  private storedSession: StoredSession | null = null;
  private operationTails = {
    provider: Promise.resolve(),
    stored: Promise.resolve(),
  };

  constructor(private readonly dependencies: NativeAuthDependencies) {}

  async restoreCachedSession(): Promise<SignedInResult | null> {
    const epoch = this.operationEpoch;
    const cleanupPending = await this.dependencies.loadCleanupPending();
    this.assertCurrentOperation(epoch);
    if (cleanupPending) return null;
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
      const firebaseSession =
        await this.dependencies.signInWithQaPassword(email, password);
      this.assertCurrentOperation(epoch);
      const accessSession = this.accessSession(firebaseSession);
      let user: OpenJobUser;
      try {
        user = await this.dependencies.getMe(accessSession.idToken);
      } catch (error) {
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
    return (await this.removePrivateData())
      ? { kind: "signed-out" }
      : { kind: "cleanup-retry" };
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

  private async removePrivateData() {
    this.operationEpoch += 1;
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
