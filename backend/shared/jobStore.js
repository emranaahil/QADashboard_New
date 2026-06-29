const fs = require('fs-extra');
const path = require('path');
const { uuidv4, validateUuid } = require('./uuidUtils');
const { normalizeUrl } = require('./urlSecurity');
const { parseUrlList, normalizeUrlList } = require('./parseUrlList');
const { getModule } = require('./moduleRegistry');
const { deriveModelId } = require('./modelUtils');
const { moduleDataRoot, moduleJobsDir } = require('./storagePaths');
const ephemeralLiveReportsConfig = require('./ephemeralLiveReportsConfig');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function commitTempJsonFile(tmp, filePath) {
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fs.move(tmp, filePath, { overwrite: true });
      return;
    } catch (err) {
      const retryable = err && ['EPERM', 'EACCES', 'EBUSY'].includes(err.code);
      if (!retryable || attempt === maxAttempts - 1) {
        if (process.platform === 'win32' && retryable) {
          await fs.copy(tmp, filePath, { overwrite: true });
          await fs.remove(tmp).catch(() => {});
          return;
        }
        throw err;
      }
      await sleep(35 * (attempt + 1));
    }
  }
}

async function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeJson(tmp, data, { spaces: 2 });
  try {
    await commitTempJsonFile(tmp, filePath);
  } catch (err) {
    await fs.remove(tmp).catch(() => {});
    throw err;
  }
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

function resolveReportAbsolutePath(moduleId, jobId, job) {
  if (job?.reportPath && typeof job.reportPath === 'string') {
    return path.join(moduleDataRoot(moduleId), job.reportPath);
  }
  if (moduleId === 'seo' && job?.reportRunId) {
    return path.join(moduleDataRoot(moduleId), 'reports', job.reportRunId, 'qa-report.html');
  }
  return path.join(getJobDir(moduleId, jobId), 'qa-report.html');
}

function inferReportRelativePath(moduleId, jobId, job) {
  if (job?.reportPath && typeof job.reportPath === 'string') {
    return job.reportPath;
  }
  if (moduleId === 'seo' && job?.reportRunId) {
    return `reports/${job.reportRunId}/qa-report.html`;
  }
  return `jobs/${jobId}/qa-report.html`;
}

function getReportPath(moduleId, jobId) {
  const jobFile = getJobFile(moduleId, jobId);
  try {
    if (fs.existsSync(jobFile)) {
      const job = fs.readJsonSync(jobFile);
      const candidate = resolveReportAbsolutePath(moduleId, jobId, job);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    /* fall through to legacy job-dir path */
  }
  return path.join(getJobDir(moduleId, jobId), 'qa-report.html');
}

async function resolveReportLocation(moduleId, jobId, job) {
  const resolvedJob = job || await getJob(moduleId, jobId);
  if (!resolvedJob) return null;

  const primary = resolveReportAbsolutePath(moduleId, jobId, resolvedJob);
  if (await fs.pathExists(primary)) {
    return {
      absolutePath: primary,
      reportPath: resolvedJob.reportPath || inferReportRelativePath(moduleId, jobId, resolvedJob),
      reportRunId: resolvedJob.reportRunId || null
    };
  }

  if (moduleId === 'seo') {
    const { findSeoReportForJob } = require('../SEO/seoReportStorage');
    const discovered = await findSeoReportForJob(resolvedJob);
    if (discovered?.reportPath) {
      const discoveredPath = path.join(moduleDataRoot(moduleId), discovered.reportPath);
      if (await fs.pathExists(discoveredPath)) {
        return {
          absolutePath: discoveredPath,
          reportPath: discovered.reportPath,
          reportRunId: discovered.reportRunId
        };
      }
    }
  }

  return null;
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

async function createJob(moduleId, { url, options = {}, user = 'anonymous', sessionId = null }) {
  if (!RUNNABLE_MODULES.has(moduleId)) {
    throw new Error('Module does not support job execution');
  }
  let cleanUrl = validateUrl(url);
  let resolvedUrls = null;
  const execOptions = { ...options };

  if (moduleId === 'ui-check') {
    if (Array.isArray(execOptions.urls) && execOptions.urls.length) {
      const parsed = normalizeUrlList(execOptions.urls);
      cleanUrl = parsed.primaryUrl;
      resolvedUrls = parsed.urls;
    } else {
      const parsed = parseUrlList(url);
      cleanUrl = parsed.primaryUrl;
      resolvedUrls = parsed.urls;
    }
    execOptions.urls = resolvedUrls;
  }

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
    message: resolvedUrls && resolvedUrls.length > 1
      ? `Queued — ${resolvedUrls.length} URLs`
      : 'Queued',
    url: cleanUrl,
    ...(resolvedUrls ? { urls: resolvedUrls } : {}),
    options: execOptions,
    user,
    sessionId: sessionId || null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    reportPath: null,
    reportAvailable: false,
    error: null,
    ...(ephemeralLiveReportsConfig.isEnabled() ? { reportSource: 'live' } : {}),
    expiresAt: null,
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
    const isActive = !TERMINAL_STATUSES.has(updated.status) &&
      (updated.status === 'pending' || updated.status === 'running');
    if (isActive) {
      updated.lastHeartbeatAt = new Date().toISOString();
    }
    if (patch.status === 'running' && !job.startedAt) {
      updated.startedAt = new Date().toISOString();
    }
    if (TERMINAL_STATUSES.has(patch.status)) {
      updated.completedAt = new Date().toISOString();
      if (job.startedAt) {
        updated.durationMs = new Date(updated.completedAt) - new Date(job.startedAt);
      }
      if (
        ephemeralLiveReportsConfig.isEnabled() &&
        updated.reportSource === 'live'
      ) {
        updated.expiresAt = ephemeralLiveReportsConfig.getExpiresAt(updated.completedAt);
      }
    }

    const reportFile = resolveReportAbsolutePath(moduleId, jobId, updated);
    const hasReport = await fs.pathExists(reportFile);

    if (TERMINAL_STATUSES.has(updated.status)) {
      updated.reportAvailable = updated.status === 'completed' && hasReport;
      if (updated.status === 'completed' && hasReport) {
        updated.reportPath = inferReportRelativePath(moduleId, jobId, updated);
      }
    } else if (hasReport && (patch.reportPath || patch.reportRunId)) {
      // Preserve SEO report location saved before process exit (status still running)
      updated.reportPath = patch.reportPath || inferReportRelativePath(moduleId, jobId, updated);
    }

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
    const location = await resolveReportLocation(moduleId, jobId);
    return Boolean(location);
  } catch {
    return false;
  }
}

/** Attach live report availability from disk — never trust stale job.json alone. */
async function enrichJob(moduleId, job) {
  if (!job) return null;
  const location = await resolveReportLocation(moduleId, job.id, job);
  const hasFile = Boolean(location);

  if (
    hasFile &&
    moduleId === 'seo' &&
    location.reportPath &&
    (job.reportPath !== location.reportPath || job.reportRunId !== location.reportRunId)
  ) {
    updateJob(moduleId, job.id, {
      reportPath: location.reportPath,
      reportRunId: location.reportRunId,
      reportAvailable: true
    }).catch(() => {});
  }

  const isCompleted = job.status === 'completed' || job.status === 'done';
  const reportAvailable = isCompleted && hasFile;
  const totalPages = job.totalPages || 0;
  const currentPage = job.currentPage || 0;
  const progressPercent = job.progress || 0;

  return {
    ...job,
    testType: job.testType || MODULE_TEST_TYPE[moduleId] || null,
    reportAvailable,
    reportPath: reportAvailable ? (location?.reportPath || job.reportPath || `jobs/${job.id}/qa-report.html`) : null,
    reportRunId: location?.reportRunId || job.reportRunId || null,
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