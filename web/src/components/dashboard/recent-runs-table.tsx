"use client";

import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { truncateUrl } from "@/lib/utils";
import type { DashboardStats } from "@/lib/api";

export function RecentRunsTable({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) {
  return (
    <Card className="flex-1">
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">URL</th>
                  <th className="px-4 py-3 font-medium">Module</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-border/60 transition-colors duration-150 hover:bg-elevated/40"
                  >
                    <td className="max-w-[240px] truncate px-4 py-3.5 font-medium" title={run.url}>
                      {truncateUrl(run.url, 42)}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">{run.moduleId}</td>
                    <td className="px-4 py-3.5">
                      <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}