"use client";

import { Button } from "@/components/ui/button";
import { openRunReport } from "@/lib/report";

type OpenReportButtonProps = {
  moduleId: string;
  jobId: string;
  size?: "default" | "sm";
  className?: string;
  label?: string;
};

export function OpenReportButton({
  moduleId,
  jobId,
  size = "sm",
  className,
  label = "Open",
}: OpenReportButtonProps) {
  return (
    <Button
      size={size}
      variant="outline"
      className={className}
      onClick={() => openRunReport(moduleId, jobId)}
      aria-label={`Open report for job ${jobId}`}
    >
      {label}
    </Button>
  );
}