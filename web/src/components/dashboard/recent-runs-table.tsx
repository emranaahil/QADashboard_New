"use client";

import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { canViewReport } from "@/lib/report";
import { moduleLabel } from "@/lib/modules";
import { formatDateTime, truncateUrl } from "@/lib/utils";
import type { DashboardStats } from "@/lib/api";

export function RecentRunsTable({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) {
  return (
    <Card className="min-w-0 flex-1">
      <CardHeader className="pb-3">
        <CardTitle>Recent Runs</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading || !stats ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : stats.recentRuns.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No runs yet. Start a test from Quick Actions.</p>
        ) : (
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[16%]" />
              <col className="w-[24%]" />
              <col className="w-[12%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-medium align-middle">URL</th>
                <th className="px-2 py-2.5 text-left font-medium align-middle">Module</th>
                <th className="px-2 py-2.5 text-left font-medium align-middle">When</th>
                <th className="px-2 py-2.5 text-center font-medium align-middle">Status</th>
                <th className="px-2 py-2.5 text-right font-medium align-middle">Report</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentRuns.map((run) => {
                const showReport =
                  canViewReport({ status: run.status, reportAvailable: run.reportAvailable }) &&
                  !!run.moduleId &&
                  !!run.id;

                return (
                  <tr
                    key={`${run.moduleId}:${run.id}`}
                    className="border-b border-border/60 transition-colors duration-150 hover:bg-elevated/40"
                  >
                    <td className="truncate px-3 py-3 text-left font-medium align-middle" title={run.url}>
                      {truncateUrl(run.url, 28)}
                    </td>
                    <td className="truncate px-2 py-3 text-left align-middle text-muted-foreground">
                      {moduleLabel(run.moduleId)}
                    </td>
                    <td className="truncate px-2 py-3 text-left align-middle text-xs text-muted-foreground">
                      {formatDateTime(run.createdAt)}
                    </td>
                    <td className="px-2 py-3 text-center align-middle">
                      <Badge variant={statusBadgeVariant(run.status)} className="uppercase">
                        {run.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-3 text-right align-middle">
                      {showReport ? (
                        <ViewReportButton
                          moduleId={run.moduleId}
                          jobId={run.id}
                          size="sm"
                          className="max-w-full"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}