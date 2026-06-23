/**
 * SEO Testing history — server-side filter by test type (mode) and search query.
 */
const jobStore = require('../jobStore');

const MODULE_ID = 'seo';

const TYPE_TO_MODE = {
  'single-page': 'single',
  'full-website': 'full'
};

const MODE_TO_TYPE = {
  single: 'single-page',
  full: 'full-website'
};

const TYPE_HEADINGS = {
  'single-page': 'SEO History',
  'full-website': 'SEO History'
};

function normalizeTestType(type) {
  const t = String(type || '').toLowerCase().trim();
  if (!TYPE_TO_MODE[t]) {
    const err = new Error(`Invalid test type. Use: ${Object.keys(TYPE_TO_MODE).join(', ')}`);
    err.code = 'INVALID_TYPE';
    throw err;
  }
  return t;
}

function deriveTestType(job) {
  if (job.testType && TYPE_TO_MODE[job.testType]) return job.testType;
  const mode = job.options?.mode || 'single';
  return MODE_TO_TYPE[mode] || 'single-page';
}

function matchesMode(job, testType) {
  const mode = TYPE_TO_MODE[testType];
  const jobMode = job.options?.mode || 'single';
  return jobMode === mode;
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
        dateLabel: iso === 'unknown' ? 'Unknown' : new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }),
        reports: []
      });
    }
    groups.get(iso).reports.push(item);
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}

async function listSeoTestingHistory({ type, q, limit = 100 } = {}) {
  const testType = normalizeTestType(type);
  const search = String(q || '').trim();
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

  const jobs = await jobStore.enrichJobs(MODULE_ID, await jobStore.listJobs(MODULE_ID, cap));

  const items = jobs
    .filter(job => matchesMode(job, testType))
    .map(job => {
      const tt = deriveTestType(job);
      let title = job.url;
      try { title = new URL(job.url).hostname; } catch { /* keep url */ }
      return {
        id: job.id,
        url: job.url,
        title,
        testType: tt,
        moduleId: MODULE_ID,
        status: job.status,
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
    .filter(item => item.testType === testType)
    .filter(item => matchesSearch(item, search));

  return {
    testType,
    moduleId: MODULE_ID,
    heading: TYPE_HEADINGS[testType],
    total: items.length,
    grouped: groupByIsoDate(items),
    items
  };
}

module.exports = {
  MODULE_ID,
  TYPE_TO_MODE,
  MODE_TO_TYPE,
  TYPE_HEADINGS,
  normalizeTestType,
  deriveTestType,
  listSeoTestingHistory
};