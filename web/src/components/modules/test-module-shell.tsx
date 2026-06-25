"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { useGlobalWorkBusy } from "@/hooks/use-global-work-busy";
import { canViewLogs } from "@/lib/logs";
import { canViewReport } from "@/lib/report";
import type { Job } from "@/lib/api";

type TestModuleShellProps = {
  title: string;
  url: string;
  onUrlChange: (v: string) => void;
  running: boolean;
  onRun: () => void;
  onCancel: () => void;
  progress: number;
  currentPage: number;
  totalPages: number;
  status?: string;
  message?: string;
  job?: Job | null;
  moduleId?: string;
  children?: React.ReactNode;
  runLabel?: string;
  showExecution?: boolean;
  isCancelling?: boolean;
};

export function TestModuleShell({
  title,
  url,
  onUrlChange,
  running,
  onRun,
  onCancel,
  progress,
  currentPage,
  totalPages,
  status,
  message,
  job,
  moduleId,
  children,
  runLabel = "Run Test",
  showExecution = false,
  isCancelling = false,
}: TestModuleShellProps) {
  const globalBusy = useGlobalWorkBusy();
  const formLocked = globalBusy || running || isCancelling;
  const showViewReport = canViewReport(job) && !!moduleId && !!job?.id;
  const showViewLog = canViewLogs(status) && !!moduleId && !!job?.id;
  const showRerun =
    !running &&
    !isCancelling &&
    (status === "completed" || status === "failed" || status === "cancelled");

  return (
    <div className="mx-auto max-w-4xl flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {children}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">URL</label>
            <Input
              type="url"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://example.com"
              disabled={formLocked}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button loading={running && !isCancelling} disabled={formLocked} onClick={onRun}>
              {running ? "Running…" : runLabel}
            </Button>
            {(running || isCancelling) && (
              <Button variant="cancel" loading={isCancelling} disabled={isCancelling} onClick={onCancel}>
                {isCancelling ? "Cancelling…" : "Cancel Test"}
              </Button>
            )}
            {showViewReport && <ViewReportButton moduleId={moduleId!} jobId={job!.id} />}
            {showViewLog && <ViewLogButton kind="job" moduleId={moduleId!} jobId={job!.id} />}
            {showRerun && (
              <Button variant="secondary" disabled={globalBusy} onClick={onRun}>
                Re-run Test
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {showExecution && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm">Execution</CardTitle>
            {status && <Badge variant={statusBadgeVariant(status)}>{status}</Badge>}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Progress value={progress} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{progress}%</span>
              {totalPages > 0 && (
                <span>
                  {currentPage} / {totalPages} Pages
                </span>
              )}
            </div>
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
            {showViewReport && <ViewReportButton moduleId={moduleId!} jobId={job!.id} size="sm" />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}