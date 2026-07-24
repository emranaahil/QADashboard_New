/**
 * Delete reports across all QA modules with session and bundled-demo guards.
 */
const path = require('path');
const fs = require('fs-extra');
const { getModule } = require('../moduleRegistry');
const jobStore = require('../jobStore');
const { parseJobReportId } = require('../jobReportUtils');
const { deleteLiveJob } = require('../ephemeralLiveReports');
const { isProtectedJob, isProtectedPath } = require('../bundledReportsManifest');
const {
  isJobVisibleToSession,
  isKeywordScanVisible,
  isErrorReportVisible
} = require('../reportVisibility');
const { moduleReportsDir } = require('../storagePaths');
const stateService = require('../../keyword-check/stateService');


function decodeReportId(reportId) {
  return decodeURIComponent(String(reportId || '').trim());
}

async function deleteKeywordReport(reportId, sessionId) {
  const scan = await stateService.getScanState(reportId);
  if (!scan) {
    throw new Error('Report not found');
  }
  if (scan.status === 'running' || scan.status === 'starting') {
    throw new Error('Cannot delete a report while the scan is still running');
  }
  if (!isKeywordScanVisible(scan, sessionId)) {
    throw new Error('You do not have permission to delete this report');
  }
  const storageBase = scan.storageFilename || reportId;
  if (isProtectedPath(`keyword-check/storage/scans/${storageBase}.json`)) {
    throw new Error('This demo report cannot be deleted');
  }
  await stateService.deleteScan(reportId);
  return { moduleId: 'keyword-check', reportId, deleted: true };
}

async function deleteErrorCheckReport(reportId, sessionId) {
  const safeName = path.basename(decodeReportId(reportId));
  const filePath = path.join(moduleReportsDir('error-check'), safeName);
  const rel = path.posix.join('error-check', 'reports', safeName);

  if (!await fs.pathExists(filePath)) {
    throw new Error('Report not found');
  }
  if (isProtectedPath(rel)) {
    throw new Error('This demo report cannot be deleted');
  }

  let data = null;
  try {
    data = await fs.readJson(filePath);
  } catch {
    data = null;
  }
  if (!isErrorReportVisible(rel, data, sessionId)) {
    throw new Error('You do not have permission to delete this report');
  }

  await fs.remove(filePath);
  return { moduleId: 'error-check', reportId: safeName, deleted: true };
}

async function deleteRunnableJobReport(moduleId, jobId, sessionId) {
  jobStore.validateJobId(jobId);
  if (isProtectedJob(moduleId, jobId)) {
    throw new Error('This demo report cannot be deleted');
  }

  const job = await jobStore.getJob(moduleId, jobId);
  if (!job) {
    throw new Error('Report not found');
  }
  if (job.status === 'pending' || job.status === 'running') {
    throw new Error('Cannot delete a report while the test is still running');
  }
  if (!isJobVisibleToSession(job, moduleId, sessionId)) {
    throw new Error('You do not have permission to delete this report');
  }

  await deleteLiveJob(moduleId, jobId, job);
  return { moduleId, reportId: `job:${jobId}`, deleted: true };
}

async function deleteSeoLegacyRunReport(reportId, sessionId) {
  const runId = path.basename(decodeReportId(reportId));
  const runDir = path.join(moduleReportsDir('seo'), runId);
  const rel = path.posix.join('seo', 'reports', runId);

  if (!await fs.pathExists(runDir)) {
    throw new Error('Report not found');
  }
  if (isProtectedPath(rel)) {
    throw new Error('This demo report cannot be deleted');
  }

  await fs.remove(runDir);
  return { moduleId: 'seo', reportId: runId, deleted: true };
}

async function deleteReport(moduleId, reportId, sessionId) {
  const mod = getModule(moduleId);
  if (!mod) {
    throw new Error('Unknown module');
  }

  const id = decodeReportId(reportId);
  if (!id) {
    throw new Error('Report id is required');
  }

  if (moduleId === 'keyword-check') {
    return deleteKeywordReport(id, sessionId);
  }

  if (moduleId === 'error-check') {
    return deleteErrorCheckReport(id, sessionId);
  }

  if (jobStore.RUNNABLE_MODULES.has(moduleId)) {
    const jobId = parseJobReportId(id) || (() => {
      try {
        jobStore.validateJobId(id);
        return id;
      } catch {
        return null;
      }
    })();

    if (jobId) {
      return deleteRunnableJobReport(moduleId, jobId, sessionId);
    }

    if (moduleId === 'seo') {
      return deleteSeoLegacyRunReport(id, sessionId);
    }

    throw new Error('Report not found');
  }

  throw new Error('Delete is not supported for this module');
}

module.exports = {
  deleteReport
};