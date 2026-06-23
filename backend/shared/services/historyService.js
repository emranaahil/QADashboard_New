/**
 * History adapter — aggregates job execution history across runnable modules.
 * Wraps jobStore; does not replace per-module job APIs.
 */
const fs = require('fs-extra');
const jobStore = require('../jobStore');

const MODULE_LABELS = {
  seo: 'SEO Testing',
  'ui-check': 'UI Testing — Single Page',
  'full-ui-check': 'UI Testing — Full Website'
};

async function listHistory({ limit = 100, moduleId } = {}) {
  const modules = moduleId
    ? (jobStore.RUNNABLE_MODULES.has(moduleId) ? [moduleId] : [])
    : [...jobStore.RUNNABLE_MODULES];

  const items = [];
  for (const mod of modules) {
    const jobs = await jobStore.enrichJobs(mod, await jobStore.listJobs(mod, limit));
    for (const job of jobs) {
      items.push({
        ...job,
        moduleLabel: MODULE_LABELS[mod] || mod
      });
    }
  }

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return items.slice(0, limit);
}

function groupByDate(items) {
  const groups = {};
  for (const item of items) {
    const d = item.completedAt || item.createdAt;
    const key = d ? new Date(d).toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    }) : 'Unknown';
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