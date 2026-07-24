const path = require('path');
const fs = require('fs-extra');
const { safeReadJson, safeReadText, listDirsByMtime, toReportMeta } = require('../shared/reportUtils');
const { listJobReports, getJobReport, getJobHtml, parseJobReportId } = require('../shared/jobReportUtils');
const { moduleDataRoot, moduleReportsDir } = require('../shared/storagePaths');
const { generateHtmlReport } = require('./uiseocheck');
const { REPORT_HTML, REPORT_JSON } = require('./seoReportStorage');

const REPORTS_DIR = moduleReportsDir('seo');
const MODULE_ID = 'seo';

function htmlFromSeoReport(data, reportId) {
  if (!data?.pages?.length) return null;
  return generateHtmlReport({
    mainUrl: data.mainUrl,
    scanDate: data.scanDate,
    pages: data.pages,
    siteChecks: data.siteChecks || null,
    reportId
  });
}

async function persistHtml(reportId, html) {
  if (!html) return;

  let htmlPath = null;
  if (parseJobReportId(reportId)) {
    const jobReport = await getJobReport(MODULE_ID, reportId);
    const relative = jobReport?.meta?.reportPath;
    if (relative) {
      htmlPath = path.join(moduleDataRoot(MODULE_ID), relative);
    }
  } else {
    htmlPath = path.join(REPORTS_DIR, path.basename(reportId), REPORT_HTML);
  }

  if (!htmlPath) return;

  try {
    await fs.ensureDir(path.dirname(htmlPath));
    await fs.writeFile(htmlPath, html, 'utf8');
  } catch {
    // Non-fatal: serving regenerated HTML still works even if disk refresh fails.
  }
}

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
    return { error: 'NO_REPORTS', message: 'No audit report found. Run a Seo/Geo Audit first.' };
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
    const jobReport = await getJobReport(MODULE_ID, reportId);
    if (jobReport?.error) return jobReport;

    const html = htmlFromSeoReport(jobReport.data, reportId);
    if (html) {
      await persistHtml(reportId, html);
      return { html };
    }

    return getJobHtml(MODULE_ID, reportId);
  }

  const runId = path.basename(reportId);
  const jsonPath = path.join(REPORTS_DIR, runId, REPORT_JSON);
  const data = await safeReadJson(jsonPath);
  if (data?.pages?.length) {
    const html = htmlFromSeoReport(data, runId);
    await persistHtml(runId, html);
    return { html };
  }

  const htmlPath = path.join(REPORTS_DIR, runId, REPORT_HTML);
  const html = await safeReadText(htmlPath);
  if (!html) {
    return { error: 'NOT_FOUND', message: 'SEO HTML report not found. Run an SEO audit first.' };
  }
  return { html };
}

module.exports = { listReports, getReport, getLatestReport, getHtmlForReport };