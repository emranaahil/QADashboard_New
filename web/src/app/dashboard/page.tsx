"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AppShell } from "@/components/layout/app-shell";
import { AboutPlatformCard } from "@/components/dashboard/about-platform-card";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { api } from "@/lib/api";
import { useDashboardStore } from "@/store/dashboard-store";

const RecentRunsTable = dynamic(
  () => import("@/components/dashboard/recent-runs-table").then((m) => m.RecentRunsTable),
  { loading: () => <div className="h-64 animate-pulse rounded-lg bg-muted" /> }
);

const QuickActions = dynamic(
  () => import("@/components/dashboard/quick-actions").then((m) => m.QuickActions),
  { loading: () => <div className="h-80 w-full animate-pulse rounded-lg bg-muted lg:w-80" /> }
);

export default function DashboardPage() {
  const { stats, loading, setStats, setLoading, refreshKey } = useDashboardStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getDashboardStats()
      .then((data) => {
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoading(false);
          setError(err.message || "Failed to load dashboard");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, setStats, setLoading]);

  return (
    <AppShell title="Hi, QA Member" subtitle="Track quality and release confidence.">
      <div className="mx-auto max-w-6xl flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            {error}
          </div>
        )}
        <KpiCards stats={stats} loading={loading} />
        <AboutPlatformCard />
        <div className="flex flex-col gap-4 lg:flex-row">
          <RecentRunsTable stats={stats} loading={loading} />
          <QuickActions />
        </div>
      </div>
    </AppShell>
  );
}