"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  type AuthSession,
  type Group,
  type OpenJobApi,
  type OpenJobAuth,
  type User,
} from "./openjob-contracts";
import {
  GroupShell,
  LoadError,
  LoadingScreen,
  SignedOut,
  UsernameOnboarding,
} from "./openjob-screens";

const SELECTED_GROUP_KEY = "openjob:selected-group-id";

function readableError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    return "Your session expired. Sign in again.";
  }
  return "OpenJob could not load right now. Try again.";
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

export function OpenJobApp({ auth, api }: { auth: OpenJobAuth; api: OpenJobApi }) {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsReady, setGroupsReady] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authObserverFailed, setAuthObserverFailed] = useState(false);
  const [authObservation, setAuthObservation] = useState(0);
  const [selectingGroupId, setSelectingGroupId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const recoverExpiredSession = useCallback(async (candidate: unknown) => {
    if (!(candidate instanceof ApiError) || candidate.status !== 401) return false;
    setError(readableError(candidate));
    await auth.signOut().catch(() => undefined);
    setSession(null);
    return true;
  }, [auth]);

  const loadGroups = useCallback(async (activeSession: AuthSession) => {
    const token = await activeSession.getIdToken();
    const accessibleGroups = await api.listGroups(token);
    setSelectedGroup(null);

    const rememberedId = window.localStorage.getItem(SELECTED_GROUP_KEY);
    const remembered = accessibleGroups.find((group) => group.groupId === rememberedId);
    const candidate = remembered ?? (accessibleGroups.length === 1 ? accessibleGroups[0] : null);

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
    try {
      const token = await activeSession.getIdToken();
      const currentUser = await api.getMe(token);
      setUser(currentUser);
      if (!currentUser.usernameRequired) await loadGroups(activeSession);
    } catch (loadError) {
      if (!(await recoverExpiredSession(loadError))) setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, [api, loadGroups, recoverExpiredSession]);

  useEffect(
    () =>
      auth.observe(
        (nextSession) => {
          setAuthObserverFailed(false);
          setSession(nextSession);
          if (nextSession === null) {
            setUser(null);
            setGroups([]);
            setGroupsReady(false);
            setSelectedGroup(null);
            setNotice("");
            setLoading(false);
          } else {
            void bootstrap(nextSession);
          }
        },
        () => {
          setAuthObserverFailed(true);
          setSession(null);
          setUser(null);
          setGroups([]);
          setGroupsReady(false);
          setSelectedGroup(null);
          setNotice("");
          setError("Google sign-in could not start. Try again.");
          setLoading(false);
        },
      ),
    [auth, authObservation, bootstrap],
  );

  async function signIn() {
    setSigningIn(true);
    setError("");
    try {
      await auth.signIn();
      if (authObserverFailed) {
        setSession(undefined);
        setLoading(true);
        setAuthObserverFailed(false);
        setAuthObservation((current) => current + 1);
      }
    } catch {
      setError("Google sign-in did not finish. Try again.");
    } finally {
      setSigningIn(false);
    }
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
      await loadGroups(activeSession);
    }, usernameError);
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

  async function selectGroup(group: Group) {
    if (!session) return;
    setSelectingGroupId(group.groupId);
    setError("");
    setNotice("");
    try {
      const verified = await api.getGroup(await session.getIdToken(), group.groupId);
      setSelectedGroup(verified);
      window.localStorage.setItem(SELECTED_GROUP_KEY, verified.groupId);
    } catch (selectError) {
      if (selectError instanceof ApiError && selectError.status === 404) {
        setGroups((current) => current.filter((item) => item.groupId !== group.groupId));
        setSelectedGroup(null);
        window.localStorage.removeItem(SELECTED_GROUP_KEY);
        setNotice("That Group is no longer accessible.");
      } else if (!(await recoverExpiredSession(selectError))) {
        setError(readableError(selectError));
      }
    } finally {
      setSelectingGroupId(null);
    }
  }

  if (session === undefined || (session && loading)) return <LoadingScreen />;
  if (session === null) {
    return <SignedOut error={error} onSignIn={() => void signIn()} signingIn={signingIn} />;
  }

  const groupLoadFailed = Boolean(user && !user.usernameRequired && !groupsReady && error);
  if ((!user && error) || groupLoadFailed) {
    return <LoadError error={error} onRetry={() => void bootstrap(session)} />;
  }
  if (!user || (!user.usernameRequired && !groupsReady)) return <LoadingScreen />;
  if (user.usernameRequired) {
    return <UsernameOnboarding error={error} onClaim={claimUsername} saving={saving} />;
  }
  return (
    <GroupShell
      error={error}
      groups={groups}
      notice={notice}
      onCreate={createGroup}
      onRetry={() => void bootstrap(session)}
      onSelect={(group) => void selectGroup(group)}
      onSignOut={() => void auth.signOut()}
      saving={saving}
      selectedGroup={selectedGroup}
      selectingGroupId={selectingGroupId}
      user={user}
    />
  );
}
