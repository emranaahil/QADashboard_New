/**
 * Link Radar CSV / Excel export — 3 columns: Main URL | URL | Issues
 * Excel HTML preserves bold headers, wrap, top-left align, and borders.
 */

const { explainBrokenPage } = require('./linkRadarIssueExplain');

const CSV_BOM = '\uFEFF';

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function excelEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveExplanation(page) {
  if (page?.explanation?.summary) return page.explanation;
  return explainBrokenPage(page || {});
}

/**
 * Single Issues cell text — plain English for anyone.
 */
function formatIssuesCell(page) {
  const exp = resolveExplanation(page);
  const parts = [];
  if (exp.summary) parts.push(exp.summary);
  if (exp.whatItMeans) parts.push(`What it means: ${exp.whatItMeans}`);
  if (exp.fixHint) parts.push(`What to do: ${exp.fixHint}`);
  if (exp.statusCode) parts.push(`HTTP status: ${exp.statusCode}`);
  const tech = exp.technicalDetail && exp.technicalDetail !== '—' ? exp.technicalDetail : '';
  if (tech && !String(exp.summary || '').includes(String(exp.statusCode || ''))) {
    parts.push(`Technical: ${tech}`);
  }
  return parts.filter(Boolean).join('\n\n') || 'Issue detected';
}

/**
 * Build export rows: one per unique broken URL (broken pages + broken link targets).
 * @returns {{ mainUrl: string, url: string, issues: string }[]}
 */
function buildLinkRadarIssueRows(data = {}) {
  const mainUrl = data.url || data.mainUrl || '';
  const brokenPages = Array.isArray(data.brokenPages) ? data.brokenPages : [];
  const brokenLinks = Array.isArray(data.brokenLinks) ? data.brokenLinks : [];
  const pageByUrl = new Map(brokenPages.map((p) => [p.url, p]));

  // Include broken link targets that might not be in brokenPages (legacy)
  for (const link of brokenLinks) {
    if (link?.brokenUrl && !pageByUrl.has(link.brokenUrl)) {
      pageByUrl.set(link.brokenUrl, {
        url: link.brokenUrl,
        detectedErrors: [],
        statusCode: 0
      });
    }
  }

  const rows = [];
  const urls = [...pageByUrl.keys()].sort((a, b) => a.localeCompare(b));
  for (const url of urls) {
    const page = pageByUrl.get(url);
    rows.push({
      mainUrl,
      url,
      issues: formatIssuesCell(page)
    });
  }
  return rows;
}

/**
 * Plain CSV (UTF-8 BOM) — columns: Main URL, URL, Issues
 */
function buildLinkRadarIssuesCsv(data = {}) {
  const rows = buildLinkRadarIssueRows(data);
  const headers = ['Main URL', 'URL', 'Issues'];
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push([row.mainUrl, row.url, row.issues].map(csvEscape).join(','));
  }
  return `${CSV_BOM}${lines.join('\r\n')}${rows.length ? '\r\n' : ''}`;
}

/**
 * Excel-friendly HTML table (.xls) with bold headers, wrap, top-left align, borders.
 * Thick border on header row (including outer corners).
 */
function buildLinkRadarIssuesExcelHtml(data = {}) {
  const rows = buildLinkRadarIssueRows(data);
  const mainUrl = data.url || data.mainUrl || '';
  const generatedAt = data.generatedAt || new Date().toISOString();

  const headerStyle =
    'font-weight:bold;font-size:12pt;text-align:left;vertical-align:top;' +
    'white-space:normal;word-wrap:break-word;mso-wrap:yes;' +
    'background:#D9E2F3;color:#000000;' +
    'border:2.5pt solid #000000;padding:8px;';
  const cellStyle =
    'font-weight:normal;font-size:11pt;text-align:left;vertical-align:top;' +
    'white-space:normal;word-wrap:break-word;mso-wrap:yes;' +
    'border:1pt solid #000000;padding:8px;';

  const bodyRows = rows.length
    ? rows
        .map((row) => {
          const issuesHtml = excelEscape(row.issues).replace(/\n/g, '<br/>');
          return `<tr>
  <td style="${cellStyle}">${excelEscape(row.mainUrl)}</td>
  <td style="${cellStyle}">${excelEscape(row.url)}</td>
  <td style="${cellStyle}">${issuesHtml}</td>
</tr>`;
        })
        .join('\n')
    : `<tr>
  <td style="${cellStyle}" colspan="3">No broken pages found for ${excelEscape(mainUrl || 'this scan')}.</td>
</tr>`;

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<!--[if gte mso 9]>
<xml>
  <x:ExcelWorkbook>
    <x:ExcelWorksheets>
      <x:ExcelWorksheet>
        <x:Name>Link Radar Issues</x:Name>
        <x:WorksheetOptions>
          <x:DisplayGridlines/>
        </x:WorksheetOptions>
      </x:ExcelWorksheet>
    </x:ExcelWorksheets>
  </x:ExcelWorkbook>
</xml>
<![endif]-->
<style>
  table { border-collapse: collapse; table-layout: fixed; width: 100%; }
  col.main { width: 22%; }
  col.url { width: 28%; }
  col.issues { width: 50%; }
  th, td { font-family: Calibri, Arial, sans-serif; }
</style>
<title>Link Radar Issues</title>
</head>
<body>
<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:0 0 8px 0;">
  Link Radar — broken pages · Generated: ${excelEscape(generatedAt)}
</p>
<table border="1" cellspacing="0" cellpadding="8">
  <colgroup>
    <col class="main" />
    <col class="url" />
    <col class="issues" />
  </colgroup>
  <thead>
    <tr>
      <th style="${headerStyle}">Main URL</th>
      <th style="${headerStyle}">URL</th>
      <th style="${headerStyle}">Issues</th>
    </tr>
  </thead>
  <tbody>
${bodyRows}
  </tbody>
</table>
</body>
</html>`;
}

function reportDateStamp(data = {}) {
  const raw = data.generatedAt || new Date().toISOString();
  return String(raw).slice(0, 10);
}

module.exports = {
  CSV_BOM,
  csvEscape,
  buildLinkRadarIssueRows,
  buildLinkRadarIssuesCsv,
  buildLinkRadarIssuesExcelHtml,
  formatIssuesCell,
  reportDateStamp
};
