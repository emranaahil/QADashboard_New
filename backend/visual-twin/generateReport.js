/**
 * Visual Twin HTML report generator.
 */
const fs = require('fs-extra');
const path = require('path');

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function severityClass(sev) {
  const s = String(sev || 'minor').toLowerCase();
  if (s === 'critical') return 'crit';
  if (s === 'major') return 'major';
  return 'minor';
}

function generateReport({ result, outputHtmlPath, screenshotBaseUrl = '' }) {
  const pairs = result.pairs || [];
  const avg =
    pairs.length > 0
      ? Math.round(pairs.reduce((a, p) => a + (p.matchScore || 0), 0) / pairs.length)
      : 0;
  const totalIssues = pairs.reduce((a, p) => a + (p.issues?.length || 0), 0);
  const weak = pairs.filter((p) => (p.matchScore || 0) < 80).length;

  const base = screenshotBaseUrl || '';

  const pairCards = pairs
    .map((p, i) => {
      const issuesHtml = (p.issues || [])
        .slice(0, 40)
        .map(
          (iss) =>
            `<li class="iss iss-${severityClass(iss.severity)}"><strong>${escapeHtml(iss.type)}</strong>${
              iss.details ? ` — ${escapeHtml(iss.details)}` : ''
            }</li>`
        )
        .join('');
      const refShot = p.screenshots?.reference
        ? `<img src="${escapeHtml(base + p.screenshots.reference)}" alt="Reference" />`
        : '<div class="no-shot">No shot</div>';
      const candShot = p.screenshots?.candidate
        ? `<img src="${escapeHtml(base + p.screenshots.candidate)}" alt="Candidate" />`
        : '<div class="no-shot">No shot</div>';
      const scores = p.scores || {};
      const scoreBits = Object.entries(scores)
        .map(([k, v]) => `<span class="chip">${escapeHtml(k)}: ${v}%</span>`)
        .join('');

      return `
      <article class="pair">
        <header class="pair-head">
          <span class="idx">#${i + 1}</span>
          <span class="score score-${p.matchScore >= 90 ? 'good' : p.matchScore >= 70 ? 'warn' : 'bad'}">${p.matchScore ?? 0}% match</span>
          <span class="device">${escapeHtml(p.device || '')}</span>
        </header>
        <div class="urls">
          <div><span class="lbl">Reference</span> <a href="${escapeHtml(p.referenceUrl)}" target="_blank" rel="noopener">${escapeHtml(p.referenceUrl)}</a></div>
          <div><span class="lbl">Candidate</span> <a href="${escapeHtml(p.candidateUrl)}" target="_blank" rel="noopener">${escapeHtml(p.candidateUrl)}</a></div>
        </div>
        <div class="chips">${scoreBits}</div>
        <div class="shots">
          <div class="shot"><div class="shot-lbl">Reference</div>${refShot}</div>
          <div class="shot"><div class="shot-lbl">Candidate</div>${candShot}</div>
        </div>
        <div class="diffs">
          <h3>Differences (${(p.issues || []).length})</h3>
          ${issuesHtml ? `<ul>${issuesHtml}</ul>` : '<p class="ok">No material differences detected for this pair.</p>'}
        </div>
      </article>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Visual Twin Report</title>
<style>
  :root { --bg:#0a101c; --card:#111827; --text:#e8eef8; --muted:#9aabbf; --border:rgba(255,255,255,.1); --good:#22c55e; --warn:#f59e0b; --bad:#ef4444; --link:#60a5fa; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: linear-gradient(135deg,#0b1220,#0f1b33); color: var(--text); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
  h1 { margin: 0 0 8px; font-size: 1.4rem; }
  .sub { color: var(--muted); font-size: 0.85rem; margin: 4px 0 16px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 22px; }
  .stat { background: rgba(255,255,255,.04); border: 1px solid var(--border); border-radius: 14px; padding: 14px; text-align: center; }
  .stat .k { color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: .04em; }
  .stat .v { font-size: 1.5rem; font-weight: 800; margin-top: 6px; }
  .pair { background: rgba(255,255,255,.03); border: 1px solid var(--border); border-radius: 16px; padding: 16px; margin-bottom: 16px; }
  .pair-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px; }
  .score { font-weight: 800; padding: 4px 10px; border-radius: 999px; font-size: 0.85rem; }
  .score-good { background: rgba(34,197,94,.15); color: #86efac; }
  .score-warn { background: rgba(245,158,11,.15); color: #fcd34d; }
  .score-bad { background: rgba(239,68,68,.15); color: #fca5a5; }
  .urls { font-size: 0.82rem; margin-bottom: 10px; }
  .urls a { color: var(--link); word-break: break-all; }
  .lbl { color: var(--muted); font-weight: 700; font-size: 0.7rem; text-transform: uppercase; margin-right: 6px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .chip { font-size: 0.72rem; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
  .shots { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  @media (max-width: 720px) { .shots { grid-template-columns: 1fr; } }
  .shot { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: #0b1220; }
  .shot-lbl { font-size: 0.7rem; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .shot img { width: 100%; display: block; max-height: 360px; object-fit: cover; object-position: top; }
  .no-shot { padding: 40px; text-align: center; color: var(--muted); font-size: 0.85rem; }
  .diffs h3 { margin: 0 0 8px; font-size: 0.95rem; }
  .diffs ul { margin: 0; padding-left: 18px; }
  .iss { margin: 0 0 6px; font-size: 0.82rem; line-height: 1.4; }
  .iss-crit { color: #fca5a5; }
  .iss-major { color: #fcd34d; }
  .iss-minor { color: var(--muted); }
  .ok { color: #86efac; font-size: 0.85rem; }
  .device { color: var(--muted); font-size: 0.75rem; }
  .idx { font-weight: 700; color: var(--muted); }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Visual Twin Report</h1>
    <p class="sub">Reference vs candidate clone comparison · ${escapeHtml(result.generatedAt || '')}</p>
    <div class="stats">
      <div class="stat"><div class="k">Pairs</div><div class="v">${pairs.length}</div></div>
      <div class="stat"><div class="k">Avg match</div><div class="v">${avg}%</div></div>
      <div class="stat"><div class="k">Weak pairs (&lt;80%)</div><div class="v">${weak}</div></div>
      <div class="stat"><div class="k">Issues</div><div class="v">${totalIssues}</div></div>
    </div>
    <p class="sub"><strong>Reference base:</strong> ${escapeHtml(result.referenceBase || '')}<br/>
    <strong>Candidate base:</strong> ${escapeHtml(result.candidateBase || '')}</p>
    ${pairCards || '<p class="ok">No pairs compared.</p>'}
  </div>
</body>
</html>`;

  fs.ensureDirSync(path.dirname(outputHtmlPath));
  fs.writeFileSync(outputHtmlPath, html, 'utf8');
  return outputHtmlPath;
}

module.exports = { generateReport, escapeHtml };
