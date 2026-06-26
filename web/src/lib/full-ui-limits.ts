export const DEFAULT_MAX_PAGES = 8;
export const WARN_ABOVE_PAGES = 10;
export const LIVE_HARD_CAP = 12;
export const JOB_STALE_MS = 10 * 60 * 1000;

export function parseMaxPagesInput(value: string): number {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_PAGES;
  return parsed;
}

export function isJobHeartbeatStale(job: {
  lastHeartbeatAt?: string | null;
  startedAt?: string | null;
  createdAt?: string | null;
}): boolean {
  const heartbeat = job.lastHeartbeatAt || job.startedAt || job.createdAt;
  if (!heartbeat) return false;
  return Date.now() - new Date(heartbeat).getTime() > JOB_STALE_MS;
}