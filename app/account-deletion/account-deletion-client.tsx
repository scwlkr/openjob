"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createFirebaseAuth } from "../firebase-auth";
import { createOpenJobApi } from "../openjob-api";
import type {
  AuthCredentialProof,
  AuthSession,
  SignInMethod,
  User,
} from "../openjob-contracts";
import { clearBrowserPrivateState } from "../openjob-private-state";
import styles from "./account-deletion.module.css";

function methodName(method: SignInMethod) {
  return method === "apple" ? "Apple" : "Google";
}

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : "OpenJob could not continue account deletion.";
}

export function AccountDeletionClient() {
  const auth = useMemo(() => createFirebaseAuth(), []);
  const api = useMemo(() => createOpenJobApi(), []);
  const proofs = useRef(new Map<SignInMethod, AuthCredentialProof>());
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [methods, setMethods] = useState<SignInMethod[]>([]);
  const [authenticated, setAuthenticated] = useState<SignInMethod[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);

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
      for (const proof of activeProofs.values()) void proof.dispose();
      activeProofs.clear();
    };
  }, [auth]);

  useEffect(() => {
    if (!session || completed) return;
    let active = true;
    void (async () => {
      try {
        const token = await session.getIdToken();
        const [nextUser, nextMethods] = await Promise.all([
          api.getMe(token),
          api.listSignInMethods(token),
        ]);
        if (!active) return;
        setUser(nextUser);
        setMethods(nextMethods);
        setMessage("");
      } catch (error) {
        if (active) setMessage(messageFor(error));
      }
    })();
    return () => {
      active = false;
    };
  }, [api, completed, session]);

  async function freshlyAuthenticate(method: SignInMethod) {
    setBusy(true);
    setMessage("");
    try {
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
    if (!session || !user || confirmation !== "DELETE") return;
    setBusy(true);
    setMessage("");
    try {
      const credentials = await Promise.all(
        methods.map(async (provider) => {
          const proof = proofs.current.get(provider);
          if (!proof) throw new Error(`Authenticate ${methodName(provider)} again.`);
          return {
            credentialToken: await proof.getIdToken(),
            provider,
            revocation: await proof.getRevocationProof(),
          };
        }),
      );
      const result = await api.deleteUser(await session.getIdToken(), credentials);
      for (const proof of proofs.current.values()) await proof.dispose();
      proofs.current.clear();
      clearBrowserPrivateState();
      await auth.signOut();
      setCompleted(true);
      setUser(null);
      setMethods([]);
      setAuthenticated([]);
      setMessage(
        result.status === "completed"
          ? "Your OpenJob User and associated data were deleted."
          : `Deletion is in progress and will finish by ${new Date(result.deadline).toLocaleDateString()}. Access has ended.`,
      );
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
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

        {completed ? (
          <p className={styles.status} role="status">{message}</p>
        ) : !session ? (
          <div className={styles.actions}>
            <p>Sign in to request deletion. You do not need the app or support.</p>
            <button disabled={busy} onClick={() => void auth.signIn("google")} type="button">
              Continue with Google
            </button>
            <button disabled={busy} onClick={() => void auth.signIn("apple")} type="button">
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
        {message && !completed ? <p className={styles.error} role="alert">{message}</p> : null}
        <p className={styles.policy}>
          Access ends immediately. Automated cleanup normally completes in this
          flow; a provider outage may keep it pending for up to seven days.
          OpenJob retains no User or User-generated data after completion.
        </p>
      </section>
    </main>
  );
}
