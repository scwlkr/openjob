"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isNewerStableRelease } from "../lib/semver.ts";
import { OPENJOB_VERSION } from "./release";

const RELEASE_RECHECK_INTERVAL_MS = 15 * 60 * 1000;

export function useReleaseUpdate() {
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const lastCheckedAt = useRef(0);

  const check = useCallback(async () => {
    lastCheckedAt.current = Date.now();
    try {
      const response = await fetch("/api/version", { cache: "no-store" });
      if (!response.ok) return;
      const metadata: unknown = await response.json();
      if (
        metadata &&
        typeof metadata === "object" &&
        "version" in metadata &&
        typeof metadata.version === "string"
      ) {
        setAvailableVersion(
          isNewerStableRelease(metadata.version, OPENJOB_VERSION)
            ? metadata.version
            : null,
        );
      }
    } catch {
      // Release discovery must never interrupt Task work.
    }
  }, []);

  useEffect(() => {
    const initialCheck = window.setTimeout(() => void check(), 0);
    const checkVisibleRelease = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastCheckedAt.current >= RELEASE_RECHECK_INTERVAL_MS
      ) {
        void check();
      }
    };
    document.addEventListener("visibilitychange", checkVisibleRelease);
    return () => {
      window.clearTimeout(initialCheck);
      document.removeEventListener("visibilitychange", checkVisibleRelease);
    };
  }, [check]);

  return availableVersion;
}
