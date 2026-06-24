"use client";

import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openJobReport } from "@/lib/report";

type ViewReportButtonProps = {
  moduleId: string;
  jobId: string;
  size?: "default" | "sm";
  className?: string;
};

export function ViewReportButton({ moduleId, jobId, size = "default", className }: ViewReportButtonProps) {
  return (
    <Button
      variant="outline"
      size={size}
      className={className}
      onClick={() => openJobReport(moduleId, jobId)}
    >
      <FileText className="h-4 w-4" />
      View Report
    </Button>
  );
}