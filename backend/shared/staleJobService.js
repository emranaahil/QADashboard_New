const jobStore = require('./jobStore');
const testStatusService = require('./testStatusService');

const STALE_MS = Number(process.env.JOB_STALE_MS || 3 * 60 * 1000);
const INTERRUPTED_MESSAGE = 'Interrupted — server restarted or process stopped unexpectedly';
const INTERRUPTED_ERROR =
  'The test was interrupted (often due to server memory limits on live hosting). ' +
  'Try again with fewer pages (≤8 recommended on live).';

function isStaleJob(job) {
  if (!job) return false;
  if (job.status !== 'running' && job.status !== 'pending') return false;

  const heartbeat = job.lastHeartbeatAt || job.startedAt || job.createdAt;
  if (!heartbeat) return true;

  return Date.now() - new Date(heartbeat).getTime() > STALE_MS;
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
      if (!isStaleJob(job)) continue;
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
  markJobInterrupted,
  reconcileStaleJobs
};