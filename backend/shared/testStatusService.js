const fs = require('fs-extra');
const path = require('path');
const jobStore = require('./jobStore');
const { deriveModelId, validateModelId } = require('./modelUtils');

const { sharedDataPath } = require('./storagePaths');
const INDEX_PATH = sharedDataPath('test-executions.json');
const TEST_TYPES = new Set(['seo', 'ui-check', 'full-ui-check']);

function validateTestType(testType) {
  if (!TEST_TYPES.has(testType)) {
    throw new Error('Invalid test type');
  }
}

async function readIndex() {
  await fs.ensureDir(path.dirname(INDEX_PATH));
  if (!await fs.pathExists(INDEX_PATH)) return {};
  try {
    return await fs.readJson(INDEX_PATH);
  } catch {
    return {};
  }
}

async function writeIndex(index) {
  await fs.ensureDir(path.dirname(INDEX_PATH));
  await fs.writeJson(INDEX_PATH, index, { spaces: 2 });
}

function indexKey(testType, modelId) {
  return `${testType}:${modelId}`;
}

/** Public API shape — always derived from live job + disk check. */
async function toStatusResponse(testType, job) {
  if (!job) {
    return {
      status: 'idle',
      reportAvailable: false,
      reportPath: null,
      reportUrl: null,
      jobId: null,
      progress: 0,
      message: '',
      error: null,
      url: null,
      modelId: null
    };
  }

  const enriched = await jobStore.enrichJob(testType, job);
  let status = enriched.status;
  if (status === 'pending') status = 'running';
  if (status === 'cancelled') status = 'failed';

  const reportAvailable = enriched.status === 'completed' && enriched.reportAvailable === true;
  const reportPath = reportAvailable
    ? (enriched.reportPath || `jobs/${enriched.id}/qa-report.html`)
    : null;

  return {
    status,
    reportAvailable,
    reportPath,
    reportUrl: reportAvailable ? `/api/modules/${testType}/jobs/${enriched.id}/report` : null,
    jobId: enriched.id,
    progress: enriched.progress || 0,
    message: enriched.message || '',
    error: enriched.error || null,
    url: enriched.url || null,
    modelId: enriched.modelId || deriveModelId(enriched.url),
    startedAt: enriched.startedAt,
    completedAt: enriched.completedAt,
    durationMs: enriched.durationMs,
    currentPage: enriched.currentPage || 0,
    totalPages: enriched.totalPages || 0,
    currentUrl: enriched.currentUrl || '',
    executionState: enriched.executionState || null
  };
}

async function setExecution(testType, modelId, jobId, url) {
  validateTestType(testType);
  validateModelId(modelId);
  const index = await readIndex();
  index[indexKey(testType, modelId)] = {
    testType,
    modelId,
    jobId,
    url,
    updatedAt: new Date().toISOString()
  };
  await writeIndex(index);
}

async function getIndexedJob(testType, modelId) {
  validateTestType(testType);
  validateModelId(modelId);
  const index = await readIndex();
  const entry = index[indexKey(testType, modelId)];
  if (!entry?.jobId) return null;
  return jobStore.getJob(testType, entry.jobId);
}

async function getStatus(testType, modelId) {
  let job = await getIndexedJob(testType, modelId);
  if (!job) {
    const jobs = await jobStore.listJobs(testType, 50);
    job = jobs.find(j => j.modelId === modelId || deriveModelId(j.url) === modelId) || null;
  }
  return toStatusResponse(testType, job);
}

async function getActiveForModule(testType) {
  validateTestType(testType);
  const jobs = await jobStore.listJobs(testType, 100);
  const active = jobs.find(j => j.status === 'pending' || j.status === 'running');
  return toStatusResponse(testType, active || null);
}

async function findRunningJob(testType, url) {
  validateTestType(testType);
  const modelId = deriveModelId(url);
  if (!modelId) return null;

  const jobs = await jobStore.listJobs(testType, 100);
  return jobs.find(j =>
    (j.status === 'pending' || j.status === 'running') &&
    (j.modelId === modelId || deriveModelId(j.url) === modelId)
  ) || null;
}

async function syncExecutionFromJob(testType, job) {
  if (!job?.id || !job.url) return;
  const modelId = job.modelId || deriveModelId(job.url);
  if (!modelId) return;
  await setExecution(testType, modelId, job.id, job.url);
}

module.exports = {
  TEST_TYPES,
  INDEX_PATH,
  deriveModelId,
  validateTestType,
  validateModelId,
  toStatusResponse,
  setExecution,
  getStatus,
  getActiveForModule,
  findRunningJob,
  syncExecutionFromJob
};