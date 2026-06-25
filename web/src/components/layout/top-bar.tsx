"use client";

import { Menu } from "lucide-react";
import { ApiDevStatus } from "@/components/layout/api-dev-status";
import { AuthorTopBarCredit } from "@/components/layout/author-top-bar-credit";
import { GlobalSearch } from "@/components/layout/global-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useExecutionStore } from "@/store/execution-store";
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
  const jobStatus = useExecutionStore((s) => s.status);
  const jobProgress = useExecutionStore((s) => s.progress);
  const jobCancelling = useExecutionStore((s) => s.isCancelling);
  const jobModuleId = useExecutionStore((s) => s.moduleId);

  const scanStatus = useScanStore((s) => s.status);
  const scanProgress = useScanStore((s) => s.progress);
  const scanCancelling = useScanStore((s) => s.isCancelling);
  const scanModuleId = useScanStore((s) => s.moduleId);

  const jobRunning = jobStatus === "running" || jobCancelling;
  const scanRunning = scanStatus === "running" || scanCancelling;

  const activeKind = jobRunning ? "job" : scanRunning ? "scan" : null;
  const status = activeKind === "job" ? jobStatus : activeKind === "scan" ? scanStatus : "idle";
  const progress = activeKind === "job" ? jobProgress : scanProgress;
  const isCancelling = activeKind === "job" ? jobCancelling : scanCancelling;
  const moduleLabel =
    activeKind === "job"
      ? jobModuleId || "test"
      : activeKind === "scan"
        ? scanModuleId === "keyword-check"
          ? "keyword"
          : scanModuleId === "error-check"
            ? "link"
            : "scan"
        : null;

  return (
    <header className="glass-header mx-5 mt-5 flex shrink-0 flex-wrap items-center justify-between gap-4 overflow-visible rounded-[18px] border border-border px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
          {subtitle && (
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <GlobalSearch />
        <ApiDevStatus />
        <AuthorTopBarCredit />

        <div className="flex items-center gap-2">
          {moduleLabel ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">{moduleLabel}</span>
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