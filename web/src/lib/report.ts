import type { Job } from "@/lib/api";
import { api } from "@/lib/api";
import { moduleReportHtmlUrl } from "@/lib/radar-report-utils";

type ReportAvailability = {
  status?: string;
  reportAvailable?: boolean;
  moduleId?: string;
  id?: string;
};

const ACTIVE_STATUSES = new Set(["running", "pending", "starting"]);

export function canViewReport(job?: Job | ReportAvailability | null): boolean {
  if (job?.reportAvailable !== true) return false;
  const status = (job?.status || "").toLowerCase();
  if (!status || status === "cancelled") return false;
  if (ACTIVE_STATUSES.has(status)) return false;
  return true;
}

export function openJobReport(moduleId: string, jobId: string) {
  window.open(api.jobReportUrl(moduleId, jobId), "_blank", "noopener,noreferrer");
}

function openModuleHtmlReport(moduleId: string, reportId: string) {
  const path = moduleReportHtmlUrl(moduleId, reportId);
  const url = path.startsWith("http") ? path : `${window.location.origin}${path}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function openRunReport(moduleId: string, reportId: string) {
  if (moduleId === "keyword-check" || moduleId === "error-check") {
    openModuleHtmlReport(moduleId, reportId);
    return;
  }
  openJobReport(moduleId, reportId);
}