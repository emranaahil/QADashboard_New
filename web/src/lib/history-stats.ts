export type HistoryStatsItem = {
  status: string;
  hasQaIssues?: boolean;
};

export function isHistoryRunFailed(item: HistoryStatsItem): boolean {
  if (item.status === "failed" || item.status === "cancelled") return true;
  if (item.status === "completed" && item.hasQaIssues) return true;
  return false;
}

export function isHistoryRunCompleted(item: HistoryStatsItem): boolean {
  return item.status === "completed" && !item.hasQaIssues;
}

export function getHistoryDisplayStatus(item: HistoryStatsItem): string {
  if (item.status === "completed" && item.hasQaIssues) return "failed";
  return item.status;
}

export function computeHistoryStats(items: HistoryStatsItem[]) {
  let completed = 0;
  let failed = 0;
  let running = 0;

  for (const item of items) {
    if (item.status === "running" || item.status === "pending") {
      running++;
    } else if (isHistoryRunFailed(item)) {
      failed++;
    } else if (isHistoryRunCompleted(item)) {
      completed++;
    }
  }

  return { total: items.length, completed, failed, running };
}