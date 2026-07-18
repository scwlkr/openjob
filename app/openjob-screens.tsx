"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  type AuthSession,
  type Group,
  type InvitePreview,
  type OpenJobApi,
  type User,
} from "./openjob-contracts";
import { GroupGovernance } from "./openjob-governance";
import { OPENJOB_VERSION } from "./release";
import { useReleaseUpdate } from "./release-update";
import { TaskList } from "./openjob-task-list";
import {
  NotificationInvitation,
  NotificationSettings,
  notificationStateLabel,
  type NotificationController,
} from "./openjob-notifications";
import styles from "./openjob.module.css";

function initials(name: string) {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function Brand() {
  return <span className={styles.brand}>OPENJOB<span>.</span></span>;
}

export function LoadingScreen() {
  return (
    <main className={styles.centeredScreen} aria-busy="true">
      <div className={styles.loadingMark} aria-hidden="true">OJ</div>
      <p>Loading your OpenJob…</p>
    </main>
  );
}

export function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <main className={styles.centeredScreen}>
      <div className={styles.loadError} role="alert">
        <h1>OpenJob could not load right now.</h1>
        <p>{error}</p>
        <button className={styles.primaryButton} type="button" onClick={onRetry}>Try again</button>
      </div>
    </main>
  );
}

export function SignedOut({
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
            Sign in to join private Groups and keep every Task attached to the right people.
          </p>
          {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
          <button className={styles.googleButton} type="button" onClick={onSignIn} disabled={signingIn}>
            <span aria-hidden="true">G</span>
            {signingIn ? "Opening Google…" : "Continue with Google"}
          </button>
          <p className={styles.authNote}>
            Your Google email is used for sign-in, never as your Username.
          </p>
        </div>
      </section>
    </main>
  );
}

export function UsernameOnboarding({
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
              aria-describedby={`username-guidance${error ? " username-error" : ""}`}
              autoFocus
            />
          </div>
          <p id="username-guidance" className={styles.guidance}>
            2–32 lowercase letters or numbers. Dots, dashes, and underscores can sit inside.
          </p>
          {error ? <p id="username-error" className={styles.fieldError} role="alert">{error}</p> : null}
          <button className={styles.primaryButton} type="submit" disabled={saving}>
            {saving ? "Claiming…" : "Claim Username"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function InviteJoin({
  api,
  inviteToken,
  onCancel,
  onJoined,
  onSessionExpired,
  session,
}: {
  api: OpenJobApi;
  inviteToken: string;
  onCancel: () => void;
  onJoined: (group: Group) => void;
  onSessionExpired: (error: unknown) => Promise<boolean>;
  session: AuthSession;
}) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setInvalid(false);
    setError("");
    try {
      setPreview(await api.inspectInvite(await session.getIdToken(), inviteToken));
    } catch (loadError) {
      if (await onSessionExpired(loadError)) return;
      if (loadError instanceof ApiError && loadError.status === 404) {
        setPreview(null);
        setInvalid(true);
      } else {
        setError("OpenJob could not check this Invite Link. Try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [api, inviteToken, onSessionExpired, session]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function join() {
    setJoining(true);
    setError("");
    try {
      onJoined(await api.joinInvite(await session.getIdToken(), inviteToken));
    } catch (joinError) {
      if (await onSessionExpired(joinError)) return;
      if (joinError instanceof ApiError) {
        if (joinError.status === 404) {
          setPreview(null);
          setInvalid(true);
          return;
        }
        if (joinError.code === "membership_denied") {
          setError("Membership could not be granted.");
          return;
        }
        if (joinError.code === "username_required") {
          setError("Claim a Username before joining this Group.");
          return;
        }
      }
      setError("OpenJob could not join this Group. Try again.");
    } finally {
      setJoining(false);
    }
  }

  if (loading) return <LoadingScreen />;

  return (
    <main className={styles.onboardingShell}>
      <header className={styles.simpleHeader}>
        <Brand />
        <span>Invite Link</span>
      </header>
      <section className={styles.onboardingCard}>
        {invalid ? (
          <>
            <p className={styles.kicker}>Private Group</p>
            <h1>Invite Link unavailable</h1>
            <p className={styles.lede}>
              This Invite Link is no longer valid. Ask a Group Admin for the current link.
            </p>
            <button className={styles.textButton} type="button" onClick={onCancel}>Back to your Groups</button>
          </>
        ) : preview ? (
          <>
            <p className={styles.kicker}>Private Group Invite Link</p>
            <h1>Join {preview.groupName}</h1>
            <p className={styles.lede}>
              Confirm to become a Member. You will see the Group Task List after joining.
            </p>
            {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
            <div className={styles.inviteActions}>
              <button className={styles.textButton} type="button" onClick={onCancel}>Not now</button>
              <button className={styles.primaryButton} type="button" disabled={joining} onClick={() => void join()}>
                {joining ? "Joining…" : "Join Group"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.kicker}>Invite Link</p>
            <h1>Invite Link unavailable</h1>
            <p className={styles.inlineError} role="alert">{error}</p>
            <button className={styles.primaryButton} type="button" onClick={() => void load()}>Try again</button>
          </>
        )}
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
        autoComplete="off"
        aria-describedby={`group-name-guidance${error ? " group-name-error" : ""}`}
        autoFocus
      />
      <p id="group-name-guidance" className={styles.guidance}>
        Use the name your team already recognizes. It does not need to be unique.
      </p>
      {error ? <p id="group-name-error" className={styles.fieldError} role="alert">{error}</p> : null}
      <div className={styles.formActions}>
        {onCancel ? <button className={styles.textButton} type="button" onClick={onCancel}>Cancel</button> : null}
        <button className={styles.primaryButton} type="submit" disabled={saving}>
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
        <p className={styles.kicker}>New Group</p>
        <h2 id="new-group-title">Create a Group</h2>
        {form}
      </section>
    </div>
  );
}

export type GroupShellProps = {
  api: OpenJobApi;
  error: string;
  groups: Group[];
  notice: string;
  notifications: NotificationController;
  onSessionExpired: (error: unknown) => Promise<boolean>;
  onCreate: (name: string) => void;
  onGroupRemoved: (group: Group, message: string) => void;
  onGroupUpdated: (group: Group) => void;
  onRetry: () => void;
  onSelect: (group: Group) => void;
  onSignOut: () => void;
  saving: boolean;
  selectedGroup: Group | null;
  selectingGroupId: string | null;
  session: AuthSession;
  user: User;
};

export function GroupShell(props: GroupShellProps) {
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"tasks" | "governance">("tasks");
  const [openMenu, setOpenMenu] = useState<"group" | "user" | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const availableVersion = useReleaseUpdate();
  const groupMenuButton = useRef<HTMLButtonElement>(null);
  const userMenuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function closeMenu(event: KeyboardEvent) {
      if (event.key !== "Escape" || !openMenu) return;
      const opener = openMenu === "group" ? groupMenuButton : userMenuButton;
      setOpenMenu(null);
      window.setTimeout(() => opener.current?.focus(), 0);
    }
    document.addEventListener("keydown", closeMenu);
    return () => document.removeEventListener("keydown", closeMenu);
  }, [openMenu]);

  const groupMenuTrigger = (
    <button
      aria-controls="group-menu-panel"
      aria-expanded={openMenu === "group"}
      aria-label="Group menu"
      className={styles.navMenuTrigger}
      onClick={() => setOpenMenu((current) => current === "group" ? null : "group")}
      ref={groupMenuButton}
      type="button"
    >
      <span className={styles.navMenuTriggerText}>{props.selectedGroup?.name ?? "Groups"}</span>
      <span aria-hidden="true">⌄</span>
    </button>
  );

  return (
    <main className={styles.groupShell} data-testid="group-shell">
      <header className={styles.signedInHeader}>
        <Brand />
        <div className={styles.signedInNav} aria-label="OpenJob navigation">
          <div className={styles.navMenu}>
            {props.selectedGroup ? (
              <h1 aria-label={props.selectedGroup.name} className={styles.groupMenuHeading}>{groupMenuTrigger}</h1>
            ) : groupMenuTrigger}
            {openMenu === "group" ? (
              <div className={styles.navMenuPanel} id="group-menu-panel" data-testid="group-menu-panel">
                <p className={styles.menuLabel}>Your Groups</p>
                <nav className={styles.menuGroupList} aria-label="Groups">
                  {props.groups.map((group) => (
                    <button
                      type="button"
                      key={group.groupId}
                      className={props.selectedGroup?.groupId === group.groupId ? styles.selectedMenuGroup : ""}
                      onClick={() => {
                        setOpenMenu(null);
                        setView("tasks");
                        props.onSelect(group);
                      }}
                      aria-current={props.selectedGroup?.groupId === group.groupId ? "page" : undefined}
                      disabled={props.selectingGroupId === group.groupId}
                    >
                      <span aria-hidden="true">{initials(group.name)}</span>
                      <b>{group.name}</b>
                    </button>
                  ))}
                </nav>
                <div className={styles.menuActions}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      if (props.groups.length === 0) {
                        document.getElementById("first-group-name")?.focus();
                        return;
                      }
                      setCreating(true);
                    }}
                  >New Group</button>
                  {props.selectedGroup ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        setView("governance");
                      }}
                    >{props.selectedGroup.role === "admin" ? "Manage Group" : "Group settings"}</button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className={styles.taskActionSlot} id="signed-in-task-action" />
          <div className={styles.navMenu}>
            <button
              aria-controls="user-menu-panel"
              aria-expanded={openMenu === "user"}
              aria-label="User menu"
              className={styles.userMenuTrigger}
              onClick={() => setOpenMenu((current) => current === "user" ? null : "user")}
              ref={userMenuButton}
              type="button"
            ><span aria-hidden="true">{props.user.username ? initials(props.user.username) : "?"}</span></button>
            {openMenu === "user" ? (
              <div className={`${styles.navMenuPanel} ${styles.userMenuPanel}`} id="user-menu-panel">
                <p className={styles.menuLabel}>Signed in as @{props.user.username}</p>
                <p className={styles.menuVersion}>OpenJob v{OPENJOB_VERSION}</p>
                <div className={styles.menuActions}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      setNotificationsOpen(true);
                    }}
                  >Notifications — {notificationStateLabel(props.notifications.state)}</button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      props.onSignOut();
                    }}
                  >Sign out</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className={styles.groupSurface} data-testid="group-surface">
        <NotificationInvitation notifications={props.notifications} />
        {availableVersion ? (
          <div className={styles.updateBanner} role="status">
            <span>OpenJob {availableVersion} is available.</span>
            <button type="button" onClick={() => window.location.reload()}>Refresh</button>
          </div>
        ) : null}
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
          <section className={styles.selectedGroupSurface}>
            {view === "governance" ? (
              <header>
                <nav className={styles.groupViewNav} aria-label="Selected Group view">
                <button
                  type="button"
                  onClick={() => setView("tasks")}
                >Back to Task List</button>
                </nav>
              </header>
            ) : null}
            {view === "tasks" ? (
              <TaskList
                api={props.api}
                group={props.selectedGroup}
                key={props.selectedGroup.groupId}
                onSessionExpired={props.onSessionExpired}
                session={props.session}
              />
            ) : (
              <GroupGovernance
                api={props.api}
                group={props.selectedGroup}
                key={props.selectedGroup.groupId}
                onGroupRemoved={(message) => props.onGroupRemoved(props.selectedGroup!, message)}
                onGroupUpdated={props.onGroupUpdated}
                onSessionExpired={props.onSessionExpired}
                session={props.session}
                user={props.user}
              />
            )}
          </section>
        ) : (
          <section className={styles.chooseGroup}>
            <p className={styles.kicker}>More than one place to work</p>
            <h1>Choose a Group</h1>
            <p className={styles.lede}>
              Pick one from the Group menu. OpenJob will remember this choice only on this device.
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
      {notificationsOpen ? (
        <NotificationSettings
          notifications={props.notifications}
          onClose={() => setNotificationsOpen(false)}
        />
      ) : null}
    </main>
  );
}
