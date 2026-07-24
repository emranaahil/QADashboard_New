/**
 * Execution lock — single active job in production; per-module parallel jobs in local dev.
 */
const { isParallelExecutionEnabled } = require('./executionEnv');

/** @type {Map<string, object>} */
const activeExecutions = new Map();
let isCancelling = false;
const cancellingKeys = new Set();

function makeKey(moduleId, jobId) {
  return `${moduleId}:${jobId}`;
}

function registerExecution(moduleId, jobId, meta = {}) {
  const key = makeKey(moduleId, jobId);
  activeExecutions.set(key, {
    id: key,
    moduleId,
    jobId,
    status: 'running',
    abortController: meta.abortController || new AbortController(),
    process: meta.process || null,
    browser: meta.browser || null,
    queue: meta.queue || null
  });
}

function clearExecution(moduleId, jobId) {
  activeExecutions.delete(makeKey(moduleId, jobId));
}

function getActiveExecutions() {
  return [...activeExecutions.values()].filter(
    (exec) => exec.status === 'running' || exec.status === 'cancelling'
  );
}

function getActiveExecutionForModule(moduleId) {
  if (!moduleId) return null;
  for (const exec of activeExecutions.values()) {
    if (
      exec.moduleId === moduleId &&
      (exec.status === 'running' || exec.status === 'cancelling')
    ) {
      return exec;
    }
  }
  return null;
}

function hasActiveExecution(moduleId = null) {
  if (moduleId) {
    return getActiveExecutionForModule(moduleId) !== null;
  }
  return getActiveExecutions().length > 0;
}

function getActiveExecution() {
  return getActiveExecutions()[0] || null;
}

function assertCanStart(moduleId = null) {
  if (isParallelExecutionEnabled()) {
    if (moduleId && hasActiveExecution(moduleId)) {
      const err = new Error(`A test is already running for module ${moduleId}`);
      err.code = 'EXECUTION_ACTIVE';
      throw err;
    }
    return;
  }

  if (hasActiveExecution()) {
    const err = new Error('Execution already running');
    err.code = 'EXECUTION_ACTIVE';
    throw err;
  }
}

async function safeCloseBrowser(browser) {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    console.warn('Browser already closed');
  }
}

/**
 * Idempotent cancel — safe for multiple concurrent requests.
 */
async function safeCancelExecution(moduleId, jobId, executeCancel) {
  const key = makeKey(moduleId, jobId);

  if (cancellingKeys.has(key)) {
    return { ok: true, message: 'Cancel already in progress', idempotent: true };
  }

  if (isCancelling && !isParallelExecutionEnabled()) {
    return { ok: true, message: 'Cancel already in progress', idempotent: true };
  }

  isCancelling = true;
  cancellingKeys.add(key);

  try {
    const active = activeExecutions.get(key);
    if (active) {
      active.status = 'cancelling';
      if (active.abortController) {
        active.abortController.abort();
      }
      if (active.process && !active.process.killed) {
        try {
          active.process.kill('SIGTERM');
        } catch (err) {
          console.warn('Process kill failed:', err.message);
        }
      }
      await safeCloseBrowser(active.browser);
    }

    const job = await executeCancel();

    if (active) {
      active.status = 'cancelled';
    }

    return { ok: true, job };
  } catch (error) {
    console.error('Cancel execution failed:', error);
    return { ok: false, error: error.message || 'Cancel failed' };
  } finally {
    isCancelling = false;
    cancellingKeys.delete(key);
    activeExecutions.delete(key);
  }
}

module.exports = {
  registerExecution,
  clearExecution,
  hasActiveExecution,
  getActiveExecution,
  getActiveExecutionForModule,
  getActiveExecutions,
  assertCanStart,
  safeCancelExecution,
  safeCloseBrowser,
  isParallelExecutionEnabled
};