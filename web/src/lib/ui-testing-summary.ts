import { api } from "@/lib/api";

export type UiTestSummary = {
  pages: number;
  checks: number;
  issues: number;
};

function countFromEntries(entries: unknown[]): UiTestSummary {
  const pages = entries.length;
  const checks = entries.length;
  const issues = entries.reduce<number>((sum, e) => {
    const item = e as { issues?: unknown[] };
    return sum + (Array.isArray(item.issues) ? item.issues.length : 0);
  }, 0);
  return { pages, checks, issues };
}

export function fallbackSummary(opts: {
  totalPages?: number;
  deviceCount?: number;
  completed?: boolean;
}): UiTestSummary {
  const pages = opts.totalPages && opts.totalPages > 0 ? opts.totalPages : opts.completed ? 1 : 0;
  const checks = pages > 0 ? pages : opts.completed ? opts.deviceCount || 1 : 0;
  return { pages, checks, issues: 0 };
}

export async function loadUiTestSummary(
  moduleId: string,
  jobId: string,
  fallback: UiTestSummary
): Promise<UiTestSummary> {
  try {
    const report = await api.getReport(moduleId, `job:${jobId}`);
    const payload = report.data;
    const entries = Array.isArray(payload) ? payload : [];
    if (entries.length) return countFromEntries(entries);
  } catch {
    /* use fallback */
  }
  return fallback;
}