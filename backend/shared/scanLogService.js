const stateService = require('../keyword-check/stateService');
const { renderLogHtml } = require('./logViewUtils');

async function getScanLogLines(scanId) {
  const scan = await stateService.getScanState(scanId);
  if (!scan) return null;

  const lines = [];
  if (scan.error) lines.push(`[ERROR] ${scan.error}`);
  lines.push(`[STATUS] ${scan.status}`);
  if (scan.startedAt) lines.push(`[STARTED] ${scan.startedAt}`);
  if (scan.completedAt) lines.push(`[COMPLETED] ${scan.completedAt}`);

  if (scan.stats) {
    const s = scan.stats;
    lines.push(
      `[STATS] discovered=${s.urlsDiscovered ?? 0} processed=${s.urlsProcessed ?? 0} matches=${s.matchesFound ?? 0} batch=${s.currentBatch ?? 0}`
    );
  }

  if (scan.currentUrl && (scan.status === 'running' || scan.status === 'starting')) {
    lines.push(`[CURRENT] ${scan.currentUrl}`);
  }

  for (const entry of scan.logs || []) {
    const stamp = entry.at ? `[${entry.at}] ` : '';
    const level = entry.level && entry.level !== 'info' ? `[${String(entry.level).toUpperCase()}] ` : '';
    lines.push(`${stamp}${level}${entry.message}`);
  }

  if (scan.recentUrls?.length) {
    lines.push('[RECENT URLS]');
    for (const url of scan.recentUrls.slice(-20)) lines.push(`  ${url}`);
  }

  return { scan, lines };
}

async function renderScanLogsHtml(scanId) {
  const payload = await getScanLogLines(scanId);
  if (!payload) return null;

  const { scan, lines } = payload;
  const isRunning = scan.status === 'running' || scan.status === 'starting';
  const keywordParts = [];
  if (scan.keywords?.length) keywordParts.push(`Standard: ${scan.keywords.join(', ')}`);
  if (scan.caseSensitiveKeywords?.length) {
    keywordParts.push(`Case-sensitive: ${scan.caseSensitiveKeywords.join(', ')}`);
  }

  return renderLogHtml({
    title: 'Keyword Scan Logs',
    subtitle: scan.url,
    meta: {
      'Scan ID': scanId,
      Status: scan.status,
      Keywords: keywordParts.join(' · ') || '—',
      'Current URL': scan.currentUrl || '—'
    },
    lines,
    autoRefreshSec: isRunning ? 3 : 0
  });
}

module.exports = { getScanLogLines, renderScanLogsHtml };