/** Shared TTL settings — no jobStore imports (avoids circular dependency). */

function isEnabled() {
  if (process.env.EPHEMERAL_LIVE_REPORTS === 'false') return false;
  if (!process.env.STORAGE_ROOT) return false;
  if (process.env.NODE_ENV !== 'production') return false;
  return process.env.EPHEMERAL_LIVE_REPORTS === 'true' || process.env.RENDER === 'true';
}

function getTtlMs() {
  if (process.env.LIVE_REPORT_TTL_MS) {
    const ms = Number(process.env.LIVE_REPORT_TTL_MS);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (process.env.LIVE_REPORT_TTL_MINUTES) {
    const mins = Number(process.env.LIVE_REPORT_TTL_MINUTES);
    if (Number.isFinite(mins) && mins > 0) return mins * 60 * 1000;
  }
  return 10 * 60 * 1000;
}

function getExpiresAt(fromIso = new Date().toISOString()) {
  return new Date(new Date(fromIso).getTime() + getTtlMs()).toISOString();
}

module.exports = {
  isEnabled,
  getTtlMs,
  getExpiresAt
};