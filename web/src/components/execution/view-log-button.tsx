"use client";

import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openErrorCheckLogs, openJobLogs, openScanLogs } from "@/lib/logs";

type JobLogProps = {
  kind: "job";
  moduleId: string;
  jobId: string;
};

type ScanLogProps = {
  kind: "scan";
  scanId: string;
};

type ErrorCheckLogProps = {
  kind: "error-check";
};

type ViewLogButtonProps = (JobLogProps | ScanLogProps | ErrorCheckLogProps) & {
  size?: "default" | "sm";
  className?: string;
};

export function ViewLogButton({ size = "default", className, ...props }: ViewLogButtonProps) {
  const handleClick = () => {
    if (props.kind === "job") {
      openJobLogs(props.moduleId, props.jobId);
      return;
    }
    if (props.kind === "scan") {
      openScanLogs(props.scanId);
      return;
    }
    openErrorCheckLogs();
  };

  return (
    <Button variant="outline" size={size} className={className} onClick={handleClick}>
      <ScrollText className="h-4 w-4" />
      View Log
    </Button>
  );
}