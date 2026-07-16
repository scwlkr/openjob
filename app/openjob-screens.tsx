"use client";

import { type FormEvent, useState } from "react";
import type { AuthSession, Group, OpenJobApi, User } from "./openjob-contracts";
import { TaskList } from "./openjob-task-list";
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
  onSessionExpired: (error: unknown) => Promise<boolean>;
  onCreate: (name: string) => void;
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

      <section className={styles.groupSurface} data-testid="group-surface">
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
            <TaskList
              api={props.api}
              group={props.selectedGroup}
              key={props.selectedGroup.groupId}
              onSessionExpired={props.onSessionExpired}
              session={props.session}
            />
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
