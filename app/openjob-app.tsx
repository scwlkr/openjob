"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  type AuthCredentialProof,
  type AuthSession,
  type Group,
  type OpenJobApi,
  type OpenJobAuth,
  type SignInMethod,
  type User,
} from "./openjob-contracts";
import {
  GroupShell,
  InviteJoin,
  LoadError,
  LoadingScreen,
  SignInMethodsDialog,
  SignedOut,
  UnrecognizedSignIn,
  UsernameOnboarding,
} from "./openjob-screens";
import { useOpenJobNotifications } from "./openjob-notifications";
import { consumePendingNotificationGroup } from "./openjob-notification-browser";
import {
  clearBrowserPrivateState,
  SELECTED_GROUP_KEY,
} from "./openjob-private-state";

const NOTIFICATION_GROUP_PARAMETER = "notification-group";

async function notificationLaunchGroup() {
  const url = new URL(window.location.href);
  const values = url.searchParams.getAll(NOTIFICATION_GROUP_PARAMETER);
  const candidate = values.length === 1 ? values[0] : null;
  const pendingGroupId = await consumePendingNotificationGroup();
  url.searchParams.delete(NOTIFICATION_GROUP_PARAMETER);
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  return {
    present: values.length > 0,
    groupId:
      candidate && /^grp_[A-Za-z0-9_-]+$/.test(candidate)
        ? candidate
        : values.length === 0
          ? pendingGroupId
          : null,
  };
}

function readableError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    return "Your session expired. Sign in again.";
  }
  return "OpenJob could not load right now. Try again.";
}

function firebaseErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "";
}

function isTerminalFirebaseCredentialError(error: unknown) {
  return new Set([
    "auth/id-token-expired",
    "auth/invalid-user-token",
    "auth/session-cookie-expired",
    "auth/user-disabled",
    "auth/user-not-found",
    "auth/user-token-expired",
  ]).has(firebaseErrorCode(error));
}

function providerError(error: unknown, method: SignInMethod) {
  const code = firebaseErrorCode(error);
  if (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request"
  ) {
    return "Sign-in was canceled. You can try again.";
  }
  if (code === "auth/network-request-failed") {
    return "You appear to be offline. Check your connection and try again.";
  }
  const name = method === "apple" ? "Apple" : "Google";
  return `${name} sign-in did not finish. Try again.`;
}

function linkingError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "fresh_authentication_required") {
      return "That provider confirmation expired. Authenticate again.";
    }
    if (error.code === "sign_in_method_conflict") {
      return "That sign-in method belongs to another User and cannot be linked.";
    }
    if (error.code === "sign_in_method_unrecognized") {
      return "That provider is not linked to an existing User.";
    }
    if (error.code === "link_target_changed") {
      return "That User changed. Authenticate again and confirm the current User.";
    }
  }
  return readableError(error);
}

function usernameError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.fields?.username) return error.fields.username;
    if (error.code === "username_taken") {
      return "That Username is unavailable. Try another.";
    }
  }
  return readableError(error);
}

export function OpenJobApp({
  auth,
  api,
  inviteToken: initialInviteToken,
}: {
  auth: OpenJobAuth;
  api: OpenJobApi;
  inviteToken?: string;
}) {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsReady, setGroupsReady] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingIn, setSigningIn] = useState<SignInMethod | null>(null);
  const [authObserverFailed, setAuthObserverFailed] = useState(false);
  const [authObservation, setAuthObservation] = useState(0);
  const [unrecognizedMethod, setUnrecognizedMethod] =
    useState<SignInMethod | null>(null);
  const [methodsDialogOpen, setMethodsDialogOpen] = useState(false);
  const [signInMethods, setSignInMethods] = useState<SignInMethod[] | null>(null);
  const [linkingMethod, setLinkingMethod] = useState<SignInMethod | null>(null);
  const [linkProof, setLinkProof] = useState<AuthCredentialProof | null>(null);
  const [linkTarget, setLinkTarget] = useState<User | null>(null);
  const [linkError, setLinkError] = useState("");
  const [selectingGroupId, setSelectingGroupId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cleanupRequired, setCleanupRequired] = useState(false);
  const [authRestoreRetryRequired, setAuthRestoreRetryRequired] =
    useState(false);
  const [inviteToken, setInviteToken] = useState(initialInviteToken ?? null);
  const notifications = useOpenJobNotifications({
    api,
    hasUsableGroup: Boolean(selectedGroup),
    session,
    user,
  });
  const prepareNotificationSignOut = useRef(notifications.prepareSignOut);
  const authCleanupInProgress = useRef(false);
  const authFlowEpoch = useRef(0);
  const linkProofRef = useRef<AuthCredentialProof | null>(null);
  const [methodsReturnFocus, setMethodsReturnFocus] =
    useState<HTMLElement | null>(null);
  useEffect(() => {
    prepareNotificationSignOut.current = notifications.prepareSignOut;
  }, [notifications.prepareSignOut]);
  useEffect(() => {
    linkProofRef.current = linkProof;
    return () => {
      if (linkProofRef.current === linkProof) {
        linkProofRef.current = null;
      }
      void linkProof?.dispose().catch(() => undefined);
    };
  }, [linkProof]);

  const purgeBrowserSession = useCallback(async (
    preserveTaskDraft = false,
  ) => {
    let failure: unknown;
    try {
      clearBrowserPrivateState({ preserveTaskDraft });
    } catch (error) {
      failure = error;
    }
    try {
      await prepareNotificationSignOut.current();
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw failure;
  }, []);

  const finishExpiredSessionCleanup = useCallback(async () => {
    authCleanupInProgress.current = true;
    try {
      await purgeBrowserSession(true);
      await auth.signOut();
      setCleanupRequired(false);
      setSession(null);
      setUser(null);
      setGroups([]);
      setGroupsReady(false);
      setSelectedGroup(null);
      return true;
    } catch {
      setCleanupRequired(true);
      setError("OpenJob could not safely sign out. Try again.");
      return false;
    } finally {
      authCleanupInProgress.current = false;
    }
  }, [auth, purgeBrowserSession]);

  const recoverExpiredSession = useCallback(async (candidate: unknown) => {
    const expiredApiSession =
      candidate instanceof ApiError && candidate.status === 401;
    if (!expiredApiSession && !isTerminalFirebaseCredentialError(candidate)) {
      return false;
    }
    authFlowEpoch.current += 1;
    setError("Your session expired. Sign in again.");
    setCleanupRequired(true);
    setLinkTarget(null);
    setLinkingMethod(null);
    setMethodsDialogOpen(false);
    setUnrecognizedMethod(null);
    if (await finishExpiredSessionCleanup()) setLinkProof(null);
    return true;
  }, [finishExpiredSessionCleanup]);

  const loadGroups = useCallback(async (activeSession: AuthSession) => {
    const token = await activeSession.getIdToken();
    const accessibleGroups = await api.listGroups(token);
    setSelectedGroup(null);

    const notificationLaunch = await notificationLaunchGroup();
    const notifiedGroup = accessibleGroups.find(
      (group) => group.groupId === notificationLaunch.groupId,
    );
    const rememberedId = window.localStorage.getItem(SELECTED_GROUP_KEY);
    const remembered = accessibleGroups.find((group) => group.groupId === rememberedId);
    const candidate =
      notifiedGroup ??
      remembered ??
      (accessibleGroups.length === 1 ? accessibleGroups[0] : null);

    if (notificationLaunch.present && !notifiedGroup) {
      setNotice("That Group is no longer accessible.");
    }

    if (rememberedId && !remembered) {
      window.localStorage.removeItem(SELECTED_GROUP_KEY);
      setNotice(
        accessibleGroups.length === 1
          ? "That Group is no longer accessible."
          : "That Group is no longer accessible. Choose another.",
      );
    }
    if (candidate) {
      try {
        const verified = await api.getGroup(token, candidate.groupId);
        setGroups(accessibleGroups);
        setSelectedGroup(verified);
        setGroupsReady(true);
        window.localStorage.setItem(SELECTED_GROUP_KEY, verified.groupId);
        return;
      } catch (selectionError) {
        if (!(selectionError instanceof ApiError) || selectionError.status !== 404) {
          throw selectionError;
        }
        setGroups(accessibleGroups.filter((group) => group.groupId !== candidate.groupId));
        setGroupsReady(true);
        window.localStorage.removeItem(SELECTED_GROUP_KEY);
        setNotice("That Group is no longer accessible.");
        return;
      }
    }
    setGroups(accessibleGroups);
    setGroupsReady(true);
  }, [api]);

  const bootstrap = useCallback(async (activeSession: AuthSession) => {
    setLoading(true);
    setGroupsReady(false);
    setError("");
    setNotice("");
    setUser(null);
    setUnrecognizedMethod(null);
    try {
      const token = await activeSession.getIdToken();
      const currentUser = await api.getMe(token);
      setUser(currentUser);
      if (!currentUser.usernameRequired) await loadGroups(activeSession);
    } catch (loadError) {
      if (
        loadError instanceof ApiError &&
        loadError.status === 409 &&
        loadError.code === "sign_in_method_unrecognized"
      ) {
        setUnrecognizedMethod(activeSession.signInMethod);
      } else if (!(await recoverExpiredSession(loadError))) {
        setError(readableError(loadError));
      }
    } finally {
      setLoading(false);
    }
  }, [api, loadGroups, recoverExpiredSession]);

  useEffect(
    () =>
      auth.observe(
        (nextSession) => {
          if (authCleanupInProgress.current) return;
          const transitionEpoch = ++authFlowEpoch.current;
          setAuthObserverFailed(false);
          setAuthRestoreRetryRequired(false);
          setLinkProof(null);
          setLinkTarget(null);
          setLinkingMethod(null);
          setLinkError("");
          setMethodsDialogOpen(false);
          setSignInMethods(null);
          setUnrecognizedMethod(null);
          if (nextSession === null) {
            authCleanupInProgress.current = true;
            setCleanupRequired(true);
            void purgeBrowserSession()
              .then(() => auth.signOut())
              .then(() => {
                if (transitionEpoch !== authFlowEpoch.current) return;
                setCleanupRequired(false);
                setSession(null);
                setUser(null);
                setGroups([]);
                setGroupsReady(false);
                setSelectedGroup(null);
                setNotice("");
                setLoading(false);
              })
              .catch(() => {
                if (transitionEpoch !== authFlowEpoch.current) return;
                setError("OpenJob could not safely sign out. Try again.");
              })
              .finally(() => {
                authCleanupInProgress.current = false;
              });
          } else {
            setSession(nextSession);
            void bootstrap(nextSession);
          }
        },
        (observationError) => {
          if (isTerminalFirebaseCredentialError(observationError)) {
            void recoverExpiredSession(observationError);
            return;
          }
          if (
            firebaseErrorCode(observationError) ===
            "auth/network-request-failed"
          ) {
            setAuthRestoreRetryRequired(true);
            setSession(undefined);
            setError(
              "OpenJob could not restore your sign-in. Check your connection and try again.",
            );
            setLoading(false);
            return;
          }
          if (authCleanupInProgress.current) return;
          const transitionEpoch = ++authFlowEpoch.current;
          authCleanupInProgress.current = true;
          setAuthObserverFailed(true);
          setCleanupRequired(true);
          setError("Sign-in could not start. Try again.");
          void purgeBrowserSession()
            .then(() => auth.signOut())
            .then(() => {
              if (transitionEpoch !== authFlowEpoch.current) return;
              setCleanupRequired(false);
              setSession(null);
              setUser(null);
              setGroups([]);
              setGroupsReady(false);
              setSelectedGroup(null);
              setNotice("");
              setLoading(false);
            })
            .catch(() => {
              if (transitionEpoch !== authFlowEpoch.current) return;
              setError("OpenJob could not safely sign out. Try again.");
            })
            .finally(() => {
              authCleanupInProgress.current = false;
            });
        },
      ),
    [
      auth,
      authObservation,
      bootstrap,
      purgeBrowserSession,
      recoverExpiredSession,
    ],
  );

  async function signIn(method: SignInMethod) {
    setSigningIn(method);
    setError("");
    try {
      await auth.signIn(method);
      if (authObserverFailed) {
        setSession(undefined);
        setLoading(true);
        setAuthObserverFailed(false);
        setAuthObservation((current) => current + 1);
      }
    } catch (signInError) {
      setError(providerError(signInError, method));
    } finally {
      setSigningIn(null);
    }
  }

  async function leaveSession(
    switchingUser: boolean,
    completedMessage = "",
  ) {
    authFlowEpoch.current += 1;
    authCleanupInProgress.current = true;
    setError("");
    try {
      await linkProofRef.current?.dispose();
      setLinkProof(null);
      setLinkTarget(null);
      setLinkingMethod(null);
      setMethodsDialogOpen(false);
      await purgeBrowserSession();
      await (switchingUser ? auth.switchUser() : auth.signOut());
      setSession(null);
      setUser(null);
      setGroups([]);
      setGroupsReady(false);
      setSelectedGroup(null);
      setNotice("");
      setLoading(false);
      if (completedMessage) setError(completedMessage);
      return true;
    } catch {
      setError("OpenJob could not safely sign out. Try again.");
      return false;
    } finally {
      authCleanupInProgress.current = false;
    }
  }

  async function signOut() {
    await leaveSession(false);
  }

  async function switchUser() {
    await leaveSession(true);
  }

  async function createUser() {
    if (!session) return;
    setSaving(true);
    setError("");
    try {
      const created = await api.createUser(await session.getIdToken());
      setUser(created);
      setUnrecognizedMethod(null);
      if (!created.usernameRequired) await loadGroups(session);
    } catch (createError) {
      if (!(await recoverExpiredSession(createError))) {
        setError(readableError(createError));
      }
    } finally {
      setSaving(false);
    }
  }

  function beginUnknownLink() {
    if (!unrecognizedMethod) return;
    setLinkError("");
    setLinkingMethod(unrecognizedMethod === "google" ? "apple" : "google");
  }

  async function authenticateForLink(method: SignInMethod) {
    const flowEpoch = ++authFlowEpoch.current;
    let proof: AuthCredentialProof | null = null;
    setSaving(true);
    setLinkError("");
    setLinkingMethod(method);
    setLinkProof(null);
    setLinkTarget(null);
    try {
      proof = await auth.authenticateForLink(method);
      let target: User | null = null;
      if (unrecognizedMethod !== null) {
        target = await api.getMe(await proof.getIdToken());
      } else if (user?.usernameRequired) {
        try {
          target = await api.getMe(await proof.getIdToken());
        } catch (targetError) {
          if (
            targetError instanceof ApiError &&
            targetError.code === "sign_in_method_unrecognized"
          ) {
            target = user;
          } else {
            throw targetError;
          }
        }
      } else if (user) {
        target = user;
      }
      if (flowEpoch !== authFlowEpoch.current) {
        await proof.dispose();
        return;
      }
      setLinkTarget(target);
      setLinkProof(proof);
    } catch (authenticationError) {
      try {
        await proof?.dispose();
      } catch {
        setLinkError(
          "OpenJob could not safely discard that provider sign-in. Try again.",
        );
        return;
      }
      if (flowEpoch !== authFlowEpoch.current) return;
      setLinkError(
        authenticationError instanceof ApiError
          ? linkingError(authenticationError)
          : providerError(authenticationError, method),
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancelLink() {
    authFlowEpoch.current += 1;
    setSaving(true);
    try {
      await linkProofRef.current?.dispose();
      setLinkProof(null);
      setLinkTarget(null);
      setLinkingMethod(null);
      setLinkError("");
      return true;
    } catch {
      setLinkError(
        "OpenJob could not safely discard that provider sign-in. Try again.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function confirmLink() {
    const proof = linkProofRef.current;
    if (!session || !proof || !linkingMethod) return;
    const expectedTargetUserId = linkTarget?.userId ?? user?.userId;
    if (!expectedTargetUserId) return;
    const linkingUnknownCredential = unrecognizedMethod !== null;
    const recoveringEmptyShell = Boolean(user?.usernameRequired);
    if ((linkingUnknownCredential || recoveringEmptyShell) && !linkTarget) {
      return;
    }
    setSaving(true);
    setLinkError("");
    try {
      const token = await session.getIdToken();
      const credentialToken = await proof.getIdToken();
      try {
        await proof.dispose();
      } catch {
        setLinkError(
          "OpenJob could not safely discard that provider sign-in. Try again.",
        );
        return;
      }
      setLinkProof(null);
      const linked = await api.linkSignInMethod(
        token,
        credentialToken,
        expectedTargetUserId,
      );
      setUser(linked);
      setUnrecognizedMethod(null);
      setLinkProof(null);
      setLinkTarget(null);
      setLinkingMethod(null);
      setMethodsDialogOpen(false);
      setSignInMethods(null);
      if (!linked.usernameRequired && !groupsReady) {
        try {
          await loadGroups(session);
        } catch (loadError) {
          if (!(await recoverExpiredSession(loadError))) {
            setError(readableError(loadError));
          }
        }
      } else if (!linkingUnknownCredential) {
        const name = proof.signInMethod === "apple" ? "Apple" : "Google";
        setNotice(`${name} is now linked.`);
      }
    } catch (confirmationError) {
      if (
        confirmationError instanceof ApiError &&
        confirmationError.code === "fresh_authentication_required"
      ) {
        if (linkingUnknownCredential && unrecognizedMethod) {
          const name =
            unrecognizedMethod === "apple" ? "Apple" : "Google";
          await leaveSession(
            true,
            `The initial ${name} sign-in expired. Sign in again to restart linking.`,
          );
        } else {
          setLinkError(linkingError(confirmationError));
        }
      } else if (!(await recoverExpiredSession(confirmationError))) {
        setLinkError(linkingError(confirmationError));
      }
    } finally {
      setSaving(false);
    }
  }

  async function openSignInMethods(returnFocus?: HTMLElement | null) {
    if (!session) return;
    if (returnFocus) setMethodsReturnFocus(returnFocus);
    setMethodsDialogOpen(true);
    setSignInMethods(null);
    setLinkingMethod(null);
    setLinkProof(null);
    setLinkTarget(null);
    setLinkError("");
    setSaving(true);
    try {
      const methods = await api.listSignInMethods(await session.getIdToken());
      setSignInMethods(
        methods.filter(
          (method): method is SignInMethod =>
            method === "apple" || method === "google",
        ),
      );
    } catch (methodsError) {
      if (await recoverExpiredSession(methodsError)) return;
      setLinkError(readableError(methodsError));
    } finally {
      setSaving(false);
    }
  }

  async function closeSignInMethods() {
    if (!(await cancelLink())) return;
    setMethodsDialogOpen(false);
    setSignInMethods(null);
  }

  async function runSavingAction(
    action: (token: string, activeSession: AuthSession) => Promise<void>,
    errorMessage: (error: unknown) => string,
  ) {
    if (!session) return;
    setSaving(true);
    setError("");
    try {
      await action(await session.getIdToken(), session);
    } catch (actionError) {
      if (!(await recoverExpiredSession(actionError))) setError(errorMessage(actionError));
    } finally {
      setSaving(false);
    }
  }

  function claimUsername(username: string) {
    void runSavingAction(async (token, activeSession) => {
      const claimed = await api.claimUsername(token, username);
      setUser(claimed);
      if (!inviteToken) await loadGroups(activeSession);
    }, usernameError);
  }

  function completeInvite(group: Group) {
    setGroups((current) => [
      ...current.filter((candidate) => candidate.groupId !== group.groupId),
      group,
    ]);
    setSelectedGroup(group);
    setGroupsReady(true);
    setInviteToken(null);
    setNotice(`Joined ${group.name}.`);
    window.localStorage.setItem(SELECTED_GROUP_KEY, group.groupId);
    window.history.replaceState({}, "", "/");
  }

  function cancelInvite() {
    if (!session) return;
    setInviteToken(null);
    window.history.replaceState({}, "", "/");
    void loadGroups(session).catch(async (loadError) => {
      if (!(await recoverExpiredSession(loadError))) setError(readableError(loadError));
    });
  }

  function createGroup(name: string) {
    void runSavingAction(async (token) => {
      const created = await api.createGroup(token, name);
      setGroups((current) => [...current, created]);
      setSelectedGroup(created);
      setGroupsReady(true);
      setNotice("");
      window.localStorage.setItem(SELECTED_GROUP_KEY, created.groupId);
    }, (createError) =>
      createError instanceof ApiError && createError.fields?.name
        ? createError.fields.name
        : readableError(createError),
    );
  }

  function updateGroup(group: Group) {
    setGroups((current) => current.map((candidate) =>
      candidate.groupId === group.groupId ? group : candidate
    ));
    setSelectedGroup((current) => current?.groupId === group.groupId ? group : current);
  }

  function removeGroup(group: Group, message: string) {
    setGroups((current) => current.filter((candidate) => candidate.groupId !== group.groupId));
    setSelectedGroup((current) => current?.groupId === group.groupId ? null : current);
    setNotice(message);
    if (window.localStorage.getItem(SELECTED_GROUP_KEY) === group.groupId) {
      window.localStorage.removeItem(SELECTED_GROUP_KEY);
    }
  }

  const selectGroup = useCallback(async (groupId: string) => {
    if (!session) return;
    setSelectingGroupId(groupId);
    setError("");
    setNotice("");
    try {
      const verified = await api.getGroup(await session.getIdToken(), groupId);
      setGroups((current) => {
        const existing = current.findIndex((group) => group.groupId === groupId);
        if (existing < 0) return [...current, verified];
        return current.map((group, index) => index === existing ? verified : group);
      });
      setSelectedGroup(verified);
      window.localStorage.setItem(SELECTED_GROUP_KEY, verified.groupId);
    } catch (selectError) {
      if (selectError instanceof ApiError && selectError.status === 404) {
        setGroups((current) => current.filter((item) => item.groupId !== groupId));
        setSelectedGroup((current) =>
          current?.groupId === groupId ? null : current
        );
        if (window.localStorage.getItem(SELECTED_GROUP_KEY) === groupId) {
          window.localStorage.removeItem(SELECTED_GROUP_KEY);
        }
        setNotice("That Group is no longer accessible.");
      } else if (!(await recoverExpiredSession(selectError))) {
        setError(readableError(selectError));
      }
    } finally {
      setSelectingGroupId(null);
    }
  }, [api, recoverExpiredSession, session]);

  useEffect(() => {
    if (!session || !navigator.serviceWorker?.addEventListener) return;
    const handleNotificationSelection = (event: MessageEvent) => {
      const message = event.data as unknown;
      if (
        !message ||
        typeof message !== "object" ||
        Array.isArray(message) ||
        Object.keys(message).sort().join(",") !== "groupId,type" ||
        !("type" in message) ||
        message.type !== "openjob:select-notification-group" ||
        !("groupId" in message) ||
        typeof message.groupId !== "string" ||
        !/^grp_[A-Za-z0-9_-]+$/.test(message.groupId)
      ) {
        return;
      }
      void consumePendingNotificationGroup();
      void selectGroup(message.groupId);
    };
    navigator.serviceWorker.addEventListener(
      "message",
      handleNotificationSelection,
    );
    return () => navigator.serviceWorker.removeEventListener(
      "message",
      handleNotificationSelection,
    );
  }, [selectGroup, session]);

  useEffect(() => {
    if (!session || !user || user.usernameRequired || !groupsReady) return;
    let consuming = false;
    const consumeSelection = async () => {
      if (consuming) return;
      consuming = true;
      try {
        const groupId = await consumePendingNotificationGroup();
        if (groupId) await selectGroup(groupId);
      } finally {
        consuming = false;
      }
    };
    const handleFocus = () => void consumeSelection();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void consumeSelection();
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [groupsReady, selectGroup, session, user]);

  if (cleanupRequired) {
    return (
      <LoadError
        error={error || "OpenJob could not safely sign out. Try again."}
        onRetry={() => void finishExpiredSessionCleanup()}
      />
    );
  }
  if (authRestoreRetryRequired) {
    return (
      <LoadError
        error={error}
        onRetry={() => {
          setAuthRestoreRetryRequired(false);
          setError("");
          setLoading(true);
          setAuthObservation((current) => current + 1);
        }}
      />
    );
  }
  if (session === undefined || (session && loading)) return <LoadingScreen />;
  if (session === null) {
    return (
      <SignedOut
        error={error}
        onSignIn={(method) => void signIn(method)}
        signingIn={signingIn}
      />
    );
  }
  if (unrecognizedMethod) {
    return (
      <UnrecognizedSignIn
        currentMethod={unrecognizedMethod}
        error={linkingMethod ? linkError : error}
        linkTarget={linkTarget}
        linking={linkingMethod !== null}
        onAuthenticate={() => {
          if (linkingMethod) void authenticateForLink(linkingMethod);
        }}
        onCancelLink={() => void cancelLink()}
        onConfirmLink={() => void confirmLink()}
        onCreate={() => void createUser()}
        onLinkExisting={beginUnknownLink}
        onSignOut={() => void switchUser()}
        proofReady={linkProof !== null}
        saving={saving}
      />
    );
  }

  const groupLoadFailed = Boolean(user && !user.usernameRequired && !groupsReady && error);
  if ((!user && error) || groupLoadFailed) {
    return <LoadError error={error} onRetry={() => void bootstrap(session)} />;
  }
  if (!user) return <LoadingScreen />;
  const methodsDialog = methodsDialogOpen ? (
    <SignInMethodsDialog
      error={linkError}
      linkingMethod={linkingMethod}
      linkTarget={linkTarget}
      methods={signInMethods}
      onAuthenticate={(method) => void authenticateForLink(method)}
      onClose={() => void closeSignInMethods()}
      onConfirmLink={() => void confirmLink()}
      onRetry={() => void openSignInMethods()}
      proofReady={linkProof !== null}
      returnFocus={methodsReturnFocus}
      saving={saving}
    />
  ) : null;
  if (user.usernameRequired) {
    return (
      <>
        <UsernameOnboarding
          error={error}
          onClaim={claimUsername}
          onLinkExisting={(returnFocus) =>
            void openSignInMethods(returnFocus)
          }
          onSignOut={() => void signOut()}
          onSwitchUser={() => void switchUser()}
          saving={saving}
        />
        {methodsDialog}
      </>
    );
  }
  if (inviteToken) {
    return (
      <InviteJoin
        api={api}
        inviteToken={inviteToken}
        onCancel={cancelInvite}
        onJoined={completeInvite}
        onSessionExpired={recoverExpiredSession}
        session={session}
      />
    );
  }
  if (!groupsReady) return <LoadingScreen />;
  return (
    <>
      <GroupShell
        api={api}
        error={error}
        groups={groups}
        notice={notice}
        notifications={notifications}
        onSessionExpired={recoverExpiredSession}
        onCreate={createGroup}
        onGroupRemoved={removeGroup}
        onGroupUpdated={updateGroup}
        onManageSignInMethods={(returnFocus) =>
          void openSignInMethods(returnFocus)
        }
        onRetry={() => void bootstrap(session)}
        onSelect={(group) => void selectGroup(group.groupId)}
        onSignOut={() => void signOut()}
        onSwitchUser={() => void switchUser()}
        saving={saving}
        selectedGroup={selectedGroup}
        selectingGroupId={selectingGroupId}
        session={session}
        user={user}
      />
      {methodsDialog}
    </>
  );
}
