const path = require('path');
const fs = require('fs-extra');
const { safeReadJson, safeReadText, listDirsByMtime, toReportMeta } = require('../shared/reportUtils');
const { listJobReports, getJobReport, getJobHtml, parseJobReportId } = require('../shared/jobReportUtils');
const { moduleReportsDir } = require('../shared/storagePaths');
const { REPORT_HTML, REPORT_JSON } = require('./seoReportStorage');

const REPORTS_DIR = moduleReportsDir('seo');
const MODULE_ID = 'seo';

async function listReports() {
  const reports = await listJobReports(MODULE_ID);
  const runs = await listDirsByMtime(REPORTS_DIR);

  for (const run of runs) {
    const jsonPath = path.join(run.path, REPORT_JSON);
    if (!await fs.pathExists(jsonPath)) continue;
    const stat = await fs.stat(jsonPath);
    reports.push(toReportMeta({
      id: run.name,
      type: 'seo-run',
      title: `SEO Run ${run.name}`,
      generatedAt: stat.mtime.toISOString(),
      size: stat.size,
      hasHtml: await fs.pathExists(path.join(run.path, REPORT_HTML))
    }));
  }

  return reports;
}

async function getReport(reportId) {
  if (parseJobReportId(reportId)) {
    return getJobReport(MODULE_ID, reportId);
  }

  const runPath = path.join(REPORTS_DIR, path.basename(reportId), REPORT_JSON);
  const data = await safeReadJson(runPath);
  if (!data) {
    return { error: 'NO_REPORTS', message: 'No SEO report found. Run an SEO audit first.' };
  }

  const stat = await fs.stat(runPath).catch(() => null);
  const runDir = path.dirname(runPath);

  return {
    meta: {
      id: reportId,
      type: 'seo-run',
      generatedAt: data.scanDate || stat?.mtime?.toISOString(),
      hasHtml: await fs.pathExists(path.join(runDir, REPORT_HTML))
    },
    data
  };
}

async function getLatestReport() {
  const runs = await listDirsByMtime(REPORTS_DIR);
  for (const run of runs) {
    const result = await getReport(run.name);
    if (!result.error) return result;
  }
  return getReport('latest');
}

async function getHtmlForReport(reportId) {
  if (parseJobReportId(reportId)) {
    return getJobHtml(MODULE_ID, reportId);
  }

  const htmlPath = path.join(REPORTS_DIR, path.basename(reportId), REPORT_HTML);
  const html = await safeReadText(htmlPath);
  if (!html) {
    return { error: 'NOT_FOUND', message: 'SEO HTML report not found. Run an SEO audit first.' };
  }
  return { html };
}

module.exports = { listReports, getReport, getLatestReport, getHtmlForReport };