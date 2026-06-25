"use client";

import { useEffect } from "react";
import { useScanStore } from "@/store/scan-store";

/** Re-attach to in-flight keyword/link scans after client navigation. */
export function ScanResumeBootstrap() {
  const resumeActive = useScanStore((s) => s.resumeActive);

  useEffect(() => {
    resumeActive();
  }, [resumeActive]);

  return null;
}