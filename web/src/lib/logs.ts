import { api } from "@/lib/api";

export function canViewLogs(status?: string | null): boolean {
  return status === "failed" || status === "cancelled";
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