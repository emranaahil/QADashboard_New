/**
 * Execution controller — wraps existing jobQueue + executionService.
 * Provides cancel, status, and progress without replacing Playwright pipelines.
 */
const jobStore = require('./jobStore');
const jobQueue = require('./jobQueue');
const executionService = require('./services/executionService');
const executionProgress = require('./executionProgress');
const executionLock = require('./executionLock');

async function startExecution(moduleId, payload) {
  executionLock.assertCanStart();
  return executionService.startExecution(moduleId, payload);
}

async function cancelExecution(moduleId, jobId) {
  jobStore.validateJobId(jobId);
  const job = await jobStore.getJob(moduleId, jobId);
  if (!job) throw new Error('Job not found');

  if (jobStore.TERMINAL_STATUSES.has(job.status)) {
    return jobStore.enrichJob(moduleId, job);
  }

  const result = await executionLock.safeCancelExecution(moduleId, jobId, async () => {
    const cancelled = await jobQueue.cancelJob(moduleId, jobId);
    return jobStore.enrichJob(moduleId, cancelled);
  });

  if (!result.ok) {
    throw new Error(result.error || 'Cancel failed');
  }

  if (result.job) return result.job;

  const refreshed = await jobStore.getJob(moduleId, jobId);
  return jobStore.enrichJob(moduleId, refreshed);
}

async function getExecutionStatus(moduleId, jobId) {
  const job = await executionService.getExecution(moduleId, jobId);
  if (!job) return executionProgress.toExecutionState(null);
  return executionProgress.toExecutionState(job);
}

async function getExecutionProgress(moduleId, jobId) {
  return getExecutionStatus(moduleId, jobId);
}

/** SSE URL for clients — use existing /api/modules/:id/jobs/:id/events stream. */
function getExecutionEventsUrl(moduleId, jobId) {
  return `/api/modules/${moduleId}/jobs/${jobId}/events`;
}

module.exports = {
  startExecution,
  cancelExecution,
  getExecutionStatus,
  getExecutionProgress,
  getExecutionEventsUrl
};