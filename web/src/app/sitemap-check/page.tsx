"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RunModuleButton } from "@/components/execution/run-module-button";
import { RunTestActionsPanel } from "@/components/execution/run-test-actions-panel";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { DeleteReportButton } from "@/components/execution/delete-report-button";
import { StatusWithReport } from "@/components/execution/status-with-report";
import { useModuleWorkBusy } from "@/hooks/use-global-work-busy";
import { useJobRunner } from "@/hooks/use-job-runner";
import { canViewReport } from "@/lib/report";
import { canViewLogs } from "@/lib/logs";
import { MAX_URL_LENGTH, validateUrl } from "@/lib/url-validation";
import { cn, formatDateTime } from "@/lib/utils";
import {
  exportSitemapFilesCsv,
  exportSitemapPagesCsv,
} from "@/lib/sitemap-report-export";
import { toast } from "sonner";

const MODULE_ID = "sitemap-check";

type SitemapUrlResult = {
  url: string;
  statusCode?: number;
  primaryIssue?: string;
  issues?: string[];
  hasIssue?: boolean;
  finalUrl?: string;
};

type SitemapReport = {
  url: string;
  sitemapUrl?: string | null;
  sitemapFound?: boolean;
  sitemaps?: string[];
  generatedAt?: string;
  summary?: {
    totalSitemapFiles?: number;
    nestedSitemapFiles?: number;
    totalDiscovered?: number;
    totalChecked?: number;
    issueCount?: number;
    okCount?: number;
    failCount?: number;
  };
  urls?: SitemapUrlResult[];
};

type ReportMeta = {
  id: string;
  title?: string;
  generatedAt?: string;
  jobId?: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `Request failed (${res.status})`);
  }
  return data as T;
}

function StatCard({
  value,
  label,
  highlight,
}: {
  value: number | string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className="hover-lift flex h-24 flex-col items-center justify-center rounded-[14px] border border-border bg-background-elevated px-3 text-center">
      <div className={`text-xl font-bold leading-tight ${highlight ? "text-amber-400" : ""}`}>{value}</div>
      <div className="mt-1 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export default function SitemapCheckPage() {
  const [url, setUrl] = useState("");
  const [maxUrls, setMaxUrls] = useState("100");
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<SitemapReport | null>(null);
  const [reportError, setReportError] = useState("");

  const moduleBusy = useModuleWorkBusy(MODULE_ID);

  const runner = useJobRunner({
    moduleId: MODULE_ID,
    successMessage: "Sitemap audit completed",
    source: "sitemap_check",
    onComplete: () => void loadReports(true),
  });

  const workflow = useMemo(() => {
    if (runner.running || runner.isCancelling) return "running";
    if (runner.isActive && (runner.status === "completed" || runner.status === "failed")) return "complete";
    return "idle";
  }, [runner.running, runner.isCancelling, runner.isActive, runner.status]);

  const activeJob = runner.isActive ? runner.job : null;
  const showViewLog = canViewLogs(activeJob?.status) && !!activeJob?.id;
  const showViewReport =
    canViewReport({
      status: activeJob?.status,
      reportAvailable: activeJob?.reportAvailable,
    }) && !!activeJob?.id;

  const loadReports = useCallback(async (selectFirst = false) => {
    try {
      const data = await fetchJson<{ reports: ReportMeta[] }>(`/api/modules/${MODULE_ID}/reports`);
      const list = data.reports || [];
      setReports(list);
      if (selectFirst && list.length) setActiveReportId(list[0].id);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to load reports");
    }
  }, []);

  const loadReport = useCallback(async (reportId: string) => {
    try {
      const result = await fetchJson<{ data: SitemapReport }>(
        `/api/modules/${MODULE_ID}/reports/${encodeURIComponent(reportId)}`
      );
      setReportData(result.data);
      setReportError("");
    } catch (err) {
      setReportData(null);
      setReportError(err instanceof Error ? err.message : "Failed to load report");
    }
  }, []);

  useEffect(() => {
    void loadReports(true);
  }, [loadReports]);

  useEffect(() => {
    if (activeReportId) void loadReport(activeReportId);
  }, [activeReportId, loadReport]);

  const handleRun = () => {
    const urlError = validateUrl(url);
    if (urlError) {
      toast.error(urlError);
      return;
    }
    const capped = Math.min(Math.max(parseInt(maxUrls, 10) || 100, 1), 500);
    runner.start(url.trim(), { maxUrls: capped });
  };

  const pagesLabel =
    runner.totalPages > 0
      ? `URL ${runner.currentPage} / ${runner.totalPages}`
      : runner.running
        ? `${runner.progress}%`
        : "—";

  const liveSummary = reportData?.summary;
  const issueUrls = (reportData?.urls || []).filter((u) => u.hasIssue);

  return (
    <AppShell title="Sitemap Audit" subtitle="Parse sitemap.xml and verify every listed URL">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <Card className="rounded-[20px] border-border p-8">
          <h2 className="text-lg font-bold leading-tight">Run Sitemap Audit</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Discovers URLs from sitemap.xml (or sitemap_index.xml), then checks each URL for HTTP
            status, redirects (301/302), and page-not-found content — same logic as Link Radar.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Website URL</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={moduleBusy}
                maxLength={MAX_URL_LENGTH}
                placeholder="https://example.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Max URLs</label>
              <Input
                type="number"
                value={maxUrls}
                onChange={(e) => setMaxUrls(e.target.value)}
                disabled={moduleBusy}
                min={1}
                max={500}
              />
            </div>
          </div>

          <RunTestActionsPanel>
            <RunModuleButton
              kind="sitemap-check"
              busyModuleId={MODULE_ID}
              label="Start Audit"
              loadingLabel="Auditing…"
              loading={runner.running && !runner.isCancelling}
              disabled={runner.isCancelling}
              onClick={handleRun}
            />
            {(runner.running || runner.isCancelling) && (
              <Button
                variant="cancel"
                className="h-11 min-w-[140px] rounded-lg px-4"
                loading={runner.isCancelling}
                disabled={runner.isCancelling}
                onClick={runner.cancel}
              >
                {runner.isCancelling ? "Cancelling…" : "Stop Audit"}
              </Button>
            )}
          </RunTestActionsPanel>
        </Card>

        {workflow === "running" && (
          <Card className="rounded-[20px] border-border p-8" aria-live="polite">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold">Progress</h3>
              <Badge variant={statusBadgeVariant("running")} className="uppercase">
                running
              </Badge>
            </div>
            <Progress value={runner.progress} className="mb-2 h-2 rounded-full" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{runner.progress}%</span>
              <span>{pagesLabel}</span>
            </div>
            {runner.message ? (
              <p className="mt-3 text-sm text-muted-foreground">{runner.message}</p>
            ) : null}
            {showViewLog && activeJob?.id ? (
              <div className="mt-4">
                <ViewLogButton kind="job" moduleId={MODULE_ID} jobId={activeJob.id} size="sm" />
              </div>
            ) : null}
          </Card>
        )}

        {workflow === "complete" && activeJob && (
          <Card className="rounded-[20px] border-border p-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold">Latest Run</h3>
              <StatusWithReport
                status={activeJob.status}
                moduleId={MODULE_ID}
                jobId={activeJob.id}
                reportAvailable={activeJob.reportAvailable}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              {showViewReport ? (
                <ViewReportButton moduleId={MODULE_ID} jobId={activeJob.id} className="h-11 rounded-lg" />
              ) : null}
              {showViewLog ? (
                <ViewLogButton kind="job" moduleId={MODULE_ID} jobId={activeJob.id} className="h-11 rounded-lg" />
              ) : null}
            </div>
          </Card>
        )}

        {reportError ? (
          <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {reportError}
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card className="rounded-[20px] border-border">
            <div className="border-b border-border px-4 py-3">
              <h3 className="font-semibold">Saved Reports</h3>
            </div>
            <div className="flex flex-col gap-2 p-4">
              {reports.length ? (
                reports.map((r) => (
                  <div
                    key={r.id}
                    className={cn(
                      "flex items-start gap-1 rounded-lg border px-2 py-2",
                      activeReportId === r.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveReportId(r.id)}
                      className="min-w-0 flex-1 px-1 text-left text-xs"
                    >
                      <span className="block break-all font-medium">{r.title || r.id}</span>
                      {r.generatedAt ? (
                        <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                          {formatDateTime(r.generatedAt)}
                        </span>
                      ) : null}
                    </button>
                    <DeleteReportButton
                      moduleId={MODULE_ID}
                      reportId={r.id}
                      label=""
                      className="px-2"
                      onDeleted={() => {
                        if (activeReportId === r.id) {
                          setActiveReportId(null);
                          setReportData(null);
                        }
                        void loadReports();
                      }}
                    />
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No saved reports yet.</p>
              )}
            </div>
          </Card>

          <Card className="rounded-[20px] border-border p-6">
            <h3 className="mb-4 font-semibold">Report Preview</h3>
            {activeReportId && reportData ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <StatCard
                    value={
                      liveSummary?.totalSitemapFiles ??
                      reportData.sitemaps?.length ??
                      (reportData.sitemapUrl ? 1 : 0)
                    }
                    label="Sitemap Files"
                  />
                  <StatCard
                    value={
                      liveSummary?.nestedSitemapFiles ??
                      Math.max(
                        0,
                        (reportData.sitemaps?.length ?? 0) - (reportData.sitemapUrl ? 1 : 0)
                      )
                    }
                    label="Nested Sitemaps"
                  />
                  <StatCard
                    value={liveSummary?.totalDiscovered ?? reportData.urls?.length ?? 0}
                    label="Page URLs Found"
                  />
                  <StatCard
                    value={liveSummary?.totalChecked ?? reportData.urls?.length ?? 0}
                    label="Pages Checked"
                  />
                  <StatCard value={liveSummary?.okCount ?? 0} label="Pass (200)" />
                  <StatCard
                    value={liveSummary?.failCount ?? liveSummary?.issueCount ?? issueUrls.length}
                    label="Fail (not 200)"
                    highlight={(liveSummary?.failCount ?? liveSummary?.issueCount ?? issueUrls.length) > 0}
                  />
                </div>
                {reportData.sitemapUrl ? (
                  <p className="text-xs text-muted-foreground">
                    Root sitemap:{" "}
                    <span className="break-all text-foreground">{reportData.sitemapUrl}</span>
                    {(reportData.sitemaps?.length ?? 0) > 0
                      ? ` · ${reportData.sitemaps?.length} sitemap file(s) scanned`
                      : null}
                  </p>
                ) : null}
                {(reportData.sitemaps?.length ?? 0) > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">Sitemap URL</th>
                          <th className="px-3 py-2">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(reportData.sitemaps || []).slice(0, 15).map((sm, idx) => (
                          <tr key={sm} className="border-t border-border">
                            <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                            <td className="max-w-[320px] truncate px-3 py-2">{sm}</td>
                            <td className="px-3 py-2">
                              {sm === reportData.sitemapUrl ? (
                                <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[0.65rem] font-semibold text-blue-300">
                                  Root
                                </span>
                              ) : (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
                                  Nested
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(reportData.sitemaps || []).length > 15 ? (
                      <p className="px-3 py-2 text-[0.7rem] text-muted-foreground">
                        +{(reportData.sitemaps || []).length - 15} more sitemaps — open HTML report for full list
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      window.open(
                        `/api/modules/${MODULE_ID}/reports/${encodeURIComponent(activeReportId)}/html`,
                        "_blank",
                        "noopener,noreferrer"
                      )
                    }
                  >
                    Open HTML Report
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const ok = exportSitemapPagesCsv(reportData);
                      if (!ok) toast.error("No page results to export");
                      else toast.success("Pages CSV downloaded");
                    }}
                  >
                    Export CSV · Pages
                  </Button>
                  {(reportData.sitemaps?.length ?? 0) > 0 ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const ok = exportSitemapFilesCsv(reportData);
                        if (!ok) toast.error("No sitemap files to export");
                        else toast.success("Sitemap files CSV downloaded");
                      }}
                    >
                      Export CSV · Sitemaps
                    </Button>
                  ) : null}
                </div>
                {(reportData.urls || []).length ? (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">URL</th>
                          <th className="px-3 py-2">Status Code</th>
                          <th className="px-3 py-2">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(reportData.urls || []).slice(0, 30).map((row) => {
                          const failed =
                            row.hasIssue || (row.statusCode != null && Number(row.statusCode) !== 200);
                          return (
                            <tr key={row.url} className="border-t border-border">
                              <td className="max-w-[240px] truncate px-3 py-2">{row.url}</td>
                              <td className="px-3 py-2 font-mono">
                                {row.statusCode != null ? row.statusCode : "—"}
                              </td>
                              <td
                                className={
                                  failed
                                    ? "px-3 py-2 font-medium text-amber-400"
                                    : "px-3 py-2 font-medium text-[#1dbf73]"
                                }
                              >
                                {failed ? "Fail" : "Pass"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {(reportData.urls || []).length > 30 ? (
                      <p className="px-3 py-2 text-[0.7rem] text-muted-foreground">
                        +{(reportData.urls || []).length - 30} more — open HTML report for full list
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No URLs checked in this report.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {reports.length ? "Select a report to preview." : "Run an audit to generate a report."}
              </p>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}