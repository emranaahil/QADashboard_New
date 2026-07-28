"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { useExecutionStore, type ModuleJobSlice } from "@/store/execution-store";
import { useScanStore } from "@/store/scan-store";
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

/**
 * Link Radar / Keyword Radar run outside the job engine (scan-store).
 * They must still appear in the bottom running tray with View Log.
 */
function ScanDrawerPanel() {
  const moduleId = useScanStore((s) => s.moduleId);
  const status = useScanStore((s) => s.status);
  const progress = useScanStore((s) => s.progress);
  const message = useScanStore((s) => s.message);
  const currentUrl = useScanStore((s) => s.currentUrl);
  const urlsProcessed = useScanStore((s) => s.urlsProcessed);
  const errorCount = useScanStore((s) => s.errorCount);
  const matchesFound = useScanStore((s) => s.matchesFound);
  const isCancelling = useScanStore((s) => s.isCancelling);
  const scanId = useScanStore((s) => s.scanId);
  const cancelScan = useScanStore((s) => s.cancelScan);
  const reset = useScanStore((s) => s.reset);
  const [logsOpen, setLogsOpen] = useState(true);

  if (!moduleId || status === "idle") return null;

  const isRunning = status === "running" || isCancelling;
  const badgeStatus =
    status === "success"
      ? "success"
      : status === "failed" || status === "cancelled"
        ? "failed"
        : status === "running"
          ? "running"
          : "secondary";

  const showViewLog =
    moduleId === "error-check"
      ? true
      : moduleId === "keyword-check" && Boolean(scanId);

  return (
    <div className={cn("border-b border-border last:border-b-0", isParallelExecutionEnabled() && "px-1")}>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={statusVariant[status as keyof typeof statusVariant] || badgeStatus}>
            {isCancelling ? "Cancelling" : status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">{moduleLabel(moduleId)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setLogsOpen((o) => !o)}
            aria-label={logsOpen ? "Collapse logs" : "Expand logs"}
          >
            {logsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
          {!isRunning && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => reset()} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {logsOpen && (
        <div className="flex flex-col gap-3 px-4 pb-3">
          <Progress value={isRunning ? Math.max(progress, 2) : progress || 100} />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{isRunning ? `${progress}%` : status === "success" ? "100%" : status}</span>
            {moduleId === "error-check" ? (
              <span>
                {urlsProcessed} pages · {errorCount} errors
              </span>
            ) : (
              <span>
                {urlsProcessed} pages · {matchesFound} matches
              </span>
            )}
          </div>
          {currentUrl ? (
            <p className="truncate font-mono text-xs text-muted-foreground" title={currentUrl}>
              {currentUrl}
            </p>
          ) : null}
          {message ? (
            <p className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
              {message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {isRunning ? (
              <Button
                variant="cancel"
                size="sm"
                loading={isCancelling}
                disabled={isCancelling}
                onClick={() => void cancelScan()}
              >
                {isCancelling ? "Cancelling…" : "Stop"}
              </Button>
            ) : null}
            {showViewLog && moduleId === "error-check" ? (
              <ViewLogButton kind="error-check" size="sm" />
            ) : null}
            {showViewLog && moduleId === "keyword-check" && scanId ? (
              <ViewLogButton kind="scan" scanId={scanId} size="sm" />
            ) : null}
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

  const scanModuleId = useScanStore((s) => s.moduleId);
  const scanStatus = useScanStore((s) => s.status);
  const scanCancelling = useScanStore((s) => s.isCancelling);
  const scanVisible = Boolean(scanModuleId && scanStatus !== "idle");
  const scanRunning = scanStatus === "running" || scanCancelling;

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
        runningCount: runningEntries.length + (scanRunning ? 1 : 0),
      };
    }

    return {
      visibleEntries: Object.entries(moduleJobs).filter(([, slice]) => slice.status !== "idle"),
      runningCount: runningEntries.length + (scanRunning ? 1 : 0),
    };
  }, [moduleJobs, parallel, scanRunning]);

  if (!visibleEntries.length && !scanVisible) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 right-0 z-50 w-full border-t border-border bg-card sm:max-w-md sm:border-l",
        "transition-transform duration-150",
        parallel && runningCount > 1 && "sm:max-w-lg"
      )}
    >
      {parallel && runningCount > 1 ? (
        <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
          {runningCount} modules running locally
        </div>
      ) : null}

      {/* Link Radar / Keyword Radar (scan-store) — must show in tray */}
      <ScanDrawerPanel />

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
