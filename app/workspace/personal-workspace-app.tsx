"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createFirebaseAuth } from "../firebase-auth";
import type { AuthSession, OpenJobAuth, SignInMethod } from "../openjob-contracts";
import { OpenJobBrand } from "../openjob-brand";
import { createPersonalWorkspaceClient, type PersonalWorkspaceClient } from "./personal-workspace-api";
import styles from "./workspace.module.css";
import WorkspacePilotSession from '../owned-workspaces/workspace-pilot-session';
import BrowserSession from "./web-offline-session";
import { clearBrowserPrivateState } from "../openjob-private-state";

type Lease = { session: AuthSession | null | undefined; epoch: number; controller: AbortController };
type Props = { workspaceMode?: "pilot"; auth?: OpenJobAuth; client?: PersonalWorkspaceClient };

export default function PersonalWorkspaceApp({ auth, client, workspaceMode }: Props) {
  const activeAuth = useMemo(() => auth || createFirebaseAuth({ allowOfflineRestore: true }), [auth]);
  const activeClient = useMemo(() => client || createPersonalWorkspaceClient(), [client]);
  const [lease, setLease] = useState<Lease>(() => ({ session: undefined, epoch: 0, controller: new AbortController() }));
  const activeLease = useRef(lease);
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    let active = true;
    let requested = 0;
    let previousIdentity: string | null | undefined;
    let cleanup = Promise.resolve();
    const replace = async (session: AuthSession | null, message = "") => {
      if (!active) return;
      const request = ++requested;
      const identity = session?.localIdentity ? JSON.stringify([session.localIdentity.tenantId, session.localIdentity.uid]) : session ? undefined : null;
      const changed = previousIdentity !== undefined && previousIdentity !== identity;
      previousIdentity = identity;
      activeLease.current.controller.abort();
      const locked = { session: null, epoch: activeLease.current.epoch + 1, controller: new AbortController() };
      activeLease.current = locked; setLease(locked); setAuthError(message);
      if (!session || changed) cleanup = clearBrowserPrivateState();
      try { await cleanup; }
      catch { if (active && request === requested) setAuthError("Private browser cleanup could not be completed. Reload before continuing."); return; }
      if (!active || request !== requested) return;
      const next = { session, epoch: activeLease.current.epoch + 1, controller: new AbortController() };
      activeLease.current = next; setLease(next);
    };
    const unsubscribe = activeAuth.observe(session => { void replace(session); }, () => { void replace(null, "Authentication could not be restored. Please sign in again."); });
    return () => { active = false; requested += 1; activeLease.current.controller.abort(); unsubscribe(); };
  }, [activeAuth]);

  async function signIn(method: SignInMethod) {
    setSigningIn(true); setAuthError("");
    let proof: Awaited<ReturnType<OpenJobAuth["signIn"]>> = null;
    try { proof = await activeAuth.signIn(method); }
    catch { setAuthError("Sign-in could not be completed. Please try again."); }
    finally { try { await proof?.dispose(); } catch { setAuthError("Sign-in cleanup could not be completed. Please try again."); } setSigningIn(false); }
  }

  const lock = useCallback(() => {
    activeLease.current.controller.abort();
    const next = { session: null, epoch: activeLease.current.epoch + 1, controller: new AbortController() };
    activeLease.current = next; setLease(next);
  }, []);

  async function signOut() {
    activeLease.current.controller.abort();
    const next = { session: null, epoch: activeLease.current.epoch + 1, controller: new AbortController() };
    activeLease.current = next; setLease(next);
    try { await clearBrowserPrivateState(); await activeAuth.signOut(); } catch { setAuthError("Sign-out could not be completed. Reload before continuing."); }
  }

  if (lease.session && workspaceMode === "pilot") return <WorkspacePilotSession key={lease.epoch} session={lease.session} signal={lease.controller.signal} onSignOut={signOut} />;
  if (lease.session) return <BrowserSession key={lease.epoch} session={lease.session} signal={lease.controller.signal} client={activeClient} onSignOut={signOut} onPrivatePurge={lock} />;
  return <div className={styles.workspace}><header className={styles.header}><OpenJobBrand /><span>Personal workspace</span></header><main className={styles.main}>
    <h1>Your tasks and time, together</h1><p>Sign in with your existing OpenJob account to open your saved Tasks and Calendar.</p>
    {lease.session === undefined ? <p role="status">Restoring your session…</p> : <div className={styles.actions}><button disabled={signingIn} onClick={() => signIn("google")}>Continue with Google</button><button disabled={signingIn} onClick={() => signIn("apple")}>Continue with Apple</button></div>}
    {authError && <p role="alert">{authError}</p>}<p><Link href="/">Account setup and existing Groups</Link></p><p className={styles.small}>Mail provider connections are upcoming. Personal agent access can be reviewed after sign-in. Synthetic Mail is available as a clearly labeled preview after sign-in.</p>
  </main></div>;
}
