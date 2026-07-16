"use client";

import { useMemo } from "react";
import { createFirebaseAuth } from "./firebase-auth";
import { OpenJobApp } from "./openjob-app";
import { createOpenJobApi } from "./openjob-api";

export default function Home() {
  const auth = useMemo(() => createFirebaseAuth(), []);
  const api = useMemo(() => createOpenJobApi(), []);
  return <OpenJobApp auth={auth} api={api} />;
}
