"use client";

import { StatusWithReport } from "@/components/execution/status-with-report";
import { cn } from "@/lib/utils";

type HistoryReportListItemProps = {
  id: string;
  moduleId: string;
  title?: string;
  url: string;
  status: string;
  reportStatus?: string;
  reportAvailable?: boolean;
  meta?: string;
  selected?: boolean;
  onSelect: () => void;
};

export function HistoryReportListItem({
  id,
  moduleId,
  title,
  url,
  status,
  reportStatus,
  reportAvailable,
  meta,
  selected = false,
  onSelect,
}: HistoryReportListItemProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-center gap-3 rounded-[12px] border px-4 py-3 text-sm transition-colors",
        selected
          ? "border-[rgba(29,191,115,0.5)] bg-[rgba(29,191,115,0.08)]"
          : "border-border bg-background-elevated hover:border-[rgba(29,191,115,0.35)]"
      )}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <div className="truncate font-medium">{title || url}</div>
        <div className="truncate text-xs text-muted-foreground">{url}</div>
        {meta ? (
          <div className="mt-0.5 text-[0.68rem] text-muted-foreground/80">{meta}</div>
        ) : null}
      </button>
      <StatusWithReport
        status={status}
        reportStatus={reportStatus}
        moduleId={moduleId}
        jobId={id}
        reportAvailable={reportAvailable}
        className="ml-auto"
      />
    </div>
  );
}