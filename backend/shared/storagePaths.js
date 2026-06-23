const path = require('path');
const fs = require('fs-extra');

const BACKEND_ROOT = path.join(__dirname, '..');

/** Actual on-disk folder names (case-sensitive on Linux/Docker). */
const MODULE_FOLDER = {
  seo: 'SEO'
};

function resolveModuleFolder(moduleId) {
  return MODULE_FOLDER[moduleId] || moduleId;
}

function getStorageRoot() {
  if (process.env.STORAGE_ROOT) {
    return path.resolve(process.env.STORAGE_ROOT);
  }
  return BACKEND_ROOT;
}

const STORAGE_ROOT = getStorageRoot();

function moduleDataRoot(moduleId) {
  if (process.env.STORAGE_ROOT) {
    return path.join(STORAGE_ROOT, moduleId);
  }
  return path.join(BACKEND_ROOT, resolveModuleFolder(moduleId));
}

function moduleJobsDir(moduleId) {
  return path.join(moduleDataRoot(moduleId), 'jobs');
}

function moduleReportsDir(moduleId) {
  return path.join(moduleDataRoot(moduleId), 'reports');
}

function keywordStorageDir(...parts) {
  if (process.env.STORAGE_ROOT) {
    return path.join(STORAGE_ROOT, 'keyword-check', 'storage', ...parts);
  }
  return path.join(BACKEND_ROOT, 'keyword-check', 'storage', ...parts);
}

function sharedDataPath(...parts) {
  if (process.env.STORAGE_ROOT) {
    return path.join(STORAGE_ROOT, 'shared', 'data', ...parts);
  }
  return path.join(BACKEND_ROOT, 'shared', 'data', ...parts);
}

/** Backend code directory for a module (runJob.js, engines, etc.). */
function backendModuleDir(moduleId) {
  return path.join(BACKEND_ROOT, resolveModuleFolder(moduleId));
}

function ensureStorageDirs() {
  const dirs = [
    keywordStorageDir('scans'),
    keywordStorageDir('reports'),
    keywordStorageDir('checkpoints'),
    moduleReportsDir('error-check'),
    moduleJobsDir('seo'),
    moduleReportsDir('seo'),
    moduleJobsDir('ui-check'),
    moduleReportsDir('ui-check'),
    moduleJobsDir('full-ui-check'),
    moduleReportsDir('full-ui-check'),
    sharedDataPath()
  ];
  dirs.forEach(d => fs.ensureDirSync(d));
}

module.exports = {
  BACKEND_ROOT,
  STORAGE_ROOT,
  MODULE_FOLDER,
  resolveModuleFolder,
  getStorageRoot,
  moduleDataRoot,
  moduleJobsDir,
  moduleReportsDir,
  keywordStorageDir,
  sharedDataPath,
  backendModuleDir,
  ensureStorageDirs
};