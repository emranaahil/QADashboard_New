"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
};

type ReportMeta = {
  id: string;
  title?: string;
  generatedAt?: string;
};

type ProgressStatus = {
  status?: string;
  stats?: {
    urlsProcessed?: number;
    errorCount?: number;
  };
  currentUrl?: string;
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

function ReportViewer({ data }: { data: ErrorCheckReport }) {
  const brokenPages = data.brokenPages || [];
  const brokenLinks = data.brokenLinks || [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold">Error Check — {data.url || "Report"}</h3>
        <p className="text-xs text-muted-foreground">
          Generated: {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "—"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Checked", value: data.checked || 0, highlight: false },
          { label: "Broken Pages", value: brokenPages.length, highlight: true },
          { label: "Broken Links", value: brokenLinks.length, highlight: false },
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

      <div>
        <h4 className="mb-2 text-sm font-semibold">Broken Pages</h4>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-2 text-left font-medium">URL</th>
                <th className="px-3 py-2 text-left font-medium">Issues</th>
              </tr>
            </thead>
            <tbody>
              {brokenPages.length ? (
                brokenPages.map((p) => (
                  <tr key={p.url} className="border-b border-border bg-destructive/5">
                    <td className="break-all px-3 py-2">
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {p.url}
                      </a>
                    </td>
                    <td className="px-3 py-2">{(p.detectedErrors || []).join(", ") || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-muted-foreground">
                    None
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Broken Links</h4>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-2 text-left font-medium">Broken URL</th>
                <th className="px-3 py-2 text-left font-medium">Found In</th>
              </tr>
            </thead>
            <tbody>
              {brokenLinks.length ? (
                brokenLinks.map((l) => (
                  <tr key={`${l.brokenUrl}|${l.foundIn}`} className="border-b border-border">
                    <td className="break-all px-3 py-2">
                      <a
                        href={l.brokenUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-destructive hover:underline"
                      >
                        {l.brokenUrl}
                      </a>
                    </td>
                    <td className="break-all px-3 py-2">
                      <a href={l.foundIn} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {l.foundIn}
                      </a>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-muted-foreground">
                    None
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function LinkRadarPage() {
  const [url, setUrl] = useState("https://example.com");
  const [maxPages, setMaxPages] = useState("100");
  const [maxDepth, setMaxDepth] = useState("5");
  const [statusLine, setStatusLine] = useState("");
  const [running, setRunning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [urlsProcessed, setUrlsProcessed] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [currentUrl, setCurrentUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ErrorCheckReport | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadReports = useCallback(async (selectFirst = false) => {
    try {
      const data = await fetchJson<{ reports: ReportMeta[] }>(`/api/modules/${MODULE_ID}/reports`);
      const list = data.reports || [];
      setReports(list);
      if (selectFirst && list.length) {
        setActiveReportId(list[0].id);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load reports");
    }
  }, []);

  const loadReport = useCallback(async (reportId: string) => {
    try {
      const result = await fetchJson<{ data: ErrorCheckReport }>(
        `/api/modules/${MODULE_ID}/reports/${encodeURIComponent(reportId)}`
      );
      setReportData(result.data);
      setErrorMessage("");
    } catch (err) {
      setReportData(null);
      setErrorMessage(err instanceof Error ? err.message : "Failed to load report");
    }
  }, []);

  useEffect(() => {
    loadReports(true);
  }, [loadReports]);

  useEffect(() => {
    if (activeReportId) loadReport(activeReportId);
  }, [activeReportId, loadReport]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollProgress = async () => {
    try {
      const p = await fetchJson<ProgressStatus>(`/api/check-broken-pages/status?t=${Date.now()}`);
      if (p.stats) {
        setUrlsProcessed(p.stats.urlsProcessed || 0);
        setErrorCount(p.stats.errorCount || 0);
      }
      if (p.currentUrl) setCurrentUrl(p.currentUrl);
    } catch {
      /* ignore poll errors */
    }
  };

  const startCheck = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setErrorMessage("");
    setShowProgress(true);
    setStatusLine("Starting...");
    setRunning(true);
    setUrlsProcessed(0);
    setErrorCount(0);
    setCurrentUrl("");

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(pollProgress, 1800);

    try {
      await fetchJson("/api/check-broken-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmed,
          maxUrls: parseInt(maxPages, 10) || 100,
          maxDepth: parseInt(maxDepth, 10) || 5,
          delay: 400,
        }),
      });
      if (pollRef.current) clearInterval(pollRef.current);
      setStatusLine("Check complete. Report saved.");
      setShowProgress(false);
      setRunning(false);
      await loadReports(true);
    } catch (err) {
      if (pollRef.current) clearInterval(pollRef.current);
      setErrorMessage(err instanceof Error ? err.message : "Check failed");
      setShowProgress(false);
      setRunning(false);
      setStatusLine("");
    }
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
                <Input value={url} onChange={(e) => setUrl(e.target.value)} disabled={running} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Max Pages</label>
                <Input
                  type="number"
                  value={maxPages}
                  onChange={(e) => setMaxPages(e.target.value)}
                  disabled={running}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Max Depth</label>
                <Input
                  type="number"
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(e.target.value)}
                  disabled={running}
                />
              </div>
            </div>
            <Button onClick={startCheck} disabled={running}>
              {running ? "Checking…" : "▶ Start Check"}
            </Button>
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
                        {new Date(r.generatedAt).toLocaleString()}
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
            <CardContent className="p-4">
              {reportData ? (
                <ReportViewer data={reportData} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {reports.length ? "Select a report to view results." : "No reports found for this module."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}