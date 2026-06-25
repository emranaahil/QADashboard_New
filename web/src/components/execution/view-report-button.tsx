"use client";

import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openRunReport } from "@/lib/report";
import { cn } from "@/lib/utils";

type ViewReportButtonProps = {
  moduleId: string;
  jobId: string;
  size?: "default" | "sm";
  compact?: boolean;
  className?: string;
};

export function ViewReportButton({
  moduleId,
  jobId,
  size = "default",
  compact = false,
  className,
}: ViewReportButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={cn(compact ? "px-2" : "gap-1.5", className)}
      onClick={() => openRunReport(moduleId, jobId)}
      title="View report"
      aria-label="View report"
    >
      <FileText className="h-4 w-4" />
      {compact ? null : "View Report"}
    </Button>
  );
}