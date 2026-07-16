"use client";

import { useMemo } from "react";
import { createFirebaseAuth } from "./firebase-auth";
import { OpenJobApp } from "./openjob-app";
import { createOpenJobApi } from "./openjob-api";

export function OpenJobPage({ inviteToken }: { inviteToken?: string }) {
  const auth = useMemo(() => createFirebaseAuth(), []);
  const api = useMemo(() => createOpenJobApi(), []);
  return <OpenJobApp auth={auth} api={api} inviteToken={inviteToken} />;
}

export default function Home() {
  return <OpenJobPage />;
}
