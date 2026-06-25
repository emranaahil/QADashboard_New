const fs = require('fs-extra');
const path = require('path');
const jobStore = require('../jobStore');

async function jobHasQaIssues(moduleId, jobId) {
  if (!jobId || !moduleId) return false;

  const reportPath = path.join(jobStore.getJobDir(moduleId, jobId), 'qaReport.json');
  if (!await fs.pathExists(reportPath)) return false;

  try {
    const data = await fs.readJson(reportPath);
    const entries = Array.isArray(data) ? data : data.entries || [];
    return entries.some((entry) => Array.isArray(entry.issues) && entry.issues.length > 0);
  } catch {
    return false;
  }
}

async function seoJobHasCriticalIssues(moduleId, jobId, job) {
  const candidates = [
    path.join(jobStore.getJobDir(moduleId, jobId), 'seoReport.json'),
    job?.reportRunId
      ? path.join(require('../storagePaths').moduleDataRoot(moduleId), 'reports', job.reportRunId, 'seoReport.json')
      : null
  ].filter(Boolean);

  for (const reportPath of candidates) {
    if (!await fs.pathExists(reportPath)) continue;
    try {
      const data = await fs.readJson(reportPath);
      const critical = data.summary?.totalCritical ?? data.totalCritical ?? 0;
      if (critical > 0) return true;
      const pages = data.pages || [];
      if (pages.some((page) => (page.issues?.critical || []).length > 0)) return true;
    } catch {
      /* try next path */
    }
  }
  return false;
}

module.exports = {
  jobHasQaIssues,
  seoJobHasCriticalIssues
};