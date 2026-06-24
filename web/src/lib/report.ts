import type { Job } from "@/lib/api";
import { api } from "@/lib/api";

export function canViewReport(job?: Job | null): boolean {
  return job?.status === "completed" && job.reportAvailable === true;
}

export function openJobReport(moduleId: string, jobId: string) {
  window.open(api.jobReportUrl(moduleId, jobId), "_blank", "noopener,noreferrer");
}