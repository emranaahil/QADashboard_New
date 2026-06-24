"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { UiTestingSegmented } from "@/components/modules/ui-testing-segmented";
import { api, type SeoTestingHistoryItem, type SeoTestingHistoryResponse } from "@/lib/api";

type TestType = "single-page" | "full-website";

const EMPTY_MESSAGES: Record<TestType, string> = {
  "single-page": "No Single Page SEO reports found",
  "full-website": "No Full Website SEO reports found",
};

const HISTORY_TYPE_OPTIONS = [
  { value: "single-page" as const, label: "Single Page" },
  { value: "full-website" as const, label: "Full Website" },
];

type Props = {
  testType: TestType;
  onTestTypeChange: (type: TestType) => void;
  onSelectReport: (item: SeoTestingHistoryItem) => void;
  refreshKey?: number;
  selectedJobId?: string | null;
};

function computeStats(items: SeoTestingHistoryItem[]) {
  let completed = 0;
  let failed = 0;
  let running = 0;
  for (const item of items) {
    if (item.status === "completed") completed++;
    else if (item.status === "failed" || item.status === "cancelled") failed++;
    else if (item.status === "running" || item.status === "pending") running++;
  }
  return { total: items.length, completed, failed, running };
}

function formatReportTime(item: SeoTestingHistoryItem) {
  const raw = item.completedAt || item.createdAt;
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function MiniStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "default" | "info" | "success" | "error";
}) {
  const toneClass =
    tone === "info"
      ? "text-blue-400"
      : tone === "success"
        ? "text-[#1dbf73]"
        : tone === "error"
          ? "text-destructive"
          : "";
  return (
    <div className="stat-card flex h-24 flex-col items-center justify-center rounded-[14px] border border-border bg-background-elevated px-2 text-center">
      <div className={`text-lg font-bold leading-tight ${toneClass}`}>{value}</div>
      <div className="mt-1 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function SeoTestingHistoryPanel({
  testType,
  onTestTypeChange,
  onSelectReport,
  refreshKey = 0,
  selectedJobId = null,
}: Props) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<SeoTestingHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getSeoTestingHistory({
        type: testType,
        q: debouncedSearch || undefined,
        limit: 100,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [testType, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const stats = useMemo(() => computeStats(data?.items || []), [data?.items]);

  const subheading = useMemo(() => {
    if (!stats.total) return "Past SEO test runs";
    return `${stats.total} saved SEO report${stats.total === 1 ? "" : "s"}`;
  }, [stats.total]);

  const toggleDate = (date: string) => {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const emptyMessage = useMemo(() => {
    const base = EMPTY_MESSAGES[testType];
    return debouncedSearch ? `${base} for "${debouncedSearch}"` : base;
  }, [testType, debouncedSearch]);

  return (
    <Card className="history-container w-full rounded-[20px]">
      <CardContent className="flex flex-col gap-6 p-8">
        <div>
          <h2 className="text-lg font-bold leading-tight">SEO History</h2>
          <p className="mt-2 text-sm text-muted-foreground">{subheading}</p>
        </div>

        {stats.total > 0 && (
          <div
            className="stats-grid grid grid-cols-2 gap-3 md:grid-cols-4"
            aria-label="History statistics"
          >
            <MiniStat value={stats.total} label="Total" />
            <MiniStat value={stats.running} label="Running" tone="info" />
            <MiniStat value={stats.completed} label="Completed" tone="success" />
            <MiniStat value={stats.failed} label="Failed" tone="error" />
          </div>
        )}

        <div className="history-toolbar flex flex-col items-stretch gap-4 border-b border-border pb-6 sm:flex-row sm:items-center">
          <Input
            type="search"
            placeholder="Search by URL, domain, or report name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input h-11 w-full flex-1 rounded-lg"
            aria-label="Search history"
          />
          <UiTestingSegmented
            value={testType}
            options={HISTORY_TYPE_OPTIONS}
            onChange={onTestTypeChange}
            size="md"
            className="filter-radio w-full shrink-0 sm:w-auto"
            aria-label="History type filter"
          />
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading history…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && !data?.grouped?.length && (
          <div className="rounded-[14px] border border-dashed border-border bg-background-elevated px-6 py-8 text-center">
            <p className="text-sm font-semibold">
              {debouncedSearch ? "No matching reports" : "No reports yet"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {debouncedSearch
                ? emptyMessage
                : "Run a test above to generate your first report. Completed runs appear here automatically."}
            </p>
          </div>
        )}

        {!loading &&
          !error &&
          data?.grouped?.map((group) => {
            const collapsed = collapsedDates.has(group.date);
            return (
              <section key={group.date} className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => toggleDate(group.date)}
                  className="flex w-full items-center gap-2 border-b border-border py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  aria-expanded={!collapsed}
                >
                  <span className="w-3">{collapsed ? "▶" : "▼"}</span>
                  <span className="flex-1">{group.dateLabel || group.date}</span>
                  <span className="opacity-70">{group.reports.length}</span>
                </button>
                {!collapsed &&
                  group.reports.map((item) => {
                    const time = formatReportTime(item);
                    const duration = item.durationMs ? `${Math.round(item.durationMs / 1000)}s` : null;
                    const meta = [duration, time].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectReport(item)}
                        className={`flex w-full items-center justify-between gap-3 rounded-[12px] border px-4 py-3 text-left text-sm transition-colors hover:border-[rgba(29,191,115,0.35)] ${
                          selectedJobId === item.id
                            ? "border-[rgba(29,191,115,0.5)] bg-[rgba(29,191,115,0.08)]"
                            : "border-border bg-background-elevated"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{item.title || item.url}</div>
                          <div className="truncate text-xs text-muted-foreground">{item.url}</div>
                          {meta && (
                            <div className="mt-0.5 text-[0.68rem] text-muted-foreground/80">{meta}</div>
                          )}
                        </div>
                        <Badge variant={statusBadgeVariant(item.status)} className="shrink-0 uppercase">
                          {item.status}
                        </Badge>
                      </button>
                    );
                  })}
              </section>
            );
          })}
      </CardContent>
    </Card>
  );
}