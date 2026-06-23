const fs = require('fs-extra');
const path = require('path');
const { uuidv4, validateUuid } = require('./uuidUtils');
const { normalizeUrl } = require('./urlSecurity');
const { getModule } = require('./moduleRegistry');
const { deriveModelId } = require('./modelUtils');
const { moduleJobsDir } = require('./storagePaths');

const RUNNABLE_MODULES = new Set(['seo', 'ui-check', 'full-ui-check']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const MODULE_TEST_TYPE = {
  'ui-check': 'single-page',
  'full-ui-check': 'full-website'
};
const jobLocks = new Map();

async function withJobLock(moduleId, jobId, fn) {
  const key = `${moduleId}:${jobId}`;
  const prev = jobLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  jobLocks.set(key, next.finally(() => {
    if (jobLocks.get(key) === next) jobLocks.delete(key);
  }));
  return next;
}

async function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeJson(tmp, data, { spaces: 2 });
  await fs.move(tmp, filePath, { overwrite: true });
}

function getModuleJobsDir(moduleId) {
  const mod = getModule(moduleId);
  if (!mod) throw new Error('Invalid module');
  return moduleJobsDir(moduleId);
}

function getJobDir(moduleId, jobId) {
  validateJobId(jobId);
  const base = getModuleJobsDir(moduleId);
  const resolved = path.resolve(base, jobId);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error('Invalid job path');
  }
  return resolved;
}

function getJobFile(moduleId, jobId) {
  return path.join(getJobDir(moduleId, jobId), 'job.json');
}

function getReportPath(moduleId, jobId) {
  return path.join(getJobDir(moduleId, jobId), 'qa-report.html');
}

function validateJobId(jobId) {
  if (!jobId || typeof jobId !== 'string' || !validateUuid(jobId)) {
    throw new Error('Invalid job ID');
  }
}

function validateUrl(url) {
  return normalizeUrl(url);
}

async function ensureJobsDir(moduleId) {
  await fs.ensureDir(getModuleJobsDir(moduleId));
}

async function createJob(moduleId, { url, options = {}, user = 'anonymous' }) {
  if (!RUNNABLE_MODULES.has(moduleId)) {
    throw new Error('Module does not support job execution');
  }
  const cleanUrl = validateUrl(url);
  const id = uuidv4();
  const now = new Date().toISOString();
  const jobDir = getJobDir(moduleId, id);
  await fs.ensureDir(jobDir);

  const job = {
    id,
    moduleId,
    testType: MODULE_TEST_TYPE[moduleId]
      || (moduleId === 'seo'
        ? (options.mode === 'full' ? 'full-website' : 'single-page')
        : null),
    modelId: deriveModelId(cleanUrl),
    status: 'pending',
    progress: 0,
    message: 'Queued',
    url: cleanUrl,
    options,
    user,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    reportPath: null,
    reportAvailable: false,
    error: null,
    logs: [],
    totalPages: 0,
    currentPage: 0,
    currentUrl: ''
  };

  await atomicWriteJson(path.join(jobDir, 'job.json'), job);
  return job;
}

async function getJob(moduleId, jobId) {
  validateJobId(jobId);
  const file = getJobFile(moduleId, jobId);

  for (let attempt = 0; attempt < 8; attempt++) {
    if (!await fs.pathExists(file)) {
      if (attempt === 7) return null;
      await new Promise(r => setTimeout(r, 30 * (attempt + 1)));
      continue;
    }
    try {
      return await fs.readJson(file);
    } catch (err) {
      if (attempt === 7) throw err;
      await new Promise(r => setTimeout(r, 30 * (attempt + 1)));
    }
  }
  return null;
}

async function updateJob(moduleId, jobId, patch) {
  return withJobLock(moduleId, jobId, async () => {
    const job = await getJob(moduleId, jobId);
    if (!job) throw new Error('Job not found');

    const updated = { ...job, ...patch };
    if (patch.status === 'running' && !job.startedAt) {
      updated.startedAt = new Date().toISOString();
    }
    if (TERMINAL_STATUSES.has(patch.status)) {
      updated.completedAt = new Date().toISOString();
      if (job.startedAt) {
        updated.durationMs = new Date(updated.completedAt) - new Date(job.startedAt);
      }
    }

    const reportFile = getReportPath(moduleId, jobId);
    const hasReport = await fs.pathExists(reportFile);
    updated.reportAvailable = updated.status === 'completed' && hasReport;
    updated.reportPath = updated.reportAvailable
      ? (updated.reportPath || `jobs/${jobId}/qa-report.html`)
      : null;

    await atomicWriteJson(getJobFile(moduleId, jobId), updated);
    return updated;
  });
}

async function appendLog(moduleId, jobId, message) {
  const job = await getJob(moduleId, jobId);
  if (!job) return;
  const logs = [...(job.logs || []), { at: new Date().toISOString(), message }];
  await updateJob(moduleId, jobId, { logs: logs.slice(-100) });
}

async function listJobs(moduleId, limit = 50) {
  const dir = getModuleJobsDir(moduleId);
  if (!await fs.pathExists(dir)) return [];

  const entries = await fs.readdir(dir);
  const jobs = [];
  for (const entry of entries) {
    try {
      const job = await getJob(moduleId, entry);
      if (job) jobs.push(job);
    } catch { /* skip invalid */ }
  }

  jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return jobs.slice(0, limit);
}

async function reportExists(moduleId, jobId) {
  try {
    return await fs.pathExists(getReportPath(moduleId, jobId));
  } catch {
    return false;
  }
}

/** Attach live report availability from disk — never trust stale job.json alone. */
async function enrichJob(moduleId, job) {
  if (!job) return null;
  const hasFile = await reportExists(moduleId, job.id);
  const reportAvailable = job.status === 'completed' && hasFile;
  const totalPages = job.totalPages || 0;
  const currentPage = job.currentPage || 0;
  const progressPercent = job.progress || 0;

  return {
    ...job,
    testType: job.testType || MODULE_TEST_TYPE[moduleId] || null,
    reportAvailable,
    reportPath: reportAvailable ? (job.reportPath || `jobs/${job.id}/qa-report.html`) : null,
    executionState: {
      status: job.status === 'pending' ? 'running' : job.status,
      progress: { current: currentPage, total: totalPages },
      currentPage,
      totalPages,
      currentUrl: job.currentUrl || '',
      progressPercent
    }
  };
}

async function enrichJobs(moduleId, jobs) {
  return Promise.all(jobs.map(j => enrichJob(moduleId, j)));
}

module.exports = {
  RUNNABLE_MODULES,
  TERMINAL_STATUSES,
  getModuleJobsDir,
  getJobDir,
  getReportPath,
  validateJobId,
  validateUrl,
  ensureJobsDir,
  createJob,
  getJob,
  updateJob,
  appendLog,
  listJobs,
  reportExists,
  enrichJob,
  enrichJobs
};