"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { UiTestingSegmented } from "@/components/modules/ui-testing-segmented";
import { useModuleWorkBusy } from "@/hooks/use-global-work-busy";
import { useJobRunner } from "@/hooks/use-job-runner";
import { canViewReport } from "@/lib/report";
import { canViewLogs } from "@/lib/logs";
import { parseUrlListInput, validateUrlListInput } from "@/lib/parse-url-list";
import { MAX_URL_LENGTH, validateUrl } from "@/lib/url-validation";
import { cn, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";
import {
  formatImageIssueList,
  imageHasIssues,
  resolveImageAuditSummary,
  type ImageAuditSummary,
} from "@/lib/image-audit-summary";
import {
  DEFAULT_SELECTED_VIEWPORT_KEYS,
  type AuditViewport,
} from "@/lib/image-audit-viewports";
import {
  ImageAuditViewportSelector,
  type ImageAuditViewportSelectorHandle,
} from "@/components/modules/image-audit-viewport-selector";

const MODULE_ID = "image-audit";

const MODE_OPTIONS = [
  { value: "single" as const, label: "Single Page" },
  { value: "full" as const, label: "Full Website" },
];

const UI_CHECK_CARD =
  "ui-check-card w-full min-h-[320px] rounded-[20px] border-border p-8";

type Mode = "single" | "full";

type ImageAuditReport = {
  url: string;
  domain?: string;
  pageTitle?: string;
  generatedAt?: string;
  pagesAudited?: number;
  auditedUrls?: string[];
  summary?: Partial<ImageAuditSummary> & {
    totalBytes?: number;
    potentialSavings?: number;
    accessibilityFailures?: number;
  };
  images?: Array<{
    id: string;
    identity?: { url?: string; filename?: string };
    verification?: { broken?: boolean };
    optimization?: { issues?: string[] };
    rendering?: {
      viewports?: Record<string, { optimization?: { issues?: string[] } }>;
    };
  }>;
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

export default function ImageAuditPage() {
  const [mode, setMode] = useState<Mode>("single");
  const [url, setUrl] = useState("");
  const [maxUrls, setMaxUrls] = useState("100");
  const [selectedViewportKeys, setSelectedViewportKeys] = useState<string[]>(
    DEFAULT_SELECTED_VIEWPORT_KEYS
  );
  const [customViewports, setCustomViewports] = useState<AuditViewport[]>([]);
  const viewportSelectorRef = useRef<ImageAuditViewportSelectorHandle>(null);
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ImageAuditReport | null>(null);
  const [reportError, setReportError] = useState("");

  const moduleBusy = useModuleWorkBusy(MODULE_ID);

  const runner = useJobRunner({
    moduleId: MODULE_ID,
    successMessage: "Image audit completed",
    source: "image_audit",
    onComplete: () => void loadReports(false),
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
      const result = await fetchJson<{ data: ImageAuditReport }>(
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

  useEffect(() => {
    if (workflow === "complete" && activeJob?.id) {
      setActiveReportId(`job:${activeJob.id}`);
    }
  }, [workflow, activeJob?.id]);

  const handleRun = () => {
    const validationError =
      mode === "single" ? validateUrlListInput(url) : validateUrl(url);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const viewports = viewportSelectorRef.current?.getViewportsForRun();
    if (!viewports) return;

    let startUrl = url.trim();
    const runOptions: Record<string, unknown> = { mode, viewports };

    if (mode === "full") {
      const capped = Math.min(Math.max(parseInt(maxUrls, 10) || 100, 1), 500);
      runOptions.maxUrls = capped;
    } else {
      const parsed = parseUrlListInput(url);
      startUrl = parsed.primaryUrl;
      if (parsed.urls.length > 1) {
        runOptions.urls = parsed.urls;
      }
    }

    runner.start(startUrl, runOptions);
  };

  const pagesLabel =
    runner.totalPages > 0
      ? mode === "single" && runner.totalPages > 1
        ? `URL ${runner.currentPage} / ${runner.totalPages}`
        : `Page ${runner.currentPage} / ${runner.totalPages}`
      : runner.running
        ? `${runner.progress}%`
        : "—";

  const previewSummary = useMemo(
    () => resolveImageAuditSummary(reportData ?? undefined),
    [reportData]
  );
  const issueImages = useMemo(
    () => (reportData?.images || []).filter((img) => imageHasIssues(img)),
    [reportData?.images]
  );

  return (
    <AppShell
      title="Image Audit"
      subtitle="Image discovery, CDN, optimization, and accessibility"
    >
      <div className="image-audit-page mx-auto w-full max-w-[1100px] px-0 md:px-6">
        <div className="mb-6 flex justify-center">
          <UiTestingSegmented
            value={mode}
            options={MODE_OPTIONS}
            onChange={setMode}
            aria-label="Audit mode"
          />
        </div>

        <div className="image-audit-stack flex w-full flex-col gap-6">
          <Card className={UI_CHECK_CARD}>
            <h2 className="text-lg font-bold leading-tight">
              {mode === "full" ? "Full Website Image Audit" : "Single Page Image Audit"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "single"
                ? "Enter one URL, or several separated by commas — all audited in one run with a single report."
                : "Crawls your site by following internal links, then audits images on every page found."}
            </p>

            <label className="mb-2 mt-4 block text-xs font-semibold text-muted-foreground">
              {mode === "single" ? "URL(s)" : "URL"}
            </label>
            {mode === "single" ? (
              <textarea
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://test.com, test123.com, example.com/about"
                disabled={moduleBusy}
                rows={4}
                className={cn(
                  "min-h-[96px] w-full resize-y rounded-lg border border-border bg-background-elevated px-3 py-2.5 text-sm transition-all duration-250 placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(15,143,111,0.2)] disabled:cursor-not-allowed disabled:opacity-50"
                )}
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

            {mode === "full" ? (
              <div className="mt-4 max-w-xs">
                <label className="mb-2 block text-xs font-semibold text-muted-foreground">
                  Max URLs
                </label>
                <Input
                  type="number"
                  value={maxUrls}
                  onChange={(e) => setMaxUrls(e.target.value)}
                  disabled={moduleBusy}
                  min={1}
                  max={500}
                  className="h-11 w-full rounded-lg text-sm"
                />
              </div>
            ) : null}

            <div className="mt-4">
              <ImageAuditViewportSelector
                ref={viewportSelectorRef}
                selectedKeys={selectedViewportKeys}
                onSelectedKeysChange={setSelectedViewportKeys}
                customViewports={customViewports}
                onCustomViewportsChange={setCustomViewports}
                disabled={moduleBusy}
              />
            </div>

            <RunTestActionsPanel>
              <RunModuleButton
                kind="image-audit"
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
                  className="h-11 min-w-[140px] flex-1 rounded-lg px-4 sm:flex-none"
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
            <Card className={`${UI_CHECK_CARD} min-h-0`} aria-live="polite">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold leading-tight">Progress</h3>
                <Badge variant={statusBadgeVariant("running")} className="shrink-0 uppercase">
                  running
                </Badge>
              </div>
              <Progress value={runner.progress} className="mb-2 h-2 rounded-full" />
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{runner.progress}%</span>
                <span>{pagesLabel}</span>
              </div>
              {runner.message ? (
                <p className="mt-3 break-words text-sm text-muted-foreground">{runner.message}</p>
              ) : null}
              {showViewLog && activeJob?.id ? (
                <div className="mt-4">
                  <ViewLogButton kind="job" moduleId={MODULE_ID} jobId={activeJob.id} size="sm" />
                </div>
              ) : null}
            </Card>
          )}

          {workflow === "complete" && activeJob && (
            <Card className={`${UI_CHECK_CARD} min-h-0`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold leading-tight">Latest Run</h3>
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
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {previewSummary.pagesAudited > 1 ? (
                      <StatCard value={previewSummary.pagesAudited} label="Pages Audited" />
                    ) : null}
                    <StatCard value={previewSummary.totalImages} label="Total Images" />
                    <StatCard value={previewSummary.uniqueImages} label="Unique" />
                    <StatCard
                      value={previewSummary.brokenImages}
                      label="Broken"
                      highlight={previewSummary.brokenImages > 0}
                    />
                    <StatCard
                      value={previewSummary.duplicateImages}
                      label="Duplicates"
                      highlight={previewSummary.duplicateImages > 0}
                    />
                    <StatCard value={previewSummary.totalCdnImages} label="CDN Images" />
                    <StatCard value={previewSummary.lazyImages} label="Lazy Loaded" />
                    <StatCard value={previewSummary.responsiveImages} label="Responsive" />
                    <StatCard value={previewSummary.totalBytesFormatted} label="Total Size" />
                    <StatCard value={previewSummary.potentialSavingsFormatted} label="Savings" />
                  </div>
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
                      onClick={() =>
                        window.open(
                          `/api/modules/${MODULE_ID}/reports/${encodeURIComponent(activeReportId)}/csv`,
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                    >
                      Download CSV
                    </Button>
                  </div>
                  {issueImages.length ? (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2">Image</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Issues</th>
                          </tr>
                        </thead>
                        <tbody>
                          {issueImages.slice(0, 20).map((row) => (
                            <tr key={row.id} className="border-t border-border">
                              <td className="max-w-[200px] truncate px-3 py-2">
                                {row.identity?.filename || row.identity?.url || row.id}
                              </td>
                              <td className="px-3 py-2">
                                {row.verification?.broken ? "Broken" : "OK"}
                              </td>
                              <td className="px-3 py-2 text-amber-400">
                                {formatImageIssueList(row)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {issueImages.length > 20 ? (
                        <p className="px-3 py-2 text-[0.7rem] text-muted-foreground">
                          +{issueImages.length - 20} more — open HTML report for full list
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No issues found in this report.</p>
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
      </div>
    </AppShell>
  );
}