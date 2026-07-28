"use client";

import { Menu } from "lucide-react";
import { ApiDevStatus } from "@/components/layout/api-dev-status";
import { AuthorTopBarCredit } from "@/components/layout/author-top-bar-credit";
import { GlobalSearch } from "@/components/layout/global-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { moduleLabel } from "@/lib/modules";
import { isParallelExecutionEnabled } from "@/lib/parallel-execution";
import { useExecutionStore, useRunningModuleCount } from "@/store/execution-store";
import { useScanStore } from "@/store/scan-store";

const statusLabels = {
  idle: "Idle",
  running: "Running",
  success: "Success",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function TopBar({
  title,
  subtitle,
  onMenuClick,
}: {
  title: string;
  subtitle?: string;
  onMenuClick?: () => void;
}) {
  const runningTotalCount = useRunningModuleCount();
  const drawerModuleId = useExecutionStore((s) => s.drawerModuleId);
  const moduleJobs = useExecutionStore((s) => s.moduleJobs);

  const scanStatus = useScanStore((s) => s.status);
  const scanProgress = useScanStore((s) => s.progress);
  const scanCancelling = useScanStore((s) => s.isCancelling);
  const scanModuleId = useScanStore((s) => s.moduleId);

  // Real job-engine modules only (do NOT treat scan count as a job — that forced Idle badge)
  const realJobRunning = Object.values(moduleJobs).some(
    (slice) => slice.status === "running" || slice.isCancelling
  );
  // Show scan while running OR after finish until user dismisses tray (status !== idle)
  const scanActive = Boolean(scanModuleId && scanStatus !== "idle");
  const scanRunning = scanStatus === "running" || scanCancelling;
  const parallel = isParallelExecutionEnabled();

  const focusModuleId =
    drawerModuleId ||
    Object.entries(moduleJobs).find(
      ([, slice]) => slice.status === "running" || slice.isCancelling
    )?.[0] ||
    Object.entries(moduleJobs).find(([, slice]) => slice.status !== "idle")?.[0];
  const focusSlice = focusModuleId ? moduleJobs[focusModuleId] : null;

  // Prefer an actively running job; otherwise show Link/Keyword Radar scan status
  const activeKind = realJobRunning ? "job" : scanActive ? "scan" : focusSlice ? "job" : null;
  const status =
    activeKind === "job"
      ? focusSlice?.status ?? "idle"
      : activeKind === "scan"
        ? scanStatus
        : "idle";
  const progress =
    activeKind === "job" ? focusSlice?.progress ?? 0 : activeKind === "scan" ? scanProgress : 0;
  const isCancelling =
    activeKind === "job" ? focusSlice?.isCancelling ?? false : activeKind === "scan" ? scanCancelling : false;

  const activeModuleLabel =
    activeKind === "job"
      ? parallel && runningTotalCount > 1
        ? `${runningTotalCount} modules`
        : moduleLabel(focusModuleId || "test")
      : activeKind === "scan"
        ? moduleLabel(scanModuleId || "scan")
        : null;

  return (
    <header className="glass-header mx-5 mt-5 flex shrink-0 flex-col gap-3 overflow-visible rounded-[18px] border border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
      <div className="flex min-w-0 items-center gap-3 lg:max-w-[45%] lg:flex-1 xl:max-w-none">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 lg:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
          {subtitle && (
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 lg:shrink-0">
        <GlobalSearch />
        <ApiDevStatus />
        <AuthorTopBarCredit />

        <div className="flex items-center gap-2">
          {activeModuleLabel ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">{activeModuleLabel}</span>
          ) : null}
          <Badge
            variant={
              status === "running" || isCancelling
                ? "running"
                : status === "success"
                  ? "success"
                  : status === "failed" || status === "cancelled"
                    ? "failed"
                    : "secondary"
            }
            className="rounded-full px-2.5 py-1.5"
          >
            {isCancelling
              ? "Cancelling"
              : status === "running"
                ? `${progress}%`
                : statusLabels[status as keyof typeof statusLabels] || "Idle"}
          </Badge>
        </div>
      </div>
    </header>
  );
}