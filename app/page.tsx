"use client";

import { useEffect, useMemo, useState } from "react";
import { createFirebaseAuth } from "./firebase-auth";
import { OpenJobApp } from "./openjob-app";
import { createOpenJobApi } from "./openjob-api";
import {
  ACCOUNT_DELETION_STATUS_RECEIPT_KEY,
  loadAccountDeletionStatusReceipt,
} from "./openjob-private-state";
import { LoadingScreen } from "./openjob-screens";

function ReadyOpenJobPage({ inviteToken }: { inviteToken?: string }) {
  const auth = useMemo(() => createFirebaseAuth(), []);
  const api = useMemo(() => createOpenJobApi(), []);
  return <OpenJobApp auth={auth} api={api} inviteToken={inviteToken} />;
}

export function OpenJobPage({ inviteToken }: { inviteToken?: string }) {
  const [receiptChecked, setReceiptChecked] = useState(false);

  useEffect(() => {
    let active = true;
    const redirectToDeletionStatus = () => {
      window.location.replace("/account-deletion");
    };
    const handleStorage = (event: StorageEvent) => {
      if (
        event.storageArea === window.localStorage &&
        event.key === ACCOUNT_DELETION_STATUS_RECEIPT_KEY &&
        event.newValue !== null
      ) {
        redirectToDeletionStatus();
      }
    };
    window.addEventListener("storage", handleStorage);
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      try {
        if (loadAccountDeletionStatusReceipt()) {
          redirectToDeletionStatus();
          return;
        }
      } catch {
        redirectToDeletionStatus();
        return;
      }
      setReceiptChecked(true);
    })();
    return () => {
      active = false;
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  if (!receiptChecked) return <LoadingScreen />;
  return <ReadyOpenJobPage inviteToken={inviteToken} />;
}

export default function Home() {
  return <OpenJobPage />;
}
