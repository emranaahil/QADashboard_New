const fs = require('fs');
const path = require('path');

/**
 * Cleanup old generated QA report artifacts.
 *
 * WARNING: Never deletes screenshots.
 * Deletes only:
 *  - reports/<runId>/qa-report.html
 *  - reports/<runId>/report.pdf
 */

function parseRunTime(runFolderName) {
  // Expected format: 2026-06-16T07-58-02-589Z
  // Convert '-' in time parts back to ':' and '.' for ISO parse.
  // We do a best-effort parse; if it fails return null.
  try {
    // Rebuild ISO-like string
    // 2026-06-16T07-58-02-589Z -> 2026-06-16T07:58:02.589Z
    const m = /^\d{4}-\d{2}-\d{2}T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(runFolderName);
    if (!m) return null;
    const hh = m[1];
    const mm = m[2];
    const ss = m[3];
    const ms = m[4];
    const iso = `${runFolderName.slice(0, 10)}T${hh}:${mm}:${ss}.${ms}Z`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function deleteIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // intentionally swallow; cleanup should not break QA
  }
}

function listRunFolders(reportsRoot) {
  if (!fs.existsSync(reportsRoot)) return [];
  return fs
    .readdirSync(reportsRoot)
    .filter((name) => {
      const full = path.join(reportsRoot, name);
      return fs.statSync(full).isDirectory();
    });
}

function cleanupReports({
  reportsRoot = 'reports',
  keepLastRuns = 10,
  keepNewerThanDays = 30
} = {}) {
  const now = Date.now();
  const keepAgeMs = keepNewerThanDays * 24 * 60 * 60 * 1000;

  const runFolders = listRunFolders(reportsRoot);

  // Build run entries with timestamps when possible
  const runs = runFolders
    .map((name) => {
      const t = parseRunTime(name);
      return t ? { name, t } : null;
    })
    .filter(Boolean);

  // Determine which runs to keep by both rules
  const sorted = [...runs].sort((a, b) => b.t - a.t); // newest first

  const keepByLast = new Set(sorted.slice(0, keepLastRuns).map((r) => r.name));
  const cutoff = now - keepAgeMs;
  const keepByAge = new Set(runs.filter((r) => r.t >= cutoff).map((r) => r.name));

  // Whichever retains more data => keep = union of both sets.
  // (This retains more if either criterion matches more runs.)
  const keep = new Set([...keepByLast, ...keepByAge]);

  const deleted = [];
  const candidates = sorted.filter((r) => !keep.has(r.name));

  for (const r of candidates) {
    const runDir = path.join(reportsRoot, r.name);
    const html = path.join(runDir, 'qa-report.html');
    const pdf = path.join(runDir, 'report.pdf');

    // Only delete report artifacts; never delete screenshots.
    const beforeHtmlExists = fs.existsSync(html);
    const beforePdfExists = fs.existsSync(pdf);

    if (beforeHtmlExists) deleteIfExists(html);
    if (beforePdfExists) deleteIfExists(pdf);

    if (beforeHtmlExists || beforePdfExists) {
      deleted.push({ run: r.name, deleted: { html: beforeHtmlExists, pdf: beforePdfExists } });
    }
  }

  return { deleted };
}

module.exports = { cleanupReports };

