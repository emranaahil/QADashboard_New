"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { useExecutionStore, type ModuleJobSlice } from "@/store/execution-store";
import { isParallelExecutionEnabled } from "@/lib/parallel-execution";
import { moduleLabel } from "@/lib/modules";
import { canViewLogs } from "@/lib/logs";
import { canViewReport } from "@/lib/report";
import { cn } from "@/lib/utils";

const statusVariant = {
  idle: "secondary",
  running: "running",
  success: "success",
  failed: "failed",
  cancelled: "failed",
} as const;

function DrawerPanel({
  moduleId,
  slice,
  onDismiss,
  onCancel,
  onToggleLogs,
}: {
  moduleId: string;
  slice: ModuleJobSlice;
  onDismiss: () => void;
  onCancel: () => void;
  onToggleLogs: () => void;
}) {
  const { status, jobId, job, progress, message, currentUrl, currentPage, totalPages, logsOpen, isCancelling } =
    slice;
  const isRunning = status === "running" || isCancelling;
  const showViewReport = canViewReport(job) && !!jobId;
  const showViewLog = canViewLogs(status) && !!jobId;

  return (
    <div className={cn("border-b border-border last:border-b-0", isParallelExecutionEnabled() && "px-1")}>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={statusVariant[status]}>
            {isCancelling ? "Cancelling" : status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">{moduleLabel(moduleId)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleLogs}
            aria-label={logsOpen ? "Collapse logs" : "Expand logs"}
          >
            {logsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
          {!isRunning && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDismiss} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {logsOpen && (
        <div className="flex flex-col gap-3 px-4 pb-3">
          <Progress value={progress} />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{progress}%</span>
            {totalPages > 0 && (
              <span>
                {currentPage} / {totalPages} pages
              </span>
            )}
          </div>
          {currentUrl && (
            <p className="truncate font-mono text-xs text-muted-foreground" title={currentUrl}>
              {currentUrl}
            </p>
          )}
          {message && (
            <p className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
              {message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {status === "running" && (
              <Button variant="cancel" size="sm" loading={isCancelling} disabled={isCancelling} onClick={onCancel}>
                {isCancelling ? "Cancelling…" : "Cancel Test"}
              </Button>
            )}
            {showViewReport && <ViewReportButton moduleId={moduleId} jobId={jobId!} size="sm" />}
            {showViewLog && <ViewLogButton kind="job" moduleId={moduleId} jobId={jobId!} size="sm" />}
          </div>
        </div>
      )}
    </div>
  );
}

export function ExecutionDrawer() {
  const moduleJobs = useExecutionStore((s) => s.moduleJobs);
  const setLogsOpen = useExecutionStore((s) => s.setLogsOpen);
  const setDrawerModule = useExecutionStore((s) => s.setDrawerModule);
  const cancelJob = useExecutionStore((s) => s.cancelJob);
  const reset = useExecutionStore((s) => s.reset);

  const parallel = isParallelExecutionEnabled();

  const { visibleEntries, runningCount } = useMemo(() => {
    const runningEntries = Object.entries(moduleJobs).filter(
      ([, slice]) => slice.status === "running" || slice.isCancelling
    );

    if (parallel) {
      const runningIds = new Set(runningEntries.map(([id]) => id));
      const finishedEntries = Object.entries(moduleJobs).filter(
        ([moduleId, slice]) =>
          slice.status !== "idle" &&
          slice.status !== "running" &&
          !slice.isCancelling &&
          !runningIds.has(moduleId)
      );
      return {
        visibleEntries: [...runningEntries, ...finishedEntries],
        runningCount: runningEntries.length,
      };
    }

    return {
      visibleEntries: Object.entries(moduleJobs).filter(([, slice]) => slice.status !== "idle"),
      runningCount: runningEntries.length,
    };
  }, [moduleJobs, parallel]);

  if (!visibleEntries.length) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 right-0 z-50 w-full border-t border-border bg-card sm:max-w-md sm:border-l",
        "transition-transform duration-150",
        parallel && visibleEntries.length > 1 && "sm:max-w-lg"
      )}
    >
      {parallel && runningCount > 1 ? (
        <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
          {runningCount} modules running locally
        </div>
      ) : null}

      {visibleEntries.map(([moduleId, slice]) => (
        <DrawerPanel
          key={moduleId}
          moduleId={moduleId}
          slice={slice}
          onDismiss={() => reset(moduleId)}
          onCancel={() => cancelJob(moduleId)}
          onToggleLogs={() => {
            setDrawerModule(moduleId);
            setLogsOpen(!slice.logsOpen, moduleId);
          }}
        />
      ))}
    </div>
  );
}