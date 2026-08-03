const { escapeHtml } = require('../shared/logViewUtils');
const { computePageSpeedAveragePercent } = require('../shared/services/pageSpeedInsights');

function statCard(label, value, tone = 'neutral') {
  const toneClass = tone === 'bad' ? ' stat--bad' : tone === 'warn' ? ' stat--warn' : tone === 'good' ? ' stat--good' : '';
  return `<div class="stat${toneClass}"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(String(value ?? '—'))}</div></div>`;
}

function checksLabel(checks) {
  const enabled = [];
  if (checks?.includePageSpeed) enabled.push('PageSpeed');
  if (checks?.includeW3cValidator) enabled.push('W3C HTML');
  if (checks?.includeRobotsTxt) enabled.push('robots.txt');
  if (checks?.includeRedirectTrace) enabled.push('Redirects');
  if (checks?.includeSslLabs) enabled.push('SSL Labs');
  return enabled.length ? enabled.join(', ') : 'None';
}

function checkBadges(checks) {
  const items = [
    { key: 'includePageSpeed', label: 'PageSpeed' },
    { key: 'includeW3cValidator', label: 'W3C HTML' },
    { key: 'includeRobotsTxt', label: 'robots.txt' },
    { key: 'includeRedirectTrace', label: 'Redirects' },
    { key: 'includeSslLabs', label: 'SSL Labs' }
  ];
  return items
    .map(({ key, label }) => {
      const on = checks?.[key] === true;
      return `<span class="chip ${on ? 'chip--on' : 'chip--off'}">${escapeHtml(label)}</span>`;
    })
    .join('');
}

function deriveOverallStatus(summary) {
  const issues =
    (summary.w3cErrors || 0) +
    (summary.redirectIssues || 0) +
    (summary.robotsTxtIssues || 0) +
    (summary.sslLabsIssues || 0);
  if (issues === 0) {
    return { label: 'All clear', tone: 'good', detail: 'No critical issues detected in enabled checks.' };
  }
  if (issues <= 3) {
    return { label: 'Needs attention', tone: 'warn', detail: `${issues} issue group(s) found — review sections below.` };
  }
  return { label: 'Action required', tone: 'bad', detail: `${issues} issue group(s) found — prioritize fixes below.` };
}

function formatPageSpeed(pageSpeed) {
  if (!pageSpeed) return '<span class="muted">—</span>';
  if (pageSpeed.skipped) {
    return `<span class="muted">Skipped</span><br><span class="small">${escapeHtml(pageSpeed.reason || 'disabled')}</span>`;
  }

  const lines = [];
  const mobile = pageSpeed.mobile;
  const desktop = pageSpeed.desktop;

  if (mobile && !mobile.error && !mobile.skipped) {
    lines.push(
      `<span class="ps-row"><strong>Mobile</strong> P ${mobile.performance ?? '—'} · A ${mobile.accessibility ?? '—'} · S ${mobile.seo ?? '—'}</span>`
    );
  } else if (mobile?.error) {
    lines.push(`<span class="ps-row ps-row--bad">Mobile: ${escapeHtml(mobile.error)}</span>`);
  }

  if (desktop && !desktop.error && !desktop.skipped) {
    lines.push(
      `<span class="ps-row"><strong>Desktop</strong> P ${desktop.performance ?? '—'} · A ${desktop.accessibility ?? '—'} · S ${desktop.seo ?? '—'}</span>`
    );
  } else if (desktop?.error) {
    lines.push(`<span class="ps-row ps-row--bad">Desktop: ${escapeHtml(desktop.error)}</span>`);
  }

  const avg = computePageSpeedAveragePercent(pageSpeed);
  if (avg > 0) lines.push(`<span class="ps-avg">Avg <strong>${avg}%</strong></span>`);

  return lines.length ? lines.join('') : '<span class="muted">—</span>';
}

function formatW3c(w3c) {
  if (!w3c) return '<span class="muted">—</span>';
  if (w3c.error) return `<span class="badge badge--bad">${escapeHtml(w3c.error)}</span>`;
  const err = w3c.errors ?? 0;
  const warn = w3c.warnings ?? 0;
  const errBadge = err > 0 ? `<span class="badge badge--bad">${err} errors</span>` : '';
  const warnBadge = warn > 0 ? `<span class="badge badge--warn">${warn} warnings</span>` : '';
  const ok = !err && !warn ? '<span class="badge badge--good">Valid</span>' : '';
  return `<div class="badge-group">${errBadge}${warnBadge}${ok}</div>`;
}

function formatRedirects(redirects) {
  if (!redirects) return '<span class="muted">—</span>';
  if (redirects.error) return `<span class="badge badge--bad">${escapeHtml(redirects.error)}</span>`;
  const hops = redirects.hopCount ?? 0;
  const truncated = redirects.truncated ? ' <span class="badge badge--warn">Truncated</span>' : '';
  const hopList = (redirects.hops || [])
    .map((h) => `${h.status}${h.location ? ' → ' + h.location : ''}`)
    .join(' → ');
  return `<div class="redirect-cell">
    <span class="badge ${hops > 0 ? 'badge--warn' : 'badge--good'}">${hops} hop(s)</span>${truncated}
    <div class="small">Final: <span class="mono">${escapeHtml(redirects.finalUrl || '—')}</span></div>
    ${hopList ? `<div class="small mono">${escapeHtml(hopList)}</div>` : ''}
  </div>`;
}

function collectW3cIssues(pages) {
  const errors = [];
  const warnings = [];

  for (const page of pages || []) {
    const w3c = page.w3c;
    if (!w3c?.issues) continue;
    const pageUrl = page.url || w3c.url || '—';
    for (const issue of w3c.issues.errors || []) {
      errors.push({ pageUrl, ...issue });
    }
    for (const issue of w3c.issues.warnings || []) {
      warnings.push({ pageUrl, ...issue });
    }
  }

  return { errors, warnings };
}

function w3cIssueRows(issues, emptyLabel) {
  if (!issues.length) {
    return `<tr><td colspan="6" class="empty">${escapeHtml(emptyLabel)}</td></tr>`;
  }
  return issues
    .map((issue, idx) => {
      const rowClass = issue.type === 'error' ? 'row--error' : 'row--warn';
      return `<tr class="${rowClass}">
        <td class="col-num">${idx + 1}</td>
        <td class="cell-url"><a href="${escapeHtml(issue.pageUrl)}" target="_blank" rel="noopener">${escapeHtml(issue.pageUrl)}</a></td>
        <td class="col-line">${issue.line ?? '—'}</td>
        <td class="col-line">${issue.column ?? '—'}</td>
        <td class="cell-message">${escapeHtml(issue.message)}</td>
        <td class="cell-extract mono">${issue.extract ? escapeHtml(issue.extract) : '—'}</td>
      </tr>`;
    })
    .join('');
}

function w3cIssuesSection(pages, sectionId) {
  const { errors, warnings } = collectW3cIssues(pages);
  const hasW3c = (pages || []).some((p) => p.w3c && !p.w3c.skipped);
  if (!hasW3c) return '';

  const truncated = (pages || []).some((p) => p.w3c?.issues?.truncated);
  const truncNote = truncated
    ? '<div class="note note--warn">Some issues were omitted per page (limit reached). Re-run single-page audits for full detail.</div>'
    : '';

  return `
    <section class="report-section" id="${sectionId}-errors">
      <div class="section-head">
        <h2>W3C HTML validation — Errors</h2>
        <p class="section-sub">${errors.length} error(s) across audited pages</p>
      </div>
      ${truncNote}
      <div class="table-panel">
        <div class="table-scroll">
          <table class="data-table w3c-table">
            <colgroup>
              <col class="col-num" />
              <col class="col-url" />
              <col class="col-line" />
              <col class="col-line" />
              <col class="col-message" />
              <col class="col-extract" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>Page</th>
                <th>Line</th>
                <th>Col</th>
                <th>Message</th>
                <th>Extract</th>
              </tr>
            </thead>
            <tbody>${w3cIssueRows(errors, 'No W3C errors')}</tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="report-section" id="${sectionId}-warnings">
      <div class="section-head">
        <h2>W3C HTML validation — Warnings</h2>
        <p class="section-sub">${warnings.length} warning(s) across audited pages</p>
      </div>
      <div class="table-panel">
        <div class="table-scroll">
          <table class="data-table w3c-table">
            <colgroup>
              <col class="col-num" />
              <col class="col-url" />
              <col class="col-line" />
              <col class="col-line" />
              <col class="col-message" />
              <col class="col-extract" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>Page</th>
                <th>Line</th>
                <th>Col</th>
                <th>Message</th>
                <th>Extract</th>
              </tr>
            </thead>
            <tbody>${w3cIssueRows(warnings, 'No W3C warnings')}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function domainRobotsRows(domainChecks) {
  const entries = Object.entries(domainChecks || {});
  if (!entries.length) {
    return '<tr><td colspan="4" class="empty">No robots.txt checks</td></tr>';
  }
  return entries
    .map(([origin, robots]) => {
      const preview = (robots.previewLines || []).map((l) => escapeHtml(l)).join('<br>') || '—';
      const status = robots.status ?? '—';
      const okBadge = robots.ok
        ? '<span class="badge badge--good">OK</span>'
        : '<span class="badge badge--bad">Issue</span>';
      return `<tr>
        <td class="mono">${escapeHtml(origin)}</td>
        <td>${escapeHtml(String(status))}</td>
        <td>${okBadge}</td>
        <td class="cell-preview mono">${preview}</td>
      </tr>`;
    })
    .join('');
}

function pageTableRows(pages, domainChecks) {
  if (!pages?.length) {
    return '<tr><td colspan="6" class="empty">No pages audited</td></tr>';
  }

  return pages.map((page, idx) => {
    const robotsOrigin = page.robotsTxtOrigin;
    const robots = robotsOrigin ? domainChecks?.[robotsOrigin] : null;
    let robotsCell = '<span class="muted">—</span>';
    if (robots) {
      const badge = robots.ok
        ? '<span class="badge badge--good">OK</span>'
        : '<span class="badge badge--bad">Issue</span>';
      robotsCell = `${badge} <span class="small">${escapeHtml(String(robots.status ?? '—'))}</span>`;
    }

    const rowClass = page.error ? 'row--error' : '';

    return `<tr class="${rowClass}">
      <td class="col-num">${idx + 1}</td>
      <td class="cell-url"><a href="${escapeHtml(page.url)}" target="_blank" rel="noopener">${escapeHtml(page.url)}</a>${page.error ? `<div class="small badge badge--bad">${escapeHtml(page.error)}</div>` : ''}</td>
      <td class="cell-pagespeed">${formatPageSpeed(page.pageSpeed)}</td>
      <td>${formatW3c(page.w3c)}</td>
      <td class="cell-redirect">${formatRedirects(page.redirects)}</td>
      <td>${robotsCell}</td>
    </tr>`;
  }).join('');
}

function sslLabsHostRows(sslLabsByHost) {
  const entries = Object.entries(sslLabsByHost || {});
  if (!entries.length) {
    return '<tr><td colspan="6" class="empty">No SSL Labs assessments</td></tr>';
  }
  return entries
    .map(([host, ssl]) => {
      const grade = ssl.grade || '—';
      const gradeClass = ssl.weakGrade || ssl.error ? 'grade--bad' : 'grade--good';
      const reportLink = ssl.reportUrl
        ? `<a href="${escapeHtml(ssl.reportUrl)}" target="_blank" rel="noopener" class="link-btn">SSL Labs report</a>`
        : '—';
      const issueCell = ssl.error
        ? `<span class="badge badge--bad">${escapeHtml(ssl.error)}</span>`
        : (ssl.hasWarnings ? '<span class="badge badge--warn">Warnings</span>' : '<span class="badge badge--good">None</span>');
      return `<tr>
        <td class="mono">${escapeHtml(host)}</td>
        <td><span class="grade ${gradeClass}">${escapeHtml(String(grade))}</span></td>
        <td>${escapeHtml(ssl.status || '—')}</td>
        <td>${ssl.endpointCount ?? (ssl.endpoints?.length || 0)}</td>
        <td>${issueCell}</td>
        <td>${reportLink}</td>
      </tr>`;
    })
    .join('');
}

function sslLabsEndpointRows(sslLabsByHost) {
  const rows = [];
  for (const [host, ssl] of Object.entries(sslLabsByHost || {})) {
    for (const ep of ssl.endpoints || []) {
      const gradeClass = ep.grade && ['A+', 'A', 'A-'].includes(ep.grade) ? 'grade--good' : 'grade--bad';
      rows.push(`<tr>
        <td class="mono">${escapeHtml(host)}</td>
        <td class="mono">${escapeHtml(ep.ipAddress || '—')}</td>
        <td><span class="grade ${gradeClass}">${escapeHtml(ep.grade || '—')}</span></td>
        <td class="small">${escapeHtml(ep.protocols || '—')}</td>
        <td>${escapeHtml(ep.hsts || '—')}</td>
        <td>${ep.heartbleed ? '<span class="badge badge--bad">Yes</span>' : 'No'}</td>
        <td>${ep.poodle ? '<span class="badge badge--bad">Yes</span>' : 'No'}</td>
      </tr>`);
    }
  }
  if (!rows.length) {
    return '<tr><td colspan="7" class="empty">No endpoint details</td></tr>';
  }
  return rows.join('');
}

function sslLabsSection(sslLabsByHost) {
  if (!Object.keys(sslLabsByHost || {}).length) return '';
  return `
    <section class="report-section" id="ssl-labs">
      <div class="section-head">
        <h2>SSL Labs — TLS grades</h2>
        <p class="section-sub">One assessment per unique hostname. Grades from Qualys SSL Labs API.</p>
      </div>
      <div class="table-panel">
        <h3 class="table-title">Hostname summary</h3>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>Grade</th>
                <th>Status</th>
                <th>Endpoints</th>
                <th>Issues</th>
                <th>Report</th>
              </tr>
            </thead>
            <tbody>${sslLabsHostRows(sslLabsByHost)}</tbody>
          </table>
        </div>
      </div>
      <div class="table-panel table-panel--spaced">
        <h3 class="table-title">Endpoint details</h3>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>IP</th>
                <th>Grade</th>
                <th>Protocols</th>
                <th>HSTS</th>
                <th>Heartbleed</th>
                <th>POODLE</th>
              </tr>
            </thead>
            <tbody>${sslLabsEndpointRows(sslLabsByHost)}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function tableOfContents(sections) {
  const items = sections.filter(Boolean);
  if (!items.length) return '';
  return `
    <nav class="toc" aria-label="Report sections">
      <h2 class="toc-title">Contents</h2>
      <ol class="toc-list">
        ${items.map((s) => `<li><a href="#${s.id}">${escapeHtml(s.label)}</a></li>`).join('')}
      </ol>
    </nav>`;
}

const REPORT_STYLES = `
  :root {
    --bg: #0b1220;
    --surface: rgba(255,255,255,.04);
    --surface-2: rgba(255,255,255,.06);
    --text: #e7eefc;
    --muted: #a9b6d6;
    --border: rgba(255,255,255,.10);
    --good: #22c55e;
    --warn: #f59e0b;
    --bad: #ef4444;
    --link: #60a5fa;
    --primary: #0f8f6f;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(160deg, #0b1220 0%, #0f1b33 100%);
    color: var(--text);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 28px 24px 48px; }
  .report-header {
    display: flex; flex-wrap: wrap; justify-content: space-between; gap: 20px;
    padding-bottom: 20px; margin-bottom: 24px; border-bottom: 1px solid var(--border);
  }
  .brand { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 4px; }
  .brand-sub { color: var(--muted); font-size: 0.85rem; margin: 0 0 12px; }
  .meta-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px 20px; font-size: 0.85rem; color: var(--muted);
  }
  .meta-grid strong { color: var(--text); font-weight: 600; }
  .meta-grid .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
  .status-banner {
    display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px;
    border-radius: 14px; border: 1px solid var(--border); background: var(--surface);
    margin-bottom: 20px;
  }
  .status-banner--good { border-color: rgba(34,197,94,.35); background: rgba(34,197,94,.08); }
  .status-banner--warn { border-color: rgba(245,158,11,.35); background: rgba(245,158,11,.08); }
  .status-banner--bad { border-color: rgba(239,68,68,.35); background: rgba(239,68,68,.08); }
  .status-icon {
    flex: 0 0 auto; width: 40px; height: 40px; border-radius: 10px;
    display: grid; place-items: center; font-weight: 800; font-size: 1.1rem;
    background: var(--surface-2);
  }
  .status-banner--good .status-icon { color: var(--good); }
  .status-banner--warn .status-icon { color: var(--warn); }
  .status-banner--bad .status-icon { color: var(--bad); }
  .status-title { margin: 0 0 4px; font-size: 1.05rem; font-weight: 700; }
  .status-detail { margin: 0; color: var(--muted); font-size: 0.875rem; }
  .chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .chip {
    display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px;
    font-size: 0.72rem; font-weight: 600; letter-spacing: 0.02em; border: 1px solid var(--border);
  }
  .chip--on { background: rgba(15,143,111,.15); border-color: rgba(15,143,111,.4); color: #6ee7b7; }
  .chip--off { background: transparent; color: var(--muted); opacity: 0.55; }
  .summary-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 12px; margin-bottom: 24px;
  }
  .stat {
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 14px 12px; text-align: center;
  }
  .stat-label {
    font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); font-weight: 600;
  }
  .stat-value { font-size: 1.35rem; font-weight: 800; margin-top: 6px; line-height: 1.2; }
  .stat--bad .stat-value { color: var(--bad); }
  .stat--warn .stat-value { color: var(--warn); }
  .stat--good .stat-value { color: var(--good); }
  .toc {
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    padding: 16px 20px; margin-bottom: 28px;
  }
  .toc-title { margin: 0 0 10px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .toc-list { margin: 0; padding-left: 20px; font-size: 0.9rem; }
  .toc-list li { margin: 6px 0; }
  .toc-list a { color: var(--link); text-decoration: none; }
  .toc-list a:hover { text-decoration: underline; }
  .report-section { margin-bottom: 32px; scroll-margin-top: 16px; }
  .section-head { margin-bottom: 14px; }
  .section-head h2 { margin: 0 0 6px; font-size: 1.15rem; font-weight: 700; }
  .section-sub { margin: 0; color: var(--muted); font-size: 0.85rem; }
  .table-panel {
    border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
    background: var(--surface);
  }
  .table-panel--spaced { margin-top: 16px; }
  .table-title {
    margin: 0; padding: 12px 16px; font-size: 0.8rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted);
    border-bottom: 1px solid var(--border); background: var(--surface-2);
  }
  .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .data-table {
    width: 100%; border-collapse: collapse; font-size: 0.8rem;
    table-layout: auto;
  }
  .data-table thead th {
    padding: 10px 12px; text-align: left; vertical-align: top;
    font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--muted); background: var(--surface-2);
    border-bottom: 1px solid var(--border); white-space: nowrap;
  }
  .data-table tbody td {
    padding: 10px 12px; vertical-align: top; text-align: left;
    border-bottom: 1px solid rgba(255,255,255,.06);
  }
  .data-table tbody tr:last-child td { border-bottom: none; }
  .data-table tbody tr.row--error { background: rgba(239,68,68,.07); }
  .data-table tbody tr.row--warn { background: rgba(245,158,11,.07); }
  .col-num { width: 42px; text-align: center !important; color: var(--muted); font-weight: 700; }
  .col-line { width: 52px; }
  .col-url { min-width: 180px; }
  .col-message { min-width: 200px; }
  .col-extract { min-width: 160px; }
  .cell-url a, .cell-url { word-break: break-all; }
  .cell-message { word-break: break-word; }
  .cell-extract, .cell-preview, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.72rem; word-break: break-all; }
  .cell-pagespeed .ps-row { display: block; margin-bottom: 4px; }
  .cell-pagespeed .ps-row--bad { color: var(--bad); }
  .cell-pagespeed .ps-avg { display: block; margin-top: 4px; color: var(--muted); font-size: 0.75rem; }
  .badge-group { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 6px;
    font-size: 0.72rem; font-weight: 600; white-space: nowrap;
  }
  .badge--good { background: rgba(34,197,94,.15); color: #86efac; border: 1px solid rgba(34,197,94,.3); }
  .badge--warn { background: rgba(245,158,11,.15); color: #fcd34d; border: 1px solid rgba(245,158,11,.3); }
  .badge--bad { background: rgba(239,68,68,.15); color: #fca5a5; border: 1px solid rgba(239,68,68,.3); }
  .grade { display: inline-block; min-width: 28px; text-align: center; font-weight: 800; font-size: 0.95rem; padding: 2px 8px; border-radius: 6px; }
  .grade--good { background: rgba(34,197,94,.15); color: #86efac; }
  .grade--bad { background: rgba(245,158,11,.15); color: #fcd34d; }
  .small { font-size: 0.75rem; color: var(--muted); margin-top: 4px; }
  .muted { color: var(--muted); }
  .empty { text-align: center; color: var(--muted); padding: 16px !important; }
  a { color: var(--link); }
  .link-btn { font-size: 0.78rem; font-weight: 600; }
  .note {
    padding: 12px 14px; border-radius: 10px; font-size: 0.82rem; margin-bottom: 12px;
    border: 1px solid var(--border);
  }
  .note--warn { border-color: rgba(245,158,11,.35); background: rgba(245,158,11,.08); }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .btn {
    cursor: pointer; border: 1px solid var(--border); background: var(--surface-2);
    color: var(--text); padding: 10px 16px; border-radius: 10px;
    font-weight: 600; font-size: 0.82rem; transition: background 0.15s;
  }
  .btn:hover { background: rgba(255,255,255,.10); }
  .btn-primary {
    background: var(--primary); border-color: rgba(15,143,111,.6); color: #ecfdf5;
  }
  .btn-primary:hover { background: #0d7a5f; }
  .report-footer {
    margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border);
    font-size: 0.75rem; color: var(--muted); text-align: center;
  }

  @media print {
    @page { size: A4 landscape; margin: 10mm; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body { background: #fff !important; color: #111 !important; }
    .wrap { max-width: none; padding: 0; }
    .actions, .btn, .toc { display: none !important; }
    .report-header {
      border-bottom: 1px solid #d4d4d8; padding-bottom: 12px; margin-bottom: 14px;
      page-break-after: avoid; break-after: avoid-page;
    }
    .brand, .brand-sub, .status-title, .section-head h2, .table-title { color: #111 !important; }
    .meta-grid, .section-sub, .status-detail, .small, .muted { color: #52525b !important; }
    .status-banner {
      border: 1px solid #d4d4d8 !important; background: #fafafa !important;
      page-break-inside: avoid; break-inside: avoid-page;
    }
    .status-banner--good { border-color: #86efac !important; background: #f0fdf4 !important; }
    .status-banner--warn { border-color: #fcd34d !important; background: #fffbeb !important; }
    .status-banner--bad { border-color: #fca5a5 !important; background: #fef2f2 !important; }
    .chip--on { color: #166534 !important; background: #dcfce7 !important; border-color: #86efac !important; }
    .chip--off { color: #71717a !important; }
    .summary-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; page-break-inside: avoid; }
    .stat { background: #fafafa !important; border: 1px solid #e4e4e7 !important; padding: 10px 8px; }
    .stat-label { color: #52525b !important; }
    .stat-value { color: #111 !important; font-size: 1.1rem; }
    .stat--bad .stat-value { color: #b91c1c !important; }
    .stat--warn .stat-value { color: #b45309 !important; }
    .report-section { page-break-inside: auto; margin-bottom: 20px; }
    .section-head { page-break-after: avoid; }
    .table-panel {
      border: 1px solid #e4e4e7 !important; background: #fff !important;
      page-break-inside: auto;
    }
    .table-title { background: #f4f4f5 !important; color: #3f3f46 !important; border-color: #e4e4e7 !important; }
    .table-scroll { overflow: visible !important; max-height: none !important; }
    .data-table {
      width: 100% !important; min-width: 0 !important; font-size: 7.5pt;
      table-layout: fixed !important;
    }
    .data-table thead { display: table-header-group; }
    .data-table thead th {
      background: #f4f4f5 !important; color: #3f3f46 !important;
      border-bottom: 1px solid #d4d4d8 !important;
      white-space: normal !important; word-break: break-word; padding: 5px 4px;
    }
    .data-table tbody td {
      color: #111 !important; border-bottom: 1px solid #e4e4e7 !important;
      white-space: normal !important; word-break: break-word; padding: 5px 4px;
      vertical-align: top;
    }
    .data-table tbody tr { page-break-inside: avoid; break-inside: avoid-page; }
    .data-table tbody tr.row--error { background: #fef2f2 !important; }
    .data-table tbody tr.row--warn { background: #fffbeb !important; }
    .col-num { width: 28px !important; }
    .col-line { width: 36px !important; }
    .col-url { width: 22% !important; }
    .col-message { width: 28% !important; }
    .col-extract { width: 18% !important; }
    .cell-url a, a { color: #111 !important; text-decoration: none !important; }
    .badge, .grade, .chip {
      color: #111 !important; background: #f4f4f5 !important;
      border: 1px solid #d4d4d8 !important; font-size: 7pt;
    }
    .badge--good, .grade--good { background: #dcfce7 !important; border-color: #86efac !important; }
    .badge--warn, .grade--bad { background: #fef3c7 !important; border-color: #fcd34d !important; }
    .badge--bad { background: #fee2e2 !important; border-color: #fca5a5 !important; }
    .mono, .cell-extract, .cell-preview { font-size: 6.5pt !important; word-break: break-all !important; }
    .note { border: 1px solid #fcd34d !important; background: #fffbeb !important; color: #111 !important; }
    .report-footer { color: #71717a !important; border-color: #e4e4e7 !important; }
  }
`;

function generateHtmlReport(report) {
  const summary = report.summary || {};
  const pages = report.pages || [];
  const domainChecks = report.domainChecks || {};
  const sslLabsByHost = report.sslLabsByHost || {};
  const checks = report.options || summary.checksEnabled || {};
  const generatedAt = report.generatedAt
    ? new Date(report.generatedAt).toLocaleString()
    : '—';

  const overall = deriveOverallStatus(summary);
  const statusIcon = overall.tone === 'good' ? '✓' : overall.tone === 'warn' ? '!' : '✕';

  const tocSections = [
    { id: 'summary', label: 'Executive summary' },
    Object.keys(domainChecks).length ? { id: 'robots-txt', label: 'robots.txt' } : null,
    (pages || []).some((p) => p.w3c && !p.w3c.skipped) ? { id: 'w3c-errors', label: 'W3C errors' } : null,
    (pages || []).some((p) => p.w3c && !p.w3c.skipped) ? { id: 'w3c-warnings', label: 'W3C warnings' } : null,
    Object.keys(sslLabsByHost).length ? { id: 'ssl-labs', label: 'SSL Labs' } : null,
    { id: 'per-page', label: 'Per-page results' }
  ];

  const robotsSection = Object.keys(domainChecks).length
    ? `
    <section class="report-section" id="robots-txt">
      <div class="section-head">
        <h2>robots.txt</h2>
        <p class="section-sub">Fetched once per origin — HTTP status and first five lines of each file.</p>
      </div>
      <div class="table-panel">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr><th>Origin</th><th>HTTP status</th><th>Result</th><th>Preview</th></tr>
            </thead>
            <tbody>${domainRobotsRows(domainChecks)}</tbody>
          </table>
        </div>
      </div>
    </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Security Audit — ${escapeHtml(report.domain || report.url || '')}</title>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <div class="wrap">
    <header class="report-header">
      <div>
        <h1 class="brand">Security Audit Report</h1>
        <p class="brand-sub">Comprehensive security &amp; quality checks for web pages</p>
        <div class="meta-grid">
          <div><span>Target</span><br><strong class="mono">${escapeHtml(report.url || '—')}</strong></div>
          <div><span>Domain</span><br><strong>${escapeHtml(report.domain || '—')}</strong></div>
          <div><span>Mode</span><br><strong>${escapeHtml(report.mode || '—')}</strong></div>
          <div><span>Generated</span><br><strong>${escapeHtml(generatedAt)}</strong></div>
          <div><span>Pages audited</span><br><strong>${summary.pagesAudited ?? pages.length}</strong></div>
        </div>
        <div class="chip-row" aria-label="Enabled checks">${checkBadges(checks)}</div>
      </div>
      <div class="actions">
        <button class="btn" type="button" data-security-action="print" title="Opens print dialog — choose Save as PDF">Print</button>
        <button class="btn btn-primary" type="button" data-security-action="print" title="Opens print dialog — choose Save as PDF">Save as PDF</button>
      </div>
    </header>

    <section class="report-section" id="summary">
      <div class="status-banner status-banner--${overall.tone}">
        <div class="status-icon" aria-hidden="true">${statusIcon}</div>
        <div>
          <p class="status-title">${escapeHtml(overall.label)}</p>
          <p class="status-detail">${escapeHtml(overall.detail)}</p>
        </div>
      </div>

      <div class="summary-grid">
        ${statCard('Pages scanned', summary.pagesAudited ?? pages.length)}
        ${statCard('W3C errors', summary.w3cErrors ?? 0, (summary.w3cErrors || 0) > 0 ? 'bad' : 'good')}
        ${statCard('W3C warnings', summary.w3cWarnings ?? 0, (summary.w3cWarnings || 0) > 0 ? 'warn' : 'neutral')}
        ${statCard('Redirect issues', summary.redirectIssues ?? 0, (summary.redirectIssues || 0) > 0 ? 'bad' : 'good')}
        ${statCard('robots.txt issues', summary.robotsTxtIssues ?? 0, (summary.robotsTxtIssues || 0) > 0 ? 'bad' : 'good')}
        ${statCard('SSL Labs issues', summary.sslLabsIssues ?? 0, (summary.sslLabsIssues || 0) > 0 ? 'bad' : 'good')}
        ${statCard('PageSpeed avg', summary.pageSpeedAverage != null ? `${summary.pageSpeedAverage}%` : '—', 'neutral')}
        ${statCard('Pages with issues', summary.pagesWithIssues ?? 0, (summary.pagesWithIssues || 0) > 0 ? 'warn' : 'good')}
      </div>
      <p class="section-sub">Checks run: <strong>${escapeHtml(checksLabel(checks))}</strong></p>
    </section>

    ${tableOfContents(tocSections)}

    ${robotsSection}

    ${w3cIssuesSection(pages, 'w3c')}

    ${sslLabsSection(sslLabsByHost)}

    <section class="report-section" id="per-page">
      <div class="section-head">
        <h2>Per-page results</h2>
        <p class="section-sub">Combined results for every audited URL. PageSpeed shows Performance / Accessibility / SEO scores.</p>
      </div>
      <div class="table-panel">
        <div class="table-scroll">
          <table class="data-table pages-table">
            <colgroup>
              <col class="col-num" />
              <col class="col-url" />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>URL</th>
                <th>PageSpeed</th>
                <th>W3C</th>
                <th>Redirects</th>
                <th>robots.txt</th>
              </tr>
            </thead>
            <tbody>${pageTableRows(pages, domainChecks)}</tbody>
          </table>
        </div>
      </div>
    </section>

    <footer class="report-footer">
      Security Audit · ${escapeHtml(report.domain || report.url || '')} · Generated ${escapeHtml(generatedAt)}
    </footer>
  </div>
  <script>
  (function () {
    document.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest && event.target.closest('[data-security-action="print"]');
      if (!btn) return;
      event.preventDefault();
      window.print();
    });
  })();
  </script>
</body>
</html>`;
}

module.exports = {
  generateHtmlReport
};