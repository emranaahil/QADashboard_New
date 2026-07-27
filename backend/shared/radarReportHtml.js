const { escapeHtml } = require('./logViewUtils');
const { explainBrokenPage } = require('./linkRadarIssueExplain');
const { reportDateStamp } = require('./linkRadarCsv');

const BASE_STYLES = `
  :root { --bg:#0b1220; --card:#121b2f; --text:#e7eefc; --muted:#a9b6d6; --border:rgba(255,255,255,.10); --good:#22c55e; --warn:#f59e0b; --bad:#ef4444; --link:#60a5fa; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:linear-gradient(135deg,#0b1220,#0f1b33); color:var(--text); }
  .wrap { max-width:1200px; margin:0 auto; padding:24px; }
  header { margin-bottom:20px; }
  h1 { margin:0 0 8px; font-size:1.35rem; }
  .sub { color:var(--muted); font-size:0.85rem; margin:4px 0; }
  .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin:18px 0; }
  .stat { background:rgba(255,255,255,.04); border:1px solid var(--border); border-radius:12px; padding:14px; text-align:center; }
  .stat .k { color:var(--muted); font-size:0.7rem; text-transform:uppercase; letter-spacing:.04em; }
  .stat .v { font-size:1.4rem; font-weight:800; margin-top:6px; }
  .stat.highlight .v { color:var(--warn); }
  .stat.bad .v { color:var(--bad); }
  h2 { font-size:1rem; margin:24px 0 10px; }
  table { width:100%; border-collapse:separate; border-spacing:0; border:1px solid var(--border); border-radius:12px; overflow:hidden; background:rgba(255,255,255,.03); }
  th,td { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.08); vertical-align:top; text-align:left; font-size:0.85rem; }
  th { color:var(--muted); font-size:0.75rem; text-transform:uppercase; letter-spacing:.04em; background:rgba(255,255,255,.03); }
  tr:last-child td { border-bottom:none; }
  tr.error-row { background:rgba(239,68,68,.08); }
  tr.warn-row { background:rgba(245,158,11,.08); }
  a { color:var(--link); word-break:break-all; }
  .empty { color:var(--muted); padding:12px; }
  .actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
  button { cursor:pointer; background:rgba(255,255,255,.06); border:1px solid var(--border); color:var(--text); padding:8px 12px; border-radius:10px; font-weight:600; font-size:0.8rem; }
  button:hover { background:rgba(255,255,255,.10); }
  .link-radar-table .col-num { width:42px; text-align:center; color:var(--muted); font-weight:700; }
  .link-radar-table .col-issue { width:20%; min-width:120px; }
  .link-radar-table .col-found { width:42%; }
  .link-radar-table .col-broken { width:36%; }
  .link-radar-table .col-status { width:88px; white-space:nowrap; font-family:ui-monospace,monospace; font-weight:700; }
  .link-radar-table .url-block { display:block; line-height:1.45; }
  .link-radar-table .url-label { display:block; font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-bottom:4px; }
  .link-radar-table .found-list { margin:0; padding-left:18px; }
  .link-radar-table .found-list li { margin:0 0 8px; line-height:1.4; }
  .link-radar-table .found-list li:last-child { margin-bottom:0; }
  .note-box { margin:12px 0 20px; padding:12px 14px; border:1px solid rgba(245,158,11,.35); border-radius:12px; background:rgba(245,158,11,.08); color:var(--text); font-size:0.82rem; line-height:1.5; }
  .guide-box { margin:12px 0 20px; padding:14px 16px; border:1px solid rgba(96,165,250,.35); border-radius:12px; background:rgba(96,165,250,.08); color:var(--text); font-size:0.84rem; line-height:1.55; }
  .guide-box h3 { margin:0 0 8px; font-size:0.9rem; }
  .guide-box ul { margin:0; padding-left:18px; }
  .guide-box li { margin:0 0 6px; }
  .issue-card { display:flex; flex-direction:column; gap:6px; }
  .issue-badge { display:inline-flex; align-items:center; gap:6px; width:fit-content; padding:3px 10px; border-radius:999px; font-size:0.72rem; font-weight:700; letter-spacing:.02em; }
  .issue-badge--high { background:rgba(239,68,68,.18); color:#fca5a5; border:1px solid rgba(239,68,68,.35); }
  .issue-badge--medium { background:rgba(245,158,11,.16); color:#fcd34d; border:1px solid rgba(245,158,11,.35); }
  .issue-badge--soft { background:rgba(245,158,11,.18); color:#fde68a; border:1px solid rgba(245,158,11,.4); }
  .issue-summary { font-weight:700; font-size:0.9rem; line-height:1.35; }
  .issue-means { color:var(--text); font-size:0.8rem; line-height:1.45; opacity:.95; }
  .issue-fix { color:var(--muted); font-size:0.76rem; line-height:1.4; }
  .issue-tech { color:var(--muted); font-size:0.7rem; font-family:ui-monospace,monospace; }
  .page-title-hint { display:block; margin-top:4px; color:var(--muted); font-size:0.75rem; }
  .status-pill { display:inline-block; padding:2px 8px; border-radius:8px; background:rgba(239,68,68,.15); color:#fca5a5; font-weight:800; }
  .status-pill--soft { background:rgba(245,158,11,.18); color:#fde68a; }
  @media print {
    .link-radar-table { font-size:9px; }
    .link-radar-table .found-list { padding-left:14px; }
  }
`;

function groupBrokenLinksForReport(brokenLinks, brokenPages) {
  const pageByUrl = new Map((brokenPages || []).map((p) => [p.url, p]));
  const issueByUrl = new Map(
    (brokenPages || []).map((p) => [p.url, (p.detectedErrors || []).filter((e) => e !== 'rate limited (skipped)')])
  );
  const grouped = new Map();

  for (const item of brokenLinks || []) {
    if (!grouped.has(item.brokenUrl)) {
      const src = pageByUrl.get(item.brokenUrl) || {};
      grouped.set(item.brokenUrl, {
        brokenUrl: item.brokenUrl,
        foundIn: [],
        issues: issueByUrl.get(item.brokenUrl) || [],
        detectedErrors: issueByUrl.get(item.brokenUrl) || [],
        statusCode: src.statusCode,
        pageTitle: src.pageTitle,
        hasSubstantialContent: src.hasSubstantialContent,
        contentLength: src.contentLength,
        explanation: src.explanation,
        finalUrl: src.finalUrl
      });
    }
    const row = grouped.get(item.brokenUrl);
    if (!row.foundIn.includes(item.foundIn)) {
      row.foundIn.push(item.foundIn);
    }
  }

  return [...grouped.values()].sort((a, b) => a.brokenUrl.localeCompare(b.brokenUrl));
}

function formatIssueList(issues) {
  const list = (issues || []).filter(Boolean);
  if (!list.length) return '—';
  return list
    .map((issue) => issue.replace(/^http\s+/i, 'HTTP ').replace(/\b404\b/g, '404'))
    .join(', ');
}

function resolvePageExplanation(page) {
  if (page?.explanation && page.explanation.summary) {
    return page.explanation;
  }
  return explainBrokenPage(page || {});
}

function renderIssueExplanationCell(pageOrGroup) {
  const exp = resolvePageExplanation(pageOrGroup);
  const badgeClass = exp.visuallyLooksOk
    ? 'issue-badge issue-badge--soft'
    : exp.severity === 'high'
      ? 'issue-badge issue-badge--high'
      : 'issue-badge issue-badge--medium';
  const badgeText = exp.visuallyLooksOk
    ? 'Looks fine, but flagged'
    : exp.shortLabel || 'Issue';
  // Keep the card short and scannable — full how-to-check lives in the guide above
  return `<div class="issue-card">
    <span class="${badgeClass}">${escapeHtml(badgeText)}</span>
    <div class="issue-summary">${escapeHtml(exp.summary || formatIssueList(pageOrGroup.detectedErrors || pageOrGroup.issues))}</div>
    ${exp.whatItMeans ? `<div class="issue-means"><strong>What it means:</strong> ${escapeHtml(exp.whatItMeans)}</div>` : ''}
    ${exp.fixHint ? `<div class="issue-fix"><strong>What to do:</strong> ${escapeHtml(exp.fixHint)}</div>` : ''}
    <div class="issue-tech">Technical: ${escapeHtml(exp.technicalDetail || formatIssueList(pageOrGroup.detectedErrors || pageOrGroup.issues))}</div>
  </div>`;
}

function renderStatusCell(exp) {
  const code = exp.statusCode;
  if (!code) return '—';
  const soft = exp.visuallyLooksOk ? ' status-pill--soft' : '';
  return `<span class="status-pill${soft}">HTTP ${escapeHtml(String(code))}</span>`;
}

function wrapReport({ title, subtitle, metaHtml, bodyHtml, extraActionsHtml = '', extraHeadHtml = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>${BASE_STYLES}</style>
  ${extraHeadHtml || ''}
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ''}
      ${metaHtml || ''}
      <div class="actions">
        ${extraActionsHtml || ''}
        <button type="button" onclick="window.print()">Print / Save PDF</button>
      </div>
    </header>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function isLegacyRateLimitPage(page) {
  const errors = (page.detectedErrors || []).map((e) => String(e).toLowerCase());
  if (errors.every((e) => e === 'rate limited (skipped)')) return true;
  return errors.length === 1 && (errors[0] === 'http 429' || errors[0] === 'http 503');
}

function renderErrorCheckHtml(data) {
  const allBrokenPages = data.brokenPages || [];
  const brokenPages = allBrokenPages.filter((p) => !isLegacyRateLimitPage(p));
  const legacyRateLimited = allBrokenPages
    .filter((p) => isLegacyRateLimitPage(p))
    .map((p) => ({
      url: p.url,
      statusCode: p.statusCode || 429,
      finalUrl: p.finalUrl || p.url,
      note: 'Previously flagged as HTTP 429/503 — likely crawler rate limit, not a real broken page'
    }));
  const rateLimitedUrls = new Set([
    ...legacyRateLimited.map((p) => p.url),
    ...(data.rateLimitedPages || []).map((p) => p.url)
  ]);
  const brokenLinks = (data.brokenLinks || []).filter((l) => !rateLimitedUrls.has(l.brokenUrl));
  const rateLimitedPages = [];
  const seenRateLimited = new Set();
  for (const entry of [...(data.rateLimitedPages || []), ...legacyRateLimited]) {
    if (!entry?.url || seenRateLimited.has(entry.url)) continue;
    seenRateLimited.add(entry.url);
    rateLimitedPages.push(entry);
  }
  const groupedLinks = groupBrokenLinksForReport(brokenLinks, brokenPages);
  const generatedAt = data.generatedAt
    ? new Date(data.generatedAt).toLocaleString()
    : '—';

  const softCount = brokenPages.filter((p) => resolvePageExplanation(p).visuallyLooksOk).length;

  const pageRows = brokenPages.length
    ? brokenPages.map((p, idx) => {
        const exp = resolvePageExplanation(p);
        const rowClass = exp.visuallyLooksOk ? 'warn-row' : 'error-row';
        const titleHint = p.pageTitle || exp.pageTitle
          ? `<span class="page-title-hint">Page title: ${escapeHtml(p.pageTitle || exp.pageTitle)}</span>`
          : '';
        return `<tr class="${rowClass}">
        <td class="col-num">${idx + 1}</td>
        <td class="col-broken">
          <a class="url-block" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.url)}</a>
          ${titleHint}
        </td>
        <td class="col-status">${renderStatusCell(exp)}</td>
        <td class="col-issue">${renderIssueExplanationCell(p)}</td>
      </tr>`;
      }).join('')
    : '<tr><td colspan="4" class="empty">None — no broken pages found</td></tr>';

  const linkRows = groupedLinks.length
    ? groupedLinks.map((group, idx) => {
        const exp = resolvePageExplanation(group);
        const foundItems = group.foundIn
          .map((foundUrl) => `<li><a href="${escapeHtml(foundUrl)}" target="_blank" rel="noopener">${escapeHtml(foundUrl)}</a></li>`)
          .join('');
        const rowClass = exp.visuallyLooksOk ? 'warn-row' : 'error-row';
        return `<tr class="${rowClass}">
        <td class="col-num">${idx + 1}</td>
        <td class="col-found">
          <span class="url-label">Found in</span>
          <ol class="found-list">${foundItems}</ol>
        </td>
        <td class="col-status">${renderStatusCell(exp)}</td>
        <td class="col-issue">${renderIssueExplanationCell(group)}</td>
        <td class="col-broken">
          <span class="url-label">Broken URL</span>
          <a class="url-block" href="${escapeHtml(group.brokenUrl)}" target="_blank" rel="noopener">${escapeHtml(group.brokenUrl)}</a>
        </td>
      </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="empty">None</td></tr>';

  const rateLimitNote = rateLimitedPages.length
    ? `<div class="note-box"><strong>${rateLimitedPages.length} page(s) were rate-limited (HTTP 429/503)</strong> and were not marked broken. These often open fine in a normal browser. Re-run with a lower max URLs or higher delay if needed.</div>`
    : '';

  const rateLimitRows = rateLimitedPages.length
    ? rateLimitedPages.map((p, idx) => `<tr>
        <td class="col-num">${idx + 1}</td>
        <td><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.url)}</a></td>
        <td>${escapeHtml(p.statusCode ? `HTTP ${p.statusCode}` : 'Rate limited')}</td>
      </tr>`).join('')
    : '';

  const guideBullets = (data.reportGuide && data.reportGuide.bullets) || [
    'Broken page = we opened the URL and found a problem (bad server status and/or error text on the page).',
    'Status column = the HTTP code for the main page. Healthy public pages should be 200.',
    '“Looks fine, but flagged” = the page may open and look normal, but the server status is still wrong (common with 410).',
    'How to double-check: Chrome → F12 → Network → first Doc/document row → Status. Images can be 200 while the page is 404/410.',
    'Broken links = other pages still point to a broken URL. Rate limited = temporary block of our crawler (not counted as broken).'
  ];

  const guideHtml = `<div class="guide-box">
      <h3>${escapeHtml((data.reportGuide && data.reportGuide.title) || 'How to read this report (simple)')}</h3>
      <ul>${guideBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      ${softCount
        ? `<p style="margin:10px 0 0"><strong>${softCount} page(s)</strong> are marked “Looks fine, but flagged” — they can open in a browser but still return a bad status (often HTTP 410).</p>`
        : ''}
    </div>`;

  const bodyHtml = `
    <div class="summary">
      <div class="stat"><div class="k">Checked</div><div class="v">${data.checked || 0}</div></div>
      <div class="stat bad highlight"><div class="k">Broken Pages</div><div class="v">${brokenPages.length}</div></div>
      <div class="stat"><div class="k">Broken Link Groups</div><div class="v">${groupedLinks.length}</div></div>
      <div class="stat"><div class="k">Link References</div><div class="v">${brokenLinks.length}</div></div>
      ${softCount ? `<div class="stat highlight"><div class="k">Looks fine, flagged</div><div class="v">${softCount}</div></div>` : ''}
      ${rateLimitedPages.length ? `<div class="stat highlight"><div class="k">Rate Limited</div><div class="v">${rateLimitedPages.length}</div></div>` : ''}
    </div>
    ${guideHtml}
    ${rateLimitNote}
    <h2>Broken Pages</h2>
    <p class="sub">Each row: URL → status → plain-English problem, what it means, and what to do.</p>
    <table class="link-radar-table">
      <thead><tr>
        <th class="col-num">#</th>
        <th>Page URL</th>
        <th class="col-status">Status</th>
        <th class="col-issue">What is wrong</th>
      </tr></thead>
      <tbody>${pageRows}</tbody>
    </table>
    <h2>Broken Links</h2>
    <p class="sub">Left to right: where the link was found → status → what is wrong → broken URL.</p>
    <table class="link-radar-table">
      <thead><tr>
        <th class="col-num">#</th>
        <th class="col-found">Found In</th>
        <th class="col-status">Status</th>
        <th class="col-issue">What is wrong</th>
        <th class="col-broken">Broken URL</th>
      </tr></thead>
      <tbody>${linkRows}</tbody>
    </table>
    ${rateLimitedPages.length ? `<h2>Rate Limited (Not Marked Broken)</h2><p class="sub">Temporarily blocked for the crawler — usually not broken for normal visitors.</p><table class="link-radar-table"><thead><tr><th class="col-num">#</th><th>Page URL</th><th>Status</th></tr></thead><tbody>${rateLimitRows}</tbody></table>` : ''}`;

  // Export payload for Download CSV buttons (3 columns: Main URL | URL | Issues)
  const exportPayload = {
    url: data.url || '',
    mainUrl: data.url || '',
    generatedAt: data.generatedAt || '',
    brokenPages: brokenPages.map((p) => ({
      url: p.url,
      statusCode: p.statusCode,
      detectedErrors: p.detectedErrors || [],
      pageTitle: p.pageTitle || '',
      hasSubstantialContent: p.hasSubstantialContent,
      contentLength: p.contentLength,
      finalUrl: p.finalUrl,
      explanation: p.explanation || resolvePageExplanation(p)
    })),
    brokenLinks: brokenLinks.map((l) => ({
      brokenUrl: l.brokenUrl,
      foundIn: l.foundIn
    }))
  };
  const exportJson = JSON.stringify(exportPayload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const stamp = reportDateStamp(data);
  const exportScript = `
<script>
(function(){
  function downloadBlob(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
  function escCsv(v) {
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }
  function escHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function issuesText(page) {
    var exp = (page && page.explanation) || {};
    var parts = [];
    if (exp.summary) parts.push(exp.summary);
    if (exp.whatItMeans) parts.push('What it means: ' + exp.whatItMeans);
    if (exp.fixHint) parts.push('What to do: ' + exp.fixHint);
    if (exp.statusCode) parts.push('HTTP status: ' + exp.statusCode);
    if (parts.length) return parts.join('\\n\\n');
    var errs = (page && page.detectedErrors) || [];
    return errs.join('; ') || 'Issue detected';
  }
  function buildRows(r) {
    var main = r.url || r.mainUrl || '';
    var pages = r.brokenPages || [];
    var map = {};
    pages.forEach(function(p) { if (p && p.url) map[p.url] = p; });
    (r.brokenLinks || []).forEach(function(l) {
      if (l && l.brokenUrl && !map[l.brokenUrl]) {
        map[l.brokenUrl] = { url: l.brokenUrl, detectedErrors: [], statusCode: 0 };
      }
    });
    return Object.keys(map).sort().map(function(u) {
      return { mainUrl: main, url: u, issues: issuesText(map[u]) };
    });
  }
  window.exportLinkRadarCsv = function() {
    var r = window.LINK_RADAR_EXPORT || {};
    var rows = buildRows(r);
    if (!rows.length) { alert('No broken pages to export.'); return; }
    var lines = [ ['Main URL','URL','Issues'].map(escCsv).join(',') ];
    rows.forEach(function(row) {
      lines.push([row.mainUrl, row.url, row.issues].map(escCsv).join(','));
    });
    var bom = String.fromCharCode(0xFEFF);
    downloadBlob('Link-Radar-Issues-${stamp}.csv', bom + lines.join('\\r\\n') + '\\r\\n', 'text/csv;charset=utf-8');
  };
  window.exportLinkRadarExcel = function() {
    var r = window.LINK_RADAR_EXPORT || {};
    var rows = buildRows(r);
    var headerStyle = 'font-weight:bold;font-size:12pt;text-align:left;vertical-align:top;white-space:normal;word-wrap:break-word;background:#D9E2F3;color:#000;border:2.5pt solid #000;padding:8px;';
    var cellStyle = 'font-weight:normal;font-size:11pt;text-align:left;vertical-align:top;white-space:normal;word-wrap:break-word;border:1pt solid #000;padding:8px;';
    var body = '';
    if (!rows.length) {
      body = '<tr><td style="'+cellStyle+'" colspan="3">No broken pages found.</td></tr>';
    } else {
      rows.forEach(function(row) {
        body += '<tr>'
          + '<td style="'+cellStyle+'">'+escHtml(row.mainUrl)+'</td>'
          + '<td style="'+cellStyle+'">'+escHtml(row.url)+'</td>'
          + '<td style="'+cellStyle+'">'+escHtml(row.issues).replace(/\\n/g,'<br/>')+'</td>'
          + '</tr>';
      });
    }
    var html = '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"/>'
      + '<style>table{border-collapse:collapse;table-layout:fixed;width:100%}th,td{font-family:Calibri,Arial,sans-serif}</style></head><body>'
      + '<table border="1" cellspacing="0" cellpadding="8"><thead><tr>'
      + '<th style="'+headerStyle+'">Main URL</th>'
      + '<th style="'+headerStyle+'">URL</th>'
      + '<th style="'+headerStyle+'">Issues</th>'
      + '</tr></thead><tbody>'+body+'</tbody></table></body></html>';
    downloadBlob('Link-Radar-Issues-${stamp}.xls', html, 'application/vnd.ms-excel;charset=utf-8');
  };
})();
</script>
<script>window.LINK_RADAR_EXPORT = ${exportJson};</script>`;

  return wrapReport({
    title: 'Link Radar — Error Check Report',
    subtitle: data.url || '',
    metaHtml: `<p class="sub">Generated: ${escapeHtml(generatedAt)}</p>`,
    bodyHtml,
    extraHeadHtml: exportScript,
    extraActionsHtml: `
      <button type="button" onclick="exportLinkRadarCsv()">Download CSV</button>
      <button type="button" onclick="exportLinkRadarExcel()">Download Excel (formatted)</button>
    `
  });
}

function renderKeywordCheckHtml(data) {
  const results = data.results || [];
  const matches = data.matches || [];
  const rows = results.length
    ? results.map((item) => {
        const kws = (item.matchedKeywords || []).join(', ') || '—';
        const isErr = item.isError || (item.statusCode != null && item.statusCode >= 400);
        return `<tr class="${isErr ? 'error-row' : ''}">
          <td><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a></td>
          <td>${escapeHtml(item.statusCode != null ? String(item.statusCode) : '—')}</td>
          <td>${escapeHtml(kws)}</td>
        </tr>`;
      }).join('')
    : matches.map((m) => `<tr>
        <td><a href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(m.url)}</a></td>
        <td>—</td>
        <td>${escapeHtml(m.keyword)}</td>
      </tr>`).join('');

  const tableBody = rows || '<tr><td colspan="3" class="empty">No results</td></tr>';
  const processed = data.stats?.urlsProcessed || 0;
  const matchCount = data.stats?.matchesFound ?? matches.length;

  const bodyHtml = `
    <div class="summary">
      <div class="stat"><div class="k">Processed</div><div class="v">${processed}</div></div>
      <div class="stat highlight"><div class="k">Matches</div><div class="v">${matchCount}</div></div>
      <div class="stat"><div class="k">Status</div><div class="v" style="font-size:1rem">${escapeHtml(data.status || '—')}</div></div>
    </div>
    <p class="sub">Keywords: ${escapeHtml((data.keywords || []).join(', ') || '—')}</p>
    ${(data.caseSensitiveKeywords || []).length
      ? `<p class="sub">Case-sensitive keywords: ${escapeHtml(data.caseSensitiveKeywords.join(', '))}</p>`
      : ''}
    <h2>Results</h2>
    <table><thead><tr><th>URL</th><th>Status</th><th>Keywords</th></tr></thead><tbody>${tableBody}</tbody></table>`;

  const completedAt = data.completedAt || data.startedAt;
  const generatedAt = completedAt ? new Date(completedAt).toLocaleString() : '—';

  return wrapReport({
    title: 'Keyword Radar — Scan Report',
    subtitle: data.url || '',
    metaHtml: `<p class="sub">Generated: ${escapeHtml(generatedAt)}</p>`,
    bodyHtml
  });
}

function renderSitemapCheckHtml(data) {
  const urls = data.urls || [];
  const summary = data.summary || {};
  const sitemaps = Array.isArray(data.sitemaps) ? data.sitemaps : [];
  const sitemapFileCount = summary.totalSitemapFiles ?? sitemaps.length;
  const nestedCount =
    summary.nestedSitemapFiles ?? Math.max(0, sitemapFileCount - (data.sitemapUrl ? 1 : 0));
  const generatedAt = data.generatedAt
    ? new Date(data.generatedAt).toLocaleString()
    : '—';

  const rows = urls.length
    ? urls.map((row, idx) => {
        const failed = row.hasIssue || Number(row.statusCode) !== 200;
        const issueClass = failed ? 'error-row' : '';
        const statusCode =
          row.statusCode != null && row.statusCode !== ''
            ? String(row.statusCode)
            : row.redirectStatus != null
              ? String(row.redirectStatus)
              : '—';
        const resultLabel = failed ? 'Fail' : 'Pass';
        const resultBadge = failed
          ? `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:rgba(239,68,68,.15);color:#fca5a5;font-weight:700;font-size:.72rem">Fail</span>`
          : `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:rgba(34,197,94,.15);color:#86efac;font-weight:700;font-size:.72rem">Pass</span>`;
        return `<tr class="${issueClass}">
          <td style="color:var(--muted);font-weight:700;width:40px">${idx + 1}</td>
          <td><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">${escapeHtml(row.url)}</a></td>
          <td class="num" style="font-family:ui-monospace,monospace;font-weight:700">${escapeHtml(statusCode)}</td>
          <td>${resultBadge}</td>
          <td>${escapeHtml((row.issues || []).join(', ') || (failed ? `HTTP ${statusCode}` : '—'))}</td>
          <td>${row.finalUrl && row.finalUrl !== row.url
            ? `<a href="${escapeHtml(row.finalUrl)}" target="_blank" rel="noopener">${escapeHtml(row.finalUrl)}</a>`
            : '—'}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="6" class="empty">No URLs checked</td></tr>';

  const issueRows = urls.filter((r) => r.hasIssue || Number(r.statusCode) !== 200);
  const issueTable = issueRows.length
    ? issueRows.map((row, idx) => {
        const statusCode =
          row.statusCode != null && row.statusCode !== ''
            ? String(row.statusCode)
            : '—';
        return `<tr class="error-row">
        <td style="color:var(--muted);font-weight:700;width:40px">${idx + 1}</td>
        <td><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">${escapeHtml(row.url)}</a></td>
        <td class="num" style="font-family:ui-monospace,monospace;font-weight:700">${escapeHtml(statusCode)}</td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:rgba(239,68,68,.15);color:#fca5a5;font-weight:700;font-size:.72rem">Fail</span></td>
        <td>${escapeHtml((row.issues || []).join(', ') || `HTTP ${statusCode}`)}</td>
      </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="empty">No failed URLs — all returned final HTTP 200</td></tr>';

  const passCount = summary.okCount ?? urls.filter((u) => !u.hasIssue && Number(u.statusCode) === 200).length;
  const failCount = summary.failCount ?? summary.issueCount ?? issueRows.length;

  const sitemapRows = sitemaps.length
    ? sitemaps.map((sm, idx) => {
        const isRoot = data.sitemapUrl && sm === data.sitemapUrl;
        return `<tr>
          <td style="color:var(--muted);font-weight:700;width:40px">${idx + 1}</td>
          <td><a href="${escapeHtml(sm)}" target="_blank" rel="noopener">${escapeHtml(sm)}</a></td>
          <td>${isRoot
            ? '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:rgba(96,165,250,.15);color:#93c5fd;font-weight:700;font-size:.72rem">Root</span>'
            : '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.06);color:var(--muted);font-weight:700;font-size:.72rem">Nested</span>'}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="3" class="empty">${data.sitemapFound ? 'No sitemap files recorded' : 'No sitemap found — base URL checked only'}</td></tr>`;

  const bodyHtml = `
    <div class="summary">
      <div class="stat"><div class="k">Sitemap files</div><div class="v">${sitemapFileCount}</div></div>
      <div class="stat"><div class="k">Nested sitemaps</div><div class="v">${nestedCount}</div></div>
      <div class="stat"><div class="k">Page URLs found</div><div class="v">${summary.totalDiscovered || urls.length}</div></div>
      <div class="stat"><div class="k">Pages checked</div><div class="v">${summary.totalChecked || urls.length}</div></div>
      <div class="stat"><div class="k">Pass (200)</div><div class="v" style="color:var(--good)">${passCount}</div></div>
      <div class="stat bad highlight"><div class="k">Fail (not 200)</div><div class="v">${failCount}</div></div>
    </div>
    <p class="sub"><strong>Root sitemap:</strong> ${escapeHtml(data.sitemapUrl || (data.sitemapFound ? 'Found' : 'Not found'))}</p>
    <p class="sub">Nested <code>.xml</code> sitemaps are opened recursively. Page URLs are checked like a browser (redirects followed). <strong>Pass</strong> = final HTTP 200; <strong>Fail</strong> = final status is not 200.</p>

    <h2>Sitemap inventory (${sitemapFileCount})</h2>
    <table>
      <thead><tr><th>#</th><th>Sitemap URL</th><th>Type</th></tr></thead>
      <tbody>${sitemapRows}</tbody>
    </table>

    <h2>Failed page URLs</h2>
    <table><thead><tr><th>#</th><th>URL</th><th>Status</th><th>Result</th><th>Detail</th></tr></thead><tbody>${issueTable}</tbody></table>

    <h2>All checked page URLs</h2>
    <table><thead><tr><th>#</th><th>URL</th><th>Status</th><th>Result</th><th>Detail</th><th>Final URL</th></tr></thead><tbody>${rows}</tbody></table>`;

  const exportPayload = JSON.stringify({
    url: data.url || '',
    sitemapUrl: data.sitemapUrl || '',
    sitemaps: sitemaps,
    generatedAt: data.generatedAt || '',
    urls: urls.map((u) => ({
      url: u.url,
      statusCode: u.statusCode,
      hasIssue: u.hasIssue,
      issues: u.issues || [],
      redirectStatus: u.redirectStatus,
      redirectLocation: u.redirectLocation,
      finalUrl: u.finalUrl
    }))
  }).replace(/</g, '\\u003c');

  const exportScript = `
<script>
(function(){
  function esc(v){ return '"' + String(v==null?'':v).replace(/"/g,'""') + '"'; }
  function download(name, csv){
    var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
  function reportDate(){
    var d = (window.SITEMAP_REPORT && window.SITEMAP_REPORT.generatedAt) || new Date().toISOString();
    return String(d).slice(0,10);
  }
  window.exportSitemapPagesCsv = function(){
    var r = window.SITEMAP_REPORT || {};
    var urls = r.urls || [];
    if (!urls.length) { alert('No page results to export.'); return; }
    var headers = ['Site URL','Page URL','Status Code','Result','Detail','Redirect Status','Redirect Location','Final URL'];
    var lines = [headers.map(esc).join(',')];
    urls.forEach(function(row){
      var failed = row.hasIssue || (row.statusCode != null && Number(row.statusCode) !== 200);
      lines.push([
        r.url||'', row.url||'', row.statusCode!=null?row.statusCode:'',
        failed?'Fail':'Pass', (row.issues||[]).join('; '),
        row.redirectStatus!=null?row.redirectStatus:'', row.redirectLocation||'', row.finalUrl||''
      ].map(esc).join(','));
    });
    var bom = String.fromCharCode(0xFEFF);
    download('Sitemap-Audit-Pages-'+reportDate()+'.csv', bom + lines.join('\\n') + '\\n');
  };
  window.exportSitemapFilesCsv = function(){
    var r = window.SITEMAP_REPORT || {};
    var list = r.sitemaps || [];
    if (!list.length) { alert('No sitemap files to export.'); return; }
    var headers = ['#','Sitemap URL','Type','Root Sitemap'];
    var lines = [headers.map(esc).join(',')];
    list.forEach(function(sm, i){
      lines.push([i+1, sm, sm===r.sitemapUrl?'Root':'Nested', r.sitemapUrl||''].map(esc).join(','));
    });
    var bom = String.fromCharCode(0xFEFF);
    download('Sitemap-Audit-Files-'+reportDate()+'.csv', bom + lines.join('\\n') + '\\n');
  };
})();
</script>
<script>window.SITEMAP_REPORT = ${exportPayload};</script>`;

  return wrapReport({
    title: 'Sitemap Audit Report',
    subtitle: data.url || '',
    metaHtml: `<p class="sub">Generated: ${escapeHtml(generatedAt)} · ${sitemapFileCount} sitemap file(s) · ${summary.totalChecked || urls.length} page(s) checked</p>`,
    bodyHtml,
    extraHeadHtml: exportScript,
    extraActionsHtml: `
      <button type="button" onclick="exportSitemapPagesCsv()">Export CSV · Pages</button>
      ${sitemaps.length ? '<button type="button" onclick="exportSitemapFilesCsv()">Export CSV · Sitemaps</button>' : ''}
    `
  });
}

module.exports = {
  renderErrorCheckHtml,
  renderKeywordCheckHtml,
  renderSitemapCheckHtml
};