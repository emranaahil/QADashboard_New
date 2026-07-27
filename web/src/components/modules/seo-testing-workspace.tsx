"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RunModuleButton } from "@/components/execution/run-module-button";
import { RunTestActionsPanel } from "@/components/execution/run-test-actions-panel";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { StatusWithReport } from "@/components/execution/status-with-report";
import { canViewReport } from "@/lib/report";
import { useModuleWorkBusy } from "@/hooks/use-global-work-busy";
import { useJobRunner } from "@/hooks/use-job-runner";
import { api, type Job } from "@/lib/api";
import { fallbackSeoSummary, loadSeoTestSummary, type SeoTestSummary } from "@/lib/seo-testing-summary";
import {
  exportSeoIssuesDetailCsv,
  exportSeoPagesSummaryCsv,
  type SeoReportPayload,
} from "@/lib/seo-report-export";
import { canViewLogs } from "@/lib/logs";

import { MAX_URL_LENGTH } from "@/lib/url-validation";
import { parseUrlListInput, validateUrlListInput } from "@/lib/parse-url-list";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const URL_FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background-elevated px-3 text-sm transition-all duration-250 placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(15,143,111,0.2)] disabled:cursor-not-allowed disabled:opacity-50";

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

function AuditToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
  ariaLabel,
  compact,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[14px] border border-border bg-background-elevated",
        compact ? "px-3.5 py-2.5" : "px-4 py-3 gap-4"
      )}
    >
      <div className="min-w-0">
        <div className={cn("font-semibold text-foreground", compact ? "text-[0.8125rem]" : "text-sm")}>
          {title}
        </div>
        <div className={cn("text-muted-foreground", compact ? "mt-0.5 text-[0.7rem] leading-snug" : "mt-0.5 text-xs")}>
          {description}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative shrink-0 rounded-full border border-border transition-all duration-250",
          compact ? "h-7 w-[46px]" : "h-8 w-[52px]",
          checked
            ? "bg-[rgba(29,191,115,0.2)] border-[rgba(29,191,115,0.35)]"
            : "bg-[rgba(7,26,18,0.45)]",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <span
          className={cn(
            "absolute rounded-full bg-foreground shadow-sm transition-all duration-250",
            compact ? "top-0.5 h-5 w-5" : "top-1 h-6 w-6",
            checked
              ? compact
                ? "left-[calc(100%-1.35rem)] bg-[#1dbf73]"
                : "left-[calc(100%-1.75rem)] bg-[#1dbf73]"
              : "left-1 bg-muted-foreground"
          )}
        />
      </button>
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
  const [url, setUrl] = useState("");
  const [includeSeo, setIncludeSeo] = useState(true);
  const [includeGeo, setIncludeGeo] = useState(true);
  const [includeSecurityHeaders, setIncludeSecurityHeaders] = useState(true);
  const [includePageSpeed, setIncludePageSpeed] = useState(false);
  const [includeRichResults, setIncludeRichResults] = useState(false);
  const [summary, setSummary] = useState<SeoTestSummary | null>(null);
  const [reportData, setReportData] = useState<SeoReportPayload | null>(null);
  const moduleBusy = useModuleWorkBusy("seo");

  const runner = useJobRunner({
    moduleId: MODULE_ID,
    successMessage: "Seo/Geo Audit completed successfully",
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
      try {
        const report = await api.getReport(MODULE_ID, `job:${job.id}`);
        setReportData((report.data as SeoReportPayload) || null);
      } catch {
        setReportData(null);
      }
    } else {
      setSummary(base);
      setReportData(null);
    }
  }, []);

  useEffect(() => {
    if (historyJob?.url) setUrl(historyJob.url);
    const opts = historyJob?.options;
    if (!opts) return;
    if (typeof opts.includeSeo === "boolean") setIncludeSeo(opts.includeSeo);
    if (typeof opts.includeGeo === "boolean") setIncludeGeo(opts.includeGeo);
    if (typeof opts.includeSecurityHeaders === "boolean") {
      setIncludeSecurityHeaders(opts.includeSecurityHeaders);
    }
    if (opts.includePageSpeed === true) setIncludePageSpeed(true);
    if (opts.includeRichResults === true) setIncludeRichResults(true);
  }, [historyJob]);

  useEffect(() => {
    if (workflow === "complete" && activeJob) {
      loadSummary(activeJob);
    } else if (workflow !== "complete") {
      setSummary(null);
    }
  }, [workflow, activeJob, loadSummary]);

  const handleRun = () => {
    const validationError = validateUrlListInput(url);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (!includeSeo && !includeGeo && !includeSecurityHeaders && !includePageSpeed && !includeRichResults) {
      toast.error("Enable at least one check: SEO, GEO, Security Headers, PageSpeed, or Rich Results.");
      return;
    }

    let startUrl = url.trim();
    const runOptions: Record<string, unknown> = {
      mode,
      includeSeo,
      includeGeo,
      includeSecurityHeaders,
      includePageSpeed,
      includeRichResults,
    };

    if (includePageSpeed) {
      toast.info("Google PageSpeed enabled — mobile + desktop per page (slower runs).", { duration: 5000 });
    }
    if (includeRichResults) {
      toast.info(
        "Google Rich Results enabled — captures a screenshot of Google's tool for the main URL (slower).",
        { duration: 5000 }
      );
    }

    if (mode === "single") {
      const parsed = parseUrlListInput(url);
      startUrl = parsed.primaryUrl;
      if (parsed.urls.length > 1) {
        runOptions.urls = parsed.urls;
      }
    }

    onHistoryJobClear();
    setSummary(null);
    setReportData(null);
    runner.start(startUrl, runOptions);
  };

  const handleExportIssuesCsv = () => {
    if (!reportData?.pages?.length) {
      toast.error("No report data to export");
      return;
    }
    const ok = exportSeoIssuesDetailCsv(reportData, "seo-report");
    if (!ok) toast.error("No issues to export");
    else toast.success("Issues CSV downloaded");
  };

  const handleExportPagesCsv = () => {
    if (!reportData?.pages?.length) {
      toast.error("No report data to export");
      return;
    }
    const ok = exportSeoPagesSummaryCsv(reportData, "seo-report");
    if (!ok) toast.error("No pages to export");
    else toast.success("Pages CSV downloaded");
  };

  const pagesLabel =
    runner.totalPages > 0
      ? mode === "single" && runner.totalPages > 1
        ? `URL ${runner.currentPage} / ${runner.totalPages}`
        : `${runner.currentPage} / ${runner.totalPages} Pages`
      : runner.running
        ? `${runner.progress}%`
        : "—";

  const showViewLog = canViewLogs(displayStatus) && !!activeJob?.id;
  const showViewReport =
    canViewReport({
      status: activeJob?.status ?? displayStatus,
      reportAvailable: activeJob?.reportAvailable,
    }) &&
    !!activeJob?.id;

  return (
    <div className="ui-check-container flex w-full flex-col gap-6">
      <Card className={UI_CHECK_CARD}>
        <h2 className="text-lg font-bold leading-tight">Seo/Geo Audit</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "single"
            ? "Enter one URL, or several separated by commas — all tested in one run with a single report."
            : "Crawls your site by following internal links (same as Keyword Radar), then runs SEO checks on every page found."}
        </p>

        <label className="mb-2 mt-4 block text-xs font-semibold text-muted-foreground">
          {mode === "single" ? "URL(s)" : "URL"}
        </label>
        {mode === "single" ? (
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com, example.com/about, example.com/contact"
            disabled={moduleBusy}
            rows={4}
            className={cn(URL_FIELD_CLASS, "min-h-[96px] resize-y py-2.5")}
          />
        ) : (
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            disabled={moduleBusy}
            maxLength={MAX_URL_LENGTH}
            className="mb-0 h-11 w-full rounded-lg text-sm"
          />
        )}

        <div className="mt-5 flex flex-col gap-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Core modules
              </span>
              <span className="text-[0.65rem] text-muted-foreground">Default on · toggle to focus</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <AuditToggleRow
                compact
                title="SEO"
                description="On-page titles, links, meta, hierarchy"
                checked={includeSeo}
                disabled={moduleBusy}
                onChange={setIncludeSeo}
                ariaLabel="Toggle SEO checks"
              />
              <AuditToggleRow
                compact
                title="GEO"
                description="Schema, semantics, AI readiness"
                checked={includeGeo}
                disabled={moduleBusy}
                onChange={setIncludeGeo}
                ariaLabel="Toggle GEO checks"
              />
              <AuditToggleRow
                compact
                title="Security headers"
                description="HTTP response security headers"
                checked={includeSecurityHeaders}
                disabled={moduleBusy}
                onChange={setIncludeSecurityHeaders}
                ariaLabel="Toggle security header checks"
              />
            </div>
          </div>

          <div>
            <div className="mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Optional checks
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <AuditToggleRow
                compact
                title="Google PageSpeed"
                description="Mobile + desktop Lighthouse (slower)"
                checked={includePageSpeed}
                disabled={moduleBusy}
                onChange={setIncludePageSpeed}
                ariaLabel="Toggle Google PageSpeed checks"
              />
              <AuditToggleRow
                compact
                title="Google Rich Results"
                description="Screenshot of Google's tool (main URL)"
                checked={includeRichResults}
                disabled={moduleBusy}
                onChange={setIncludeRichResults}
                ariaLabel="Toggle Google Rich Results Test"
              />
            </div>
          </div>
        </div>

        <RunTestActionsPanel>
          <RunModuleButton
            kind="seo-test"
            busyModuleId="seo"
            label="Run Seo/Geo Audit"
            loadingLabel="Running…"
            loading={runner.running && !runner.isCancelling}
            disabled={runner.isCancelling}
            onClick={handleRun}
          />
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
        </RunTestActionsPanel>
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
          {showViewLog && activeJob?.id && (
            <div className="mt-4">
              <ViewLogButton
                kind="job"
                moduleId={MODULE_ID}
                jobId={activeJob.id}
                size="sm"
                className="h-10 rounded-lg"
              />
            </div>
          )}
        </Card>
      )}

      {workflow === "complete" && activeJob && summary && (
        <Card className={`${UI_CHECK_CARD} min-h-0`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold leading-tight">Results Summary</h3>
            {displayStatus ? (
              <StatusWithReport
                status={displayStatus}
                moduleId={MODULE_ID}
                jobId={activeJob.id}
                reportAvailable={activeJob.reportAvailable}
              />
            ) : null}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard value={summary.pages} label="Pages Scanned" />
            <StatCard
              value={summary.criticalIssues}
              label="Critical Issues"
              highlight={summary.criticalIssues > 0}
            />
            <StatCard
              value={summary.minorIssues}
              label="Minor Issues"
              highlight={summary.minorIssues > 0}
            />
            <StatCard
              value={summary.hiddenIssues}
              label="Hidden Issues"
              highlight={summary.hiddenIssues > 0}
            />
            <StatCard
              value={summary.averageScore > 0 ? Math.round(summary.averageScore) : "—"}
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
            {showViewReport && reportData?.pages?.length ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 rounded-lg px-4"
                  onClick={handleExportPagesCsv}
                >
                  Export CSV · Pages
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 rounded-lg px-4"
                  onClick={handleExportIssuesCsv}
                >
                  Export CSV · Issues
                </Button>
              </>
            ) : null}
            {showViewLog && (
              <ViewLogButton kind="job" moduleId={MODULE_ID} jobId={activeJob.id} className="h-11 rounded-lg" />
            )}
            <Button
              variant="secondary"
              className="h-11 rounded-lg px-4"
              disabled={moduleBusy}
              onClick={handleRun}
            >
              Re-run Test
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
