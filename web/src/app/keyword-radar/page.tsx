"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { RunModuleButton } from "@/components/execution/run-module-button";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import { MAX_URL_LENGTH, validateKeywords } from "@/lib/url-validation";
import { RadarReportPanel } from "@/components/modules/radar-report-panel";
import {
  collectKeywordLinks,
  copyTextToClipboard,
  exportKeywordCsv,
} from "@/lib/radar-report-utils";
import { useGlobalWorkBusy } from "@/hooks/use-global-work-busy";
import { useScanStore } from "@/store/scan-store";
import { useDashboardStore } from "@/store/dashboard-store";
import { toast } from "sonner";

const MODULE_ID = "keyword-check";

type KeywordResult = {
  url: string;
  statusCode?: number;
  matchedKeywords?: string[];
  isError?: boolean;
};

type KeywordMatch = {
  url: string;
  keyword: string;
};

type KeywordReport = {
  url: string;
  status?: string;
  keywords?: string[];
  stats?: { urlsProcessed?: number; matchesFound?: number };
  results?: KeywordResult[];
  matches?: KeywordMatch[];
};

type ReportMeta = {
  id: string;
  title?: string;
  generatedAt?: string;
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `Request failed (${res.status})`);
  }
  return data as T;
}

export default function KeywordRadarPage() {
  const [url, setUrl] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<KeywordReport | null>(null);
  const [reportLoadError, setReportLoadError] = useState("");

  const scanStatus = useScanStore((s) => s.status);
  const scanModuleId = useScanStore((s) => s.moduleId);
  const isKeywordActive = scanModuleId === "keyword-check";
  const isCancelling = useScanStore((s) => s.isCancelling);
  const scanning = isKeywordActive && (scanStatus === "running" || isCancelling);
  const errorMessage = useScanStore((s) => (isKeywordActive ? s.errorMessage : ""));
  const failedScanId = useScanStore((s) => (isKeywordActive ? s.failedScanId : null));
  const urlsDiscovered = useScanStore((s) => (isKeywordActive ? s.urlsDiscovered : 0));
  const urlsProcessed = useScanStore((s) => (isKeywordActive ? s.urlsProcessed : 0));
  const currentBatch = useScanStore((s) => (isKeywordActive ? s.currentBatch : 0));
  const matchesFound = useScanStore((s) => (isKeywordActive ? s.matchesFound : 0));
  const progressPct = useScanStore((s) => (isKeywordActive ? s.progress : 0));
  const statusText = useScanStore((s) => (isKeywordActive ? s.message : ""));
  const startKeywordScan = useScanStore((s) => s.startKeywordScan);
  const cancelScan = useScanStore((s) => s.cancelScan);
  const resetScan = useScanStore((s) => s.reset);
  const scanId = useScanStore((s) => (isKeywordActive ? s.scanId : null));
  const dashboardRefreshKey = useDashboardStore((s) => s.refreshKey);
  const globalBusy = useGlobalWorkBusy();

  const showProgress = isKeywordActive && (scanStatus === "running" || scanStatus === "success" || isCancelling);

  const loadReports = useCallback(async (selectFirst = false) => {
    try {
      const data = await fetchJson<{ reports: ReportMeta[] }>(`/api/modules/${MODULE_ID}/reports`);
      const list = data.reports || [];
      setReports(list);
      if (selectFirst && list.length) setActiveReportId(list[0].id);
    } catch (err) {
      setReportLoadError(err instanceof Error ? err.message : "Failed to load reports");
    }
  }, []);

  const loadReport = useCallback(async (reportId: string) => {
    try {
      const result = await fetchJson<{ data: KeywordReport }>(
        `/api/modules/${MODULE_ID}/reports/${encodeURIComponent(reportId)}`
      );
      setReportData(result.data);
      setReportLoadError("");
    } catch (err) {
      setReportData(null);
      setReportLoadError(err instanceof Error ? err.message : "Failed to load report");
    }
  }, []);

  useEffect(() => {
    loadReports(true);
  }, [loadReports, dashboardRefreshKey]);

  useEffect(() => {
    if (activeReportId) loadReport(activeReportId);
  }, [activeReportId, loadReport]);

  useEffect(() => {
    if (scanModuleId === MODULE_ID && scanStatus === "success") {
      void (async () => {
        await loadReports(false);
        if (scanId) setActiveReportId(scanId);
        else await loadReports(true);
      })();
    }
  }, [scanModuleId, scanStatus, scanId, loadReports, dashboardRefreshKey]);

  const startScan = async () => {
    const { keywords, error } = validateKeywords(keywordsText);
    if (error) {
      toast.error(error);
      return;
    }
    await startKeywordScan(url, keywords);
  };

  const clearForm = () => {
    if (!scanning) resetScan();
    setUrl("");
    setKeywordsText("");
  };

  return (
    <AppShell title="Keyword Radar" subtitle="Track rankings, volume, and competitor gaps">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Run Keyword Scan</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Website URL</label>
              <Input
                type="url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={globalBusy}
                maxLength={MAX_URL_LENGTH}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Keywords (one per line)</label>
              <textarea
                className="min-h-[100px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                rows={4}
                placeholder={"keyword1\nkeyword2"}
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                disabled={globalBusy}
              />
            </div>
            <div className="run-test-actions flex flex-wrap gap-3">
              <RunModuleButton
                kind="keyword-scan"
                label="Start Scan"
                loadingLabel="Scanning…"
                loading={scanning && !isCancelling}
                disabled={isCancelling}
                onClick={startScan}
              />
              {scanning ? (
                <Button
                  variant="cancel"
                  className="h-11 min-w-[120px] rounded-lg px-4"
                  loading={isCancelling}
                  disabled={isCancelling}
                  onClick={cancelScan}
                >
                  {isCancelling ? "Cancelling…" : "Stop Scan"}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                className="h-11 min-w-[100px] rounded-lg px-4"
                onClick={clearForm}
                disabled={globalBusy}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        {showProgress ? (
          <Card>
            <CardHeader>
              <CardTitle>Scan Progress</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  { label: "Discovered", value: urlsDiscovered },
                  { label: "Processed", value: urlsProcessed },
                  { label: "Batch", value: currentBatch },
                  { label: "Matches", value: matchesFound, highlight: true },
                ].map((s) => (
                  <div
                    key={s.label}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-center",
                      s.highlight ? "border-primary bg-primary/10" : "border-border bg-muted/30"
                    )}
                  >
                    <div className="font-mono text-xl font-bold">{s.value}</div>
                    <div className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-xs font-medium">{progressPct}%</span>
              </div>
              <p className="text-xs text-muted-foreground">{statusText}</p>
            </CardContent>
          </Card>
        ) : null}

        {reportLoadError ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">{reportLoadError}</CardContent>
          </Card>
        ) : null}

        {errorMessage ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm text-destructive">{errorMessage}</p>
              <div className="flex flex-wrap gap-2">
                {failedScanId ? <ViewLogButton kind="scan" scanId={failedScanId} size="sm" /> : null}
                <Button size="sm" onClick={startScan}>
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Saved Reports</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 p-4 pt-0">
              {reports.length ? (
                reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActiveReportId(r.id)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                      activeReportId === r.id
                        ? "border-primary bg-primary/10 font-semibold"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <span className="block break-all">{r.title || r.id}</span>
                    {r.generatedAt ? (
                      <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                        {formatDateTime(r.generatedAt)}
                      </span>
                    ) : null}
                  </button>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No saved reports. Run a scan to generate one.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Report</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {activeReportId && reportData ? (
                <RadarReportPanel
                  moduleId={MODULE_ID}
                  reportId={activeReportId}
                  hasData={Boolean((reportData.results?.length || 0) + (reportData.matches?.length || 0))}
                  onExportCsv={() => {
                    const ok = exportKeywordCsv(reportData.results || [], reportData.matches || []);
                    if (!ok) toast.error("No data to export");
                    else toast.success("CSV downloaded");
                  }}
                  onCopyLinks={async () => {
                    const links = collectKeywordLinks(reportData.results || [], reportData.matches || []);
                    if (!links.length) throw new Error("No links");
                    await copyTextToClipboard(links.join("\n"));
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {reports.length
                    ? "Select a report to view the HTML report."
                    : "No reports found. Run a scan to generate one."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}