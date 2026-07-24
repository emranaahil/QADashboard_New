const path = require('path');
const fs = require('fs-extra');
const { safeReadJson } = require('../shared/reportUtils');
const { listJobReports, getJobReport, getJobHtml, parseJobReportId } = require('../shared/jobReportUtils');
const { generateHtmlReport } = require('./generateHtmlReport');
const { REPORT_JSON } = require('./securityReportStorage');
const jobStore = require('../shared/jobStore');

const MODULE_ID = 'security-audit';

async function listReports() {
  return listJobReports(MODULE_ID);
}

async function getReport(reportId) {
  if (parseJobReportId(reportId)) {
    return getJobReport(MODULE_ID, reportId);
  }

  const jobId = reportId;
  try {
    jobStore.validateJobId(jobId);
  } catch {
    return { error: 'NOT_FOUND', message: 'Security audit report not found' };
  }

  return getJobReport(MODULE_ID, `job:${jobId}`);
}

async function getLatestReport() {
  const reports = await listReports();
  if (!reports.length) {
    return { error: 'NO_REPORTS', message: 'No security audit reports found. Run an audit first.' };
  }
  return getReport(reports[0].id);
}

async function getHtmlForReport(reportId) {
  const jobReport = parseJobReportId(reportId);
  if (jobReport) {
    const disk = await getJobHtml(MODULE_ID, reportId);
    if (!disk?.error) return disk;

    const jobDir = jobStore.getJobDir(MODULE_ID, jobReport);
    const jsonPath = path.join(jobDir, REPORT_JSON);
    const data = await safeReadJson(jsonPath);
    if (data) return { html: generateHtmlReport(data) };
    return disk;
  }

  const result = await getReport(reportId);
  if (result.error) return result;
  return { html: generateHtmlReport(result.data) };
}

module.exports = {
  listReports,
  getReport,
  getLatestReport,
  getHtmlForReport
};