"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { useJobRunner } from "@/hooks/use-job-runner";
import type { Job } from "@/lib/api";
import { fallbackSeoSummary, loadSeoTestSummary, type SeoTestSummary } from "@/lib/seo-testing-summary";
import { canViewReport } from "@/lib/report";
import { normalizeUrl, validateUrl } from "@/lib/url-validation";
import { toast } from "sonner";

type Mode = "single" | "full";

type Props = {
  mode: Mode;
  onHistoryRefresh: () => void;
  historyJob: Job | null;
  onHistoryJobClear: () => void;
};

function StatCard({ value, label, highlight }: { value: number | string; label: string; highlight?: boolean }) {
  return (
    <div className="hover-lift flex h-24 flex-col items-center justify-center rounded-[14px] border border-border bg-background-elevated px-3 text-center">
      <div className={`text-xl font-bold leading-tight ${highlight ? "text-amber-400" : ""}`}>{value}</div>
      <div className="mt-1 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

const UI_CHECK_CARD =
  "ui-check-card w-full min-h-[320px] rounded-[20px] border-border p-8";

const MODULE_ID = "seo";

export function SeoTestingWorkspace({
  mode,
  onHistoryRefresh,
  historyJob,
  onHistoryJobClear,
}: Props) {
  const [url, setUrl] = useState("https://example.com");
  const [summary, setSummary] = useState<SeoTestSummary | null>(null);

  const runner = useJobRunner({
    moduleId: MODULE_ID,
    successMessage: "SEO Test completed successfully",
    source: "seo_test",
    onComplete: onHistoryRefresh,
  });

  const activeJob = runner.isActive ? runner.job : historyJob;

  const workflow = useMemo(() => {
    if (runner.running || runner.isCancelling) return "running";
    if (runner.isActive && (runner.status === "completed" || runner.status === "failed")) return "complete";
    if (historyJob && !runner.running) return "complete";
    return "idle";
  }, [runner.running, runner.isCancelling, runner.isActive, runner.status, historyJob]);

  const displayStatus = runner.isActive ? runner.status : historyJob?.status;

  const loadSummary = useCallback(async (job: Job) => {
    const base = fallbackSeoSummary({
      totalPages: job.totalPages,
      completed: job.status === "completed",
    });
    if (job.status === "completed" && job.reportAvailable && job.id) {
      const loaded = await loadSeoTestSummary(job.id, base);
      setSummary(loaded);
    } else {
      setSummary(base);
    }
  }, []);

  useEffect(() => {
    if (historyJob?.url) setUrl(historyJob.url);
  }, [historyJob]);

  useEffect(() => {
    if (workflow === "complete" && activeJob) {
      loadSummary(activeJob);
    } else if (workflow !== "complete") {
      setSummary(null);
    }
  }, [workflow, activeJob, loadSummary]);

  const handleRun = () => {
    const validationError = validateUrl(url);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    onHistoryJobClear();
    setSummary(null);
    runner.start(normalizeUrl(url), { mode });
  };

  const pagesLabel =
    runner.totalPages > 0
      ? `${runner.currentPage} / ${runner.totalPages} Pages`
      : runner.running
        ? `${runner.progress}%`
        : "—";

  const showViewReport = canViewReport(activeJob) && !!activeJob?.id;

  return (
    <div className="ui-check-container flex w-full flex-col gap-6">
      <Card className={UI_CHECK_CARD}>
        <h2 className="text-lg font-bold leading-tight">SEO Check</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Analyze SEO performance for a URL
        </p>

        <label className="mb-2 mt-4 block text-xs font-semibold text-muted-foreground">URL</label>
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          disabled={runner.running || runner.isCancelling}
          className="mb-0 h-11 w-full rounded-lg text-sm"
        />

        <div className="run-test-actions mt-6 flex flex-wrap gap-3">
          <Button
            className="run-test-btn h-11 min-w-[140px] flex-1 rounded-lg px-4 sm:flex-none"
            loading={runner.running && !runner.isCancelling}
            disabled={runner.running || runner.isCancelling}
            onClick={handleRun}
          >
            {runner.running ? "Running…" : "Run SEO Test"}
          </Button>
          {(runner.running || runner.isCancelling) && (
            <Button
              variant="cancel"
              className="h-11 min-w-[140px] flex-1 rounded-lg px-4 sm:flex-none"
              loading={runner.isCancelling}
              disabled={runner.isCancelling}
              onClick={runner.cancel}
            >
              {runner.isCancelling ? "Cancelling…" : "Cancel Test"}
            </Button>
          )}
        </div>
      </Card>

      {workflow === "running" && (
        <Card className={`${UI_CHECK_CARD} min-h-0`} aria-live="polite">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold leading-tight">Execution</h3>
            <Badge variant={statusBadgeVariant("running")} className="shrink-0 uppercase">
              running
            </Badge>
          </div>
          <Progress value={runner.progress} className="mb-2 h-2 rounded-full" />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{runner.progress}%</span>
            <span>{pagesLabel}</span>
          </div>
          {runner.message && (
            <p className="mt-3 break-words text-sm text-muted-foreground">{runner.message}</p>
          )}
        </Card>
      )}

      {workflow === "complete" && activeJob && summary && (
        <Card className={`${UI_CHECK_CARD} min-h-0`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold leading-tight">Results Summary</h3>
            {displayStatus && (
              <Badge variant={statusBadgeVariant(displayStatus)} className="shrink-0 uppercase">
                {displayStatus}
              </Badge>
            )}
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard value={summary.pages} label="Pages Scanned" />
            <StatCard
              value={summary.criticalIssues}
              label="Critical Issues"
              highlight={summary.criticalIssues > 0}
            />
            <StatCard
              value={summary.averageScore > 0 ? summary.averageScore : "—"}
              label="Avg SEO Score"
            />
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            Duration:{" "}
            <strong className="text-foreground">
              {activeJob.durationMs ? `${Math.round(activeJob.durationMs / 1000)}s` : "—"}
            </strong>
          </p>

          {activeJob.error && (
            <p className="mb-4 text-sm text-destructive">{activeJob.error}</p>
          )}

          <div className="flex flex-wrap gap-3">
            {showViewReport && (
              <ViewReportButton moduleId={MODULE_ID} jobId={activeJob.id} className="h-11 rounded-lg" />
            )}
            <Button variant="secondary" className="h-11 rounded-lg px-4" onClick={handleRun}>
              Re-run Test
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}