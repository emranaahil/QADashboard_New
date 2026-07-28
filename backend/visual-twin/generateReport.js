/**
 * Visual Twin HTML report generator.
 * - Section-level issues (one number / one highlight band per zone)
 * - Child diffs listed under each section
 * - Full-height side-by-side screenshots (equalized when possible)
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

/** Outline highlight class: yellow for hierarchy notes, red for real content gaps. */
function highlightClass(item) {
  if (!item) return 'hl';
  if (
    item.highlight === 'yellow' ||
    /heading hierarchy differs/i.test(String(item.type || ''))
  ) {
    return 'hl hl-yellow';
  }
  const sev = String(item.severity || '').toLowerCase();
  if (sev === 'minor' && /heading hierarchy|heading level|h[1-6] level/i.test(String(item.type || ''))) {
    return 'hl hl-yellow';
  }
  return 'hl';
}

/** Tight outline boxes — sequential labels 1, 2, 3… tiny badge outside the box. */
function buildMarkers(issues, side) {
  const parts = [];
  for (const iss of issues || []) {
    if (iss.side && iss.side !== side) continue;
    const children = iss.children && iss.children.length ? iss.children : null;
    if (children) {
      for (const ch of children) {
        if (ch.side && ch.side !== side) continue;
        if (typeof ch.topPct !== 'number') continue;
        const top = Number(ch.topPct).toFixed(3);
        const h = Math.max(0.15, Number(ch.heightPct) || 0.4).toFixed(3);
        const left =
          typeof ch.leftPct === 'number' ? Number(ch.leftPct).toFixed(3) : '1';
        const w =
          typeof ch.widthPct === 'number' ? Number(ch.widthPct).toFixed(3) : '98';
        const label = escapeHtml(String(ch.boxId || ch.marker || ''));
        const title = escapeHtml(
          `#${ch.boxId || ch.marker || ''} ${ch.type}${ch.details ? ': ' + String(ch.details).slice(0, 100) : ''}`
        );
        const cls = highlightClass(ch);
        parts.push(
          `<div class="${cls}" style="top:${top}%;left:${left}%;width:${w}%;height:${h}%;" data-marker="${label}" title="${title}"><span class="hl-num">${label}</span></div>`
        );
      }
    } else if (typeof iss.topPct === 'number' && (iss.marker != null || iss.boxId != null)) {
      const top = Number(iss.topPct).toFixed(3);
      const h = Math.max(0.15, Number(iss.heightPct) || 0.4).toFixed(3);
      const left =
        typeof iss.leftPct === 'number' ? Number(iss.leftPct).toFixed(3) : '1';
      const w =
        typeof iss.widthPct === 'number' ? Number(iss.widthPct).toFixed(3) : '98';
      const label = escapeHtml(String(iss.boxId || iss.marker));
      const title = escapeHtml(
        `#${iss.boxId || iss.marker} ${iss.type}${iss.details ? ': ' + String(iss.details).slice(0, 100) : ''}`
      );
      const cls = highlightClass(iss);
      parts.push(
        `<div class="${cls}" style="top:${top}%;left:${left}%;width:${w}%;height:${h}%;" data-marker="${label}" title="${title}"><span class="hl-num">${label}</span></div>`
      );
    }
  }
  return parts.join('');
}

function shotColumn({ file, alt, label, base, markersHtml, side }) {
  if (!file) {
    return `<div class="shot"><div class="shot-lbl">${escapeHtml(label)}</div><div class="no-shot">No shot</div></div>`;
  }
  const url = escapeHtml(base + file);
  return `
    <div class="shot" data-side="${escapeHtml(side)}">
      <div class="shot-lbl">
        <span>${escapeHtml(label)}</span>
        <a class="shot-open-link" href="${url}" target="_blank" rel="noopener">Open full size</a>
      </div>
      <div class="shot-full">
        <img src="${url}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" />
        <div class="hl-layer" aria-hidden="true">${markersHtml || ''}</div>
      </div>
    </div>`;
}

function renderSectionIssue(iss, pairIndex) {
  const children = iss.children || [];
  const sideTag = (side) =>
    side
      ? `<span class="side-tag side-${escapeHtml(side)}">${escapeHtml(
          side === 'reference' ? 'on reference' : 'on candidate'
        )}</span>`
      : '';

  // Flat sequential issues: each child is #1, #2, #3… (not 1.1 / 2.1)
  if (children.length > 0) {
    return children
      .map((ch) => {
        const n = ch.boxId || ch.marker;
        const jump =
          n != null && typeof ch.topPct === 'number'
            ? ` <a class="jump" href="#pair-${pairIndex}-m-${escapeHtml(String(n))}" data-pair="${pairIndex}" data-marker="${escapeHtml(
                String(n)
              )}" data-side="${escapeHtml(ch.side || iss.side || 'reference')}">show on shot</a>`
            : ` <span class="no-shot-tag">not on screenshot</span>`;
        const hierCls =
          ch.highlight === 'yellow' || /heading hierarchy differs/i.test(String(ch.type || ''))
            ? ' iss-hierarchy'
            : '';
        return `<li class="iss section-iss iss-${severityClass(ch.severity)}${hierCls}" id="pair-${pairIndex}-iss-${n != null ? n : 'x'}">
          <div class="iss-head">
            <span class="iss-num">#${n != null ? escapeHtml(String(n)) : '·'}</span>
            <strong class="iss-title">${escapeHtml(ch.type)}</strong>
            ${sideTag(ch.side || iss.side)}
            ${jump}
          </div>
          ${ch.details ? `<p class="child-summary">${escapeHtml(ch.details)}</p>` : ''}
        </li>`;
      })
      .join('');
  }

  const n = iss.boxId || iss.marker;
  const jump =
    n != null && typeof iss.topPct === 'number'
      ? ` <a class="jump" href="#pair-${pairIndex}-m-${escapeHtml(String(n))}" data-pair="${pairIndex}" data-marker="${escapeHtml(
          String(n)
        )}" data-side="${escapeHtml(iss.side || 'reference')}">show on shot</a>`
      : '';
  const noShot =
    iss.onScreenshot === false
      ? `<span class="no-shot-tag" title="This item has no page coordinates">not drawn on screenshot</span>`
      : '';

  return `<li class="iss section-iss iss-${severityClass(iss.severity)}" id="pair-${pairIndex}-iss-${n != null ? n : 'x'}">
    <div class="iss-head">
      <span class="iss-num">${n != null ? `#${escapeHtml(String(n))}` : '·'}</span>
      <strong class="iss-title">${escapeHtml(iss.type)}</strong>
      ${sideTag(iss.side)}
      ${noShot}
      ${jump}
    </div>
    ${
      iss.details
        ? `<p class="child-summary">${escapeHtml(iss.details)}${
            iss.note ? ` · ${escapeHtml(iss.note)}` : ''
          }</p>`
        : ''
    }
  </li>`;
}

/** Force sequential 1, 2, 3… on children/boxIds (also upgrades old 1.1-style reports). */
function renumberIssuesFlat(issues) {
  let n = 0;
  for (const iss of issues || []) {
    if (iss.children && iss.children.length) {
      for (const ch of iss.children) {
        n += 1;
        ch.boxId = String(n);
        ch.marker = n;
      }
      iss.marker = iss.children[0].marker;
    } else {
      n += 1;
      iss.marker = n;
      iss.boxId = String(n);
    }
  }
  return n;
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
      const allIssues = p.issues || [];
      renumberIssuesFlat(allIssues);
      const detailCount = allIssues.reduce(
        (n, iss) => n + (iss.children && iss.children.length ? iss.children.length : 1),
        0
      );

      const issuesHtml = allIssues.slice(0, 80).map((iss) => renderSectionIssue(iss, i)).join('');
      const moreNote =
        allIssues.length > 80
          ? `<p class="shot-hint">Showing 80 issue groups — see qaReport.json for full list.</p>`
          : '';

      const refMarkers = buildMarkers(allIssues, 'reference');
      const candMarkers = buildMarkers(allIssues, 'candidate');
      const refShot = shotColumn({
        file: p.screenshots?.reference,
        alt: 'Reference full page',
        label: 'Reference',
        base,
        markersHtml: refMarkers,
        side: 'reference'
      });
      const candShot = shotColumn({
        file: p.screenshots?.candidate,
        alt: 'Candidate full page',
        label: 'Candidate',
        base,
        markersHtml: candMarkers,
        side: 'candidate'
      });

      const scores = p.scores || {};
      // Drop obsolete visual chip if present in old JSON
      const scoreBits = Object.entries(scores)
        .filter(([k]) => k !== 'visual')
        .map(([k, v]) => `<span class="chip">${escapeHtml(k)}: ${v}%</span>`)
        .join('');

      return `
      <article class="pair" id="pair-${i}">
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

        <div class="diffs">
          <h3>Differences (${detailCount})</h3>
          <p class="diffs-help">
            Issues are numbered <strong>1, 2, 3…</strong> (same number on the screenshot).
            Red outline = content gap · yellow outline = heading hierarchy (minor). Click <em>show on shot</em> to jump.
          </p>
          ${issuesHtml ? `<ul class="section-list">${issuesHtml}</ul>${moreNote}` : '<p class="ok">No material differences detected for this pair.</p>'}
        </div>

        <div class="shots-legend">
          <span><i class="lg lg-crit"></i> Red = content / structure gap</span>
          <span><i class="lg lg-minor"></i> Yellow = heading hierarchy (minor)</span>
          <span>Tiny number badge = issue # (matches list above)</span>
        </div>
        <div class="shots">
          ${refShot}
          ${candShot}
        </div>
        <p class="shot-hint center-hint">Full-page screenshots at matching height — scroll the report to compare top-to-bottom side by side.</p>
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
  .wrap { max-width: min(1600px, 98vw); margin: 0 auto; padding: 20px 16px 48px; }
  h1 { margin: 0 0 8px; font-size: 1.4rem; }
  .sub { color: var(--muted); font-size: 0.85rem; margin: 4px 0 16px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 22px; }
  .stat { background: rgba(255,255,255,.04); border: 1px solid var(--border); border-radius: 14px; padding: 14px; text-align: center; }
  .stat .k { color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: .04em; }
  .stat .v { font-size: 1.5rem; font-weight: 800; margin-top: 6px; }
  .pair { background: rgba(255,255,255,.03); border: 1px solid var(--border); border-radius: 16px; padding: 16px; margin-bottom: 28px; }
  .pair-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px; }
  .score { font-weight: 800; padding: 4px 10px; border-radius: 999px; font-size: 0.85rem; }
  .score-good { background: rgba(34,197,94,.15); color: #86efac; }
  .score-warn { background: rgba(245,158,11,.15); color: #fcd34d; }
  .score-bad { background: rgba(239,68,68,.15); color: #fca5a5; }
  .urls { font-size: 0.82rem; margin-bottom: 10px; }
  .urls a { color: var(--link); word-break: break-all; }
  .lbl { color: var(--muted); font-weight: 700; font-size: 0.7rem; text-transform: uppercase; margin-right: 6px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .chip { font-size: 0.72rem; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }

  .diffs {
    margin: 0 0 16px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: rgba(0,0,0,.22);
  }
  .diffs h3 { margin: 0 0 6px; font-size: 1rem; }
  .diffs-help { margin: 0 0 12px; font-size: 0.75rem; color: var(--muted); line-height: 1.45; }
  .section-list { margin: 0; padding: 0; list-style: none; }
  .section-iss {
    margin: 0 0 12px;
    padding: 10px 12px;
    border-radius: 10px;
    border-left: 4px solid transparent;
    background: rgba(255,255,255,.04);
  }
  .iss-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin-bottom: 4px; }
  .iss-num { font-weight: 800; color: var(--link); font-size: 0.95rem; min-width: 2rem; }
  .iss-title { font-size: 0.9rem; color: var(--text); }
  .iss-crit { border-left-color: #ef4444; }
  .iss-major { border-left-color: #f59e0b; }
  .iss-minor { border-left-color: #64748b; }
  .iss-minor.iss-hierarchy { border-left-color: #eab308; }
  .iss-minor.iss-hierarchy .iss-title { color: #facc15; }
  .iss .jump { color: var(--link); font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
  .side-tag {
    display: inline-block;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .03em;
    padding: 2px 7px;
    border-radius: 999px;
  }
  .side-reference { background: rgba(96,165,250,.15); color: #93c5fd; }
  .side-candidate { background: rgba(251,146,60,.15); color: #fdba74; }
  .child-summary { margin: 4px 0 6px; font-size: 0.75rem; color: var(--muted); }
  .child-list {
    margin: 0;
    padding: 0 0 0 1.25rem;
    font-size: 0.8rem;
    line-height: 1.45;
  }
  .child-list .child { margin: 0 0 4px; color: var(--muted); }
  .child-list .iss-crit { color: #fca5a5; }
  .child-list .iss-major { color: #fcd34d; }
  .child-list .iss-minor { color: var(--muted); }
  .ok { color: #86efac; font-size: 0.85rem; }

  .shots-legend {
    display: flex; flex-wrap: wrap; gap: 14px;
    font-size: 0.7rem; color: var(--muted);
    margin: 0 0 8px;
  }
  .shots-legend .lg {
    display: inline-block; width: 14px; height: 10px; border-radius: 2px;
    margin-right: 4px; vertical-align: middle;
  }
  .lg-crit { background: transparent; border: 2px solid #ef4444; }
  .lg-minor { background: transparent; border: 2px solid #eab308; }

  .shots {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    align-items: start;
  }
  @media (max-width: 900px) { .shots { grid-template-columns: 1fr; } }
  .shot {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: #0b1220;
    min-width: 0;
    overflow: hidden;
  }
  .shot-lbl {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--muted);
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 5;
    background: rgba(11,18,32,.96);
    backdrop-filter: blur(6px);
  }
  .shot-open-link { color: var(--link); font-weight: 600; font-size: 0.7rem; }
  .shot-full {
    position: relative;
    width: 100%;
    line-height: 0;
    background: #0b1220;
  }
  .shot-full img {
    width: 100%;
    height: auto;
    display: block;
  }
  .hl-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
  }
  /* Tight outline only — no fill; number badge outside so it does not cover the issue */
  .hl {
    position: absolute;
    border: 2px solid #ef4444;
    background: transparent !important;
    box-shadow: 0 0 0 1px rgba(0,0,0,.25);
    min-width: 10px;
    min-height: 12px;
    box-sizing: border-box;
    overflow: visible;
  }
  /* Heading hierarchy (H1→H2 etc.) — minor note, yellow outline */
  .hl.hl-yellow {
    border-color: #eab308;
    box-shadow: 0 0 0 1px rgba(0,0,0,.2);
  }
  .hl.hl-yellow .hl-num {
    background: #eab308;
    color: #1c1917;
    border-color: #fef08a;
  }
  .hl-num {
    position: absolute;
    left: 0;
    top: 0;
    transform: translate(-15%, -85%);
    min-width: 0.85rem;
    height: 0.85rem;
    padding: 0 3px;
    border-radius: 3px;
    background: #ef4444;
    border: 1px solid #fff;
    color: #fff;
    font-size: 0.55rem;
    font-weight: 800;
    line-height: 0.85rem;
    text-align: center;
    white-space: nowrap;
    box-shadow: 0 1px 2px rgba(0,0,0,.35);
    z-index: 3;
  }
  .no-shot-tag {
    display: inline-block;
    font-size: 0.62rem;
    font-weight: 700;
    color: #fca5a5;
    background: rgba(239,68,68,.12);
    padding: 1px 6px;
    border-radius: 999px;
  }
  .jump-sm { font-size: 0.7rem; }
  .hl.flash {
    animation: hlflash 1.2s ease;
    z-index: 4;
  }
  .hl.hl-yellow.flash {
    animation: hlflash-yellow 1.2s ease;
  }
  @keyframes hlflash {
    0%, 100% { border-color: #ef4444; background: transparent; box-shadow: none; }
    30%, 70% { border-color: #f87171; background: transparent; box-shadow: 0 0 0 2px rgba(239,68,68,.35); }
  }
  @keyframes hlflash-yellow {
    0%, 100% { border-color: #eab308; background: transparent; box-shadow: none; }
    30%, 70% { border-color: #facc15; background: transparent; box-shadow: 0 0 0 2px rgba(234,179,8,.4); }
  }
  .shot-hint { font-size: 0.7rem; color: var(--muted); padding: 6px 4px; }
  .center-hint { text-align: center; margin-top: 8px; }
  .no-shot { padding: 40px; text-align: center; color: var(--muted); font-size: 0.85rem; line-height: 1.4; }
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
      <div class="stat"><div class="k">Section issues</div><div class="v">${totalIssues}</div></div>
    </div>
    <p class="sub"><strong>Reference base:</strong> ${escapeHtml(result.referenceBase || '')}<br/>
    <strong>Candidate base:</strong> ${escapeHtml(result.candidateBase || '')}</p>
    ${pairCards || '<p class="ok">No pairs compared.</p>'}
  </div>
  <script>
    (function () {
      document.querySelectorAll('a.jump').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var pair = a.getAttribute('data-pair');
          var marker = a.getAttribute('data-marker');
          var side = a.getAttribute('data-side') || 'reference';
          var col = document.querySelector('#pair-' + pair + ' .shot[data-side="' + side + '"]');
          if (!col) return;
          var hl = col.querySelector('.hl[data-marker="' + marker + '"]');
          if (!hl) return;
          hl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          hl.classList.remove('flash');
          void hl.offsetWidth;
          hl.classList.add('flash');
        });
      });
    })();
  </script>
</body>
</html>`;

  fs.ensureDirSync(path.dirname(outputHtmlPath));
  fs.writeFileSync(outputHtmlPath, html, 'utf8');
  return outputHtmlPath;
}

module.exports = { generateReport, escapeHtml };
