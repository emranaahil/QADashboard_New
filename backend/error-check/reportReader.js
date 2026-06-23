const path = require('path');
const { safeReadJson, listFilesByMtime, toReportMeta } = require('../shared/reportUtils');

const { moduleReportsDir } = require('../shared/storagePaths');
const REPORTS_DIR = moduleReportsDir('error-check');

async function listReports() {
  const files = await listFilesByMtime(REPORTS_DIR, { extension: '.json', prefix: 'error-check-' });
  return files.map(f => toReportMeta({
    id: f.name,
    type: 'error-check',
    title: f.name.replace('error-check-', '').replace('.json', ''),
    generatedAt: f.mtime.toISOString(),
    size: f.size
  }));
}

async function getReport(reportId) {
  const safeName = path.basename(reportId);
  const filePath = path.join(REPORTS_DIR, safeName);
  const data = await safeReadJson(filePath);
  if (!data) return { error: 'NOT_FOUND', message: 'Error check report not found' };

  return {
    meta: { id: safeName, type: 'error-check', generatedAt: data.generatedAt },
    data
  };
}

async function getLatestReport() {
  const files = await listFilesByMtime(REPORTS_DIR, { extension: '.json', prefix: 'error-check-' });
  if (!files.length) return { error: 'NO_REPORTS', message: 'No error check reports found. Run a check first.' };
  return getReport(files[0].name);
}

async function getHtmlForReport() {
  return { error: 'NOT_AVAILABLE', message: 'Error check reports are JSON only.' };
}

module.exports = { listReports, getReport, getLatestReport, getHtmlForReport };