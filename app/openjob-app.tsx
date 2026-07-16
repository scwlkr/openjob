"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./openjob.module.css";

export type User = {
  userId: string;
  username: string | null;
  usernameRequired: boolean;
};

export type Group = {
  groupId: string;
  name: string;
  role: "member" | "admin";
  createdAt: string;
};

export type AuthSession = { getIdToken(): Promise<string> };

export type OpenJobAuth = {
  observe(listener: (session: AuthSession | null) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};

export type OpenJobApi = {
  getMe(token: string): Promise<User>;
  claimUsername(token: string, username: string): Promise<User>;
  listGroups(token: string): Promise<Group[]>;
  getGroup(token: string, groupId: string): Promise<Group>;
  createGroup(token: string, name: string): Promise<Group>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const SELECTED_GROUP_KEY = "openjob:selected-group-id";
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])$/;

function initials(name: string) {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function readableError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    return "Your session expired. Sign in again.";
  }
  return "OpenJob could not load right now. Try again.";
}

function Brand() {
  return <span className={styles.brand}>OPENJOB<span>.</span></span>;
}

function LoadingScreen() {
  return (
    <main className={styles.centeredScreen} aria-busy="true">
      <div className={styles.loadingMark} aria-hidden="true">OJ</div>
      <p>Loading your OpenJob…</p>
    </main>
  );
}

function SignedOut({
  error,
  onSignIn,
  signingIn,
}: {
  error: string;
  onSignIn: () => void;
  signingIn: boolean;
}) {
  return (
    <main className={styles.authShell}>
      <aside className={styles.authRail} aria-label="OpenJob introduction">
        <Brand />
        <div className={styles.railStatement}>
          <p className={styles.kicker}>Private Groups</p>
          <p>Shared work stays with the people doing it.</p>
        </div>
        <p className={styles.railFoot}>Google sign-in only</p>
      </aside>
      <section className={styles.authContent}>
        <div className={styles.authCopy}>
          <p className={styles.kicker}>The shared list, stripped back</p>
          <h1>Your team. One clear list.</h1>
          <p className={styles.lede}>
            Sign in to join private Groups and keep every Task attached to the
            right people.
          </p>
          {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
          <button
            className={styles.googleButton}
            type="button"
            onClick={onSignIn}
            disabled={signingIn}
          >
            <span aria-hidden="true">G</span>
            {signingIn ? "Opening Google…" : "Continue with Google"}
          </button>
          <p className={styles.authNote}>
            Your Google email is used for sign-in, never as your OpenJob name.
          </p>
        </div>
      </section>
    </main>
  );
}

function UsernameOnboarding({
  error,
  onClaim,
  saving,
}: {
  error: string;
  onClaim: (username: string) => void;
  saving: boolean;
}) {
  const [username, setUsername] = useState("");
  return (
    <main className={styles.onboardingShell}>
      <header className={styles.simpleHeader}>
        <Brand />
        <span>Step 1 of 1</span>
      </header>
      <section className={styles.onboardingCard}>
        <p className={styles.kicker}>One name, everywhere</p>
        <h1>Claim your Username</h1>
        <p className={styles.lede}>
          Members will use it to recognize you and assign work. You choose it once.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onClaim(username);
          }}
          noValidate
        >
          <label htmlFor="username">Username</label>
          <div className={styles.prefixedInput}>
            <span aria-hidden="true">@</span>
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={32}
              aria-describedby="username-guidance username-error"
              autoFocus
            />
          </div>
          <p id="username-guidance" className={styles.guidance}>
            2–32 lowercase letters or numbers. Dots, dashes, and underscores can sit inside.
          </p>
          {error ? <p id="username-error" className={styles.fieldError} role="alert">{error}</p> : null}
          <button className={styles.primaryButton} type="submit" disabled={saving || !username}>
            {saving ? "Claiming…" : "Claim Username"}
          </button>
        </form>
      </section>
    </main>
  );
}

function GroupCreator({
  error,
  onCancel,
  onCreate,
  saving,
  standalone = false,
}: {
  error: string;
  onCancel?: () => void;
  onCreate: (name: string) => void;
  saving: boolean;
  standalone?: boolean;
}) {
  const [name, setName] = useState("");
  const inputId = standalone ? "first-group-name" : "new-group-name";
  const form = (
    <form
      className={styles.groupForm}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onCreate(name);
      }}
      noValidate
    >
      <label htmlFor={inputId}>Group Name</label>
      <input
        id={inputId}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        autoComplete="off"
        aria-describedby="group-name-guidance group-name-error"
        autoFocus
      />
      <p id="group-name-guidance" className={styles.guidance}>
        Use the name your team already recognizes. It does not need to be unique.
      </p>
      {error ? <p id="group-name-error" className={styles.fieldError} role="alert">{error}</p> : null}
      <div className={styles.formActions}>
        {onCancel ? <button className={styles.textButton} type="button" onClick={onCancel}>Cancel</button> : null}
        <button className={styles.primaryButton} type="submit" disabled={saving || !name.trim()}>
          {saving ? "Creating…" : "Create Group"}
        </button>
      </div>
    </form>
  );

  if (standalone) {
    return (
      <section className={styles.emptyGroups}>
        <p className={styles.kicker}>Start private</p>
        <h1>Create your first Group</h1>
        <p className={styles.lede}>A Group is one membership boundary with one shared Task List.</p>
        {form}
      </section>
    );
  }

  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="new-group-title">
        <p className={styles.kicker}>New private space</p>
        <h2 id="new-group-title">Create a Group</h2>
        {form}
      </section>
    </div>
  );
}

type GroupShellProps = {
  error: string;
  groups: Group[];
  notice: string;
  onCreate: (name: string) => void;
  onRetry: () => void;
  onSelect: (group: Group) => void;
  onSignOut: () => void;
  saving: boolean;
  selectedGroup: Group | null;
  selectingGroupId: string | null;
  user: User;
};

function GroupShell(props: GroupShellProps) {
  const [creating, setCreating] = useState(false);
  return (
    <main className={styles.groupShell} data-testid="group-shell">
      <aside className={styles.groupRail} data-testid="group-rail">
        <div className={styles.railTopline}>
          <Brand />
          <button className={styles.compactSignOut} type="button" onClick={props.onSignOut}>Sign out</button>
        </div>
        <p className={styles.railLabel}>Your Groups</p>
        <nav className={styles.groupList} aria-label="Groups">
          {props.groups.map((group) => (
            <button
              type="button"
              key={group.groupId}
              className={props.selectedGroup?.groupId === group.groupId ? styles.selectedGroup : ""}
              onClick={() => props.onSelect(group)}
              aria-label={group.name}
              aria-current={props.selectedGroup?.groupId === group.groupId ? "page" : undefined}
              disabled={props.selectingGroupId === group.groupId}
            >
              <span aria-hidden="true">{initials(group.name)}</span>
              <b>{group.name}</b>
            </button>
          ))}
        </nav>
        {props.groups.length > 0 ? (
          <button className={styles.newGroupButton} type="button" onClick={() => setCreating(true)}>+ New Group</button>
        ) : null}
        <div className={styles.signedInUser}>
          <span aria-hidden="true">@</span>
          <b>{props.user.username}</b>
          <button type="button" onClick={props.onSignOut}>Sign out</button>
        </div>
      </aside>

      <section className={styles.groupWorkspace} data-testid="group-workspace">
        {props.notice ? <p className={styles.notice} role="status">{props.notice}</p> : null}
        {props.error && props.groups.length > 0 ? (
          <div className={styles.errorBanner} role="alert">
            <span>{props.error}</span>
            <button type="button" onClick={props.onRetry}>Try again</button>
          </div>
        ) : null}
        {props.groups.length === 0 ? (
          <GroupCreator error={props.error} onCreate={props.onCreate} saving={props.saving} standalone />
        ) : props.selectedGroup ? (
          <section className={styles.selectedWorkspace}>
            <header>
              <div>
                <p className={styles.kicker}>Selected Group</p>
                <h1>{props.selectedGroup.name}</h1>
                <p className={styles.groupMeta}>
                  {props.selectedGroup.role === "admin" ? "Admin" : "Member"}
                  <span aria-hidden="true">·</span>
                  <code>{props.selectedGroup.groupId}</code>
                </p>
              </div>
            </header>
            <div className={styles.workspacePlaceholder}>
              <span className={styles.indexMark} aria-hidden="true">01</span>
              <div>
                <p className={styles.kicker}>Shared Task List</p>
                <h2>This Group is ready.</h2>
                <p>Your team’s Task List will open in this work surface.</p>
              </div>
            </div>
          </section>
        ) : (
          <section className={styles.chooseGroup}>
            <p className={styles.kicker}>More than one place to work</p>
            <h1>Choose a Group</h1>
            <p className={styles.lede}>
              Pick one from the Group rail. OpenJob will remember this choice only on this device.
            </p>
          </section>
        )}
      </section>

      {creating ? (
        <GroupCreator
          error={props.error}
          onCancel={() => setCreating(false)}
          onCreate={(name) => {
            props.onCreate(name);
            setCreating(false);
          }}
          saving={props.saving}
        />
      ) : null}
    </main>
  );
}

export function OpenJobApp({ auth, api }: { auth: OpenJobAuth; api: OpenJobApi }) {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [selectingGroupId, setSelectingGroupId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadGroups = useCallback(async (activeSession: AuthSession) => {
    const token = await activeSession.getIdToken();
    const accessibleGroups = await api.listGroups(token);
    setSelectedGroup(null);

    const rememberedId = window.localStorage.getItem(SELECTED_GROUP_KEY);
    const remembered = accessibleGroups.find((group) => group.groupId === rememberedId);
    const candidate = remembered ?? (accessibleGroups.length === 1 ? accessibleGroups[0] : null);

    if (rememberedId && !remembered) {
      window.localStorage.removeItem(SELECTED_GROUP_KEY);
      setNotice("That Group is no longer accessible. Choose another.");
    }
    if (candidate) {
      try {
        const verified = await api.getGroup(token, candidate.groupId);
        setGroups(accessibleGroups);
        setSelectedGroup(verified);
        window.localStorage.setItem(SELECTED_GROUP_KEY, verified.groupId);
        return;
      } catch (selectionError) {
        if (!(selectionError instanceof ApiError) || selectionError.status !== 404) {
          throw selectionError;
        }
        setGroups(accessibleGroups.filter((group) => group.groupId !== candidate.groupId));
        window.localStorage.removeItem(SELECTED_GROUP_KEY);
        setNotice("That Group is no longer accessible.");
        return;
      }
    }
    setGroups(accessibleGroups);
  }, [api]);

  const bootstrap = useCallback(async (activeSession: AuthSession) => {
    setLoading(true);
    setError("");
    try {
      const token = await activeSession.getIdToken();
      const currentUser = await api.getMe(token);
      setUser(currentUser);
      if (!currentUser.usernameRequired) await loadGroups(activeSession);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, [api, loadGroups]);

  useEffect(
    () =>
      auth.observe((nextSession) => {
        setSession(nextSession);
        if (nextSession === null) {
          setUser(null);
          setGroups([]);
          setSelectedGroup(null);
          setLoading(false);
        } else {
          void bootstrap(nextSession);
        }
      }),
    [auth, bootstrap],
  );

  async function signIn() {
    setSigningIn(true);
    setError("");
    try {
      await auth.signIn();
    } catch {
      setError("Google sign-in did not finish. Try again.");
    } finally {
      setSigningIn(false);
    }
  }

  async function claimUsername(username: string) {
    if (!USERNAME_PATTERN.test(username)) {
      setError("Use lowercase letters and numbers, with dots, dashes, or underscores only inside.");
      return;
    }
    if (!session) return;
    setSaving(true);
    setError("");
    try {
      const token = await session.getIdToken();
      const claimed = await api.claimUsername(token, username);
      setUser(claimed);
      await loadGroups(session);
    } catch (claimError) {
      setError(
        claimError instanceof ApiError && claimError.code === "username_taken"
          ? "That Username is unavailable. Try another."
          : readableError(claimError),
      );
    } finally {
      setSaving(false);
    }
  }

  async function createGroup(name: string) {
    if (!session) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80 || /[\n\r\p{Cc}]/u.test(trimmed)) {
      setError("Use 1–80 characters without line breaks or control characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const token = await session.getIdToken();
      const created = await api.createGroup(token, name);
      setGroups((current) => [...current, created]);
      setSelectedGroup(created);
      setNotice("");
      window.localStorage.setItem(SELECTED_GROUP_KEY, created.groupId);
    } catch (createError) {
      setError(
        createError instanceof ApiError && createError.fields?.name
          ? createError.fields.name
          : readableError(createError),
      );
    } finally {
      setSaving(false);
    }
  }

  async function selectGroup(group: Group) {
    if (!session) return;
    setSelectingGroupId(group.groupId);
    setError("");
    setNotice("");
    try {
      const token = await session.getIdToken();
      const verified = await api.getGroup(token, group.groupId);
      setSelectedGroup(verified);
      window.localStorage.setItem(SELECTED_GROUP_KEY, verified.groupId);
    } catch (selectError) {
      if (selectError instanceof ApiError && selectError.status === 404) {
        setGroups((current) => current.filter((item) => item.groupId !== group.groupId));
        setSelectedGroup(null);
        window.localStorage.removeItem(SELECTED_GROUP_KEY);
        setNotice("That Group is no longer accessible.");
      } else {
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
  if (!user && error) {
    return (
      <main className={styles.centeredScreen}>
        <div className={styles.loadError} role="alert">
          <h1>OpenJob could not load right now.</h1>
          <p>{error}</p>
          <button className={styles.primaryButton} type="button" onClick={() => void bootstrap(session)}>Try again</button>
        </div>
      </main>
    );
  }
  if (!user) return <LoadingScreen />;
  if (user.usernameRequired) {
    return <UsernameOnboarding error={error} onClaim={(username) => void claimUsername(username)} saving={saving} />;
  }
  return (
    <GroupShell
      error={error}
      groups={groups}
      notice={notice}
      onCreate={(name) => void createGroup(name)}
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
