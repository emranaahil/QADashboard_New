const path = require('path');
const fs = require('fs-extra');
const { safeReadJson, listFilesByMtime, toReportMeta } = require('../shared/reportUtils');

const { keywordStorageDir } = require('../shared/storagePaths');
const SCANS_DIR = keywordStorageDir('scans');
const REPORTS_DIR = keywordStorageDir('reports');

async function listReports() {
  const scans = await listFilesByMtime(SCANS_DIR, { extension: '.json' });
  return scans.map(f => {
    const id = f.name.replace('.json', '');
    return toReportMeta({
      id,
      type: 'scan',
      title: `Scan ${id.slice(0, 8)}…`,
      generatedAt: f.mtime.toISOString(),
      size: f.size,
      hasPdf: true
    });
  });
}

async function getReport(reportId) {
  const scanPath = path.join(SCANS_DIR, `${reportId}.json`);
  const data = await safeReadJson(scanPath);
  if (!data) return { error: 'NOT_FOUND', message: 'Scan report not found' };

  const pdfPath = path.join(REPORTS_DIR, `keyword-audit-report-${reportId}.pdf`);
  const hasPdf = await fs.pathExists(pdfPath);

  return {
    meta: {
      id: reportId,
      type: 'scan',
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
    const id = scan.name.replace('.json', '');
    const result = await getReport(id);
    if (!result.error && result.data?.status === 'completed') return result;
  }

  const latestId = scans[0].name.replace('.json', '');
  return getReport(latestId);
}

async function getHtmlForReport() {
  return { error: 'NOT_AVAILABLE', message: 'Keyword check uses PDF reports. Use the PDF endpoint.' };
}

async function getPdfPath(reportId) {
  const pdfPath = path.join(REPORTS_DIR, `keyword-audit-report-${reportId}.pdf`);
  if (!await fs.pathExists(pdfPath)) return null;
  return pdfPath;
}

module.exports = { listReports, getReport, getLatestReport, getHtmlForReport, getPdfPath };