"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { api, type Job } from "@/lib/api";
import { canViewReport } from "@/lib/report";
import { truncateUrl } from "@/lib/utils";

export default function HistoryPage() {
  const [grouped, setGrouped] = useState<Array<{ date: string; runs: Job[] }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getHistory({ limit: 100 })
      .then((data) => setGrouped(data.grouped || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell title="History" subtitle="Full execution history grouped by date">
      <div className="mx-auto max-w-5xl flex flex-col gap-4">
        {loading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : grouped.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No execution history yet.
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