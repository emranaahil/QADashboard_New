import { api } from "@/lib/api";

const LOG_VIEWABLE_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "success",
  "failed",
  "cancelled",
]);

export function canViewLogs(status?: string | null): boolean {
  if (!status) return false;
  return LOG_VIEWABLE_STATUSES.has(status);
}

export function openJobLogs(moduleId: string, jobId: string) {
  window.open(api.jobLogUrl(moduleId, jobId), "_blank", "noopener,noreferrer");
}

export function openScanLogs(scanId: string) {
  window.open(api.scanLogUrl(scanId), "_blank", "noopener,noreferrer");
}

export function openErrorCheckLogs() {
  window.open(api.errorCheckLogUrl(), "_blank", "noopener,noreferrer");
}