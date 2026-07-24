"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { RunModuleButton } from "@/components/execution/run-module-button";
import { RunTestActionsPanel } from "@/components/execution/run-test-actions-panel";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import {
  MAX_URL_LENGTH,
  validateKeywordScanInput,
  validateUrl,
} from "@/lib/url-validation";
import { RadarReportPanel } from "@/components/modules/radar-report-panel";
import { DeleteReportButton } from "@/components/execution/delete-report-button";
import {
  collectKeywordLinks,
  copyTextToClipboard,
  exportKeywordCsv,
} from "@/lib/radar-report-utils";
import { useModuleWorkBusy } from "@/hooks/use-global-work-busy";
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
  caseSensitiveKeywords?: string[];
  stats?: { urlsProcessed?: number; matchesFound?: number };
  results?: KeywordResult[];
  matches?: KeywordMatch[];
};

type ReportMeta = {
  id: string;
  title?: string;
  generatedAt?: string;
};

function parseFetchError(data: unknown, status: number): string {
  const body = data as { message?: string; error?: string };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const error = typeof body.error === "string" ? body.error.trim() : "";
  if (message && error && message !== error) return `${message} (${error})`;
  return message || error || `Request failed (${status})`;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options?.headers || {}),
      },
    });
  } catch {
    throw new Error("Cannot reach the API. Check that the backend is running.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseFetchError(data, res.status));
  }
  return data as T;
}

export default function KeywordRadarPage() {
  const [url, setUrl] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [caseSensitiveKeywordsText, setCaseSensitiveKeywordsText] = useState("");
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<KeywordReport | null>(null);
  const [reportsListError, setReportsListError] = useState("");
  const [reportDetailError, setReportDetailError] = useState("");
  const [reportLoading, setReportLoading] = useState(false);

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
  const currentCheckUrl = useScanStore((s) => (isKeywordActive ? s.currentUrl : ""));
  const startKeywordScan = useScanStore((s) => s.startKeywordScan);
  const cancelScan = useScanStore((s) => s.cancelScan);
  const resetScan = useScanStore((s) => s.reset);
  const scanId = useScanStore((s) => (isKeywordActive ? s.scanId : null));
  const dashboardRefreshKey = useDashboardStore((s) => s.refreshKey);
  const moduleBusy = useModuleWorkBusy("keyword-check");

  const showProgress = isKeywordActive && (scanStatus === "running" || scanStatus === "success" || isCancelling);

  const loadReports = useCallback(async (selectFirst = false) => {
    try {
      const data = await fetchJson<{ reports: ReportMeta[] }>(`/api/modules/${MODULE_ID}/reports`);
      const list = data.reports || [];
      setReports(list);
      setReportsListError("");
      if (selectFirst && list.length) setActiveReportId(list[0].id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load reports";
      setReportsListError(msg);
      toast.error(msg);
    }
  }, []);

  const loadReport = useCallback(async (reportId: string) => {
    setReportLoading(true);
    setReportDetailError("");
    setReportData(null);
    try {
      const result = await fetchJson<{ data: KeywordReport }>(
        `/api/modules/${MODULE_ID}/reports/${encodeURIComponent(reportId)}`
      );
      const data = result.data;
      setReportData(data);
      setReportDetailError("");
      if (data.url) setUrl(data.url);
      if (Array.isArray(data.keywords)) {
        setKeywordsText(data.keywords.join("\n"));
      }
      if (Array.isArray(data.caseSensitiveKeywords)) {
        setCaseSensitiveKeywordsText(data.caseSensitiveKeywords.join("\n"));
      } else {
        setCaseSensitiveKeywordsText("");
      }
    } catch (err) {
      setReportData(null);
      const msg = err instanceof Error ? err.message : "Failed to load report";
      setReportDetailError(msg);
      toast.error(msg);
    } finally {
      setReportLoading(false);
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
    const urlError = validateUrl(url);
    if (urlError) {
      toast.error(urlError);
      return;
    }
    const { keywords, caseSensitiveKeywords, error } = validateKeywordScanInput(
      keywordsText,
      caseSensitiveKeywordsText
    );
    if (error) {
      toast.error(error);
      return;
    }
    await startKeywordScan(url, keywords, caseSensitiveKeywords);
  };

  const logScanId = scanId || failedScanId;

  const clearForm = () => {
    if (!scanning) resetScan();
    setUrl("");
    setKeywordsText("");
    setCaseSensitiveKeywordsText("");
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
                disabled={moduleBusy}
                maxLength={MAX_URL_LENGTH}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Keywords (one per line, case-insensitive)
              </label>
              <textarea
                className="min-h-[100px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                rows={4}
                placeholder={"keyword1\nkeyword2"}
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                disabled={moduleBusy}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Case-sensitive keywords{" "}
                <span className="font-normal text-muted-foreground/80">(optional)</span>
              </label>
              <textarea
                className="min-h-[72px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                rows={3}
                placeholder={"BrandName\nSKU-123"}
                value={caseSensitiveKeywordsText}
                onChange={(e) => setCaseSensitiveKeywordsText(e.target.value)}
                disabled={moduleBusy}
              />
              <p className="text-[0.7rem] text-muted-foreground">
                Matches exact letter casing only. Leave empty to use standard keywords above.
              </p>
            </div>
            <RunTestActionsPanel className="mt-0">
              <RunModuleButton
                kind="keyword-scan"
                busyModuleId="keyword-check"
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
                disabled={moduleBusy}
              >
                Clear
              </Button>
            </RunTestActionsPanel>
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
              <p className="break-all text-xs text-muted-foreground">{statusText}</p>
              {currentCheckUrl && scanning ? (
                <p className="break-all text-[0.7rem] text-muted-foreground/90">
                  Current URL: {currentCheckUrl}
                </p>
              ) : null}
              {scanId && (scanning || scanStatus === "success") ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <ViewLogButton kind="scan" scanId={scanId} size="sm" />
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {reportsListError ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm text-destructive">{reportsListError}</p>
              <Button size="sm" variant="secondary" onClick={() => void loadReports(true)}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {isKeywordActive && scanStatus === "cancelled" ? (
          <Card className="border-border bg-muted/20">
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm text-muted-foreground">Scan was cancelled.</p>
              {logScanId ? (
                <div className="flex flex-wrap gap-2">
                  <ViewLogButton kind="scan" scanId={logScanId} size="sm" />
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {errorMessage ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm text-destructive">{errorMessage}</p>
              <div className="flex flex-wrap gap-2">
                {logScanId ? <ViewLogButton kind="scan" scanId={logScanId} size="sm" /> : null}
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
                  <div
                    key={r.id}
                    className={cn(
                      "flex items-start gap-1 rounded-lg border px-2 py-2 transition-colors",
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
              ) : activeReportId && reportDetailError ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-destructive">{reportDetailError}</p>
                  <Button size="sm" variant="secondary" onClick={() => void loadReport(activeReportId)}>
                    Retry
                  </Button>
                </div>
              ) : activeReportId && reportLoading ? (
                <p className="text-sm text-muted-foreground">Loading report…</p>
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