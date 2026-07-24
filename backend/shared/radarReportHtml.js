const { escapeHtml } = require('./logViewUtils');

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
  a { color:var(--link); word-break:break-all; }
  .empty { color:var(--muted); padding:12px; }
  .actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
  button { cursor:pointer; background:rgba(255,255,255,.06); border:1px solid var(--border); color:var(--text); padding:8px 12px; border-radius:10px; font-weight:600; font-size:0.8rem; }
  button:hover { background:rgba(255,255,255,.10); }
  .link-radar-table .col-num { width:42px; text-align:center; color:var(--muted); font-weight:700; }
  .link-radar-table .col-issue { width:20%; min-width:120px; }
  .link-radar-table .col-found { width:42%; }
  .link-radar-table .col-broken { width:36%; }
  .link-radar-table .url-block { display:block; line-height:1.45; }
  .link-radar-table .url-label { display:block; font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-bottom:4px; }
  .link-radar-table .found-list { margin:0; padding-left:18px; }
  .link-radar-table .found-list li { margin:0 0 8px; line-height:1.4; }
  .link-radar-table .found-list li:last-child { margin-bottom:0; }
  .note-box { margin:12px 0 20px; padding:12px 14px; border:1px solid rgba(245,158,11,.35); border-radius:12px; background:rgba(245,158,11,.08); color:var(--text); font-size:0.82rem; line-height:1.5; }
  @media print {
    .link-radar-table { font-size:9px; }
    .link-radar-table .found-list { padding-left:14px; }
  }
`;

function groupBrokenLinksForReport(brokenLinks, brokenPages) {
  const issueByUrl = new Map(
    (brokenPages || []).map((p) => [p.url, (p.detectedErrors || []).filter((e) => e !== 'rate limited (skipped)')])
  );
  const grouped = new Map();

  for (const item of brokenLinks || []) {
    if (!grouped.has(item.brokenUrl)) {
      grouped.set(item.brokenUrl, {
        brokenUrl: item.brokenUrl,
        foundIn: [],
        issues: issueByUrl.get(item.brokenUrl) || []
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

  const pageRows = brokenPages.length
    ? brokenPages.map((p, idx) => `<tr class="error-row">
        <td class="col-num">${idx + 1}</td>
        <td class="col-broken"><a class="url-block" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.url)}</a></td>
        <td class="col-issue">${escapeHtml(formatIssueList(p.detectedErrors))}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" class="empty">None</td></tr>';

  const linkRows = groupedLinks.length
    ? groupedLinks.map((group, idx) => {
        const foundItems = group.foundIn
          .map((foundUrl) => `<li><a href="${escapeHtml(foundUrl)}" target="_blank" rel="noopener">${escapeHtml(foundUrl)}</a></li>`)
          .join('');
        return `<tr class="error-row">
        <td class="col-num">${idx + 1}</td>
        <td class="col-found">
          <span class="url-label">Found in</span>
          <ol class="found-list">${foundItems}</ol>
        </td>
        <td class="col-issue">${escapeHtml(formatIssueList(group.issues))}</td>
        <td class="col-broken">
          <span class="url-label">Broken URL</span>
          <a class="url-block" href="${escapeHtml(group.brokenUrl)}" target="_blank" rel="noopener">${escapeHtml(group.brokenUrl)}</a>
        </td>
      </tr>`;
      }).join('')
    : '<tr><td colspan="4" class="empty">None</td></tr>';

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

  const bodyHtml = `
    <div class="summary">
      <div class="stat"><div class="k">Checked</div><div class="v">${data.checked || 0}</div></div>
      <div class="stat bad highlight"><div class="k">Broken Pages</div><div class="v">${brokenPages.length}</div></div>
      <div class="stat"><div class="k">Broken Link Groups</div><div class="v">${groupedLinks.length}</div></div>
      <div class="stat"><div class="k">Link References</div><div class="v">${brokenLinks.length}</div></div>
      ${rateLimitedPages.length ? `<div class="stat highlight"><div class="k">Rate Limited</div><div class="v">${rateLimitedPages.length}</div></div>` : ''}
    </div>
    ${rateLimitNote}
    <h2>Broken Pages</h2>
    <table class="link-radar-table"><thead><tr><th class="col-num">#</th><th>Page URL</th><th class="col-issue">Issue</th></tr></thead><tbody>${pageRows}</tbody></table>
    <h2>Broken Links</h2>
    <p class="sub">Read left to right: where the link was found → what issue it has → the broken URL.</p>
    <table class="link-radar-table"><thead><tr><th class="col-num">#</th><th class="col-found">Found In</th><th class="col-issue">Issue</th><th class="col-broken">Broken URL</th></tr></thead><tbody>${linkRows}</tbody></table>
    ${rateLimitedPages.length ? `<h2>Rate Limited (Not Marked Broken)</h2><table class="link-radar-table"><thead><tr><th class="col-num">#</th><th>Page URL</th><th>Status</th></tr></thead><tbody>${rateLimitRows}</tbody></table>` : ''}`;

  return wrapReport({
    title: 'Link Radar — Error Check Report',
    subtitle: data.url || '',
    metaHtml: `<p class="sub">Generated: ${escapeHtml(generatedAt)}</p>`,
    bodyHtml
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