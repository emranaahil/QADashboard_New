const jobStore = require('./jobStore');
const testStatusService = require('./testStatusService');

const STALE_MS = Number(process.env.JOB_STALE_MS || 10 * 60 * 1000);
const INTERRUPTED_MESSAGE = 'Interrupted — server restarted or process stopped unexpectedly';
const INTERRUPTED_ERROR =
  'The test was interrupted before it could finish. Try again; use 8 or fewer pages on live hosting.';

function isProcessActive(moduleId, jobId) {
  try {
    const jobQueue = require('./jobQueue');
    return jobQueue.isProcessActive(moduleId, jobId);
  } catch {
    return false;
  }
}

function isLockedExecution(moduleId, jobId) {
  try {
    const executionLock = require('./executionLock');
    const locked = executionLock.getActiveExecution();
    return !!(locked && locked.moduleId === moduleId && locked.jobId === jobId);
  } catch {
    return false;
  }
}

function isStaleJob(job) {
  if (!job) return false;
  if (job.status !== 'running' && job.status !== 'pending') return false;

  const heartbeat = job.lastHeartbeatAt || job.startedAt || job.createdAt;
  if (!heartbeat) return false;

  return Date.now() - new Date(heartbeat).getTime() > STALE_MS;
}

/** True only for orphaned jobs — never interrupt while child process or lock is active. */
function canMarkJobInterrupted(moduleId, job) {
  if (!job?.id || !isStaleJob(job)) return false;
  if (isProcessActive(moduleId, job.id)) return false;
  if (isLockedExecution(moduleId, job.id)) return false;
  return true;
}

async function markJobInterrupted(moduleId, job, reason = INTERRUPTED_ERROR) {
  const updated = await jobStore.updateJob(moduleId, job.id, {
    status: 'failed',
    message: INTERRUPTED_MESSAGE,
    error: reason,
    reportAvailable: false
  });
  await testStatusService.syncExecutionFromJob(moduleId, updated);
  return updated;
}

async function reconcileStaleJobs() {
  let marked = 0;

  for (const moduleId of jobStore.RUNNABLE_MODULES) {
    const jobs = await jobStore.listJobs(moduleId, 100);
    for (const job of jobs) {
      if (!canMarkJobInterrupted(moduleId, job)) continue;
      await markJobInterrupted(moduleId, job);
      marked += 1;
    }
  }

  return { marked, staleMs: STALE_MS };
}

module.exports = {
  STALE_MS,
  INTERRUPTED_MESSAGE,
  INTERRUPTED_ERROR,
  isStaleJob,
  canMarkJobInterrupted,
  markJobInterrupted,
  reconcileStaleJobs
};