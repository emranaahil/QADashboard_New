const path = require('path');
const fs = require('fs-extra');
const { safeReadJson } = require('../shared/reportUtils');
const { listJobReports, getJobReport, getJobHtml, parseJobReportId } = require('../shared/jobReportUtils');
const { renderSitemapCheckHtml } = require('../shared/radarReportHtml');
const { REPORT_JSON } = require('./sitemapReportStorage');
const jobStore = require('../shared/jobStore');

const MODULE_ID = 'sitemap-check';

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
    return { error: 'NOT_FOUND', message: 'Sitemap report not found' };
  }

  return getJobReport(MODULE_ID, `job:${jobId}`);
}

async function getLatestReport() {
  const reports = await listReports();
  if (!reports.length) {
    return { error: 'NO_REPORTS', message: 'No sitemap reports found. Run a check first.' };
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
    if (data) return { html: renderSitemapCheckHtml(data) };
    return disk;
  }

  const result = await getReport(reportId);
  if (result.error) return result;
  return { html: renderSitemapCheckHtml(result.data) };
}

module.exports = {
  listReports,
  getReport,
  getLatestReport,
  getHtmlForReport
};