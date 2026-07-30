"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardStats } from "@/lib/api";

export function KpiCards({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) {
  if (loading || !stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  const trends = stats.trends || { passed: "", failed: "", successRate: "" };
  const items = [
    { label: "Total Tests", value: stats.totalTests ?? 0, trend: null as string | null },
    { label: "Passed", value: stats.passed ?? 0, trend: trends.passed || null },
    { label: "Failed", value: stats.failed ?? 0, trend: trends.failed || null },
    {
      label: "Success Rate",
      value: `${stats.successRate ?? 0}%`,
      trend: trends.successRate || null,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="hover-lift">
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
              {item.value}
            </p>
            {item.trend && (
              <p className="mt-1 text-xs text-muted-foreground">{item.trend} vs last week</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}