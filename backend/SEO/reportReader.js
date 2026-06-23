const path = require('path');
const { safeReadJson, safeReadText, toReportMeta } = require('../shared/reportUtils');
const { listJobReports, getJobReport, getJobHtml, parseJobReportId } = require('../shared/jobReportUtils');

const { moduleReportsDir } = require('../shared/storagePaths');
const REPORTS_DIR = moduleReportsDir('seo');
const JSON_PATH = path.join(REPORTS_DIR, 'seoReport.json');
const HTML_PATH = path.join(REPORTS_DIR, 'reportseo.html');
const MODULE_ID = 'seo';

async function listReports() {
  const fs = require('fs-extra');
  const reports = await listJobReports(MODULE_ID);
  if (await fs.pathExists(JSON_PATH)) {
    const stat = await fs.stat(JSON_PATH);
    reports.push(toReportMeta({
      id: 'latest',
      type: 'seo',
      title: 'Latest SEO Audit (CLI)',
      generatedAt: stat.mtime.toISOString(),
      size: stat.size,
      hasHtml: await fs.pathExists(HTML_PATH)
    }));
  }
  return reports;
}

async function getReport(reportId) {
  if (parseJobReportId(reportId)) {
    return getJobReport(MODULE_ID, reportId);
  }

  const data = await safeReadJson(JSON_PATH);
  if (!data) return { error: 'NO_REPORTS', message: 'No SEO report found. Run: node backend/seo/runseo.js <url>' };

  return {
    meta: {
      id: reportId || 'latest',
      type: 'seo',
      generatedAt: data.scanDate,
      hasHtml: true
    },
    data
  };
}

async function getLatestReport() {
  return getReport('latest');
}

async function getHtmlForReport(reportId) {
  if (parseJobReportId(reportId)) {
    return getJobHtml(MODULE_ID, reportId);
  }

  const html = await safeReadText(HTML_PATH);
  if (!html) return { error: 'NOT_FOUND', message: 'SEO HTML report not found. Run an SEO audit first.' };
  return { html };
}

module.exports = { listReports, getReport, getLatestReport, getHtmlForReport };