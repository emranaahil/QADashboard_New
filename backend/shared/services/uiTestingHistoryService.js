/**
 * UI Testing history — server-side filter by test type and search query.
 */
const jobStore = require('../jobStore');
const { filterJobsForSession } = require('../reportVisibility');
const { jobHasQaIssues } = require('./qaReportUtils');
const { formatDisplayDate } = require('../dateFormat');

const TYPE_TO_MODULE = {
  'single-page': 'ui-check',
  'full-website': 'full-ui-check'
};

const MODULE_TO_TYPE = {
  'ui-check': 'single-page',
  'full-ui-check': 'full-website'
};

const TYPE_HEADINGS = {
  'single-page': 'Single Page History',
  'full-website': 'Full Website History'
};

function normalizeTestType(type) {
  const t = String(type || '').toLowerCase().trim();
  if (!TYPE_TO_MODULE[t]) {
    const err = new Error(`Invalid test type. Use: ${Object.keys(TYPE_TO_MODULE).join(', ')}`);
    err.code = 'INVALID_TYPE';
    throw err;
  }
  return t;
}

function deriveTestType(job, moduleId) {
  if (job.testType && TYPE_TO_MODULE[job.testType]) return job.testType;
  return MODULE_TO_TYPE[moduleId] || null;
}

function matchesSearch(item, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const host = (() => {
    try { return new URL(item.url).hostname.toLowerCase(); }
    catch { return ''; }
  })();
  return (
    (item.url || '').toLowerCase().includes(needle) ||
    host.includes(needle) ||
    (item.id || '').toLowerCase().includes(needle) ||
    (item.title || '').toLowerCase().includes(needle)
  );
}

function groupByIsoDate(items) {
  const groups = new Map();
  for (const item of items) {
    const raw = item.completedAt || item.createdAt;
    const iso = raw ? new Date(raw).toISOString().slice(0, 10) : 'unknown';
    if (!groups.has(iso)) {
      groups.set(iso, {
        date: iso,
        dateLabel: iso === 'unknown' ? 'Unknown' : formatDisplayDate(`${iso}T12:00:00`, { dateOnly: true }),
        reports: []
      });
    }
    groups.get(iso).reports.push(item);
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}

async function listUiTestingHistory({ type, q, limit = 100, sessionId } = {}) {
  const testType = normalizeTestType(type);
  const moduleId = TYPE_TO_MODULE[testType];
  const search = String(q || '').trim();
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

  const rawJobs = await jobStore.listJobs(moduleId, cap);
  const jobs = await jobStore.enrichJobs(moduleId, filterJobsForSession(rawJobs, moduleId, sessionId));

  const items = (await Promise.all(
    jobs.map(async (job) => {
      const tt = deriveTestType(job, moduleId);
      let title = job.url;
      try { title = new URL(job.url).hostname; } catch { /* keep url */ }
      const hasQaIssues =
        job.status === 'completed' ? await jobHasQaIssues(moduleId, job.id) : false;
      return {
        id: job.id,
        url: job.url,
        title,
        testType: tt,
        moduleId,
        status: job.status,
        hasQaIssues,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        durationMs: job.durationMs,
        reportAvailable: job.reportAvailable,
        message: job.message,
        error: job.error,
        progress: job.progress,
        totalPages: job.totalPages,
        currentPage: job.currentPage
      };
    })
  ))
    .filter((item) => item.testType === testType)
    .filter((item) => matchesSearch(item, search));

  return {
    testType,
    moduleId,
    heading: TYPE_HEADINGS[testType],
    total: items.length,
    grouped: groupByIsoDate(items),
    items
  };
}

module.exports = {
  TYPE_TO_MODULE,
  MODULE_TO_TYPE,
  TYPE_HEADINGS,
  normalizeTestType,
  deriveTestType,
  listUiTestingHistory
};