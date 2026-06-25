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
`;

function wrapReport({ title, subtitle, metaHtml, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ''}
      ${metaHtml || ''}
      <div class="actions">
        <button type="button" onclick="window.print()">Print / Save PDF</button>
      </div>
    </header>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function renderErrorCheckHtml(data) {
  const brokenPages = data.brokenPages || [];
  const brokenLinks = data.brokenLinks || [];
  const generatedAt = data.generatedAt
    ? new Date(data.generatedAt).toLocaleString()
    : '—';

  const pageRows = brokenPages.length
    ? brokenPages.map((p) => `<tr class="error-row">
        <td><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.url)}</a></td>
        <td>${escapeHtml((p.detectedErrors || []).join(', ') || '—')}</td>
      </tr>`).join('')
    : '<tr><td colspan="2" class="empty">None</td></tr>';

  const linkRows = brokenLinks.length
    ? brokenLinks.map((l) => `<tr>
        <td><a href="${escapeHtml(l.brokenUrl)}" target="_blank" rel="noopener">${escapeHtml(l.brokenUrl)}</a></td>
        <td><a href="${escapeHtml(l.foundIn)}" target="_blank" rel="noopener">${escapeHtml(l.foundIn)}</a></td>
      </tr>`).join('')
    : '<tr><td colspan="2" class="empty">None</td></tr>';

  const bodyHtml = `
    <div class="summary">
      <div class="stat"><div class="k">Checked</div><div class="v">${data.checked || 0}</div></div>
      <div class="stat bad highlight"><div class="k">Broken Pages</div><div class="v">${brokenPages.length}</div></div>
      <div class="stat"><div class="k">Broken Links</div><div class="v">${brokenLinks.length}</div></div>
    </div>
    <h2>Broken Pages</h2>
    <table><thead><tr><th>URL</th><th>Issues</th></tr></thead><tbody>${pageRows}</tbody></table>
    <h2>Broken Links</h2>
    <table><thead><tr><th>Broken URL</th><th>Found In</th></tr></thead><tbody>${linkRows}</tbody></table>`;

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

module.exports = { renderErrorCheckHtml, renderKeywordCheckHtml };