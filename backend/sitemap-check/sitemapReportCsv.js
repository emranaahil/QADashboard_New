/**
 * Sitemap Audit CSV export — UTF-8 BOM, Excel-friendly headers.
 */

const CSV_BOM = '\uFEFF';

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function resultLabel(row) {
  const failed = row.hasIssue || (row.statusCode != null && Number(row.statusCode) !== 200);
  return failed ? 'Fail' : 'Pass';
}

function buildSitemapPagesCsv(report) {
  const urls = report.urls || [];
  const siteUrl = report.url || '';
  const headers = [
    'Site URL',
    'Page URL',
    'Status Code',
    'Result',
    'Detail',
    'Redirect Status',
    'Redirect Location',
    'Final URL'
  ];

  const rows = urls.map((row) =>
    [
      siteUrl,
      row.url || '',
      row.statusCode != null ? row.statusCode : '',
      resultLabel(row),
      (row.issues || []).join('; ') || '',
      row.redirectStatus != null ? row.redirectStatus : '',
      row.redirectLocation || '',
      row.finalUrl || ''
    ]
      .map(csvEscape)
      .join(',')
  );

  return `${CSV_BOM}${headers.map(csvEscape).join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

function buildSitemapFilesCsv(report) {
  const sitemaps = Array.isArray(report.sitemaps) ? report.sitemaps : [];
  const root = report.sitemapUrl || '';
  const headers = ['#', 'Sitemap URL', 'Type', 'Root Sitemap'];

  const rows = sitemaps.map((sm, idx) =>
    [
      idx + 1,
      sm,
      sm === root ? 'Root' : 'Nested',
      root
    ]
      .map(csvEscape)
      .join(',')
  );

  return `${CSV_BOM}${headers.map(csvEscape).join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

function buildSitemapFullCsv(report) {
  // Single workbook-friendly export: page results (primary) is what users expect for "Export CSV"
  return buildSitemapPagesCsv(report);
}

module.exports = {
  CSV_BOM,
  csvEscape,
  buildSitemapPagesCsv,
  buildSitemapFilesCsv,
  buildSitemapFullCsv
};
