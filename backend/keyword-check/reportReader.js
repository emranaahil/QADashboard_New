const path = require('path');
const fs = require('fs-extra');
const { safeReadJson, listFilesByMtime, toReportMeta } = require('../shared/reportUtils');
const stateService = require('./stateService');
const { scanTitleFromData } = require('./scanFilename');
const { renderKeywordCheckHtml } = require('../shared/radarReportHtml');

const { keywordStorageDir } = require('../shared/storagePaths');
const SCANS_DIR = keywordStorageDir('scans');
const REPORTS_DIR = keywordStorageDir('reports');

async function listReports() {
  const scans = await listFilesByMtime(SCANS_DIR, { extension: '.json' });
  const reports = [];

  for (const f of scans) {
    const data = await safeReadJson(f.path);
    if (!data) continue;

    const id = data.id || f.name.replace('.json', '');
    const pdfPath = path.join(REPORTS_DIR, `keyword-audit-report-${id}.pdf`);
    const hasPdf = await fs.pathExists(pdfPath);

    reports.push(toReportMeta({
      id,
      type: 'scan',
      title: scanTitleFromData(data, f.name),
      generatedAt: data.completedAt || data.startedAt || f.mtime.toISOString(),
      size: f.size,
      hasPdf,
      hasHtml: true
    }));
  }

  return reports;
}

async function getReport(reportId) {
  const data = await stateService.getScanState(reportId);
  if (!data) return { error: 'NOT_FOUND', message: 'Scan report not found' };

  const pdfPath = path.join(REPORTS_DIR, `keyword-audit-report-${reportId}.pdf`);
  const hasPdf = await fs.pathExists(pdfPath);

  return {
    meta: {
      id: reportId,
      type: 'scan',
      title: scanTitleFromData(data),
      generatedAt: data.completedAt || data.startedAt,
      hasPdf
    },
    data
  };
}

async function getLatestReport() {
  const scans = await listFilesByMtime(SCANS_DIR, { extension: '.json' });
  if (!scans.length) return { error: 'NO_REPORTS', message: 'No keyword scan reports found' };

  for (const scan of scans) {
    const data = await safeReadJson(scan.path);
    if (!data?.id) continue;
    const result = await getReport(data.id);
    if (!result.error && result.data?.status === 'completed') return result;
  }

  const latestData = await safeReadJson(scans[0].path);
  const latestId = latestData?.id || scans[0].name.replace('.json', '');
  return getReport(latestId);
}

async function getHtmlForReport(reportId) {
  const result = reportId ? await getReport(reportId) : await getLatestReport();
  if (result.error) return result;
  return { html: renderKeywordCheckHtml(result.data) };
}

async function getPdfPath(reportId) {
  const pdfPath = path.join(REPORTS_DIR, `keyword-audit-report-${reportId}.pdf`);
  if (!await fs.pathExists(pdfPath)) return null;
  return pdfPath;
}

module.exports = { listReports, getReport, getLatestReport, getHtmlForReport, getPdfPath };