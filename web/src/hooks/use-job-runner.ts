"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  useExecutionStore,
  useModuleJob,
  type ExecSource,
  type ExecStatus,
} from "@/store/execution-store";

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
  const moduleState = useModuleJob(moduleId);
  const status = moduleState.status;
  const job = moduleState.job;
  const currentPage = moduleState.currentPage;
  const totalPages = moduleState.totalPages;
  const progress = moduleState.progress;
  const message = moduleState.message;
  const isCancelling = moduleState.isCancelling;
  const startJob = useExecutionStore((s) => s.startJob);
  const cancelJob = useExecutionStore((s) => s.cancelJob);
  const setDrawerModule = useExecutionStore((s) => s.setDrawerModule);

  const isActive = status !== "idle";
  const running = status === "running" || isCancelling;
  const globalRunning = useExecutionStore((s) =>
    Object.values(s.moduleJobs).some((slice) => slice.status === "running" || slice.isCancelling)
  );

  const prevStatusRef = useRef<ExecStatus>("idle");

  useEffect(() => {
    if (running) {
      setDrawerModule(moduleId);
    }
  }, [running, moduleId, setDrawerModule]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (isActive && prev === "running" && (status === "success" || status === "failed" || status === "cancelled")) {
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
    await cancelJob(moduleId);
  }, [moduleId, cancelJob]);

  const activeJob = isActive ? job : null;

  return {
    job: activeJob,
    running,
    globalRunning,
    isActive,
    isCancelling,
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