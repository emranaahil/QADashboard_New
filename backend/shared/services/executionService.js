/**
 * Thin adapter over jobQueue + jobStore — preserves existing execution pipeline.
 */
const fs = require('fs-extra');
const path = require('path');
const jobStore = require('../jobStore');
const jobQueue = require('../jobQueue');
const testStatusService = require('../testStatusService');
const executionLock = require('../executionLock');
const { resolveDevices, applyDevicesToEnv } = require('./deviceService');
const { applyBrowserToEnv } = require('./browserService');

async function persistResolvedDevices(moduleId, jobId, devices) {
  if (!devices?.length) return;
  const jobDir = jobStore.getJobDir(moduleId, jobId);
  await fs.ensureDir(jobDir);
  await fs.writeJson(path.join(jobDir, 'devices.runtime.json'), devices, { spaces: 2 });
}

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
  if (execOptions._resolvedDevices?.length) {
    await persistResolvedDevices(moduleId, created.id, execOptions._resolvedDevices);
  }
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
  let resolved = Array.isArray(opts._resolvedDevices) && opts._resolvedDevices.length
    ? opts._resolvedDevices
    : null;
  if (!resolved && opts.devices) {
    resolved = resolveDevices(opts.devices);
  }
  if (resolved?.length) {
    await applyDevicesToEnv(resolved);
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