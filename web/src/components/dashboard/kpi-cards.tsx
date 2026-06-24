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

  const items = [
    { label: "Total Tests", value: stats.totalTests, trend: null },
    { label: "Passed", value: stats.passed, trend: stats.trends.passed },
    { label: "Failed", value: stats.failed, trend: stats.trends.failed },
    {
      label: "Success Rate",
      value: `${stats.successRate}%`,
      trend: stats.trends.successRate,
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