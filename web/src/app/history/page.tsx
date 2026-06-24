"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Input } from "@/components/ui/input";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { api, type Job } from "@/lib/api";
import { canViewLogs } from "@/lib/logs";
import { canViewReport } from "@/lib/report";
import { truncateUrl } from "@/lib/utils";

function HistoryPageFallback() {
  return (
    <AppShell title="History" subtitle="Full execution history grouped by date">
      <div className="mx-auto max-w-5xl">
        <Skeleton className="mb-4 h-11 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </AppShell>
  );
}

function HistoryPageContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [grouped, setGrouped] = useState<Array<{ date: string; runs: Job[] }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setQuery(initialQuery);
    setDebouncedQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setLoading(true);
    api
      .getHistory({ limit: 100, q: debouncedQuery || undefined })
      .then((data) => setGrouped(data.grouped || []))
      .finally(() => setLoading(false));
  }, [debouncedQuery]);

  return (
    <AppShell title="History" subtitle="Full execution history grouped by date">
      <div className="mx-auto max-w-5xl flex flex-col gap-4">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by URL, module, or status..."
          className="h-11 bg-background-elevated"
          aria-label="Filter history"
        />
        {loading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : grouped.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              {debouncedQuery ? `No runs match "${debouncedQuery}".` : "No execution history yet."}
            </CardContent>
          </Card>
        ) : (
          grouped.map((group) => (
            <Card key={group.date}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                  {group.date}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 p-4 pt-0">
                {group.runs.map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 transition-colors duration-150 hover:bg-elevated/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={run.url}>
                        {truncateUrl(run.url, 50)}
                      </p>
                      <p className="text-xs text-muted-foreground">{run.moduleId}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canViewReport(run) && (
                        <ViewReportButton moduleId={run.moduleId} jobId={run.id} size="sm" />
                      )}
                      {canViewLogs(run.status) && (
                        <ViewLogButton kind="job" moduleId={run.moduleId} jobId={run.id} size="sm" />
                      )}
                      <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistoryPageFallback />}>
      <HistoryPageContent />
    </Suspense>
  );
}