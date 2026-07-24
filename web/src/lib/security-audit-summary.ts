import { api } from "@/lib/api";

export type SecurityAuditSummary = {
  pages: number;
  w3cErrors: number;
  w3cWarnings: number;
  redirectIssues: number;
  robotsTxtIssues: number;
  sslLabsIssues: number;
  sslLabsHostsChecked: number;
  pageSpeedAverage: number | null;
  pagesWithIssues: number;
};

type SecurityReportPayload = {
  summary?: {
    pagesAudited?: number;
    w3cErrors?: number;
    w3cWarnings?: number;
    redirectIssues?: number;
    robotsTxtIssues?: number;
    sslLabsIssues?: number;
    sslLabsHostsChecked?: number;
    pageSpeedAverage?: number | null;
    pagesWithIssues?: number;
  };
  pages?: unknown[];
};

export function fallbackSecuritySummary(opts: {
  totalPages?: number;
  completed?: boolean;
}): SecurityAuditSummary {
  const pages = opts.totalPages && opts.totalPages > 0 ? opts.totalPages : opts.completed ? 1 : 0;
  return {
    pages,
    w3cErrors: 0,
    w3cWarnings: 0,
    redirectIssues: 0,
    robotsTxtIssues: 0,
    sslLabsIssues: 0,
    sslLabsHostsChecked: 0,
    pageSpeedAverage: null,
    pagesWithIssues: 0,
  };
}

export async function loadSecurityAuditSummary(
  jobId: string,
  fallback: SecurityAuditSummary
): Promise<SecurityAuditSummary> {
  try {
    const report = await api.getReport("security-audit", `job:${jobId}`);
    const payload = report.data as SecurityReportPayload;
    const summary = payload?.summary;
    if (summary) {
      return {
        pages: summary.pagesAudited ?? fallback.pages,
        w3cErrors: summary.w3cErrors ?? 0,
        w3cWarnings: summary.w3cWarnings ?? 0,
        redirectIssues: summary.redirectIssues ?? 0,
        robotsTxtIssues: summary.robotsTxtIssues ?? 0,
        sslLabsIssues: summary.sslLabsIssues ?? 0,
        sslLabsHostsChecked: summary.sslLabsHostsChecked ?? 0,
        pageSpeedAverage: summary.pageSpeedAverage ?? null,
        pagesWithIssues: summary.pagesWithIssues ?? 0,
      };
    }
    if (Array.isArray(payload?.pages) && payload.pages.length) {
      return { ...fallback, pages: payload.pages.length };
    }
  } catch {
    /* use fallback */
  }
  return fallback;
}