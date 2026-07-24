/**
 * Image Audit CSV export — UTF-8 BOM, Excel-compatible.
 */

const { formatBytes } = require('./engines/summaryEngine');
const {
  resolveAuditViewports,
  getViewportSlot,
  formatDiffPct,
  viewportCsvHeaderCells,
  VIEWPORT_COLUMN_COUNT
} = require('./viewportConfig');

const CSV_BOM = '\uFEFF';

const BASE_HEADERS = [
  'No.',
  'Page URL',
  'Image Type',
  'Image URL',
  'Alt Text',
  'Original Width',
  'Original Height'
];

const TAIL_HEADERS = [
  'Loading Status',
  'HTTP Status',
  'File Size',
  'Responsive',
  'Loaded',
  'Broken'
];

const BASE_COLUMN_COUNT = BASE_HEADERS.length + TAIL_HEADERS.length;
const TABLE_COLUMN_COUNT = BASE_COLUMN_COUNT + VIEWPORT_COLUMN_COUNT;

function resolveReportViewports(report) {
  return resolveAuditViewports({ viewports: report?.viewports });
}

function buildHeaders(viewports) {
  return [
    ...BASE_HEADERS,
    ...viewports.flatMap(viewportCsvHeaderCells),
    ...TAIL_HEADERS
  ];
}

function tableColumnCount(viewports) {
  return buildHeaders(viewports).length;
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function csvFilename(domain) {
  const safe = String(domain || 'site')
    .replace(/[^a-z0-9.-]+/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'site';
  return `Image_Audit_${safe}.csv`;
}

function loadingStatus(img) {
  if (img.source?.loading) return String(img.source.loading);
  if (img.source?.lazy) return 'lazy';
  return 'eager';
}

function optimizationStatus(img) {
  const issues = img.optimization?.issues || [];
  if (!issues.length) return 'OK';
  const recs = img.optimization?.recommendations || [];
  return recs.length ? `${issues.join('; ')} → ${recs.join('; ')}` : issues.join('; ');
}

function optimizationStatusForViewport(img, viewportKey, viewports) {
  const slot = getViewportSlot(img, viewportKey, viewports);
  const issues = slot.optimization?.issues || [];
  if (!issues.length) return 'OK';
  const recs = slot.optimization?.recommendations || [];
  return recs.length ? `${issues.join('; ')} → ${recs.join('; ')}` : issues.join('; ');
}

function visibleLabel(slot) {
  return slot.visible ? 'Yes' : 'No';
}

function viewportCsvCells(img, viewportKey, viewports) {
  const slot = getViewportSlot(img, viewportKey, viewports);
  return [
    slot.renderedWidth ?? 0,
    slot.renderedHeight ?? 0,
    formatDiffPct(slot.widthDiffPct),
    formatDiffPct(slot.heightDiffPct),
    visibleLabel(slot),
    optimizationStatusForViewport(img, viewportKey, viewports)
  ];
}

function loadedStatus(img) {
  if (img.verification?.broken) return 'No';
  if (img.verification?.ok) return 'Yes';
  return 'Unknown';
}

function imageToRow(img, index, viewports) {
  const viewportCells = viewports.flatMap((vp) => viewportCsvCells(img, vp.key, viewports));

  return [
    index + 1,
    img.identity?.pageUrl,
    img.metadata?.format,
    img.identity?.url,
    img.accessibility?.alt ?? '',
    img.rendering?.naturalWidth ?? '',
    img.rendering?.naturalHeight ?? '',
    ...viewportCells,
    loadingStatus(img),
    img.network?.status ?? '',
    img.network?.bytes != null ? formatBytes(img.network.bytes) : '',
    img.source?.responsive ? 'Yes' : 'No',
    loadedStatus(img),
    img.verification?.broken ? 'Yes' : 'No'
  ].map(csvEscape).join(',');
}

function buildImageAuditCsv(report) {
  const images = report.images || [];
  const viewports = resolveReportViewports(report);
  const headers = buildHeaders(viewports);
  const lines = [headers.map(csvEscape).join(',')];
  images.forEach((img, idx) => {
    lines.push(imageToRow(img, idx, viewports));
  });
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

module.exports = {
  CSV_BOM,
  TABLE_COLUMN_COUNT,
  BASE_COLUMN_COUNT,
  VIEWPORT_COLUMN_COUNT,
  csvEscape,
  csvFilename,
  resolveReportViewports,
  buildHeaders,
  tableColumnCount,
  loadingStatus,
  optimizationStatus,
  optimizationStatusForViewport,
  visibleLabel,
  viewportCsvCells,
  loadedStatus,
  imageToRow,
  buildImageAuditCsv
};