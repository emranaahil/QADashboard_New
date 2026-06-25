const { isProtectedJob, isProtectedPath } = require('./bundledReportsManifest');
const { shouldFilterBySession } = require('./sessionUtils');

function isJobVisibleToSession(job, moduleId, sessionId) {
  if (!job) return false;
  if (!shouldFilterBySession(sessionId)) return true;
  if (isProtectedJob(moduleId, job.id)) return true;
  return job.sessionId === sessionId;
}

function isKeywordScanVisible(scan, sessionId) {
  if (!scan) return false;
  if (!shouldFilterBySession(sessionId)) return true;
  if (scan.storageFilename) {
    const rel = `keyword-check/storage/scans/${scan.storageFilename}.json`;
    if (isProtectedPath(rel)) return true;
  }
  return scan.sessionId === sessionId;
}

function isErrorReportVisible(reportRelativePath, reportData, sessionId) {
  if (!shouldFilterBySession(sessionId)) return true;
  const rel = String(reportRelativePath || '').replace(/\\/g, '/');
  if (rel && isProtectedPath(rel)) return true;
  return reportData?.sessionId === sessionId;
}

function filterJobsForSession(jobs, moduleId, sessionId) {
  return jobs.filter((job) => isJobVisibleToSession(job, moduleId, sessionId));
}

module.exports = {
  isJobVisibleToSession,
  isKeywordScanVisible,
  isErrorReportVisible,
  filterJobsForSession
};