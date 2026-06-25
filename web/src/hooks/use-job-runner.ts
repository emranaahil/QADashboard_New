"use client";

import { useCallback, useEffect, useRef } from "react";
import { useExecutionStore, type ExecSource, type ExecStatus } from "@/store/execution-store";

type UseJobRunnerOptions = {
  moduleId: string;
  successMessage: string;
  source?: ExecSource;
  onComplete?: () => void;
};

export function useJobRunner({
  moduleId,
  successMessage,
  source = "ui_test",
  onComplete,
}: UseJobRunnerOptions) {
  const storeModuleId = useExecutionStore((s) => s.moduleId);
  const status = useExecutionStore((s) => s.status);
  const job = useExecutionStore((s) => s.job);
  const currentPage = useExecutionStore((s) => s.currentPage);
  const totalPages = useExecutionStore((s) => s.totalPages);
  const progress = useExecutionStore((s) => s.progress);
  const message = useExecutionStore((s) => s.message);
  const isCancelling = useExecutionStore((s) => s.isCancelling);
  const startJob = useExecutionStore((s) => s.startJob);
  const cancelJob = useExecutionStore((s) => s.cancelJob);

  const isActive = storeModuleId === moduleId;
  const running = isActive && (status === "running" || isCancelling);
  const globalRunning = status === "running" || isCancelling;

  const prevStatusRef = useRef<ExecStatus>("idle");

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (
      isActive &&
      prev === "running" &&
      (status === "success" || status === "failed" || status === "cancelled")
    ) {
      onComplete?.();
    }
  }, [status, isActive, onComplete]);

  const start = useCallback(
    async (url: string, options?: Record<string, unknown>) => {
      await startJob({ moduleId, url, options, source, successMessage });
    },
    [moduleId, source, successMessage, startJob]
  );

  const cancel = useCallback(async () => {
    if (isActive) await cancelJob();
  }, [isActive, cancelJob]);

  const activeJob = isActive ? job : null;

  return {
    job: activeJob,
    running,
    globalRunning,
    isActive,
    isCancelling: isActive && isCancelling,
    start,
    cancel,
    currentPage: isActive ? currentPage : 0,
    totalPages: isActive ? totalPages : 0,
    progress: isActive ? progress : 0,
    message: isActive ? message : undefined,
    status: isActive ? job?.status : undefined,
    reportAvailable: activeJob?.reportAvailable === true,
    canViewReport: activeJob?.status === "completed" && activeJob?.reportAvailable === true,
  };
}