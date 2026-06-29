const path = require('path');
const { isProtectedJob, isProtectedPath } = require('./bundledReportsManifest');
const { shouldFilterBySession } = require('./sessionUtils');

function isProtectedKeywordScanPath(storageFilename) {
  if (!storageFilename) return false;
  const base = `${storageFilename}.json`;
  return [
    `keyword-check/storage/scans/${base}`,
    `keyword-check/scans/${base}`
  ].some(isProtectedPath);
}

function isProtectedErrorReportPath(reportRelativePath) {
  const rel = String(reportRelativePath || '').replace(/\\/g, '/');
  const basename = path.posix.basename(rel);
  if (!basename) return false;
  return [
    rel,
    `error-check/reports/${basename}`,
    `error-check/${basename}`
  ].some(isProtectedPath);
}

function isJobVisibleToSession(job, moduleId, sessionId) {
  if (!job) return false;
  if (!shouldFilterBySession(sessionId)) return true;
  if (isProtectedJob(moduleId, job.id)) return true;
  return job.sessionId === sessionId;
}

function isKeywordScanVisible(scan, sessionId) {
  if (!scan) return false;
  if (!shouldFilterBySession(sessionId)) return true;
  if (isProtectedKeywordScanPath(scan.storageFilename)) return true;
  return scan.sessionId === sessionId;
}

function isErrorReportVisible(reportRelativePath, reportData, sessionId) {
  if (!shouldFilterBySession(sessionId)) return true;
  if (isProtectedErrorReportPath(reportRelativePath)) return true;
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