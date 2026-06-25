"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { RunModuleButton } from "@/components/execution/run-module-button";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import { MAX_URL_LENGTH, validateUrl } from "@/lib/url-validation";
import { RadarReportPanel } from "@/components/modules/radar-report-panel";
import {
  collectErrorCheckLinks,
  copyTextToClipboard,
  exportErrorCheckCsv,
} from "@/lib/radar-report-utils";
import { useGlobalWorkBusy } from "@/hooks/use-global-work-busy";
import { useScanStore } from "@/store/scan-store";
import { useDashboardStore } from "@/store/dashboard-store";
import { toast } from "sonner";

const MODULE_ID = "error-check";

type BrokenPage = {
  url: string;
  detectedErrors?: string[];
};

type BrokenLink = {
  brokenUrl: string;
  foundIn: string;
};

type ErrorCheckReport = {
  url: string;
  generatedAt?: string;
  checked?: number;
  brokenPages?: BrokenPage[];
  brokenLinks?: BrokenLink[];
  allCheckedUrls?: Array<{
    url: string;
    statusCode?: number;
    detectedErrors?: string[];
  }>;
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

export default function LinkRadarPage() {
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState("100");
  const [maxDepth, setMaxDepth] = useState("5");
  const [reportLoadError, setReportLoadError] = useState("");
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ErrorCheckReport | null>(null);

  const scanStatus = useScanStore((s) => s.status);
  const scanModuleId = useScanStore((s) => s.moduleId);
  const isLinkActive = scanModuleId === "error-check";
  const isCancelling = useScanStore((s) => s.isCancelling);
  const running = isLinkActive && (scanStatus === "running" || isCancelling);
  const errorMessage = useScanStore((s) => (isLinkActive ? s.errorMessage : ""));
  const urlsProcessed = useScanStore((s) => (isLinkActive ? s.urlsProcessed : 0));
  const errorCount = useScanStore((s) => (isLinkActive ? s.errorCount : 0));
  const currentUrl = useScanStore((s) => (isLinkActive ? s.currentUrl : ""));
  const statusLine = useScanStore((s) => (isLinkActive ? s.message : ""));
  const startErrorCheck = useScanStore((s) => s.startErrorCheck);
  const cancelScan = useScanStore((s) => s.cancelScan);
  const dashboardRefreshKey = useDashboardStore((s) => s.refreshKey);
  const globalBusy = useGlobalWorkBusy();
  const showProgress =
    isLinkActive &&
    (scanStatus === "running" ||
      scanStatus === "success" ||
      isCancelling ||
      statusLine === "Starting check…" ||
      statusLine === "Checking pages…");

  const loadReports = useCallback(async (selectFirst = false) => {
    try {
      const data = await fetchJson<{ reports: ReportMeta[] }>(`/api/modules/${MODULE_ID}/reports`);
      const list = data.reports || [];
      setReports(list);
      if (selectFirst && list.length) {
        setActiveReportId(list[0].id);
      }
    } catch (err) {
      setReportLoadError(err instanceof Error ? err.message : "Failed to load reports");
    }
  }, []);

  const loadReport = useCallback(async (reportId: string) => {
    try {
      const result = await fetchJson<{ data: ErrorCheckReport }>(
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
      void loadReports(true);
    }
  }, [scanModuleId, scanStatus, loadReports, dashboardRefreshKey]);

  const startCheck = async () => {
    const urlError = validateUrl(url);
    if (urlError) {
      toast.error(urlError);
      return;
    }
    const maxUrls = Math.min(Math.max(parseInt(maxPages, 10) || 100, 1), 500);
    const depth = Math.min(Math.max(parseInt(maxDepth, 10) || 5, 1), 20);
    await startErrorCheck(url, { maxUrls, maxDepth: depth });
  };

  return (
    <AppShell title="Link Radar" subtitle="Backlinks, broken links, and internal link health">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Run Error Check</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">URL</label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={globalBusy}
                  maxLength={MAX_URL_LENGTH}
                  placeholder="https://example.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Max Pages</label>
                <Input
                  type="number"
                  value={maxPages}
                  onChange={(e) => setMaxPages(e.target.value)}
                  disabled={globalBusy}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Max Depth</label>
                <Input
                  type="number"
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(e.target.value)}
                  disabled={globalBusy}
                />
              </div>
            </div>
            <div className="run-test-actions flex flex-wrap gap-3">
              <RunModuleButton
                kind="link-check"
                label="Start Check"
                loadingLabel="Checking…"
                loading={running && !isCancelling}
                disabled={isCancelling}
                onClick={startCheck}
              />
              {running ? (
                <Button
                  variant="cancel"
                  className="h-11 min-w-[120px] rounded-lg px-4"
                  loading={isCancelling}
                  disabled={isCancelling}
                  onClick={cancelScan}
                >
                  {isCancelling ? "Cancelling…" : "Stop Check"}
                </Button>
              ) : null}
            </div>
            {statusLine ? <p className="text-xs text-muted-foreground">{statusLine}</p> : null}
          </CardContent>
        </Card>

        {showProgress ? (
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-center">
                  <div className="font-mono text-xl font-bold">{urlsProcessed}</div>
                  <div className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Processed</div>
                </div>
                <div className="rounded-lg border border-primary bg-primary/10 px-3 py-2 text-center">
                  <div className="font-mono text-xl font-bold">{errorCount}</div>
                  <div className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Errors</div>
                </div>
              </div>
              {currentUrl ? (
                <p className="text-xs text-muted-foreground">Checking: {currentUrl}</p>
              ) : null}
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
                <ViewLogButton kind="error-check" size="sm" />
                <Button size="sm" onClick={startCheck}>
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
                  hasData={
                    Boolean(
                      (reportData.allCheckedUrls?.length || 0) +
                        (reportData.brokenPages?.length || 0) +
                        (reportData.brokenLinks?.length || 0)
                    )
                  }
                  onExportCsv={() => {
                    const ok = exportErrorCheckCsv(
                      reportData.brokenPages || [],
                      reportData.brokenLinks || [],
                      reportData.allCheckedUrls || []
                    );
                    if (!ok) toast.error("No data to export");
                    else toast.success("CSV downloaded");
                  }}
                  onCopyLinks={async () => {
                    const links = collectErrorCheckLinks(
                      reportData.brokenPages || [],
                      reportData.brokenLinks || [],
                      reportData.allCheckedUrls || []
                    );
                    if (!links.length) throw new Error("No links");
                    await copyTextToClipboard(links.join("\n"));
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {reports.length
                    ? "Select a report to view the HTML report."
                    : "No reports found. Run a check to generate one."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}