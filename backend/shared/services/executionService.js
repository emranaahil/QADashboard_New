/**
 * Thin adapter over jobQueue + jobStore — preserves existing execution pipeline.
 */
const jobStore = require('../jobStore');
const jobQueue = require('../jobQueue');
const testStatusService = require('../testStatusService');
const executionLock = require('../executionLock');
const { resolveDevices, applyDevicesToEnv } = require('./deviceService');
const { applyBrowserToEnv } = require('./browserService');

async function startExecution(moduleId, { url, options = {}, user }) {
  executionLock.assertCanStart();

  const running = await testStatusService.findRunningJob(moduleId, url);
  if (running) {
    const err = new Error('A test is already running for this URL. Please wait for it to finish.');
    err.code = 'ALREADY_RUNNING';
    err.job = await jobStore.enrichJob(moduleId, running);
    throw err;
  }

  const execOptions = { ...options };
  if (execOptions.devices) {
    execOptions._resolvedDevices = resolveDevices(execOptions.devices);
  }

  const created = await jobStore.createJob(moduleId, { url, options: execOptions, user });
  const modelId = created.modelId || testStatusService.deriveModelId(created.url);
  if (modelId) {
    await testStatusService.setExecution(moduleId, modelId, created.id, created.url);
  }

  await jobQueue.enqueue(moduleId, created.id);
  return jobStore.enrichJob(moduleId, created);
}

async function getExecution(moduleId, jobId) {
  const job = await jobStore.getJob(moduleId, jobId);
  if (!job) return null;
  return jobStore.enrichJob(moduleId, job);
}

async function applyJobRuntimeEnv(job) {
  const opts = job.options || {};
  if (opts._resolvedDevices) {
    applyDevicesToEnv(opts._resolvedDevices);
  } else if (opts.devices) {
    applyDevicesToEnv(resolveDevices(opts.devices));
  }
  if (opts.browser) {
    applyBrowserToEnv(opts.browser);
  }
}

module.exports = {
  startExecution,
  getExecution,
  applyJobRuntimeEnv
};