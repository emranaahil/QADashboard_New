/**
 * Global execution lock — idempotent cancel + single active execution guard.
 * Wrapper only; does not replace jobQueue / Playwright pipelines.
 */

let activeExecution = null;
let isCancelling = false;
const cancellingKeys = new Set();

function makeKey(moduleId, jobId) {
  return `${moduleId}:${jobId}`;
}

function registerExecution(moduleId, jobId, meta = {}) {
  const key = makeKey(moduleId, jobId);
  activeExecution = {
    id: key,
    moduleId,
    jobId,
    status: 'running',
    abortController: meta.abortController || new AbortController(),
    process: meta.process || null,
    browser: meta.browser || null,
    queue: meta.queue || null
  };
}

function clearExecution(moduleId, jobId) {
  if (!activeExecution) return;
  const key = makeKey(moduleId, jobId);
  if (activeExecution.id === key) {
    activeExecution = null;
  }
}

function hasActiveExecution() {
  return (
    activeExecution !== null &&
    (activeExecution.status === 'running' || activeExecution.status === 'cancelling')
  );
}

function assertCanStart() {
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
 * @param {string} moduleId
 * @param {string} jobId
 * @param {() => Promise<object>} executeCancel — calls existing jobQueue.cancelJob
 */
async function safeCancelExecution(moduleId, jobId, executeCancel) {
  const key = makeKey(moduleId, jobId);

  if (cancellingKeys.has(key)) {
    return { ok: true, message: 'Cancel already in progress', idempotent: true };
  }

  if (isCancelling) {
    return { ok: true, message: 'Cancel already in progress', idempotent: true };
  }

  if (activeExecution && activeExecution.id !== key) {
    // Allow cancelling a specific job even if lock tracks another (e.g. queued job)
    // but log mismatch for the active process lock
  }

  isCancelling = true;
  cancellingKeys.add(key);

  try {
    if (activeExecution && activeExecution.id === key) {
      activeExecution.status = 'cancelling';
      if (activeExecution.abortController) {
        activeExecution.abortController.abort();
      }
      if (activeExecution.process && !activeExecution.process.killed) {
        try {
          activeExecution.process.kill('SIGTERM');
        } catch (err) {
          console.warn('Process kill failed:', err.message);
        }
      }
      await safeCloseBrowser(activeExecution.browser);
    }

    const job = await executeCancel();

    if (activeExecution && activeExecution.id === key) {
      activeExecution.status = 'cancelled';
    }

    return { ok: true, job };
  } catch (error) {
    console.error('Cancel execution failed:', error);
    return { ok: false, error: error.message || 'Cancel failed' };
  } finally {
    isCancelling = false;
    cancellingKeys.delete(key);
    if (activeExecution && activeExecution.id === key) {
      activeExecution = null;
    }
  }
}

function getActiveExecution() {
  return activeExecution;
}

module.exports = {
  registerExecution,
  clearExecution,
  hasActiveExecution,
  assertCanStart,
  safeCancelExecution,
  safeCloseBrowser,
  getActiveExecution
};