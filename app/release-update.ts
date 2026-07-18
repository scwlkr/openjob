"use client";

import { useCallback, useEffect, useState } from "react";
import { isNewerStableRelease } from "../lib/semver.ts";
import { OPENJOB_VERSION } from "./release";

export function useReleaseUpdate() {
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

  const check = useCallback(async () => {
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
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", checkVisibleRelease);
    return () => {
      window.clearTimeout(initialCheck);
      document.removeEventListener("visibilitychange", checkVisibleRelease);
    };
  }, [check]);

  return availableVersion;
}
