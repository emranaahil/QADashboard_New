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
import {
  fallbackSecuritySummary,
  loadSecurityAuditSummary,
  type SecurityAuditSummary,
} from "@/lib/security-audit-summary";
import { canViewLogs } from "@/lib/logs";
import { MAX_URL_LENGTH } from "@/lib/url-validation";
import { parseUrlListInput, validateUrlListInput } from "@/lib/parse-url-list";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const URL_FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background-elevated px-3 text-sm transition-all duration-250 placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(15,143,111,0.2)] disabled:cursor-not-allowed disabled:opacity-50";

type Mode = "single" | "full";

type CheckOptions = {
  includePageSpeed: boolean;
  includeW3cValidator: boolean;
  includeRobotsTxt: boolean;
  includeRedirectTrace: boolean;
  includeSslLabs: boolean;
};

const DEFAULT_CHECKS: CheckOptions = {
  includePageSpeed: false,
  includeW3cValidator: false,
  includeRobotsTxt: false,
  includeRedirectTrace: false,
  includeSslLabs: false,
};

const ALL_CHECKS: CheckOptions = {
  includePageSpeed: true,
  includeW3cValidator: true,
  includeRobotsTxt: true,
  includeRedirectTrace: true,
  includeSslLabs: true,
};

type SslLabsHostResult = {
  host: string;
  grade?: string | null;
  status?: string;
  error?: string | null;
  weakGrade?: boolean;
  hasWarnings?: boolean;
  endpointCount?: number;
  reportUrl?: string;
  endpoints?: Array<{
    ipAddress?: string | null;
    grade?: string | null;
    protocols?: string | null;
    hsts?: string | null;
  }>;
};

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
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[14px] border border-border bg-background-elevated px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-8 w-[52px] shrink-0 rounded-full border border-border transition-all duration-250",
          checked
            ? "bg-[rgba(29,191,115,0.2)] border-[rgba(29,191,115,0.35)]"
            : "bg-[rgba(7,26,18,0.45)]"
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-6 w-6 rounded-full bg-foreground shadow-sm transition-all duration-250",
            checked ? "left-[calc(100%-1.75rem)] bg-[#1dbf73]" : "left-1 bg-muted-foreground"
          )}
        />
      </button>
    </div>
  );
}

const UI_CHECK_CARD =
  "ui-check-card w-full min-h-[320px] rounded-[20px] border-border p-8";

const MODULE_ID = "security-audit";

type W3cIssueRow = {
  pageUrl: string;
  type: "error" | "warning";
  message: string;
  line: number | null;
  column: number | null;
  extract: string | null;
};

type SecurityAuditReportPage = {
  url: string;
  w3c?: {
    errors?: number;
    warnings?: number;
    issues?: {
      errors?: Array<Omit<W3cIssueRow, "pageUrl" | "type">>;
      warnings?: Array<Omit<W3cIssueRow, "pageUrl" | "type">>;
      truncated?: boolean;
    };
  };
};

function collectW3cIssueRows(pages: SecurityAuditReportPage[]): {
  errors: W3cIssueRow[];
  warnings: W3cIssueRow[];
  truncated: boolean;
} {
  const errors: W3cIssueRow[] = [];
  const warnings: W3cIssueRow[] = [];
  let truncated = false;

  for (const page of pages) {
    const w3c = page.w3c;
    if (!w3c?.issues) continue;
    if (w3c.issues.truncated) truncated = true;
    const pageUrl = page.url || "—";
    for (const issue of w3c.issues.errors || []) {
      errors.push({ pageUrl, type: "error", ...issue });
    }
    for (const issue of w3c.issues.warnings || []) {
      warnings.push({ pageUrl, type: "warning", ...issue });
    }
  }

  return { errors, warnings, truncated };
}

function W3cIssuesTable({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: W3cIssueRow[];
  tone: "error" | "warning";
}) {
  if (!issues.length) {
    return (
      <div className="rounded-[14px] border border-border bg-background-elevated px-4 py-3 text-sm text-muted-foreground">
        {title}: none
      </div>
    );
  }

  const rowBg =
    tone === "error" ? "bg-[rgba(239,68,68,0.06)]" : "bg-[rgba(245,158,11,0.06)]";

  return (
    <div className="rounded-[14px] border border-border bg-background-elevated p-4">
      <h4 className="mb-3 text-sm font-semibold text-foreground">
        {title} <span className="text-muted-foreground">({issues.length})</span>
      </h4>
      <div className="table-scroll max-h-[360px] overflow-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Page</th>
              <th className="px-2 py-2">Line</th>
              <th className="px-2 py-2">Col</th>
              <th className="px-2 py-2">Message</th>
              <th className="px-2 py-2">Extract</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, idx) => (
              <tr key={`${issue.pageUrl}-${idx}-${issue.message}`} className={cn("border-b border-border/60", rowBg)}>
                <td className="px-2 py-2 align-top text-muted-foreground">{idx + 1}</td>
                <td className="max-w-[180px] break-all px-2 py-2 align-top">
                  <a href={issue.pageUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {issue.pageUrl}
                  </a>
                </td>
                <td className="px-2 py-2 align-top">{issue.line ?? "—"}</td>
                <td className="px-2 py-2 align-top">{issue.column ?? "—"}</td>
                <td className="min-w-[200px] px-2 py-2 align-top">{issue.message}</td>
                <td className="max-w-[220px] break-all px-2 py-2 align-top font-mono text-[0.68rem] text-muted-foreground">
                  {issue.extract || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function anyCheckEnabled(checks: CheckOptions) {
  return (
    checks.includePageSpeed ||
    checks.includeW3cValidator ||
    checks.includeRobotsTxt ||
    checks.includeRedirectTrace ||
    checks.includeSslLabs
  );
}

function SslLabsResultsTable({ hosts }: { hosts: Record<string, SslLabsHostResult> }) {
  const entries = Object.values(hosts);
  if (!entries.length) {
    return (
      <div className="rounded-[14px] border border-border bg-background-elevated px-4 py-3 text-sm text-muted-foreground">
        No SSL Labs results
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-border bg-background-elevated p-4">
      <div className="table-scroll max-h-[320px] overflow-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2">Hostname</th>
              <th className="px-2 py-2">Grade</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Endpoints</th>
              <th className="px-2 py-2">Report</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((ssl) => (
              <tr key={ssl.host} className="border-b border-border/60">
                <td className="px-2 py-2 align-top">{ssl.host}</td>
                <td className={`px-2 py-2 align-top font-bold ${ssl.weakGrade || ssl.error ? "text-amber-400" : "text-[#1dbf73]"}`}>
                  {ssl.grade || (ssl.error ? "—" : "—")}
                </td>
                <td className="px-2 py-2 align-top text-muted-foreground">
                  {ssl.error || ssl.status || "—"}
                </td>
                <td className="px-2 py-2 align-top">{ssl.endpointCount ?? ssl.endpoints?.length ?? 0}</td>
                <td className="px-2 py-2 align-top">
                  {ssl.reportUrl ? (
                    <a href={ssl.reportUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      SSL Labs
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SecurityAuditWorkspace({
  mode,
  onHistoryRefresh,
  historyJob,
  onHistoryJobClear,
}: Props) {
  const [url, setUrl] = useState("");
  const [checks, setChecks] = useState<CheckOptions>(DEFAULT_CHECKS);
  const [summary, setSummary] = useState<SecurityAuditSummary | null>(null);
  const [reportPages, setReportPages] = useState<SecurityAuditReportPage[]>([]);
  const [sslLabsByHost, setSslLabsByHost] = useState<Record<string, SslLabsHostResult>>({});
  const moduleBusy = useModuleWorkBusy(MODULE_ID);

  const runner = useJobRunner({
    moduleId: MODULE_ID,
    successMessage: "Security audit completed",
    source: "security_audit",
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
    const base = fallbackSecuritySummary({
      totalPages: job.totalPages,
      completed: job.status === "completed",
    });
    if (job.status === "completed" && job.reportAvailable && job.id) {
      const loaded = await loadSecurityAuditSummary(job.id, base);
      setSummary(loaded);
      try {
        const report = await api.getReport(MODULE_ID, `job:${job.id}`);
        const payload = report.data as {
          pages?: SecurityAuditReportPage[];
          sslLabsByHost?: Record<string, SslLabsHostResult>;
        };
        setReportPages(payload?.pages || []);
        setSslLabsByHost(payload?.sslLabsByHost || {});
      } catch {
        setReportPages([]);
        setSslLabsByHost({});
      }
    } else {
      setSummary(base);
      setReportPages([]);
      setSslLabsByHost({});
    }
  }, []);

  useEffect(() => {
    if (historyJob?.url) setUrl(historyJob.url);
    const opts = historyJob?.options;
    if (opts) {
      setChecks({
        includePageSpeed: opts.includePageSpeed === true,
        includeW3cValidator: opts.includeW3cValidator === true,
        includeRobotsTxt: opts.includeRobotsTxt === true,
        includeRedirectTrace: opts.includeRedirectTrace === true,
        includeSslLabs: opts.includeSslLabs === true,
      });
    }
  }, [historyJob]);

  useEffect(() => {
    if (workflow === "complete" && activeJob) {
      loadSummary(activeJob);
    } else if (workflow !== "complete") {
      setSummary(null);
      setReportPages([]);
      setSslLabsByHost({});
    }
  }, [workflow, activeJob, loadSummary]);

  const handleRun = () => {
    const validationError = validateUrlListInput(url);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (!anyCheckEnabled(checks)) {
      toast.error("Enable at least one security check before running.");
      return;
    }

    let startUrl = url.trim();
    const runOptions: Record<string, unknown> = { mode, ...checks };

    if (checks.includePageSpeed) {
      toast.info("Google PageSpeed enabled — mobile + desktop per page (slower runs).", { duration: 5000 });
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
    setReportPages([]);
    setSslLabsByHost({});

    if (checks.includeSslLabs) {
      toast.info("SSL Labs enabled — uses cached results when available; fresh scans may take 1–3 min per hostname.", { duration: 6000 });
    }

    runner.start(startUrl, runOptions);
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
    }) && !!activeJob?.id;

  const allEnabled = Object.values(checks).every(Boolean);
  const w3cIssues = useMemo(() => collectW3cIssueRows(reportPages), [reportPages]);
  const w3cEnabled =
    activeJob?.options?.includeW3cValidator === true || checks.includeW3cValidator;
  const showW3cTables = workflow === "complete" && w3cEnabled;
  const sslLabsEnabled =
    activeJob?.options?.includeSslLabs === true || checks.includeSslLabs;
  const showSslLabsTable = workflow === "complete" && sslLabsEnabled;

  return (
    <div className="ui-check-container flex w-full flex-col gap-6">
      <Card className={UI_CHECK_CARD}>
        <h2 className="text-lg font-bold leading-tight">Security Audit</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "single"
            ? "Enter one URL, or several separated by commas — all tested in one run with a single report."
            : "Crawls your site by following internal links, then runs enabled security checks on every page found."}
        </p>

        <label className="mb-2 mt-4 block text-xs font-semibold text-muted-foreground">
          {mode === "single" ? "URL(s)" : "URL"}
        </label>
        {mode === "single" ? (
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com, example.com/about"
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

        <div className="mt-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Optional checks
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 rounded-lg px-3 text-xs"
              disabled={moduleBusy || allEnabled}
              onClick={() => setChecks(ALL_CHECKS)}
            >
              Enable all
            </Button>
          </div>

          <AuditToggleRow
            title="Google PageSpeed"
            description="Fetch mobile and desktop Lighthouse scores per page (slower runs)."
            checked={checks.includePageSpeed}
            disabled={moduleBusy}
            onChange={(next) => setChecks((prev) => ({ ...prev, includePageSpeed: next }))}
            ariaLabel="Toggle Google PageSpeed checks"
          />
          <AuditToggleRow
            title="W3C HTML Validator"
            description="Validate markup via validator.w3.org Nu checker (errors and warnings)."
            checked={checks.includeW3cValidator}
            disabled={moduleBusy}
            onChange={(next) => setChecks((prev) => ({ ...prev, includeW3cValidator: next }))}
            ariaLabel="Toggle W3C HTML validator"
          />
          <AuditToggleRow
            title="robots.txt"
            description="Fetch robots.txt once per domain — HTTP status and first 5 lines."
            checked={checks.includeRobotsTxt}
            disabled={moduleBusy}
            onChange={(next) => setChecks((prev) => ({ ...prev, includeRobotsTxt: next }))}
            ariaLabel="Toggle robots.txt check"
          />
          <AuditToggleRow
            title="Redirect tracer"
            description="Follow redirect chains manually (up to 8 hops) and log the path."
            checked={checks.includeRedirectTrace}
            disabled={moduleBusy}
            onChange={(next) => setChecks((prev) => ({ ...prev, includeRedirectTrace: next }))}
            ariaLabel="Toggle redirect tracer"
          />
          <AuditToggleRow
            title="SSL Labs"
            description="Qualys SSL Labs TLS grade per unique hostname (cached when recent; fresh scans ~1–3 min)."
            checked={checks.includeSslLabs}
            disabled={moduleBusy}
            onChange={(next) => setChecks((prev) => ({ ...prev, includeSslLabs: next }))}
            ariaLabel="Toggle SSL Labs TLS assessment"
          />
        </div>

        <RunTestActionsPanel>
          <RunModuleButton
            kind="security-audit"
            busyModuleId={MODULE_ID}
            label="Run Security Audit"
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
              {runner.isCancelling ? "Cancelling…" : "Cancel Audit"}
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
              value={summary.w3cErrors}
              label="W3C Errors"
              highlight={summary.w3cErrors > 0}
            />
            <StatCard value={summary.w3cWarnings} label="W3C Warnings" />
            <StatCard
              value={summary.redirectIssues}
              label="Redirect Issues"
              highlight={summary.redirectIssues > 0}
            />
            <StatCard
              value={summary.robotsTxtIssues}
              label="robots.txt Issues"
              highlight={summary.robotsTxtIssues > 0}
            />
            <StatCard
              value={summary.sslLabsIssues}
              label="SSL Labs Issues"
              highlight={summary.sslLabsIssues > 0}
            />
            <StatCard
              value={summary.pageSpeedAverage != null ? `${summary.pageSpeedAverage}%` : "—"}
              label="PageSpeed Avg"
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

          {showSslLabsTable && (
            <div className="mb-6 flex flex-col gap-3">
              <h4 className="text-sm font-semibold text-foreground">SSL Labs TLS grades</h4>
              <SslLabsResultsTable hosts={sslLabsByHost} />
            </div>
          )}

          {showW3cTables && (
            <div className="mb-6 flex flex-col gap-4">
              <h4 className="text-sm font-semibold text-foreground">W3C HTML validation</h4>
              {w3cIssues.truncated && (
                <p className="text-xs text-muted-foreground">
                  Some issues were omitted per page (storage limit). Re-run a single-page audit for full detail.
                </p>
              )}
              <W3cIssuesTable title="Errors" issues={w3cIssues.errors} tone="error" />
              <W3cIssuesTable title="Warnings" issues={w3cIssues.warnings} tone="warning" />
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {showViewReport && (
              <ViewReportButton moduleId={MODULE_ID} jobId={activeJob.id} className="h-11 rounded-lg" />
            )}
            {showViewLog && (
              <ViewLogButton kind="job" moduleId={MODULE_ID} jobId={activeJob.id} className="h-11 rounded-lg" />
            )}
            <Button
              variant="secondary"
              className="h-11 rounded-lg px-4"
              disabled={moduleBusy}
              onClick={handleRun}
            >
              Re-run Audit
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}