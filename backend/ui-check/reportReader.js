const path = require('path');
const fs = require('fs-extra');
const { safeReadJson, safeReadText, listDirsByMtime, toReportMeta } = require('../shared/reportUtils');
const { listJobReports, getJobReport, getJobHtml, parseJobReportId } = require('../shared/jobReportUtils');

const { moduleReportsDir } = require('../shared/storagePaths');
const REPORTS_DIR = moduleReportsDir('ui-check');
const HTML_PATH = path.join(REPORTS_DIR, 'qa-report.html');
const MODULE_ID = 'ui-check';

async function listReports() {
  const reports = await listJobReports(MODULE_ID);
  const runs = await listDirsByMtime(REPORTS_DIR);
  for (const run of runs) {
    const jsonPath = path.join(run.path, 'qaReport.json');
    if (!await fs.pathExists(jsonPath)) continue;
    const stat = await fs.stat(jsonPath);
    reports.push(toReportMeta({
      id: run.name,
      type: 'ui-run',
      title: `UI Run ${run.name}`,
      generatedAt: stat.mtime.toISOString(),
      size: stat.size,
      hasHtml: await fs.pathExists(HTML_PATH)
    }));
  }
  if (await fs.pathExists(HTML_PATH)) {
    const stat = await fs.stat(HTML_PATH);
    reports.unshift(toReportMeta({
      id: 'latest-html',
      type: 'ui-html',
      title: 'Latest HTML Report',
      generatedAt: stat.mtime.toISOString(),
      size: stat.size,
      hasHtml: true
    }));
  }
  return reports;
}

async function getReport(reportId) {
  if (parseJobReportId(reportId)) {
    return getJobReport(MODULE_ID, reportId);
  }

  if (reportId === 'latest-html') {
    const html = await safeReadText(HTML_PATH);
    return html
      ? { meta: { id: reportId, type: 'ui-html', hasHtml: true }, data: { format: 'html', available: true } }
      : { error: 'NOT_FOUND', message: 'No UI check HTML report found.' };
  }

  const runPath = path.join(REPORTS_DIR, path.basename(reportId), 'qaReport.json');
  const data = await safeReadJson(runPath);
  if (!data) return { error: 'NOT_FOUND', message: 'UI check run report not found' };

  const stat = await fs.stat(runPath).catch(() => null);
  return {
    meta: { id: reportId, type: 'ui-run', generatedAt: stat?.mtime?.toISOString(), hasHtml: await fs.pathExists(HTML_PATH) },
    data
  };
}

async function getLatestReport() {
  const runs = await listDirsByMtime(REPORTS_DIR);
  for (const run of runs) {
    const result = await getReport(run.name);
    if (!result.error) return result;
  }
  return getReport('latest-html');
}

async function getHtmlForReport(reportId) {
  if (parseJobReportId(reportId)) {
    return getJobHtml(MODULE_ID, reportId);
  }

  const html = await safeReadText(HTML_PATH);
  if (!html) return { error: 'NOT_FOUND', message: 'No UI check HTML report. Run: node backend/ui-check/runSingleURL.js <url>' };
  return { html };
}

module.exports = { listReports, getReport, getLatestReport, getHtmlForReport };