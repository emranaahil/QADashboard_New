import { api } from "@/lib/api";

export type SeoTestSummary = {
  pages: number;
  criticalIssues: number;
  averageScore: number;
};

type SeoReportPayload = {
  summary?: {
    totalPages?: number;
    totalCritical?: number;
    averageScore?: number;
  };
  pages?: unknown[];
};

export function fallbackSeoSummary(opts: {
  totalPages?: number;
  completed?: boolean;
}): SeoTestSummary {
  const pages = opts.totalPages && opts.totalPages > 0 ? opts.totalPages : opts.completed ? 1 : 0;
  return { pages, criticalIssues: 0, averageScore: 0 };
}

export async function loadSeoTestSummary(
  jobId: string,
  fallback: SeoTestSummary
): Promise<SeoTestSummary> {
  try {
    const report = await api.getReport("seo", `job:${jobId}`);
    const payload = report.data as SeoReportPayload;
    const summary = payload?.summary;
    if (summary) {
      return {
        pages: summary.totalPages ?? fallback.pages,
        criticalIssues: summary.totalCritical ?? 0,
        averageScore: summary.averageScore ?? 0,
      };
    }
    if (Array.isArray(payload?.pages) && payload.pages.length) {
      return { pages: payload.pages.length, criticalIssues: 0, averageScore: 0 };
    }
  } catch {
    /* use fallback */
  }
  return fallback;
}