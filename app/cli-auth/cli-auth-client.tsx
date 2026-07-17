"use client";

import { useState } from "react";
import { getGoogleIdTokenForCli } from "../firebase-auth";
import styles from "./cli-auth.module.css";

type Props = {
  callbackUrl: string | null;
  state: string | null;
};

function validHandoff(callbackUrl: string | null, state: string | null) {
  if (!callbackUrl || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return false;
  try {
    const callback = new URL(callbackUrl);
    return (
      callback.protocol === "http:" &&
      callback.hostname === "127.0.0.1" &&
      callback.port !== "" &&
      callback.pathname === "/callback" &&
      callback.search === "" &&
      callback.hash === "" &&
      callback.username === "" &&
      callback.password === ""
    );
  } catch {
    return false;
  }
}

export function CliAuthClient({ callbackUrl, state }: Props) {
  const valid = validHandoff(callbackUrl, state);
  const [status, setStatus] = useState<"idle" | "signing-in" | "complete" | "error">(
    "idle",
  );

  async function signIn() {
    if (!valid || !callbackUrl || !state) return;
    setStatus("signing-in");
    try {
      const idToken = await getGoogleIdTokenForCli();
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id_token: idToken, state }),
      });
      if (!response.ok) throw new Error("The CLI rejected the sign-in response.");
      setStatus("complete");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-labelledby="cli-auth-title">
        <p className={styles.eyebrow}>OpenJob CLI</p>
        <h1 id="cli-auth-title">Sign in from your browser</h1>
        <p className={styles.copy}>
          Continue with Google, then return to the terminal that opened this page.
        </p>

        {!valid ? (
          <p role="alert" className={styles.error}>
            This CLI sign-in link is invalid. Return to your terminal and try again.
          </p>
        ) : status === "complete" ? (
          <p role="status" className={styles.success}>
            Return to OpenJob in your terminal.
          </p>
        ) : (
          <>
            <button
              type="button"
              className={styles.button}
              disabled={status === "signing-in"}
              onClick={() => void signIn()}
            >
              {status === "signing-in" ? "Signing in…" : "Continue with Google"}
            </button>
            {status === "error" ? (
              <p role="alert" className={styles.error}>
                Sign-in could not be returned to the CLI. Return to your terminal and try again.
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
