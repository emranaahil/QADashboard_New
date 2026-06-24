"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { useExecutionStore } from "@/store/execution-store";
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

export function ExecutionDrawer() {
  const status = useExecutionStore((s) => s.status);
  const moduleId = useExecutionStore((s) => s.moduleId);
  const jobId = useExecutionStore((s) => s.jobId);
  const job = useExecutionStore((s) => s.job);
  const progress = useExecutionStore((s) => s.progress);
  const message = useExecutionStore((s) => s.message);
  const currentUrl = useExecutionStore((s) => s.currentUrl);
  const currentPage = useExecutionStore((s) => s.currentPage);
  const totalPages = useExecutionStore((s) => s.totalPages);
  const logsOpen = useExecutionStore((s) => s.logsOpen);
  const isCancelling = useExecutionStore((s) => s.isCancelling);
  const setLogsOpen = useExecutionStore((s) => s.setLogsOpen);
  const cancelJob = useExecutionStore((s) => s.cancelJob);
  const reset = useExecutionStore((s) => s.reset);

  if (status === "idle") return null;

  const isRunning = status === "running" || isCancelling;
  const showViewReport = canViewReport(job) && !!moduleId && !!jobId;
  const showViewLog = canViewLogs(status) && !!moduleId && !!jobId;

  return (
    <div
      className={cn(
        "fixed bottom-0 right-0 z-50 w-full border-t border-border bg-card sm:max-w-md sm:border-l",
        "transition-transform duration-150"
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={statusVariant[status]}>
            {isCancelling ? "Cancelling" : status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">{moduleId}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setLogsOpen(!logsOpen)}
            aria-label={logsOpen ? "Collapse logs" : "Expand logs"}
          >
            {logsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
          {!isRunning && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reset} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {logsOpen && (
        <div className="flex flex-col gap-3 px-4 py-3">
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
              <Button variant="cancel" size="sm" loading={isCancelling} disabled={isCancelling} onClick={cancelJob}>
                {isCancelling ? "Cancelling…" : "Cancel Test"}
              </Button>
            )}
            {showViewReport && <ViewReportButton moduleId={moduleId!} jobId={jobId!} size="sm" />}
            {showViewLog && (
              <ViewLogButton kind="job" moduleId={moduleId!} jobId={jobId!} size="sm" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}