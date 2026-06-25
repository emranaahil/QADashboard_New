const fs = require('fs-extra');
const path = require('path');
const jobStore = require('./jobStore');
const { validateUuid } = require('./uuidUtils');
const {
  STORAGE_ROOT,
  moduleDataRoot,
  moduleJobsDir,
  keywordStorageDir,
  sharedDataPath
} = require('./storagePaths');
const { isProtectedJob, isProtectedPath, toPosixRelative } = require('./bundledReportsManifest');

const REGISTRY_PATH = () => sharedDataPath('live-ephemeral-registry.json');
const CLEANUP_INTERVAL_MS = Number(process.env.EPHEMERAL_CLEANUP_INTERVAL_MS || 60_000);

function isEnabled() {
  if (process.env.EPHEMERAL_LIVE_REPORTS === 'false') return false;
  if (!process.env.STORAGE_ROOT) return false;
  if (process.env.NODE_ENV !== 'production') return false;
  return process.env.EPHEMERAL_LIVE_REPORTS === 'true' || process.env.RENDER === 'true';
}

function getTtlMs() {
  if (process.env.LIVE_REPORT_TTL_MS) {
    const ms = Number(process.env.LIVE_REPORT_TTL_MS);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (process.env.LIVE_REPORT_TTL_MINUTES) {
    const mins = Number(process.env.LIVE_REPORT_TTL_MINUTES);
    if (Number.isFinite(mins) && mins > 0) return mins * 60 * 1000;
  }
  return 10 * 60 * 1000;
}

function getExpiresAt(fromIso = new Date().toISOString()) {
  return new Date(new Date(fromIso).getTime() + getTtlMs()).toISOString();
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return Date.now() >= new Date(expiresAt).getTime();
}

function relativeToStorage(absolutePath) {
  if (!process.env.STORAGE_ROOT) return null;
  const rel = path.relative(path.resolve(STORAGE_ROOT), path.resolve(absolutePath));
  if (!rel || rel.startsWith('..')) return null;
  return rel.split(path.sep).join('/');
}

function loadRegistrySync() {
  const filePath = REGISTRY_PATH();
  if (!fs.existsSync(filePath)) return { artifacts: [] };
  try {
    const data = fs.readJsonSync(filePath);
    return { artifacts: Array.isArray(data.artifacts) ? data.artifacts : [] };
  } catch {
    return { artifacts: [] };
  }
}

function saveRegistrySync(registry) {
  const filePath = REGISTRY_PATH();
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeJsonSync(filePath, registry, { spaces: 2 });
}

function registerArtifact({ moduleId, paths, expiresAt, kind, refId }) {
  if (!isEnabled()) return;
  const normalizedPaths = [...new Set((paths || [])
    .map(p => String(p).replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter(Boolean)
    .filter(p => !isProtectedPath(p)))];

  if (!normalizedPaths.length) return;

  const registry = loadRegistrySync();
  registry.artifacts = registry.artifacts.filter(item => item.refId !== refId);
  registry.artifacts.push({
    moduleId,
    kind,
    refId,
    paths: normalizedPaths,
    expiresAt,
    createdAt: new Date().toISOString()
  });
  saveRegistrySync(registry);
}

function registerErrorCheckReport(filePath) {
  if (!isEnabled()) return;
  const relative = relativeToStorage(filePath);
  if (!relative || isProtectedPath(relative)) return;
  registerArtifact({
    moduleId: 'error-check',
    kind: 'error-report',
    refId: path.basename(filePath),
    paths: [relative],
    expiresAt: getExpiresAt()
  });
}

async function resolveKeywordScanPath(scanId) {
  const scansDir = keywordStorageDir('scans');
  const legacy = path.join(scansDir, `${scanId}.json`);
  if (await fs.pathExists(legacy)) return legacy;

  const files = await fs.readdir(scansDir).catch(() => []);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(scansDir, file);
    try {
      const data = await fs.readJson(filePath);
      if (data.id === scanId) return filePath;
    } catch {
      /* skip invalid */
    }
  }
  return null;
}

async function registerKeywordScan(scanId, scanData) {
  if (!isEnabled() || !scanData) return;

  const paths = [];
  const scanPath = await resolveKeywordScanPath(scanId);
  if (scanPath) {
    const rel = relativeToStorage(scanPath);
    if (rel && !isProtectedPath(rel)) paths.push(rel);
  }

  const pdfPath = path.join(keywordStorageDir('reports'), `keyword-audit-report-${scanId}.pdf`);
  if (await fs.pathExists(pdfPath)) {
    const rel = relativeToStorage(pdfPath);
    if (rel && !isProtectedPath(rel)) paths.push(rel);
  }

  registerArtifact({
    moduleId: 'keyword-check',
    kind: 'keyword-scan',
    refId: scanId,
    paths,
    expiresAt: getExpiresAt(scanData.completedAt || scanData.startedAt)
  });
}

async function reconcileTestExecutionIndex(moduleId, deletedJob) {
  if (!deletedJob?.modelId) return;

  const indexPath = sharedDataPath('test-executions.json');
  if (!await fs.pathExists(indexPath)) return;

  let index;
  try {
    index = await fs.readJson(indexPath);
  } catch {
    return;
  }

  const key = `${moduleId}:${deletedJob.modelId}`;
  if (index[key]?.jobId !== deletedJob.id) return;

  const bundledIds = require('./bundledReportsManifest').loadManifestSync().jobs?.[moduleId] || [];
  for (const bundledJobId of bundledIds) {
    const bundled = await jobStore.getJob(moduleId, bundledJobId);
    if (!bundled) continue;
    const hasReport = await jobStore.reportExists(moduleId, bundledJobId);
    if (!hasReport) continue;
    index[key] = {
      testType: moduleId,
      modelId: deletedJob.modelId,
      jobId: bundledJobId,
      url: bundled.url,
      updatedAt: bundled.completedAt || bundled.createdAt || new Date().toISOString()
    };
    await fs.writeJson(indexPath, index, { spaces: 2 });
    return;
  }

  delete index[key];
  await fs.writeJson(indexPath, index, { spaces: 2 });
}

async function deleteLiveJob(moduleId, jobId, job) {
  const resolvedJob = job || await jobStore.getJob(moduleId, jobId);

  if (moduleId === 'seo' && resolvedJob?.reportRunId) {
    const reportDir = path.join(moduleDataRoot(moduleId), 'reports', resolvedJob.reportRunId);
    const rel = toPosixRelative(['seo', 'reports', resolvedJob.reportRunId]);
    if (!isProtectedPath(rel)) {
      await fs.remove(reportDir).catch(() => {});
    }
  }

  await fs.remove(jobStore.getJobDir(moduleId, jobId)).catch(() => {});
  if (resolvedJob) {
    await reconcileTestExecutionIndex(moduleId, resolvedJob);
  }
}

async function cleanupRunnableModuleJobs() {
  let removed = 0;

  for (const moduleId of jobStore.RUNNABLE_MODULES) {
    const jobsDir = moduleJobsDir(moduleId);
    if (!await fs.pathExists(jobsDir)) continue;

    const entries = await fs.readdir(jobsDir);
    for (const entry of entries) {
      if (!validateUuid(entry)) continue;
      if (isProtectedJob(moduleId, entry)) continue;

      const job = await jobStore.getJob(moduleId, entry);
      if (!job) continue;
      if (job.status === 'pending' || job.status === 'running') continue;

      let expiresAt = job.expiresAt;
      if (!expiresAt && job.completedAt && job.reportSource === 'live') {
        expiresAt = getExpiresAt(job.completedAt);
      }
      if (!expiresAt && job.completedAt && !job.reportSource) {
        expiresAt = getExpiresAt(job.completedAt);
      }
      if (!isExpired(expiresAt)) continue;

      await deleteLiveJob(moduleId, entry, job);
      removed += 1;
    }
  }

  return removed;
}

async function cleanupRegistryArtifacts() {
  const registry = loadRegistrySync();
  const kept = [];
  let removed = 0;

  for (const item of registry.artifacts) {
    if (!isExpired(item.expiresAt)) {
      kept.push(item);
      continue;
    }

    const paths = (item.paths || []).filter(p => !isProtectedPath(p));
    if (!paths.length) {
      removed += 1;
      continue;
    }

    await Promise.all(paths.map(p => fs.remove(path.join(STORAGE_ROOT, p)).catch(() => {})));
    removed += 1;
  }

  if (kept.length !== registry.artifacts.length) {
    saveRegistrySync({ artifacts: kept });
  }

  return removed;
}

async function cleanupExpiredReports() {
  if (!isEnabled()) return { removedJobs: 0, removedArtifacts: 0 };

  const removedJobs = await cleanupRunnableModuleJobs();
  const removedArtifacts = await cleanupRegistryArtifacts();

  if (removedJobs > 0 || removedArtifacts > 0) {
    console.log(
      `[ephemeral] Removed ${removedJobs} live job(s) and ${removedArtifacts} live artifact group(s) ` +
      `(TTL ${Math.round(getTtlMs() / 60000)} min)`
    );
  }

  return { removedJobs, removedArtifacts };
}

let cleanupTimer = null;

function startCleanupSchedule() {
  if (!isEnabled() || cleanupTimer) return;

  const tick = () => {
    cleanupExpiredReports().catch(err => {
      console.error('[ephemeral] Cleanup failed:', err.message);
    });
  };

  tick();
  cleanupTimer = setInterval(tick, CLEANUP_INTERVAL_MS);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

module.exports = {
  isEnabled,
  getTtlMs,
  getExpiresAt,
  registerArtifact,
  registerErrorCheckReport,
  registerKeywordScan,
  cleanupExpiredReports,
  startCleanupSchedule
};