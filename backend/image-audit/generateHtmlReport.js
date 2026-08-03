const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('../shared/logViewUtils');
const { formatBytes } = require('./engines/summaryEngine');
const {
  VIEWPORT_COLUMN_COUNT,
  getViewportSlot,
  formatDiffPct,
  viewportSummaryLine
} = require('./viewportConfig');
const {
  resolveReportViewports,
  tableColumnCount,
  loadingStatus,
  optimizationStatusForViewport,
  visibleLabel,
  loadedStatus
} = require('./imageAuditCsv');

const CSV_CLIENT_PATH = path.join(__dirname, 'imageAuditCsvClient.js');

function readCsvClientScript() {
  try {
    return fs.readFileSync(CSV_CLIENT_PATH, 'utf8');
  } catch {
    return '';
  }
}

function statCard(label, value, highlight) {
  const cls = highlight ? ' stat bad' : ' stat';
  return `<div class="${cls.trim()}"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(String(value))}</div></div>`;
}

function formatBreakdown(images) {
  const counts = {};
  for (const img of images) {
    const fmt = (img.metadata?.format || 'UNKNOWN').toUpperCase();
    counts[fmt] = (counts[fmt] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([fmt, n]) => `${fmt}: ${n}`)
    .join(' · ') || '—';
}

function viewportTableCells(img, viewportKey, viewports) {
  const slot = getViewportSlot(img, viewportKey, viewports);
  const opt = optimizationStatusForViewport(img, viewportKey, viewports);
  const optClass = opt !== 'OK' ? 'cell-warn' : '';
  return `
    <td class="num">${slot.renderedWidth ?? 0}</td>
    <td class="num">${slot.renderedHeight ?? 0}</td>
    <td class="num">${escapeHtml(formatDiffPct(slot.widthDiffPct))}</td>
    <td class="num">${escapeHtml(formatDiffPct(slot.heightDiffPct))}</td>
    <td>${escapeHtml(visibleLabel(slot))}</td>
    <td class="${optClass}">${escapeHtml(opt)}</td>`;
}

function imageTableHead(viewports) {
  const viewportGroups = viewports.map(
    (vp) => `<th colspan="${VIEWPORT_COLUMN_COUNT}" class="group-vp">${escapeHtml(vp.label)}</th>`
  ).join('');
  const viewportCols = viewports.map(
    () => '<th>W</th><th>H</th><th>W Δ%</th><th>H Δ%</th><th>Visible</th><th>Optimization</th>'
  ).join('');
  return `
    <thead>
      <tr class="head-group">
        <th rowspan="2" class="col-num">No.</th>
        <th rowspan="2">Page URL</th>
        <th rowspan="2">Image Type</th>
        <th rowspan="2">Image URL</th>
        <th rowspan="2">Alt Text</th>
        <th colspan="2" class="group-original">Original</th>
        ${viewportGroups}
        <th rowspan="2">Loading</th>
        <th rowspan="2">HTTP</th>
        <th rowspan="2">File Size</th>
        <th rowspan="2">Responsive</th>
        <th rowspan="2">Loaded</th>
        <th rowspan="2">Broken</th>
      </tr>
      <tr class="head-cols">
        <th>W</th>
        <th>H</th>
        ${viewportCols}
      </tr>
    </thead>`;
}

function imageTableRows(images, viewports) {
  const colCount = tableColumnCount(viewports);
  if (!images.length) {
    return `<tr><td colspan="${colCount}" class="empty">No images discovered</td></tr>`;
  }

  return images.map((img, idx) => {
    const broken = img.verification?.broken;
    const rowClass = broken ? 'error-row' : '';
    return `<tr class="${rowClass}">
      <td class="col-num">${idx + 1}</td>
      <td class="cell-url"><a href="${escapeHtml(img.identity?.pageUrl || '')}" target="_blank" rel="noopener">${escapeHtml(img.identity?.pageUrl || '—')}</a></td>
      <td>${escapeHtml(img.metadata?.format || '—')}</td>
      <td class="cell-url"><a href="${escapeHtml(img.identity?.url || '')}" target="_blank" rel="noopener">${escapeHtml(img.identity?.url || '—')}</a></td>
      <td>${escapeHtml(img.accessibility?.alt ?? '—')}</td>
      <td class="num">${img.rendering?.naturalWidth ?? '—'}</td>
      <td class="num">${img.rendering?.naturalHeight ?? '—'}</td>
      ${viewports.map((vp) => viewportTableCells(img, vp.key, viewports)).join('')}
      <td>${escapeHtml(loadingStatus(img))}</td>
      <td>${img.network?.status ?? '—'}</td>
      <td>${img.network?.bytes != null ? escapeHtml(formatBytes(img.network.bytes)) : '—'}</td>
      <td>${img.source?.responsive ? 'Yes' : 'No'}</td>
      <td>${escapeHtml(loadedStatus(img))}</td>
      <td>${broken ? 'Yes' : 'No'}</td>
    </tr>`;
  }).join('');
}

function generateHtmlReport(report) {
  const summary = report.summary || {};
  const images = report.images || [];
  const viewports = resolveReportViewports(report);
  const viewportLine = viewportSummaryLine(viewports);
  const tableMinWidth = Math.max(1200, 700 + viewports.length * 320);
  const generatedAt = report.generatedAt
    ? new Date(report.generatedAt).toLocaleString()
    : '—';

  const exportJson = JSON.stringify({
    domain: report.domain,
    url: report.url,
    generatedAt: report.generatedAt,
    summary: report.summary,
    viewports,
    images: report.images
  }).replace(/</g, '\\u003c');

  const PRINT_STYLES = `
  @media print {
    @page { size: A4 landscape; margin: 6mm; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { background: #fff !important; color: #111 !important; }
    .wrap { max-width: none; padding: 0; }
    .actions, .btn { display: none !important; }
    .summary { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .stat { background: #fafafa !important; border: 1px solid #e4e4e7; }
    .table-scroll { max-height: none !important; overflow: visible !important; }
    table { font-size: 5.5pt; table-layout: fixed !important; min-width: 0 !important; }
    thead { display: table-header-group; }
    th, td { color: #111 !important; border-color: #e4e4e7 !important; white-space: normal !important; word-break: break-word; padding: 3px 2px; }
    .group-vp, .group-original { background: #f4f4f5 !important; }
    a { color: #111 !important; text-decoration: none !important; }
    tr.error-row td { background: #fef2f2 !important; }
  }`;

  const bodyHtml = `
    <div class="summary">
      ${statCard('Total Images', summary.totalImages ?? images.length)}
      ${statCard('Unique Images', summary.uniqueImages ?? 0)}
      ${statCard('Broken', summary.brokenImages ?? 0, (summary.brokenImages || 0) > 0)}
      ${statCard('Lazy Loaded', summary.lazyImages ?? 0)}
      ${statCard('Responsive', summary.responsiveImages ?? 0)}
      ${statCard('Total Size', summary.totalBytesFormatted ?? '0 B')}
      ${statCard('Potential Savings', summary.potentialSavingsFormatted ?? '0 B')}
    </div>
    <p class="sub"><strong>Formats:</strong> ${escapeHtml(formatBreakdown(images))}</p>

    <div class="section">
      <h2>All Images</h2>
      <p class="sub"><strong>Audited viewports:</strong> ${escapeHtml(viewportLine)}</p>
      <p class="sub">Each page is loaded once per viewport above. <strong>Original W/H</strong> = intrinsic file dimensions (natural size or HTTP probe). <strong>W/H</strong> under each viewport = rendered layout pixels (<strong>0</strong> when hidden). <strong>W/H Δ%</strong> = (original − rendered) ÷ original × 100, shown only when the file is larger than its on-screen display (blank otherwise). <strong>Image URL</strong> = discovered image address (<code>src</code> or equivalent).</p>
      <div class="table-scroll">
        <table class="images-table">
          ${imageTableHead(viewports)}
          <tbody>${imageTableRows(images, viewports)}</tbody>
        </table>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Image Audit Report — ${escapeHtml(report.domain || report.url || '')}</title>
  <style>
    :root { --bg:#0b1220; --text:#e7eefc; --muted:#a9b6d6; --border:rgba(255,255,255,.10); --bad:#ef4444; --link:#60a5fa; --vp-a:rgba(96,165,250,.12); --vp-b:rgba(52,211,153,.12); }
    * { box-sizing: border-box; }
    body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:linear-gradient(135deg,#0b1220,#0f1b33); color:var(--text); }
    .wrap { max-width:100%; margin:0 auto; padding:24px; }
    h1 { margin:0 0 8px; font-size:1.35rem; }
    h2 { font-size:1rem; margin:24px 0 10px; }
    .sub { color:var(--muted); font-size:0.85rem; margin:4px 0; line-height:1.45; }
    .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; margin:18px 0; }
    .stat { background:rgba(255,255,255,.04); border:1px solid var(--border); border-radius:12px; padding:12px; text-align:center; }
    .stat .k { color:var(--muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:.04em; }
    .stat .v { font-size:1.2rem; font-weight:800; margin-top:6px; }
    .stat.bad .v { color:var(--bad); }
    .table-scroll { overflow-x:auto; border:1px solid var(--border); border-radius:12px; }
    table.images-table { width:100%; border-collapse:collapse; background:rgba(255,255,255,.03); min-width:${tableMinWidth}px; table-layout:auto; }
    th,td { padding:7px 8px; border:1px solid rgba(255,255,255,.08); vertical-align:top; text-align:left; font-size:0.72rem; }
    thead th { color:var(--muted); font-size:0.65rem; text-transform:uppercase; background:rgba(255,255,255,.04); position:sticky; top:0; z-index:2; }
    thead tr.head-cols th { top:32px; z-index:1; font-size:0.6rem; }
    th.group-vp:nth-of-type(1) { background:var(--vp-a); color:#93c5fd; }
    th.group-vp:nth-of-type(2) { background:var(--vp-b); color:#6ee7b7; }
    th.group-original { background:rgba(255,255,255,.06); }
    tr.error-row { background:rgba(239,68,68,.08); }
    .col-num { width:36px; text-align:center; color:var(--muted); font-weight:700; }
    td.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .cell-url, .cell-src { max-width:180px; word-break:break-all; }
    .src-link { font-size:0.65rem; }
    .cell-warn { color:#fcd34d; }
    a { color:var(--link); word-break:break-all; }
    .empty { color:var(--muted); padding:12px; text-align:center; }
    .actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
    .btn { cursor:pointer; background:rgba(255,255,255,.06); border:1px solid var(--border); color:var(--text); padding:8px 14px; border-radius:10px; font-weight:600; font-size:0.8rem; }
    .btn:hover { background:rgba(255,255,255,.10); }
    .section { margin-top:8px; }
    ${PRINT_STYLES}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Image Audit Report</h1>
      <p class="sub">Target: ${escapeHtml(report.url || '')}</p>
      <p class="sub">Page: ${escapeHtml(report.pageTitle || report.pageUrl || '')}</p>
      <p class="sub">Viewports: ${escapeHtml(viewportLine)}</p>
      <p class="sub">Generated: ${escapeHtml(generatedAt)}</p>
      <div class="actions">
        <button class="btn" type="button" data-image-audit-action="export-csv">Export CSV</button>
        <button class="btn" type="button" data-image-audit-action="print">Print / Save PDF</button>
      </div>
    </header>
    ${bodyHtml}
  </div>
  <script>window.IMAGE_AUDIT_DATA = ${exportJson};</script>
  <script>${readCsvClientScript()}</script>
</body>
</html>`;
}

module.exports = { generateHtmlReport };