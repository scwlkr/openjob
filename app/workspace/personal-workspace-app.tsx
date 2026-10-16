"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createFirebaseAuth } from "../firebase-auth";
import type { AuthSession, OpenJobAuth, SignInMethod } from "../openjob-contracts";
import { OpenJobBrand } from "../openjob-brand";
import type { WorkspaceCommand, WorkspaceView } from "../../shared/workspace-contracts";
import { createFixtureWorkspace } from "../../shared/workspace-fixtures";
import { createPersonalWorkspaceClient, PersonalWorkspaceError, type PersonalWorkspaceClient } from "./personal-workspace-api";
import WorkspaceTasks from "./workspace-tasks";
import WorkspaceCalendar from "./workspace-calendar";
import styles from "./workspace.module.css";

type Lease = { session: AuthSession | null | undefined; epoch: number; controller: AbortController };
type Props = { auth?: OpenJobAuth; client?: PersonalWorkspaceClient };

export default function PersonalWorkspaceApp({ auth, client }: Props) {
  const activeAuth = useMemo(() => auth || createFirebaseAuth(), [auth]);
  const activeClient = useMemo(() => client || createPersonalWorkspaceClient(), [client]);
  const [lease, setLease] = useState<Lease>(() => ({ session: undefined, epoch: 0, controller: new AbortController() }));
  const activeLease = useRef(lease);
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    let active = true;
    const replace = (session: AuthSession | null) => {
      if (!active) return;
      activeLease.current.controller.abort();
      const next = { session, epoch: activeLease.current.epoch + 1, controller: new AbortController() };
      activeLease.current = next;
      if (active) { setLease(next); setAuthError(""); }
    };
    const unsubscribe = activeAuth.observe(replace, () => { replace(null); if (active) setAuthError("Authentication could not be restored. Please sign in again."); });
    return () => { active = false; activeLease.current.controller.abort(); unsubscribe(); };
  }, [activeAuth]);

  async function signIn(method: SignInMethod) {
    setSigningIn(true); setAuthError("");
    let proof: Awaited<ReturnType<OpenJobAuth["signIn"]>> = null;
    try { proof = await activeAuth.signIn(method); }
    catch { setAuthError("Sign-in could not be completed. Please try again."); }
    finally { try { await proof?.dispose(); } catch { setAuthError("Sign-in cleanup could not be completed. Please try again."); } setSigningIn(false); }
  }

  async function signOut() {
    activeLease.current.controller.abort();
    const next = { session: null, epoch: activeLease.current.epoch + 1, controller: new AbortController() };
    activeLease.current = next; setLease(next);
    try { await activeAuth.signOut(); } catch { setAuthError("Sign-out could not be completed. Reload before continuing."); }
  }

  if (lease.session) return <PersonalSession key={lease.epoch} session={lease.session} signal={lease.controller.signal} client={activeClient} onSignOut={signOut} />;
  return <div className={styles.workspace}><header className={styles.header}><OpenJobBrand /><span>Personal workspace</span></header><main className={styles.main}>
    <h1>Your tasks and time, together</h1><p>Sign in with your existing OpenJob account to open your saved Tasks and Calendar.</p>
    {lease.session === undefined ? <p role="status">Restoring your session…</p> : <div className={styles.actions}><button disabled={signingIn} onClick={() => signIn("google")}>Continue with Google</button><button disabled={signingIn} onClick={() => signIn("apple")}>Continue with Apple</button></div>}
    {authError && <p role="alert">{authError}</p>}<p><Link href="/">Account setup and existing Groups</Link></p><p className={styles.small}>Mail provider connections and personal agent access are upcoming. Synthetic Mail is available as a clearly labeled preview after sign-in.</p>
  </main></div>;
}

function PersonalSession({ session, signal, client, onSignOut }: { session: AuthSession; signal: AbortSignal; client: PersonalWorkspaceClient; onSignOut: () => Promise<void> }) {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [tab, setTab] = useState("Tasks");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unrecognized, setUnrecognized] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedMessage, setSelectedMessage] = useState("");
  const mounted = useRef(true);
  const synthetic = useMemo(() => createFixtureWorkspace(), []);
  const messages = synthetic.messages.filter((message) => message.accountId.startsWith("alex_"));
  const selected = messages.find((message) => message.id === selectedMessage);
  const current = () => mounted.current && !signal.aborted;

  useEffect(() => {
    let active = true;
    mounted.current = true;
    client.snapshot(session, signal).then((next) => { if (active && !signal.aborted) setView(next); }).catch((failure: unknown) => { if (active && !signal.aborted) { setError("Your workspace could not be loaded. Try Refresh."); setUnrecognized(failure instanceof PersonalWorkspaceError && failure.code === "sign_in_method_unrecognized"); } });
    return () => { active = false; mounted.current = false; };
  }, [client, session, signal]);

  async function refresh() {
    if (!current()) return;
    setError("");
    try { const next = await client.snapshot(session, signal); if (current()) { setView(next); setUnrecognized(false); } }
    catch (failure) { if (current()) { setError("Your workspace could not be loaded. Try Refresh."); setUnrecognized(failure instanceof PersonalWorkspaceError && failure.code === "sign_in_method_unrecognized"); } }
  }

  async function command(input: WorkspaceCommand, success: string) {
    if (!current()) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      await client.command(session, input, signal);
      if (!current()) return false;
      const next = await client.snapshot(session, signal);
      if (!current()) return false;
      setView(next); setNotice(success); return true;
    } catch { if (current()) setError("The change could not be completed. Refresh to check your saved workspace before retrying."); return false; }
    finally { if (current()) setBusy(false); }
  }

  return <div className={styles.workspace}><header className={styles.header}><OpenJobBrand /><span>Personal workspace · signed in</span><button onClick={onSignOut}>Sign out</button></header>
    <div className={styles.layout}><aside className={styles.sidebar}><nav aria-label="Personal workspace"><div className={styles.tabs}>{["Tasks", "Calendar", "Mail preview", "Agents"].map((name) => <button key={name} disabled={!view} aria-current={tab === name ? "page" : undefined} onClick={() => setTab(name)}>{name}</button>)}</div></nav><p className={styles.small}>Tasks and Calendar use your authenticated OpenJob account.</p><Link href="/">Existing Groups and account</Link></aside>
      <main className={styles.main}><div className={styles.title}><h1>{tab}</h1><button disabled={busy} onClick={refresh}>Refresh</button></div>
        {!view && !error && <p role="status">Loading your personal workspace…</p>}{error && <p role="alert" className={styles.error}>{error}</p>}{unrecognized && <p>Finish setting up your existing sign-in at <Link href="/">OpenJob account setup</Link>. No account has been created automatically.</p>}{notice && <p role="status" className={styles.success}>{notice}</p>}
        {view && tab === "Tasks" && <WorkspaceTasks view={view} busy={busy} command={command} />}
        {view && tab === "Calendar" && <WorkspaceCalendar view={view} busy={busy} command={command} />}
        {view && tab === "Mail preview" && <><p className={styles.banner}>Synthetic Mail preview · fictional messages, no provider connection, no sending. This mail is not saved to your account.</p><div className={styles.mailGrid}><section className={styles.panel} aria-label="Synthetic messages">{messages.map((message) => <button className={styles.message} key={message.id} onClick={() => setSelectedMessage(message.id)}><strong>{message.subject}</strong><small>{message.from} · synthetic</small></button>)}</section><section className={styles.panel} aria-label="Synthetic message reader">{selected ? <div className={styles.reader}><h2>{selected.subject}</h2><p>{selected.from}</p><pre className={styles.body}>{selected.body}</pre><button disabled={busy} onClick={() => command({ type: "task.create", title: selected.subject }, "Task created from a synthetic example; no mailbox link was saved")}>Create personal task from example</button></div> : <p className={styles.empty}>Select a fictional message to explore the preview.</p>}</section></div></>}
        {view && tab === "Agents" && <section className={styles.panel}><h2 className={styles.sectionHeading}>Personal agent access is upcoming</h2><p className={styles.inset}>This authenticated workspace does not create or simulate agent grants. Scoped agent access will be available through the shared API when supported.</p></section>}
      </main></div></div>;
}
