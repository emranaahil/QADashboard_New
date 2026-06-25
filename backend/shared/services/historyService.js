/**
 * History adapter — aggregates job execution history across runnable modules.
 * Wraps jobStore; does not replace per-module job APIs.
 */
const fs = require('fs-extra');
const jobStore = require('../jobStore');
const { formatDisplayDate } = require('../dateFormat');
const { filterJobsForSession } = require('../reportVisibility');

const MODULE_LABELS = {
  seo: 'SEO Testing',
  'ui-check': 'UI Testing — Single Page',
  'full-ui-check': 'UI Testing — Full Website'
};

function matchesSearch(item, q) {
  if (!q) return true;
  const needle = String(q).toLowerCase().trim();
  if (!needle) return true;
  const host = (() => {
    try { return new URL(item.url).hostname.toLowerCase(); }
    catch { return ''; }
  })();
  return (
    (item.url || '').toLowerCase().includes(needle) ||
    host.includes(needle) ||
    (item.id || '').toLowerCase().includes(needle) ||
    (item.moduleId || '').toLowerCase().includes(needle) ||
    (item.moduleLabel || '').toLowerCase().includes(needle) ||
    (item.status || '').toLowerCase().includes(needle)
  );
}

async function listHistory({ limit = 100, moduleId, q, sessionId } = {}) {
  const search = String(q || '').trim();
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const modules = moduleId
    ? (jobStore.RUNNABLE_MODULES.has(moduleId) ? [moduleId] : [])
    : [...jobStore.RUNNABLE_MODULES];

  const items = [];
  for (const mod of modules) {
    const rawJobs = await jobStore.listJobs(mod, cap);
    const jobs = await jobStore.enrichJobs(mod, filterJobsForSession(rawJobs, mod, sessionId));
    for (const job of jobs) {
      const row = {
        ...job,
        moduleLabel: MODULE_LABELS[mod] || mod
      };
      if (matchesSearch(row, search)) {
        items.push(row);
      }
    }
  }

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return items.slice(0, cap);
}

function groupByDate(items) {
  const groups = {};
  for (const item of items) {
    const d = item.completedAt || item.createdAt;
    const key = d ? formatDisplayDate(d, { dateOnly: true }) : 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return Object.entries(groups).map(([date, runs]) => ({ date, runs }));
}

async function deleteHistoryEntry(moduleId, jobId) {
  if (!jobStore.RUNNABLE_MODULES.has(moduleId)) {
    throw new Error('Invalid module for history delete');
  }
  jobStore.validateJobId(jobId);
  const dir = jobStore.getJobDir(moduleId, jobId);
  if (!await fs.pathExists(dir)) {
    throw new Error('History entry not found');
  }
  await fs.remove(dir);
  return { moduleId, jobId, deleted: true };
}

module.exports = {
  listHistory,
  groupByDate,
  deleteHistoryEntry
};