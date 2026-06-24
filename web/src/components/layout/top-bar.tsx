"use client";

import { Menu } from "lucide-react";
import { GlobalSearch } from "@/components/layout/global-search";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useExecutionStore } from "@/store/execution-store";

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
  const status = useExecutionStore((s) => s.status);
  const progress = useExecutionStore((s) => s.progress);
  const moduleId = useExecutionStore((s) => s.moduleId);
  const isCancelling = useExecutionStore((s) => s.isCancelling);

  return (
    <header className="glass-header mx-5 mt-5 flex shrink-0 flex-wrap items-center justify-between gap-4 rounded-[18px] border border-border px-5 py-4">
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

        <div className="flex items-center gap-2">
          {(status === "running" || isCancelling) && (
            <div className="hidden w-28 md:block">
              <Progress value={progress} className="h-2" />
            </div>
          )}
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
            {isCancelling ? "Cancelling" : statusLabels[status]}
            {(status === "running" || isCancelling) && moduleId && (
              <span className="ml-1 font-normal opacity-70">· {progress}%</span>
            )}
          </Badge>
        </div>
      </div>
    </header>
  );
}