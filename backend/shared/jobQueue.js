const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const jobStore = require('./jobStore');
const { logJob } = require('./logger');
const testStatusService = require('./testStatusService');
const cancelSignal = require('./cancelSignal');
const executionLock = require('./executionLock');
const { backendModuleDir } = require('./storagePaths');

const activeProcesses = new Map();
const cancellingJobs = new Set();
const killTimers = new Map();
const heartbeatTimers = new Map();
const moduleQueues = new Map();
let initialized = false;

const HEARTBEAT_MS = Number(process.env.JOB_HEARTBEAT_MS || 30_000);

const NOISY_STDOUT_PATTERNS = [
  /^PROGRESS:/,
  /^🧹 Cleared old QA logs/,
  /^✅ UI CHECKS RUNNING/
];

function shouldLogChildLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return !NOISY_STDOUT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function clearHeartbeat(key) {
  const timer = heartbeatTimers.get(key);
  if (timer) {
    clearInterval(timer);
    heartbeatTimers.delete(key);
  }
}

function startHeartbeat(moduleId, jobId) {
  const key = `${moduleId}:${jobId}`;
  clearHeartbeat(key);
  const timer = setInterval(() => {
    jobStore.getJob(moduleId, jobId).then((job) => {
      if (!job || jobStore.TERMINAL_STATUSES.has(job.status)) {
        clearHeartbeat(key);
        return;
      }
      return jobStore.updateJob(moduleId, jobId, {
        message: job.message || 'Running...'
      });
    }).catch(() => {});
  }, HEARTBEAT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  heartbeatTimers.set(key, timer);
}

function getRunJobScript(moduleId) {
  return path.join(backendModuleDir(moduleId), 'runJob.js');
}

async function enqueue(moduleId, jobId) {
  if (!moduleQueues.has(moduleId)) moduleQueues.set(moduleId, []);
  const queue = moduleQueues.get(moduleId);
  if (!queue.includes(jobId)) queue.push(jobId);
  processModuleQueue(moduleId);
}

async function processModuleQueue(moduleId) {
  const queue = moduleQueues.get(moduleId) || [];
  const running = [...activeProcesses.entries()].some(([key]) => key.startsWith(`${moduleId}:`));
  if (running || queue.length === 0) return;

  const jobId = queue.shift();
  await runJob(moduleId, jobId);
  processModuleQueue(moduleId);
}

async function runJob(moduleId, jobId) {
  const script = getRunJobScript(moduleId);
  if (!await fs.pathExists(script)) {
    await jobStore.updateJob(moduleId, jobId, {
      status: 'failed',
      progress: 0,
      message: 'Job runner not found',
      error: 'Job runner script missing'
    });
    return;
  }

  const key = `${moduleId}:${jobId}`;
  await jobStore.updateJob(moduleId, jobId, {
    status: 'running',
    progress: 2,
    message: 'Starting test execution...'
  });
  logJob(moduleId, jobId, 'info', 'Job started');

  const child = spawn(process.execPath, [script, jobId], {
    cwd: backendModuleDir(moduleId),
    env: { ...process.env, JOB_ID: jobId, JOB_MODULE: moduleId },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  activeProcesses.set(key, child);
  const abortController = new AbortController();
  executionLock.registerExecution(moduleId, jobId, { process: child, abortController });
  startHeartbeat(moduleId, jobId);

  child.stdout.on('data', (buf) => {
    const text = buf.toString();
    text.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const structured = trimmed.match(/^PROGRESS:(\d+)\|(\d+)\|(\d+)\|([^|]*)\|(.*)$/);
      if (structured) {
        let currentUrl = structured[4] || '';
        try {
          currentUrl = decodeURIComponent(currentUrl);
        } catch {
          /* keep raw */
        }
        jobStore.updateJob(moduleId, jobId, {
          progress: parseInt(structured[1], 10),
          currentPage: parseInt(structured[2], 10) || 0,
          totalPages: parseInt(structured[3], 10) || 0,
          currentUrl,
          message: structured[5]?.trim() || 'Running...'
        }).catch(() => {});
        return;
      }

      const m = trimmed.match(/^PROGRESS:(\d+)\s*(.*)$/);
      if (m) {
        const message = m[2]?.trim() || 'Running...';
        const patch = {
          progress: parseInt(m[1], 10),
          message
        };
        const urlProgress = message.match(/URL\s+(\d+)\s*\/\s*(\d+)/i);
        if (urlProgress) {
          patch.currentPage = parseInt(urlProgress[1], 10) || 0;
          patch.totalPages = parseInt(urlProgress[2], 10) || 0;
        }
        jobStore.updateJob(moduleId, jobId, patch).catch(() => {});
        return;
      }

      if (!shouldLogChildLine(trimmed)) return;
      logJob(moduleId, jobId, 'info', trimmed);
    });
  });

  child.stderr.on('data', (buf) => {
    logJob(moduleId, jobId, 'error', buf.toString().trim());
  });

  child.on('close', async (code) => {
    const timer = killTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      killTimers.delete(key);
    }
    clearHeartbeat(key);
    activeProcesses.delete(key);
    executionLock.clearExecution(moduleId, jobId);
    const job = await jobStore.getJob(moduleId, jobId);
    if (!job) return;

    if (job.status === 'cancelled') {
      processModuleQueue(moduleId);
      return;
    }

    const reportOk = await jobStore.reportExists(moduleId, jobId);
    if (code === 0 && reportOk) {
      const completed = await jobStore.updateJob(moduleId, jobId, {
        status: 'completed',
        progress: 100,
        message: 'Completed',
        reportAvailable: true,
        error: null
      });
      await testStatusService.syncExecutionFromJob(moduleId, completed);
      logJob(moduleId, jobId, 'info', 'Job completed successfully');
    } else {
      const failed = await jobStore.updateJob(moduleId, jobId, {
        status: 'failed',
        message: 'Test execution failed',
        error: job.error || `Process exited with code ${code}`,
        reportAvailable: false
      });
      await testStatusService.syncExecutionFromJob(moduleId, failed);
      logJob(moduleId, jobId, 'error', `Job failed with code ${code}`);
    }
    processModuleQueue(moduleId);
  });
}

async function cancelJob(moduleId, jobId) {
  const key = `${moduleId}:${jobId}`;

  const existing = await jobStore.getJob(moduleId, jobId);
  if (!existing) throw new Error('Job not found');
  if (jobStore.TERMINAL_STATUSES.has(existing.status)) {
    return existing;
  }

  if (cancellingJobs.has(key)) {
    return existing;
  }
  cancellingJobs.add(key);

  try {
    const jobDir = jobStore.getJobDir(moduleId, jobId);
    cancelSignal.setCancelled(jobDir);

    const child = activeProcesses.get(key);
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch (err) {
        console.warn('Process kill failed:', err.message);
      }

      if (!killTimers.has(key)) {
        const timer = setTimeout(() => {
          killTimers.delete(key);
          if (activeProcesses.has(key)) {
            try {
              const proc = activeProcesses.get(key);
              if (proc && !proc.killed) proc.kill('SIGKILL');
            } catch { /* ignore */ }
            activeProcesses.delete(key);
          }
        }, 5000);
        killTimers.set(key, timer);
        child.once('close', () => {
          const t = killTimers.get(key);
          if (t) {
            clearTimeout(t);
            killTimers.delete(key);
          }
          activeProcesses.delete(key);
        });
      }
    }

    const cancelled = await jobStore.updateJob(moduleId, jobId, {
      status: 'cancelled',
      message: 'Cancelled by user',
      error: null
    });
    await testStatusService.syncExecutionFromJob(moduleId, cancelled);
    logJob(moduleId, jobId, 'info', 'Job cancelled');
    return cancelled;
  } finally {
    cancellingJobs.delete(key);
  }
}

const AUTO_RECOVER = process.env.JOB_RECOVER_ON_STARTUP === 'true';
const RECOVER_WINDOW_MS = parseInt(process.env.JOB_RECOVER_WINDOW_MS || '900000', 10);

/**
 * On startup: cancel stale pending/running jobs instead of resuming them.
 * Set JOB_RECOVER_ON_STARTUP=true to re-queue jobs younger than JOB_RECOVER_WINDOW_MS (default 15m).
 */
async function cleanupOnStartup() {
  if (initialized) return { cancelled: 0, recovered: 0 };
  initialized = true;

  let cancelled = 0;
  let recovered = 0;
  const now = Date.now();

  for (const moduleId of jobStore.RUNNABLE_MODULES) {
    await jobStore.ensureJobsDir(moduleId);
    const jobs = await jobStore.listJobs(moduleId, 200);

    for (const job of jobs) {
      if (job.status !== 'running' && job.status !== 'pending') continue;

      const createdAt = new Date(job.createdAt || job.startedAt || 0).getTime();
      const ageMs = Number.isFinite(createdAt) ? now - createdAt : Infinity;
      const shouldRecover = AUTO_RECOVER && ageMs < RECOVER_WINDOW_MS;

      if (shouldRecover) {
        await jobStore.updateJob(moduleId, job.id, {
          status: 'pending',
          progress: 0,
          message: 'Re-queued after server restart'
        });
        await enqueue(moduleId, job.id);
        recovered++;
        logJob(moduleId, job.id, 'info', 'Job re-queued after server restart');
      } else {
        const { markJobInterrupted } = require('./staleJobService');
        await markJobInterrupted(moduleId, job);
        logJob(moduleId, job.id, 'info', 'Job marked interrupted on startup (not auto-resumed)');
        cancelled++;
      }
    }
  }

  return { cancelled, recovered };
}

/** @deprecated Use cleanupOnStartup */
async function recoverOnStartup() {
  return cleanupOnStartup();
}

function isProcessActive(moduleId, jobId) {
  return activeProcesses.has(`${moduleId}:${jobId}`);
}

module.exports = {
  enqueue,
  cancelJob,
  cleanupOnStartup,
  recoverOnStartup,
  isProcessActive,
  activeProcesses
};