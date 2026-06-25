"use client";

import { useEffect } from "react";
import { useExecutionStore } from "@/store/execution-store";

/** Re-attach to in-flight QA jobs after client navigation or page reload. */
export function JobResumeBootstrap() {
  const resumeActive = useExecutionStore((s) => s.resumeActive);

  useEffect(() => {
    resumeActive();
  }, [resumeActive]);

  return null;
}