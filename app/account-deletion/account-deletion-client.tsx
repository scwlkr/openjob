"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFirebaseAuth } from "../firebase-auth";
import { createOpenJobApi } from "../openjob-api";
import type {
  AccountDeletionCredentialInput,
  AccountDeletionPending,
  AccountDeletionRequestResult,
  AccountDeletionStatusReceipt,
  AuthCredentialProof,
  AuthSession,
  SignInMethod,
  User,
} from "../openjob-contracts";
import { ApiError } from "../openjob-contracts";
import {
  ACCOUNT_DELETION_RECEIPT_OWNER_KEY,
  ACCOUNT_DELETION_STATUS_RECEIPT_KEY,
  accountDeletionReceiptOwnedByAnotherTab,
  clearAccountDeletionStatusReceipt,
  clearBrowserPrivateState,
  loadAccountDeletionStatusReceipt,
  releaseAccountDeletionReceiptOwnership,
  saveAccountDeletionStatusReceipt,
} from "../openjob-private-state";
import { clearDeletionNotificationState } from "../openjob-notification-browser";
import styles from "./account-deletion.module.css";

const RECOVERY_PROOF_RETRY_WINDOW_MS = 4 * 60 * 1_000;
const RECOVERY_RETRY_DELAYS_MS = [500, 1_000, 2_000] as const;

function methodName(method: SignInMethod) {
  return method === "apple" ? "Apple" : "Google";
}

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : "OpenJob could not continue account deletion.";
}

function transientRecoveryFailure(error: unknown) {
  return error instanceof TypeError ||
    (error instanceof ApiError &&
      (error.status === 429 || error.status >= 500));
}

function waitForRecoveryRetry(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function pendingStatusMessage(pending: AccountDeletionPending) {
  if (Date.parse(pending.deadline) > Date.now()) {
    return `Deletion is in progress and will finish by ${new Date(pending.deadline).toLocaleDateString()}. Access has ended.`;
  }
  return pending.reauthenticationProviders.length > 0
    ? "Deletion passed its automated deadline. Operator completion is required. Complete the fresh provider prompt, then check again. Access has ended."
    : "Deletion passed its automated deadline. Operator completion is required; check again later. Access has ended.";
}

async function deletionCredentialFor(
  proof: AuthCredentialProof,
): Promise<AccountDeletionCredentialInput> {
  const credentialToken = await proof.getIdToken();
  if (proof.signInMethod === "google") {
    return {
      credentialToken,
      provider: "google",
      revocation: await proof.getRevocationProof(),
    };
  }
  return {
    credentialToken,
    provider: "apple",
    revocation: await proof.getRevocationProof(),
  };
}

export function AccountDeletionClient() {
  const auth = useMemo(() => createFirebaseAuth(), []);
  const api = useMemo(() => createOpenJobApi(), []);
  const proofs = useRef(new Map<SignInMethod, AuthCredentialProof>());
  const primarySignInProof = useRef<AuthCredentialProof | null>(null);
  const primarySignInProofExpiresAt = useRef<number | null>(null);
  const componentMounted = useRef(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [methods, setMethods] = useState<SignInMethod[]>([]);
  const [authenticated, setAuthenticated] = useState<SignInMethod[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [primarySignInPending, setPrimarySignInPending] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [completionCleanupPending, setCompletionCleanupPending] =
    useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);
  const [pending, setPending] = useState<AccountDeletionPending | null>(null);
  const [statusUncertain, setStatusUncertain] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [statusReceipt, setStatusReceipt] =
    useState<AccountDeletionStatusReceipt | null>(null);
  const [interactivePrepared, setInteractivePrepared] = useState(false);
  const [pendingRecoveryRequired, setPendingRecoveryRequired] = useState(false);
  const [recoveryRetrying, setRecoveryRetrying] = useState(false);
  const [waitingForOwningTab, setWaitingForOwningTab] = useState(false);
  const [statusReceiptReadFailed, setStatusReceiptReadFailed] = useState(false);
  const [statusReceiptReady, setStatusReceiptReady] = useState(false);

  const disposePrimarySignInProof = useCallback(async () => {
    const proof = primarySignInProof.current;
    primarySignInProof.current = null;
    primarySignInProofExpiresAt.current = null;
    if (!proof) return undefined;
    try {
      await proof.dispose();
      return undefined;
    } catch (error) {
      return error;
    }
  }, []);

  const disposeProofs = useCallback(async (
    preservedPrimaryProof?: AuthCredentialProof,
  ) => {
    let failure: unknown;
    if (primarySignInProof.current !== preservedPrimaryProof) {
      failure = await disposePrimarySignInProof();
    }
    for (const proof of proofs.current.values()) {
      try {
        await proof.dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    proofs.current.clear();
    return failure;
  }, [disposePrimarySignInProof]);

  const purgeClientAccess = useCallback(async (
    preservedPrimaryProof?: AuthCredentialProof,
  ) => {
    let failure = await disposeProofs(preservedPrimaryProof);
    try {
      clearBrowserPrivateState();
    } catch (error) {
      failure ??= error;
    }
    try {
      await clearDeletionNotificationState();
    } catch (error) {
      failure ??= error;
    }
    try {
      await auth.signOut();
    } catch (error) {
      failure ??= error;
    }
    return failure;
  }, [auth, disposeProofs]);

  useEffect(() => {
    componentMounted.current = true;
    return () => {
      componentMounted.current = false;
    };
  }, []);

  const finishCompletedDeletion = useCallback((
    receipt: AccountDeletionStatusReceipt,
    cleanupFailure?: unknown,
  ) => {
    setPending(null);
    setStatusUncertain(false);
    setCompleted(false);
    setInteractivePrepared(false);
    setMessage("");
    if (cleanupFailure) {
      setCompletionCleanupPending(true);
      setStatusError(
        `OpenJob confirmed the server deletion, but could not finish clearing this browser. ${messageFor(cleanupFailure)}`,
      );
      return;
    }
    const completedReceipt: AccountDeletionStatusReceipt = {
      ...receipt,
      phase: "completed",
    };
    try {
      saveAccountDeletionStatusReceipt(completedReceipt);
    } catch (error) {
      setCompletionCleanupPending(true);
      setStatusReceipt(receipt);
      setStatusError(
        `OpenJob confirmed the server deletion and cleared private data, but could not save final confirmation. ${messageFor(error)}`,
      );
      return;
    }
    setCompletionCleanupPending(false);
    setStatusReceipt(completedReceipt);
    setCompleted(true);
    setMessage("Your OpenJob User and associated data were deleted.");
    setStatusError("");
  }, []);

  const finishRecoveredCompletion = useCallback((cleanupFailure?: unknown) => {
    setPending(null);
    setStatusUncertain(false);
    setInteractivePrepared(false);
    setPendingRecoveryRequired(false);
    setMessage("");
    if (cleanupFailure) {
      setCompletionCleanupPending(true);
      setStatusError(
        `OpenJob confirmed the server deletion, but could not finish clearing this browser. ${messageFor(cleanupFailure)}`,
      );
      return;
    }
    setCompletionCleanupPending(false);
    setCompleted(true);
    setMessage("Your OpenJob User and associated data were deleted.");
    setStatusError("");
  }, []);

  const refreshDeletionStatus = useCallback(async (
    receipt: AccountDeletionStatusReceipt,
    isActive: () => boolean = () => true,
  ) => {
    if (receipt.phase === "completed") {
      setStatusReceipt(receipt);
      setCompleted(true);
      setMessage("Your OpenJob User and associated data were deleted.");
      setStatusError("");
      return;
    }
    setCheckingStatus(true);
    setStatusUncertain(true);
    setStatusError("");
    let cleanupAttempted = false;
    let cleanupFailure: unknown;
    const ensureCleanup = async () => {
      if (!cleanupAttempted) {
        cleanupAttempted = true;
        cleanupFailure = await purgeClientAccess();
      }
      return cleanupFailure;
    };
    if (receipt.phase === "submitting") await ensureCleanup();
    try {
      const result = await api.getAccountDeletionStatus(receipt.statusToken);
      if (!isActive()) return;
      if (result.status === "completed") {
        let activeReceipt = receipt;
        if (receipt.phase === "prepared") {
          activeReceipt = { ...receipt, phase: "submitting" };
          try {
            saveAccountDeletionStatusReceipt(activeReceipt);
          } catch {
            // The durable completed write below remains the final success gate.
          }
          setStatusReceipt(activeReceipt);
        }
        finishCompletedDeletion(activeReceipt, await ensureCleanup());
      } else if (result.status === "pending") {
        await ensureCleanup();
        let activeReceipt = receipt;
        let receiptStorageFailure: unknown;
        if (receipt.phase === "prepared") {
          activeReceipt = { ...receipt, phase: "submitting" };
          try {
            saveAccountDeletionStatusReceipt(activeReceipt);
          } catch (error) {
            receiptStorageFailure = error;
          }
          setStatusReceipt(activeReceipt);
        }
        setPending(result);
        setStatusUncertain(false);
        const localFailure = receiptStorageFailure ?? cleanupFailure;
        if (localFailure) {
          setStatusError(
            `OpenJob could not finish securing this browser. ${messageFor(localFailure)}`,
          );
        }
      } else {
        if (
          receipt.submissionExpiresAt === null ||
          result.submissionExpiresAt !== receipt.submissionExpiresAt
        ) {
          throw new Error("OpenJob returned mismatched deletion status.");
        }
        setPending(null);
        setStatusUncertain(false);
        if (!result.submissionExpired) {
          const activeReceipt = receipt.phase === "submitting"
            ? { ...receipt, phase: "prepared" as const }
            : receipt;
          setMessage("");
          if (activeReceipt !== receipt) {
            try {
              saveAccountDeletionStatusReceipt(activeReceipt);
            } catch (error) {
              setStatusReceipt(receipt);
              setStatusError(
                `OpenJob confirmed the prepared deletion, but could not save its local status. ${messageFor(error)}`,
              );
              return;
            }
          }
          setStatusReceipt(activeReceipt);
          try {
            releaseAccountDeletionReceiptOwnership(activeReceipt);
          } catch (error) {
            setStatusError(
              `OpenJob confirmed the prepared deletion, but could not release this tab's ownership. ${messageFor(error)}`,
            );
          }
          return;
        }
        try {
          if (!clearAccountDeletionStatusReceipt(receipt)) {
            const current = loadAccountDeletionStatusReceipt();
            setStatusReceipt(current);
            setStatusUncertain(true);
            if (current?.phase === "submitting") await ensureCleanup();
            setStatusError(
              "Deletion status changed in another tab. Refresh the current status before continuing.",
            );
            return;
          }
          setStatusReceipt(null);
          setMessage(
            receipt.phase === "prepared"
              ? "The prepared deletion was not submitted. You can try again."
              : "The unconfirmed deletion submission was canceled. Sign in to try again.",
          );
        } catch (error) {
          setStatusReceipt(receipt);
          setStatusError(
            `OpenJob could not clear the saved deletion status. ${messageFor(error)}`,
          );
        }
      }
    } catch (error) {
      await ensureCleanup();
      if (isActive()) {
        setStatusUncertain(true);
        setStatusError(
          `OpenJob could not refresh deletion status. ${messageFor(error)}`,
        );
      }
    } finally {
      if (isActive()) setCheckingStatus(false);
    }
  }, [api, finishCompletedDeletion, purgeClientAccess]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      try {
        const receipt = loadAccountDeletionStatusReceipt();
        setStatusReceipt(receipt);
        setStatusReceiptReady(true);
        if (receipt?.phase === "completed") {
          setCompleted(true);
          setMessage("Your OpenJob User and associated data were deleted.");
        } else if (receipt) {
          if (accountDeletionReceiptOwnedByAnotherTab(receipt)) {
            setWaitingForOwningTab(true);
            const cleanupFailure = await purgeClientAccess();
            if (active && cleanupFailure) {
              setStatusError(
                `Another tab is completing deletion, but OpenJob could not finish securing this browser. ${messageFor(cleanupFailure)}`,
              );
            }
          } else {
            void refreshDeletionStatus(receipt, () => active);
          }
        }
      } catch (error) {
        const cleanupFailure = await purgeClientAccess();
        if (!active) return;
        setStatusReceiptReadFailed(true);
        setStatusUncertain(true);
        setStatusError(
          `OpenJob could not read deletion status. ${messageFor(cleanupFailure ?? error)}`,
        );
        setStatusReceiptReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [purgeClientAccess, refreshDeletionStatus]);

  useEffect(() => {
    if (!waitingForOwningTab || !statusReceipt) return;
    let active = true;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const reconsiderOwnership = () => {
      if (!active) return;
      try {
        const current = loadAccountDeletionStatusReceipt();
        if (!current) {
          setWaitingForOwningTab(false);
          setStatusReceipt(null);
          setStatusUncertain(true);
          setStatusError(
            "Deletion status changed in another tab. Access remains blocked.",
          );
          return;
        }
        setStatusReceipt(current);
        if (accountDeletionReceiptOwnedByAnotherTab(current)) return;
        setWaitingForOwningTab(false);
        void refreshDeletionStatus(current, () => active);
      } catch (error) {
        setWaitingForOwningTab(false);
        setStatusUncertain(true);
        setStatusError(
          `OpenJob could not read deletion status. ${messageFor(error)}`,
        );
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (
        event.storageArea === window.localStorage &&
        (event.key === ACCOUNT_DELETION_STATUS_RECEIPT_KEY ||
          event.key === ACCOUNT_DELETION_RECEIPT_OWNER_KEY)
      ) reconsiderOwnership();
    };
    window.addEventListener("storage", handleStorage);
    if (statusReceipt.submissionExpiresAt !== null) {
      expiryTimer = setTimeout(
        reconsiderOwnership,
        Math.max(
          0,
          Date.parse(statusReceipt.submissionExpiresAt) - Date.now() + 50,
        ),
      );
    }
    return () => {
      active = false;
      if (expiryTimer) clearTimeout(expiryTimer);
      window.removeEventListener("storage", handleStorage);
    };
  }, [refreshDeletionStatus, statusReceipt, waitingForOwningTab]);

  useEffect(() => {
    const activeProofs = proofs.current;
    const dispose = auth.observe(
      (next) => {
        setSession(next);
        if (!next) {
          setUser(null);
          setMethods([]);
        }
      },
      (error) => setMessage(messageFor(error)),
    );
    return () => {
      dispose();
      const primaryProof = primarySignInProof.current;
      primarySignInProof.current = null;
      primarySignInProofExpiresAt.current = null;
      if (primaryProof) void primaryProof.dispose();
      for (const proof of activeProofs.values()) void proof.dispose();
      activeProofs.clear();
    };
  }, [auth]);

  useEffect(() => {
    if (
      !session ||
      primarySignInPending ||
      completed ||
      completionCleanupPending ||
      !statusReceiptReady ||
      statusReceipt ||
      statusReceiptReadFailed
    ) return;
    let active = true;
    void (async () => {
      let token: string | null = null;
      try {
        token = await session.getIdToken();
        const [nextUser, nextMethods] = await Promise.all([
          api.getMe(token),
          api.listSignInMethods(token),
        ]);
        const proofDisposalFailure = await disposePrimarySignInProof();
        if (!active) return;
        setUser(nextUser);
        setMethods(nextMethods);
        setPendingRecoveryRequired(false);
        setMessage(proofDisposalFailure
          ? `OpenJob could not clear the provider sign-in proof. ${messageFor(proofDisposalFailure)}`
          : "");
      } catch (error) {
        if (
          error instanceof ApiError &&
          ((error.status === 410 &&
            error.code === "account_deletion_pending") ||
            (error.status === 409 &&
              error.code === "sign_in_method_unrecognized")) &&
          token !== null
        ) {
          try {
            const proof = primarySignInProof.current;
            const proofExpiresAt = primarySignInProofExpiresAt.current;
            if (
              !proof ||
              proofExpiresAt === null ||
              (session.signInMethod !== "apple" &&
                session.signInMethod !== "google") ||
              proof.signInMethod !== session.signInMethod
            ) {
              throw new Error(
                "A fresh provider sign-in is required to recover deletion status.",
              );
            }
            const credential = await deletionCredentialFor(proof);
            setRecoveryRetrying(true);
            setPendingRecoveryRequired(false);
            setUser(null);
            setMethods([]);
            setAuthenticated([]);
            setMessage("");
            const initialCleanupFailure = await purgeClientAccess(proof);
            if (initialCleanupFailure && componentMounted.current) {
              setStatusError(
                `Access is blocked while OpenJob retries local cleanup and deletion recovery. ${messageFor(initialCleanupFailure)}`,
              );
            }

            let preflight: Awaited<ReturnType<
              typeof api.prepareAccountDeletion
            >> | null = null;
            let lastTransientFailure: unknown;
            let terminalReason: "expired" | "limit" | null = null;
            for (
              let attempt = 0;
              attempt <= RECOVERY_RETRY_DELAYS_MS.length;
              attempt += 1
            ) {
              if (
                !componentMounted.current ||
                primarySignInProof.current !== proof
              ) return;
              if (Date.now() >= proofExpiresAt) {
                terminalReason = "expired";
                break;
              }
              try {
                preflight = await api.prepareAccountDeletion(token, credential);
                break;
              } catch (retryError) {
                if (!transientRecoveryFailure(retryError)) throw retryError;
                lastTransientFailure = retryError;
                const retryDelay = RECOVERY_RETRY_DELAYS_MS[attempt];
                if (retryDelay === undefined) {
                  terminalReason = "limit";
                  break;
                }
                if (componentMounted.current) {
                  setStatusError(
                    `Account deletion recovery is temporarily unavailable. Access is blocked while OpenJob retries the same provider proof (${attempt + 2} of ${RECOVERY_RETRY_DELAYS_MS.length + 1}).`,
                  );
                }
                const remainingMs = proofExpiresAt - Date.now();
                if (remainingMs <= 0) {
                  terminalReason = "expired";
                  break;
                }
                await waitForRecoveryRetry(Math.min(retryDelay, remainingMs));
              }
            }

            if (!preflight) {
              if (
                !componentMounted.current ||
                primarySignInProof.current !== proof
              ) return;
              const proofDisposalFailure = await disposePrimarySignInProof();
              const cleanupFailure = await purgeClientAccess();
              if (!componentMounted.current) return;
              setRecoveryRetrying(false);
              setPendingRecoveryRequired(true);
              setStatusError(terminalReason === "expired"
                ? "OpenJob could not finish deletion recovery before the fresh provider proof expired. Sign in again with the same provider to retry."
                : `OpenJob could not finish deletion recovery because the transient retry limit was reached. Sign in again with the same provider to retry. ${messageFor(proofDisposalFailure ?? cleanupFailure ?? lastTransientFailure)}`);
              return;
            }
            if (preflight.status === "not_started") {
              throw new Error(
                "OpenJob returned inconsistent pending deletion status.",
              );
            }
            if (preflight.status === "completed") {
              const cleanupFailure = await purgeClientAccess();
              if (!componentMounted.current) return;
              setRecoveryRetrying(false);
              setUser(null);
              setMethods([]);
              setAuthenticated([]);
              finishRecoveredCompletion(cleanupFailure);
              return;
            }
            const recoveredReceipt: AccountDeletionStatusReceipt = {
              phase: "submitting",
              statusToken: preflight.statusToken,
              submissionExpiresAt: null,
              version: 1,
            };
            saveAccountDeletionStatusReceipt(recoveredReceipt);
            const cleanupFailure = await purgeClientAccess();
            if (!componentMounted.current) return;
            setRecoveryRetrying(false);
            setStatusReceipt(recoveredReceipt);
            setPending({
              deadline: preflight.deadline,
              reauthenticationProviders:
                preflight.reauthenticationProviders,
              requestedAt: preflight.requestedAt,
              status: "pending",
            });
            setPendingRecoveryRequired(false);
            setUser(null);
            setMethods([]);
            setAuthenticated([]);
            if (cleanupFailure) {
              setStatusError(
                `Deletion is already in progress, but OpenJob could not finish securing this browser. ${messageFor(cleanupFailure)}`,
              );
            } else {
              setStatusError("");
            }
          } catch (recoveryError) {
            const cleanupFailure = await purgeClientAccess();
            if (!componentMounted.current) return;
            setRecoveryRetrying(false);
            setUser(null);
            setMethods([]);
            setAuthenticated([]);
            setPendingRecoveryRequired(true);
            setMessage("");
            setStatusError(
              `OpenJob could not recover pending deletion status. ${messageFor(cleanupFailure ?? recoveryError)}`,
            );
          }
        } else {
          const proofDisposalFailure = await disposePrimarySignInProof();
          if (active) setMessage(messageFor(proofDisposalFailure ?? error));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [
    api,
    completed,
    completionCleanupPending,
    session,
    statusReceipt,
    statusReceiptReadFailed,
    statusReceiptReady,
    disposePrimarySignInProof,
    finishRecoveredCompletion,
    purgeClientAccess,
    primarySignInPending,
  ]);

  async function signInForDeletion(method: SignInMethod) {
    setBusy(true);
    setPrimarySignInPending(true);
    setMessage("");
    setStatusError("");
    try {
      await disposePrimarySignInProof();
      const proof = await auth.signIn(method);
      primarySignInProof.current = proof;
      primarySignInProofExpiresAt.current = proof
        ? Date.now() + RECOVERY_PROOF_RETRY_WINDOW_MS
        : null;
      setPendingRecoveryRequired(false);
    } catch (error) {
      const cleanupFailure = await purgeClientAccess();
      setMessage(messageFor(cleanupFailure ?? error));
    } finally {
      setPrimarySignInPending(false);
      setBusy(false);
    }
  }

  async function freshlyAuthenticate(method: SignInMethod) {
    setBusy(true);
    setMessage("");
    setStatusError("");
    try {
      if (!session) throw new Error("Sign in again to continue deletion.");
      if (!interactivePrepared || statusReceipt?.phase !== "prepared") {
        const preflight = await api.prepareAccountDeletion(
          await session.getIdToken(),
        );
        if (preflight.status === "pending") {
          const pendingReceipt: AccountDeletionStatusReceipt = {
            phase: "submitting",
            statusToken: preflight.statusToken,
            submissionExpiresAt: null,
            version: 1,
          };
          let receiptFailure: unknown;
          try {
            saveAccountDeletionStatusReceipt(pendingReceipt);
          } catch (error) {
            receiptFailure = error;
          }
          setStatusReceipt(pendingReceipt);
          setInteractivePrepared(false);
          setPending({
            deadline: preflight.deadline,
            reauthenticationProviders: preflight.reauthenticationProviders,
            requestedAt: preflight.requestedAt,
            status: "pending",
          });
          setStatusUncertain(false);
          setUser(null);
          setMethods([]);
          setAuthenticated([]);
          const cleanupFailure = await purgeClientAccess();
          const localFailure = receiptFailure ?? cleanupFailure;
          if (localFailure) {
            setStatusError(
              `Deletion is already in progress, but OpenJob could not finish securing this browser. ${messageFor(localFailure)}`,
            );
          }
          return;
        }
        if (preflight.status === "completed") {
          setUser(null);
          setMethods([]);
          setAuthenticated([]);
          finishRecoveredCompletion(await purgeClientAccess());
          return;
        }
        const preparedReceipt: AccountDeletionStatusReceipt = {
          phase: "prepared",
          statusToken: preflight.statusToken,
          submissionExpiresAt: preflight.submissionExpiresAt,
          version: 1,
        };
        try {
          saveAccountDeletionStatusReceipt(preparedReceipt);
        } catch (error) {
          setMessage(
            `Fresh authentication did not start because OpenJob could not first save deletion recovery. ${messageFor(error)}`,
          );
          return;
        }
        setStatusReceipt(preparedReceipt);
        setInteractivePrepared(true);
      }
      const previous = proofs.current.get(method);
      if (previous) await previous.dispose();
      const proof = await auth.authenticateForLink(method);
      proofs.current.set(method, proof);
      setAuthenticated((current) => [...new Set([...current, method])]);
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser() {
    if (
      !session ||
      !user ||
      confirmation !== "DELETE" ||
      !interactivePrepared ||
      statusReceipt?.phase !== "prepared"
    ) return;
    setBusy(true);
    setMessage("");
    setStatusError("");
    try {
      const credentials = await Promise.all(
        methods.map(async (provider) => {
          const proof = proofs.current.get(provider);
          if (!proof) throw new Error(`Authenticate ${methodName(provider)} again.`);
          const credential = await deletionCredentialFor(proof);
          if (credential.provider !== provider) {
            throw new Error("Firebase returned a different Sign-in Method.");
          }
          return credential;
        }),
      );
      const token = await session.getIdToken();
      const submittingReceipt: AccountDeletionStatusReceipt = {
        ...statusReceipt,
        phase: "submitting",
      };
      try {
        saveAccountDeletionStatusReceipt(submittingReceipt);
      } catch (error) {
        await disposeProofs();
        setAuthenticated([]);
        setStatusError(
          `Deletion was prepared but not submitted because OpenJob could not save the submission state. ${messageFor(error)}`,
        );
        return;
      }
      setStatusReceipt(submittingReceipt);
      setInteractivePrepared(false);
      setStatusUncertain(false);

      let result;
      let ownershipFailure: unknown;
      try {
        result = await api.deleteUser(
          token,
          submittingReceipt.statusToken,
          credentials,
        );
      } catch (error) {
        try {
          releaseAccountDeletionReceiptOwnership(submittingReceipt);
        } catch (ownershipError) {
          ownershipFailure = ownershipError;
        }
        setUser(null);
        setMethods([]);
        setAuthenticated([]);
        const cleanupFailure = await purgeClientAccess();
        setStatusUncertain(true);
        setStatusError(
          `OpenJob could not confirm whether deletion started. Access is blocked until status can be refreshed. ${messageFor(ownershipFailure ?? cleanupFailure ?? error)}`,
        );
        return;
      }

      try {
        releaseAccountDeletionReceiptOwnership(submittingReceipt);
      } catch (error) {
        ownershipFailure = error;
      }

      setUser(null);
      setMethods([]);
      setAuthenticated([]);
      if (result.status === "completed") {
        setCompletionCleanupPending(true);
      } else {
        setPending({
          deadline: result.deadline,
          reauthenticationProviders: result.reauthenticationProviders,
          requestedAt: result.requestedAt,
          status: "pending",
        });
      }
      const purgeFailure = await purgeClientAccess();
      const cleanupFailure = ownershipFailure ?? purgeFailure;
      if (result.status === "completed") {
        finishCompletedDeletion(submittingReceipt, cleanupFailure);
      } else {
        setStatusUncertain(false);
      }
      if (cleanupFailure && result.status === "pending") {
        setStatusError(
          `OpenJob could not clear all browser data. ${messageFor(cleanupFailure)}`,
        );
      }
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshPendingProvider(method: SignInMethod) {
    if (
      !statusReceipt ||
      !pending?.reauthenticationProviders.includes(method)
    ) return;
    setBusy(true);
    setMessage("");
    setStatusError("");
    let proof: AuthCredentialProof | null = null;
    let result: AccountDeletionRequestResult | null = null;
    let refreshFailure: unknown;
    try {
      proof = await auth.authenticateForLink(method);
      const credential = await deletionCredentialFor(proof);
      if (credential.provider !== method) {
        throw new Error("Firebase returned a different Sign-in Method.");
      }
      result = await api.refreshAccountDeletionProvider(
        statusReceipt.statusToken,
        credential,
      );
    } catch (error) {
      refreshFailure = error;
    }

    let proofDisposalFailure: unknown;
    if (proof) {
      try {
        await proof.dispose();
      } catch (error) {
        proofDisposalFailure = error;
      }
    }
    const purgeFailure = await purgeClientAccess();
    const cleanupFailure = proofDisposalFailure ?? purgeFailure;
    setUser(null);
    setMethods([]);
    setAuthenticated([]);

    try {
      if (refreshFailure) {
        setStatusUncertain(true);
        const cleanupMessage = cleanupFailure
          ? ` This browser also needs local cleanup; refresh deletion status to retry. ${messageFor(cleanupFailure)}`
          : "";
        setStatusError(
          `OpenJob could not refresh ${methodName(method)} authentication. ${messageFor(refreshFailure)}${cleanupMessage}`,
        );
      } else if (result?.status === "completed") {
        finishCompletedDeletion(statusReceipt, cleanupFailure);
      } else if (result?.status === "pending") {
        setPending(result);
        setStatusUncertain(false);
        setStatusError(cleanupFailure
          ? `Deletion remains pending, but OpenJob could not finish securing this browser. Refresh deletion status to retry local cleanup. ${messageFor(cleanupFailure)}`
          : "");
      } else {
        setStatusUncertain(true);
        setStatusError(
          "OpenJob could not confirm the provider refresh. Refresh deletion status to continue.",
        );
      }
    } catch (error) {
      setStatusError(
        `OpenJob could not refresh ${methodName(method)} authentication. ${messageFor(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryCompletionCleanup() {
    setCheckingStatus(true);
    setStatusError("");
    try {
      const cleanupFailure = await purgeClientAccess();
      if (statusReceipt) {
        finishCompletedDeletion(statusReceipt, cleanupFailure);
      } else {
        finishRecoveredCompletion(cleanupFailure);
      }
    } catch (error) {
      setStatusError(
        `OpenJob could not finish clearing this browser. ${messageFor(error)}`,
      );
    } finally {
      setCheckingStatus(false);
    }
  }

  async function acknowledgeCompletedDeletion() {
    if (statusReceipt && statusReceipt.phase !== "completed") return;
    setCheckingStatus(true);
    setStatusError("");
    try {
      if (statusReceipt && !clearAccountDeletionStatusReceipt(statusReceipt)) {
        setStatusReceipt(loadAccountDeletionStatusReceipt());
        setCompleted(false);
        setStatusUncertain(true);
        setStatusError(
          "Deletion status changed in another tab. Refresh the current status before continuing.",
        );
        return;
      }
      setStatusReceipt(null);
      setCompleted(false);
      window.location.replace("/");
    } catch (error) {
      setStatusError(
        `OpenJob could not acknowledge final deletion status. ${messageFor(error)}`,
      );
    } finally {
      setCheckingStatus(false);
    }
  }

  return (
    <main className={styles.page}>
      {/* This page also runs in the browser-only acceptance fixture. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className={styles.wordmark} href="/">OpenJob</a>
      <section className={styles.card} aria-labelledby="deletion-title">
        <p className={styles.kicker}>Account and data</p>
        <h1 id="deletion-title">Delete your OpenJob User</h1>
        <p>
          This permanently removes your OpenJob identity, sign-in methods,
          notification data, Tasks you created, and access to shared Groups.
          This cannot be undone.
        </p>
        <p>
          If other Members remain, OpenJob keeps their Group. Open Tasks assigned
          to you become Unassigned. Completed shared Tasks keep only a “Deleted
          User” marker with no User ID or Username.
        </p>

        {!statusReceiptReady ? (
          <p aria-busy="true">Checking for an existing deletion request…</p>
        ) : completionCleanupPending ? (
          <div className={styles.actions}>
            <p className={styles.status} role="status">
              OpenJob confirmed the server deletion, but this browser still
              needs local cleanup before this request is finished.
            </p>
            <button
              disabled={busy || checkingStatus}
              onClick={() => void retryCompletionCleanup()}
              type="button"
            >
              {busy || checkingStatus ? "Finishing local cleanup…" : "Retry local cleanup"}
            </button>
          </div>
        ) : completed ? (
          <div className={styles.actions}>
            <p className={styles.status} role="status">{message}</p>
            <button
              disabled={checkingStatus}
              onClick={() => void acknowledgeCompletedDeletion()}
              type="button"
            >
              {checkingStatus ? "Continuing…" : "Continue"}
            </button>
          </div>
        ) : recoveryRetrying ? (
          <div className={styles.actions}>
            <p className={styles.status} role="status">
              Access is blocked while OpenJob retries deletion recovery with
              the same in-memory provider proof.
            </p>
          </div>
        ) : statusReceipt && !(
          interactivePrepared && statusReceipt.phase === "prepared"
        ) ? (
          <div className={styles.actions}>
            <p className={styles.status} role="status">
              {checkingStatus
                ? "Checking deletion status…"
                : waitingForOwningTab
                  ? "Another tab is completing deletion. This tab is blocked until that attempt finishes."
                  : pending
                    ? pendingStatusMessage(pending)
                    : statusUncertain
                      ? "Deletion status could not be confirmed. Access is blocked."
                      : statusReceipt.phase === "prepared"
                        ? `Deletion is prepared but has not been submitted. It remains available until ${
                          new Date(
                            statusReceipt.submissionExpiresAt ?? "",
                          ).toLocaleTimeString()
                        }. Return to the active tab, or refresh after that time.`
                        : "Deletion submission is being confirmed. Access is blocked."}
            </p>
            {!waitingForOwningTab
              ? pending?.reauthenticationProviders.map((method) => (
              <button
                disabled={busy || checkingStatus}
                key={method}
                onClick={() => void refreshPendingProvider(method)}
                type="button"
              >
                {busy
                  ? `Refreshing ${methodName(method)}…`
                  : `Reauthenticate ${methodName(method)}`}
              </button>
                ))
              : null}
            {!waitingForOwningTab ? (
              <button
                disabled={busy || checkingStatus}
                onClick={() => void refreshDeletionStatus(statusReceipt)}
                type="button"
              >
                {checkingStatus
                  ? "Refreshing…"
                  : busy
                    ? "Refreshing provider…"
                    : "Refresh deletion status"}
              </button>
            ) : null}
          </div>
        ) : pendingRecoveryRequired ? (
          <div className={styles.actions}>
            <p>
              Deletion is already in progress. Sign in again with the same
              provider to securely recover its status.
            </p>
            <button
              disabled={busy}
              onClick={() => void signInForDeletion("google")}
              type="button"
            >
              Continue with Google
            </button>
            <button
              disabled={busy}
              onClick={() => void signInForDeletion("apple")}
              type="button"
            >
              Continue with Apple
            </button>
          </div>
        ) : statusReceiptReadFailed ? null : !session ? (
          <div className={styles.actions}>
            <p>Sign in to request deletion. You do not need the app or support.</p>
            <button disabled={busy} onClick={() => void signInForDeletion("google")} type="button">
              Continue with Google
            </button>
            <button disabled={busy} onClick={() => void signInForDeletion("apple")} type="button">
              Continue with Apple
            </button>
          </div>
        ) : user ? (
          <div className={styles.actions}>
            <p>Deleting <strong>@{user.username}</strong>.</p>
            <p>Freshly authenticate every linked Sign-in Method:</p>
            {methods.map((method) => (
              <button
                disabled={busy}
                key={method}
                onClick={() => void freshlyAuthenticate(method)}
                type="button"
              >
                {authenticated.includes(method) ? "Authenticated" : "Authenticate"} {methodName(method)}
              </button>
            ))}
            <label htmlFor="delete-confirmation">
              Type <strong>DELETE</strong> to confirm permanent deletion
            </label>
            <input
              autoComplete="off"
              id="delete-confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              value={confirmation}
            />
            <button
              className={styles.danger}
              disabled={
                busy ||
                confirmation !== "DELETE" ||
                authenticated.length !== methods.length
              }
              onClick={() => void deleteUser()}
              type="button"
            >
              {busy ? "Deleting…" : "Permanently delete User"}
            </button>
          </div>
        ) : (
          <p aria-busy="true">Loading your OpenJob User…</p>
        )}
        {message && !completed && (!statusReceipt || interactivePrepared)
          ? <p className={styles.error} role="alert">{message}</p>
          : null}
        {statusError ? <p className={styles.error} role="alert">{statusError}</p> : null}
        <p className={styles.policy}>
          Access ends immediately. Automated cleanup normally completes in this
          flow; a provider outage may keep it pending for up to seven days.
          OpenJob retains no User or User-generated data after completion.
        </p>
      </section>
    </main>
  );
}
