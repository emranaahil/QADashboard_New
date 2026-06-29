"use client";

import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { canViewReport } from "@/lib/report";
import { cn } from "@/lib/utils";

type StatusWithReportProps = {
  status: string;
  reportStatus?: string;
  moduleId?: string;
  jobId?: string;
  reportAvailable?: boolean;
  className?: string;
  badgeClassName?: string;
};

export function StatusWithReport({
  status,
  reportStatus,
  moduleId,
  jobId,
  reportAvailable,
  className,
  badgeClassName,
}: StatusWithReportProps) {
  const reportCheckStatus = reportStatus ?? status;
  const showViewReport =
    canViewReport({
      status: reportCheckStatus,
      reportAvailable,
    }) && !!moduleId && !!jobId;

  return (
    <div className={cn("flex shrink-0 flex-wrap items-center justify-end gap-2", className)}>
      {showViewReport ? (
        <ViewReportButton moduleId={moduleId!} jobId={jobId!} size="sm" />
      ) : null}
      <Badge variant={statusBadgeVariant(status)} className={cn("uppercase", badgeClassName)}>
        {status}
      </Badge>
    </div>
  );
}