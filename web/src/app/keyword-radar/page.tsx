"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

type ScanStatus = {
  status: string;
  error?: string;
  stats?: {
    urlsDiscovered?: number;
    urlsProcessed?: number;
    currentBatch?: number;
    matchesFound?: number;
  };
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

function ReportViewer({ data }: { data: KeywordReport }) {
  const results = data.results || [];
  const matches = data.matches || [];
  const rows = results.length
    ? results.map((item) => ({
        url: item.url,
        status: item.statusCode != null ? String(item.statusCode) : "—",
        keywords: (item.matchedKeywords || []).join(", ") || "—",
        isError: item.isError || (item.statusCode != null && item.statusCode >= 400),
      }))
    : matches.map((m) => ({
        url: m.url,
        status: "—",
        keywords: m.keyword,
        isError: false,
      }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold">{data.url || "Keyword Scan"}</h3>
        <p className="text-xs text-muted-foreground">
          Status: <strong>{data.status || "—"}</strong>
          {" · "}
          Keywords: {(data.keywords || []).join(", ") || "—"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { label: "Processed", value: data.stats?.urlsProcessed || 0, highlight: false },
          { label: "Matches", value: data.stats?.matchesFound ?? matches.length, highlight: true },
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

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-3 py-2 text-left font-medium">URL</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Keywords</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr
                  key={`${row.url}|${row.keywords}`}
                  className={cn("border-b border-border", row.isError && "bg-destructive/5")}
                >
                  <td className="break-all px-3 py-2">
                    <a href={row.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {row.url}
                    </a>
                  </td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">{row.keywords}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="px-3 py-2 text-muted-foreground">
                  No results
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function KeywordRadarPage() {
  const [url, setUrl] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [urlsDiscovered, setUrlsDiscovered] = useState(0);
  const [urlsProcessed, setUrlsProcessed] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [matchesFound, setMatchesFound] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [statusText, setStatusText] = useState("Initializing...");
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<KeywordReport | null>(null);
  const scanIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadReports = useCallback(async (selectFirst = false) => {
    try {
      const data = await fetchJson<{ reports: ReportMeta[] }>(`/api/modules/${MODULE_ID}/reports`);
      const list = data.reports || [];
      setReports(list);
      if (selectFirst && list.length) setActiveReportId(list[0].id);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load reports");
    }
  }, []);

  const loadReport = useCallback(async (reportId: string) => {
    try {
      const result = await fetchJson<{ data: KeywordReport }>(
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

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setShowProgress(false);
  };

  const pollStatus = async () => {
    if (!scanIdRef.current) return;
    try {
      const data = await fetchJson<ScanStatus>(`/api/scan/${scanIdRef.current}/status`);
      const stats = data.stats || {};
      setUrlsDiscovered(stats.urlsDiscovered || 0);
      setUrlsProcessed(stats.urlsProcessed || 0);
      setCurrentBatch(stats.currentBatch || 0);
      setMatchesFound(stats.matchesFound || 0);
      const pct = stats.urlsDiscovered
        ? Math.min(100, Math.round(((stats.urlsProcessed || 0) / stats.urlsDiscovered) * 100))
        : 0;
      setProgressPct(pct);
      setStatusText(data.status);

      if (data.status === "completed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setScanning(false);
        await loadReports(true);
      } else if (data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setScanning(false);
        showError(data.error || "Scan failed");
      }
    } catch (err) {
      if (pollRef.current) clearInterval(pollRef.current);
      setScanning(false);
      showError(err instanceof Error ? err.message : "Scan failed");
    }
  };

  const startScan = async () => {
    const trimmedUrl = url.trim();
    const keywords = keywordsText
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);

    if (!trimmedUrl) return showError("Please enter a website URL");
    if (!keywords.length) return showError("Please enter at least one keyword");

    setErrorMessage("");
    setShowProgress(true);
    setScanning(true);
    setUrlsDiscovered(0);
    setUrlsProcessed(0);
    setCurrentBatch(0);
    setMatchesFound(0);
    setProgressPct(0);
    setStatusText("Initializing...");

    if (pollRef.current) clearInterval(pollRef.current);

    try {
      const data = await fetchJson<{ scanId: string }>("/api/scan/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl, keywords }),
      });
      scanIdRef.current = data.scanId;
      pollRef.current = setInterval(pollStatus, 2000);
    } catch (err) {
      setScanning(false);
      setShowProgress(false);
      showError(err instanceof Error ? err.message : "Failed to start scan");
    }
  };

  const clearForm = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    scanIdRef.current = null;
    setUrl("");
    setKeywordsText("");
    setShowProgress(false);
    setErrorMessage("");
    setScanning(false);
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
                disabled={scanning}
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
                disabled={scanning}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={startScan} disabled={scanning}>
                {scanning ? "Scanning…" : "▶ Start Scan"}
              </Button>
              <Button variant="secondary" onClick={clearForm} disabled={scanning}>
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

        {errorMessage ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm text-destructive">{errorMessage}</p>
              <Button size="sm" onClick={startScan}>
                Try Again
              </Button>
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