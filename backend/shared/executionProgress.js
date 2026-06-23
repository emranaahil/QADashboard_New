/**
 * Execution progress adapter — locks totalPages once, updates currentPage/currentUrl.
 */
const jobStore = require('./jobStore');

async function lockTotalPages(moduleId, jobId, totalPages) {
  const total = Math.max(0, Number(totalPages) || 0);
  return jobStore.updateJob(moduleId, jobId, {
    totalPages: total,
    currentPage: 0,
    currentUrl: '',
    message: total > 0 ? `Ready — 0 / ${total} pages` : 'Discovering pages...'
  });
}

async function updatePageProgress(moduleId, jobId, { currentPage, currentUrl, progress }) {
  let job = await jobStore.getJob(moduleId, jobId);
  if (!job) {
    await new Promise(r => setTimeout(r, 50));
    job = await jobStore.getJob(moduleId, jobId);
  }
  if (!job) return null;

  const total = job.totalPages || 0;
  const current = Math.max(0, Number(currentPage) || 0);
  const patch = {
    currentPage: current,
    currentUrl: currentUrl || job.currentUrl || ''
  };

  if (total > 0) {
    const pct = progress != null
      ? progress
      : Math.min(99, Math.round((current / total) * 100));
    patch.progress = pct;
    patch.message = `Scanning pages... ${current} / ${total}`;
  }

  return jobStore.updateJob(moduleId, jobId, patch);
}

function toExecutionState(job) {
  if (!job) {
    return {
      status: 'idle',
      progress: { current: 0, total: 0 },
      currentPage: 0,
      totalPages: 0,
      currentUrl: '',
      progressPercent: 0,
      logs: []
    };
  }

  let status = job.status;
  if (status === 'pending') status = 'running';
  if (status === 'completed') status = 'success';

  return {
    status,
    progress: {
      current: job.currentPage || 0,
      total: job.totalPages || 0
    },
    currentPage: job.currentPage || 0,
    totalPages: job.totalPages || 0,
    currentUrl: job.currentUrl || '',
    progressPercent: job.progress || 0,
    logs: job.logs || [],
    message: job.message || '',
    error: job.error || null,
    jobId: job.id,
    moduleId: job.moduleId,
    url: job.url
  };
}

module.exports = {
  lockTotalPages,
  updatePageProgress,
  toExecutionState
};