const path = require('path');
const fs = require('fs-extra');
const { safeReadJson, safeReadText } = require('../shared/reportUtils');
const { listJobReports, getJobReport, getJobHtml, parseJobReportId } = require('../shared/jobReportUtils');
const { moduleJobsDir } = require('../shared/storagePaths');

const MODULE_ID = 'visual-twin';

async function listReports() {
  return listJobReports(MODULE_ID);
}

async function getReport(reportId) {
  if (parseJobReportId(reportId)) {
    return getJobReport(MODULE_ID, reportId);
  }
  // job id only
  const jobDir = path.join(moduleJobsDir(MODULE_ID), path.basename(reportId));
  const jsonPath = path.join(jobDir, 'qaReport.json');
  const data = await safeReadJson(jsonPath);
  if (!data) return { error: 'NOT_FOUND', message: 'Visual Twin report not found' };
  return {
    meta: { id: reportId, type: 'visual-twin', hasHtml: await fs.pathExists(path.join(jobDir, 'qa-report.html')) },
    data
  };
}

async function getLatestReport() {
  const reports = await listReports();
  if (!reports.length) return { error: 'NO_REPORTS', message: 'No Visual Twin reports yet' };
  return getReport(reports[0].id.startsWith('job:') ? reports[0].id : `job:${reports[0].id}`);
}

async function getHtmlForReport(reportId) {
  if (parseJobReportId(reportId)) {
    return getJobHtml(MODULE_ID, reportId);
  }
  const jobDir = path.join(moduleJobsDir(MODULE_ID), path.basename(reportId));
  const html = await safeReadText(path.join(jobDir, 'qa-report.html'));
  if (!html) return { error: 'NOT_FOUND', message: 'No HTML report for this Visual Twin job' };
  return { html };
}

module.exports = { listReports, getReport, getLatestReport, getHtmlForReport };
