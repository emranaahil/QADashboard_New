/**
 * generateReport.js — Production QA Report Generator
 *
 * Generates a comprehensive, device-aware, filterable, printable,
 * and PDF-exportable QA dashboard from qaReport.json data.
 *
 * Features:
 *   1. Device-aware screenshot mapping
 *   2. Responsive statistics dashboard (CSS Grid)
 *   3. Advanced multi-filter (URL, Device, Priority)
 *   4. Live search
 *   5. PDF export (html2canvas + jsPDF)
 *   6. Print-friendly styles
 *   7. Centralized severity classification
 *   8. Visual QA Findings section
 *   9. Interactive screenshot gallery with lightbox
 *  10. Executive summary with health score
 *  11. Empty-state handling
 *  12. All original features preserved
 */

const fs = require('fs');
const path = require('path');
const { loadJson, ensureDir } = require('./utils/reportUtils');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
.replace(/</g, '&lt;')
.replace(/>/g, '&gt;')
.replace(/"/g, '&quot;')
.replace(/'/g, '&#039;');
}

/**
 * Centralized severity classification for an issue.
 * Works with both issue-object format (from uiChecksFull.js) and plain strings.
 */
function classifySeverity(issue) {
  if (issue && typeof issue === 'object') {
    const raw = (issue.severity || '').toLowerCase();
    if (raw === 'critical') return 'critical';
    if (raw === 'major') return 'major';
    return 'minor';
  }
  const s = String(issue ?? '').toLowerCase();
  if (s.includes('broken') || s.includes('blank') || s.includes('page load') ||
      s.includes('runtime') || s.includes('missing content')) return 'critical';
  if (s.includes('overflow') || s.includes('overlap') || s.includes('alignment') ||
      s.includes('clipped') || s.includes('clipping') || s.includes('layout shift') ||
      s.includes('navbar') || s.includes('covered')) return 'major';
  return 'minor';
}

/**
 * Extract a human-readable issue label from an issue (object or string).
 */
function issueLabel(issue) {
  if (issue && typeof issue === 'object') {
    const parts = [issue.type || 'Unknown'];
    if (issue.count) parts.push(String(issue.count));
    return parts.join(': ');
  }
  return String(issue ?? 'Unknown');
}

/**
 * Extract the full display text for an issue (object or string).
 */
function issueText(issue) {
  if (issue && typeof issue === 'object') {
    const parts = [];
    if (issue.type) parts.push(issue.type);
    if (issue.count) parts.push(issue.count);
    if (issue.details) parts.push(issue.details);
    return parts.join(' — ');
  }
  return String(issue ?? '');
}

/**
 * Category classification for an issue.
 */
function classifyCategory(issue) {
  const t = (issue && typeof issue === 'object') ? (issue.type || '') : String(issue ?? '');
  const s = t.toLowerCase();
  if (s.includes('broken image')) return 'Broken Images';
  if (s.includes('broken images') || s.includes('broken')) return 'Broken Images';
  if (s.includes('blank')) return 'Blank Page';
  if (s.includes('overflow') || s.includes('horizontal scroll')) return 'Overflow';
  if (s.includes('overlap')) return 'Overlap';
  if (s.includes('alignment') || s.includes('misaligned')) return 'Alignment';
  if (s.includes('text clipping') || s.includes('clipped') || s.includes('truncated')) return 'Text Clipping';
  if (s.includes('navbar')) return 'Navbar';
  if (s.includes('hero')) return 'Hero';
  if (s.includes('card')) return 'Card';
  if (s.includes('distorted') || s.includes('image distortion')) return 'Image Distortion';
  if (s.includes('small buttons') || s.includes('button') || s.includes('touch target')) return 'Button Size';
  if (s.includes('layering')) return 'Layering';
  if (s.includes('popup') || s.includes('modal')) return 'Popup/Modal';
  if (s.includes('faq')) return 'FAQ';
  if (s.includes('cta') || s.includes('above fold')) return 'CTA';
  if (s.includes('missing headings') || s.includes('missing paragraphs') || s.includes('missing content')) return 'Content Comparison';
  if (s.includes('layout shifts') || s.includes('cls')) return 'Layout Shift';
  if (s.includes('offscreen')) return 'Offscreen Elements';
  if (s.includes('covered interactive')) return 'Covered Elements';
  if (s.includes('spacing') || s.includes('collapsed') || s.includes('excessive')) return 'Spacing';
  if (s.includes('contrast')) return 'Color Contrast';
  if (s.includes('console') || s.includes('js error') || s.includes('runtime') || s.includes('failed request')) return 'Runtime';
  return 'UI Issue';
}

/**
 * Map severity to a human-readable priority label.
 */
function priorityLabel(severity) {
  if (severity === 'critical') return 'Critical';
  if (severity === 'major') return 'Major';
  return 'Minor';
}

/** Human-friendly page label — prefer URL path when page name is just the device label. */
function entryDisplayName(entry) {
  const page = entry.page || 'Page';
  const url = entry.url || '';
  if (!url) return page;
  try {
    const parsed = new URL(url);
    const pathLabel = parsed.pathname && parsed.pathname !== '/'
      ? parsed.pathname
      : parsed.hostname;
    if (page === entry.device || page === 'unknown') return pathLabel;
    return page;
  } catch {
    return url;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREENSHOT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function resolveScreenshotBaseUrl({ htmlDir, screenshotDirAbs, runId, moduleId }) {
  if (process.env.QA_SCREENSHOT_BASE_URL) {
    return String(process.env.QA_SCREENSHOT_BASE_URL).replace(/\/$/, '');
  }

  const mod = moduleId || process.env.QA_JOB_MODULE_ID;
  if (runId && mod) {
    return `/api/modules/${mod}/jobs/${runId}/screenshots`;
  }

  const rel = path.relative(htmlDir, screenshotDirAbs).replace(/\\/g, '/');
  if (rel && rel !== '.') return rel;
  return runId ? `reports/${runId}/screenshots` : 'screenshots';
}

function getScreenshotThumbsForFolder(screenshotDir, screenshotBaseUrl) {
  if (!fs.existsSync(screenshotDir)) return [];
  const files = fs.readdirSync(screenshotDir).filter(f => f.toLowerCase().endsWith('.png'));
  files.sort();
  return files.map(f => ({
    file: f,
    thumbSrc: `${screenshotBaseUrl}/${f}`,
fullSrc: `${screenshotBaseUrl}/${f}`
  }));
}

/**
 * Build a lookup: screenshot filename -> { device, page, url } from report data.
 */
function buildScreenshotMetadataMap(entries) {
  const map = {};

  for (const entry of entries) {
    const device = entry.device || 'Unknown';
    const page = entry.page || 'Unknown';
    const url = entry.url || '';

    // Final screenshot
    if (entry.finalScreenshot) {
      map[entry.finalScreenshot] = {
        device,
        page,
        url
      };
    }

    // Legacy screenshot field
    if (entry.screenshot) {
      map[entry.screenshot] = {
        device,
        page,
        url
      };
    }

    // Issue screenshots
    if (Array.isArray(entry.issues)) {
      for (const issue of entry.issues) {
        if (issue?.screenshot) {
          map[issue.screenshot] = {
            device,
            page,
            url
          };
        }
      }
    }

    // Screenshot array
    if (Array.isArray(entry.screenshots)) {
      for (const shot of entry.screenshots) {
        map[shot] = {
          device,
          page,
          url
        };
      }
    }
  }

  return map;
}

/**
 * Collect all unique screenshot filenames for a specific entry.
 */
function collectEntryScreenshots(entry) {
  const set = new Set();

  if (entry.screenshot) {
    set.add(entry.screenshot);
  }

  if (entry.finalScreenshot) {
    set.add(entry.finalScreenshot);
  }
  if (Array.isArray(entry.issues)) {
    for (const issue of entry.issues) {
      if (issue.screenshot && typeof issue.screenshot === 'string') {
        set.add(issue.screenshot);
      }
    }
  }
  return [...set];
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

module.exports = function generateReport({
  qaReportPath,
  outputHtmlPath,
  screenshotFolder,
  runId,
  moduleId
}) {
  const resolvedQaReportPath = qaReportPath || path.join('reports', 'qaReport.json');
  const resolvedScreenshotFolder = screenshotFolder || path.join('reports', 'screenshots');

  const htmlDir = path.resolve(path.dirname(outputHtmlPath || 'qa-report.html'));
  const screenshotDirAbs = path.resolve(resolvedScreenshotFolder);
  const screenshotBaseUrl = resolveScreenshotBaseUrl({
    htmlDir,
    screenshotDirAbs,
    runId,
    moduleId
  });
  // Load report data
  const report = loadJson(resolvedQaReportPath, []);
  console.log('Report entries:', report.length);
if (report.length) {
  console.log(JSON.stringify(report[0], null, 2));
}

  // ── Normalize entries (group by url+device; page label alone is not unique for multi-URL runs) ──
  const byKey = new Map();
  for (const entry of report) {
    const page = entry.page || 'Page';
    const url = entry.url || '';
    const device = entry.device || 'device';
    const key = (url || page) + '__' + device;

    if (!byKey.has(key)) {
      byKey.set(key, {
        page,
        url,
        device,
        issues: [],
        screenshots: new Set(),
        timestamp: entry.timestamp || null,
        finalScreenshot: entry.screenshot || null
      });
    }

    const bucket = byKey.get(key);

    // Merge issues (handle both object and string formats)
    if (Array.isArray(entry.issues)) {
      for (const issue of entry.issues) {
        if (typeof issue === 'object' && issue !== null) {
          // Object format from uiChecksFull.js
          bucket.issues.push(issue);
          if (issue.screenshot) bucket.screenshots.add(issue.screenshot);
        } else if (typeof issue === 'string' && issue.trim()) {
          bucket.issues.push(issue.trim());
        }
      }
    }

    if (entry.screenshot) {
      bucket.screenshots.add(entry.screenshot);
      bucket.finalScreenshot = entry.screenshot;
    }
    if (entry.timestamp) bucket.timestamp = entry.timestamp;
  }

  const entries = [...byKey.values()].map(v => ({
    page: v.page,
    url: v.url,
    device: v.device,
    timestamp: v.timestamp,
    issues: v.issues,
    screenshots: [...v.screenshots],
    finalScreenshot: v.finalScreenshot
  }));

  // ── Statistics ─────────────────────────────────────────────────────────────
  const totalPagesTested = entries.length;
  const failedPages = entries.filter(e => e.issues.length > 0).length;
  const passedPages = totalPagesTested - failedPages;

  // Collect all issues
  const allIssuesFlat = [];
  for (const e of entries) {
    for (const issue of e.issues) {
      allIssuesFlat.push({ ...((typeof issue === 'object' ? issue : {})), _entry: e });
    }
  }

  const criticalIssues = allIssuesFlat.filter(i => classifySeverity(i) === 'critical').length;
  const majorIssues = allIssuesFlat.filter(i => classifySeverity(i) === 'major').length;
  const minorIssues = allIssuesFlat.filter(i => classifySeverity(i) === 'minor').length;
  const totalIssues = allIssuesFlat.length;
console.log('Screenshot folder:', resolvedScreenshotFolder);
console.log('Folder exists:', fs.existsSync(resolvedScreenshotFolder));

if (fs.existsSync(resolvedScreenshotFolder)) {
  console.log('Files:', fs.readdirSync(resolvedScreenshotFolder));
}
  const allScreenshotFiles = getScreenshotThumbsForFolder(resolvedScreenshotFolder,screenshotBaseUrl);
  const ssMetaMap = buildScreenshotMetadataMap(entries);

  // Health score
  const healthScore = totalPagesTested > 0
    ? Math.round((passedPages / totalPagesTested) * 100)
    : 100;
  const healthStatus = healthScore >= 90
    ? '✅ Excellent'
    : healthScore >= 70
      ? '⚠️ Needs Attention'
      : '🔴 Critical';

  // Dynamic filter values
  const allUrls = [...new Set(entries.map(e => e.url).filter(Boolean))];
  const allDevices = [...new Set(entries.map(e => e.device).filter(Boolean))];

  // ── Visual QA Findings (human-visible / UX issues) ─────────────────────────
  // const visualQAFindings = [];
  // const visualKeywords = [
  //   'overflow', 'overlap', 'alignment', 'misaligned', 'spacing',
  //   'clipped', 'clipping', 'truncated', 'distorted', 'image distortion',
  //   'small buttons', 'touch target', 'layering', 'covered',
  //   'layout shift', 'contrast', 'horizontal scroll'
  // ];
  // for (const issue of allIssuesFlat) {
  //   const t = issueText(issue).toLowerCase();
  //   if (visualKeywords.some(kw => t.includes(kw))) {
  //     visualQAFindings.push(issue);
  //   }
  // }

  // ── Issue Table Rows ───────────────────────────────────────────────────────
  let issueRowsHtml = '';
  for (const e of entries) {
    for (const issue of e.issues) {
      const severity = classifySeverity(issue);
      const label = issueLabel(issue);
      const category = classifyCategory(issue);
      issueRowsHtml += `
        <tr data-device="${escapeHtml(e.device)}" data-url="${escapeHtml(e.url)}"
            data-severity="${severity}" data-search="${escapeHtml((issueText(issue) + ' ' + e.device + ' ' + e.url + ' ' + category).toLowerCase())}">
          <td>${escapeHtml(e.url)}</td>
          <td>${escapeHtml(label)}</td>
          <td><span class="badge badge-${severity}">${escapeHtml(severity.toUpperCase())}</span></td>
          <td>${escapeHtml(category)}</td>
        </tr>`;
    }
  }

  // ── Page Cards HTML ────────────────────────────────────────────────────────
  const pageCardsHtml = entries.map(e => {
    const hasIssues = e.issues.length > 0;
    const statusClass = hasIssues ? 'critical' : 'minor';
    const statusLabel = hasIssues ? 'FAIL' : 'PASS';
    const issueCount = e.issues.length;
    const entryScreenshots = e.screenshots;

    // Device-specific screenshots for this entry
    const shotThumbs = entryScreenshots
      .map(fn => allScreenshotFiles.find(s => s.file === fn) || { file: fn, thumbSrc: 'screenshots/' + fn, fullSrc: 'screenshots/' + fn });

    // Issue list HTML
    let issueListHtml = '';
    if (hasIssues) {
      const items = e.issues.slice(0, 25).map(issue => {
        const sev = classifySeverity(issue);
        const lbl = issueLabel(issue);
        return `<li class="issue-item"><span class="badge badge-${sev}" style="margin-right:6px;font-size:10px;">${escapeHtml(sev.toUpperCase())}</span>${escapeHtml(lbl)}</li>`;
      }).join('');
      const more = e.issues.length > 25
        ? `<li style="margin:4px 0;color:var(--muted);">+ ${e.issues.length - 25} more…</li>`
        : '';
      issueListHtml = `<ul class="issue-list">${items}${more}</ul>`;
    }

    // Screenshot preview HTML
    let shotPreviewHtml = '';
    if (shotThumbs.length > 0) {
      shotPreviewHtml = `<div class="thumbs">${shotThumbs.slice(0, 4).map(s => `
        <div class="thumb" onclick="openViewer('${escapeHtml(s.fullSrc)}')">
          <img src="${escapeHtml(s.thumbSrc)}" alt="${escapeHtml(s.file)}" loading="lazy" />
          <div class="t">${escapeHtml(s.file)}</div>
        </div>`).join('')}
        ${shotThumbs.length > 4 ? `<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;">+${shotThumbs.length - 4} more</div>` : ''}
      </div>`;
    } else {
      shotPreviewHtml = `<div class="empty-state" style="margin-top:8px;">📸 No screenshots available</div>`;
    }

    return `
      <div class="card pageCard" data-device="${escapeHtml(e.device)}" data-url="${escapeHtml(e.url)}"
           data-has-issues="${hasIssues}" data-search="${escapeHtml((e.page + ' ' + e.url + ' ' + e.device).toLowerCase())}">
        <div class="page-card-header">
          <div class="page-card-info">
            <div class="page-card-name">${escapeHtml(entryDisplayName(e))}</div>
            <div class="page-card-url">${escapeHtml(e.url)}</div>
            <div class="page-card-device">Device: <b>${escapeHtml(e.device)}</b></div>
           
          </div>
          <div class="page-card-status">
            <span class="badge badge-${statusClass}">${statusLabel}</span>
            <div class="page-card-count">Issues: <b>${issueCount}</b></div>
          </div>
        </div>
        <div class="page-card-issues-title">Issue List</div>
        ${hasIssues ? issueListHtml : '<div class="empty-state">✅ No issues detected.</div>'}
        <div class="page-card-shots-title">Screenshots (${shotThumbs.length})</div>
        ${shotPreviewHtml}
      </div>`;
  }).join('');

  console.log('=== Screenshot Metadata Map ===');
console.log(JSON.stringify(ssMetaMap, null, 2));

  // ── Screenshot Gallery HTML ────────────────────────────────────────────────
  // Build gallery items from all unique screenshots
  const galleryItems = allScreenshotFiles.map(s => {
    const meta = ssMetaMap[s.file] || { device: 'Unknown', page: 'Unknown', url: '' };
    return { ...s, device: meta.device, page: meta.page, url: meta.url };
  });

  const galleryHtml = galleryItems.length > 0
    ? galleryItems.map((s, idx) => `
        <div class="thumb gallery-item" data-device="${escapeHtml(s.device)}" data-page="${escapeHtml(s.page)}" data-url="${escapeHtml(s.url)}"
             onclick="openGalleryViewer(${idx})" data-index="${idx}">
          <img src="${escapeHtml(s.thumbSrc)}" alt="${escapeHtml(s.file)}" loading="lazy" />
          <div class="t">${escapeHtml(s.file)}<br><small style="color:var(--text);">${escapeHtml(s.device)} • ${escapeHtml(s.url || s.page)}</small></div>
        </div>`).join('')
    : '<div class="empty-state">No screenshots available.</div>';

  // ── Print Screenshot Appendix HTML ────────────────────────────────────────
  var printShotsHtml = '';
  if (galleryItems.length > 0) {
    printShotsHtml = galleryItems.map(function(s, idx) {
      return '<div class="print-screenshot-page">' +
        '<div class="print-shot-meta">Screenshot: ' + escapeHtml(s.file) + '</div>' +
        '<div class="print-shot-meta">Device: ' + escapeHtml(s.device) + '</div>' +
        '<div class="print-shot-meta">URL: ' + escapeHtml(s.url || s.page) + '</div>' +
        '<div class="print-shot-img-wrap">' +
          '<img src="' + escapeHtml(s.fullSrc) + '" alt="' + escapeHtml(s.file) + '" />' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── Unique filter values for priority ──────────────────────────────────────
  const hasAnyIssues = totalIssues > 0;

  // ── Timestamp ──────────────────────────────────────────────────────────────
  const now = new Date().toISOString().split('T')[0];

  // ───────────────────────────────────────────────────────────────────────────
  // HTML TEMPLATE
  // ───────────────────────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>QA Report — ${escapeHtml(now)}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" defer><\/script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" defer><\/script>
  <style>
    /* ── CSS Variables ──────────────────────────────────────────────────── */
    :root {
      --bg: #0b1224;
      --card: #111c36;
      --muted: #94a3b8;
      --text: #e5e7eb;
      --shadow: 0 10px 30px rgba(0,0,0,.35);
      --border: rgba(255,255,255,.08);
      --good: #22c55e;
      --warn: #ffa502;
      --bad: #ef4444;
      --radius: 16px;
      --gap: 16px;
    }

    /* ── Reset & Base ───────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, system-ui, -apple-system, Segoe UI, Arial, sans-serif; line-height: 1.5; }
    img { max-width: 100%; height: auto; }
    ul { margin: 8px 0 0 18px; padding: 0; }

    /* ── Layout ─────────────────────────────────────────────────────────── */
    .wrap { max-width: 1200px; margin: 0 auto; padding: 22px; }
    .topbar { position: sticky; top: 0; background: rgba(11,18,36,.88); backdrop-filter: blur(10px); z-index: 50; border-bottom: 1px solid var(--border); }
    .topbar .wrap { padding-top: 14px; padding-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
    h1 { margin: 0; font-size: 20px; letter-spacing: .2px; }
    h2 { margin: 22px 0 10px; font-size: 16px; letter-spacing: .3px; }

    .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 14px; }

    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

    /* ── Badge ──────────────────────────────────────────────────────────── */
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; letter-spacing: .2px; }
    .badge.critical, .badge-critical { background: rgba(239,68,68,.18); color: #fecaca; border: 1px solid rgba(239,68,68,.4); }
    .badge.major, .badge-major { background: rgba(255,165,2,.18); color: #fde68a; border: 1px solid rgba(255,165,2,.4); }
    .badge.minor, .badge-minor { background: rgba(34,197,94,.16); color: #bbf7d0; border: 1px solid rgba(34,197,94,.35); }

    /* ── Executive Summary ──────────────────────────────────────────────── */
    .exec-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--gap); margin-bottom: 10px; }
    .exec-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px; text-align: center; }
    .exec-card .exec-label { color: var(--muted); font-size: 13px; margin-bottom: 6px; }
    .exec-card .exec-value { font-size: 28px; font-weight: 800; }
    .exec-card .exec-status { font-size: 14px; margin-top: 8px; }
    .health-score { font-size: 48px; font-weight: 900; }
    .health-excellent { color: var(--good); }
    .health-attention { color: var(--warn); }
    .health-critical { color: var(--bad); }

    /* ── Stats Grid ─────────────────────────────────────────────────────── */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--gap); margin-top: 14px; }
    .stat .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
    .stat .v { font-size: 22px; font-weight: 800; margin-top: 6px; }

    /* ── Filter Bar ─────────────────────────────────────────────────────── */
    .filter-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 14px 0; padding: 12px 16px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
    .filter-bar select,
    .filter-bar input[type="text"] {
      background: #0f1831; color: var(--text); border: 1px solid var(--border);
      border-radius: 8px; padding: 8px 12px; font-size: 13px; outline: none;
      min-width: 140px;
    }
    .filter-bar select:focus, .filter-bar input[type="text"]:focus { border-color: rgba(99,102,241,.5); }
    .filter-bar input[type="text"] { flex: 1; min-width: 200px; }
    .btn { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: #0f1831; color: var(--text); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background .15s; }
    .btn:hover { background: rgba(99,102,241,.25); }
    .btn-primary { background: rgba(99,102,241,.3); border-color: rgba(99,102,241,.5); }
    .btn-primary:hover { background: rgba(99,102,241,.5); }
    .filter-actions { margin-left: auto; display: flex; gap: 8px; }

    /* ── Page Cards ─────────────────────────────────────────────────────── */
    .pageGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: var(--gap); margin-top: 14px; }
    .page-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .page-card-info { flex: 1; }
    .page-card-name { font-weight: 900; font-size: 15px; }
    .page-card-url { color: var(--muted); font-size: 12px; word-break: break-word; }
    .page-card-device { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .page-card-time { color: var(--muted); font-size: 11px; margin-top: 2px; }
    .page-card-status { text-align: right; flex-shrink: 0; }
    .page-card-count { color: var(--muted); font-size: 12px; margin-top: 6px; }
    .page-card-issues-title, .page-card-shots-title { margin-top: 12px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
    .issue-list { list-style: none; margin: 6px 0 0 0; padding: 0; }
    .issue-item { margin: 4px 0; font-size: 13px; display: flex; align-items: flex-start; gap: 4px; }

    /* ── Table ──────────────────────────────────────────────────────────── */
    .table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .table th, .table td { border-bottom: 1px solid var(--border); padding: 10px; text-align: left; vertical-align: top; }
    .table th { color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .3px; }
    .table td { font-size: 13px; }

    /* ── Thumbnails / Gallery ───────────────────────────────────────────── */
    .thumbs { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    .thumb { width: 160px; background: #0f1831; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; cursor: pointer; transition: transform .15s, border-color .15s; }
    .thumb:hover { transform: translateY(-2px); border-color: rgba(99,102,241,.4); }
    .thumb img { width: 100%; height: auto; display: block; }
    .thumb .t { padding: 8px 10px; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ── Empty State ────────────────────────────────────────────────────── */
    .empty-state { color: var(--muted); font-size: 14px; padding: 16px; text-align: center; }

    

    /* ── Lightbox / Viewer ──────────────────────────────────────────────── */
    .viewer { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.94); z-index: 9999; flex-direction: column; align-items: center; justify-content: center; touch-action: none; }
    .viewer.open { display: flex; }
    .viewerInner {
  position: relative;
  width: 95vw;
  height: 85vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: grab;
}
    .viewerInner img {
  display: block;
  width: auto;
  height: auto;
  max-width: none !important;
  max-height: none !important;
  object-fit: contain;
  transform-origin: center center;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: auto;
  image-rendering: auto;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,.12);
  transition: none;
}
    .viewer-close { position: absolute; top: 16px; right: 24px; font-size: 32px; color: #fff; cursor: pointer; z-index: 10000; background: rgba(0,0,0,.5); border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; }
    .viewer-nav { position: absolute; top: 50%; transform: translateY(-50%); font-size: 28px; color: #fff; cursor: pointer; background: rgba(0,0,0,.5); border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; z-index: 10000; border: none; }
    .viewer-nav.prev { left: 10px; }
    .viewer-nav.next { right: 10px; }
    .viewer-info { color: var(--muted); font-size: 13px; margin-top: 10px; text-align: center; }
    .viewer-controls { position: absolute; top: 16px; left: 24px; display: flex; gap: 8px; z-index: 10000; }

    /* ── Responsive ─────────────────────────────────────────────────────── */
    @media (max-width: 900px) {
      .pageGrid { grid-template-columns: 1fr; }
      .exec-summary { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
      .filter-actions { margin-left: 0; }
    }
    @media (max-width: 520px) {
      .wrap { padding: 12px; }
      .stats-grid { grid-template-columns: 1fr; }
    }

    /* ── Print Styles ───────────────────────────────────────────────────── */
    @media print {
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      body {
        background: #0b1224 !important;
        color: #e5e7eb !important;
      }

      .topbar {
  position: static !important;
  display: block !important;
  background: rgba(11,18,36,.88) !important;
  border-bottom: 1px solid rgba(255,255,255,.08) !important;
  width: 100% !important;
}


.topbar .wrap {
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  justify-content: flex-start !important;
  gap: 8px !important;
  padding: 16px !important;
}


.topbar h1 {
  font-size: 20px !important;
  white-space: nowrap !important;
}


.topbar .row {
  width: 100% !important;
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  gap: 8px !important;
}


.topbar .row span {
  overflow-wrap: anywhere !important;
  word-break: break-word !important;
}


.topbar .badge {
  flex-shrink: 0 !important;
}

      .wrap {
        max-width: 100% !important;
        padding: 16px !important;
      }

      .filter-bar,
      #galleryGrid,
      .viewer,
      .viewer-controls,
      .viewer-nav,
      .viewer-close,
      #galleryDeviceFilter,
      #galleryPageFilter,
      .gallery-item,
      .row select {
        display: none !important;
      }

      .pageCard {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .exec-summary {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .stats-grid {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .card table {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      img {
        max-width: 100% !important;
        max-height: 90vh !important;
        object-fit: contain !important;
      }

      .thumb {
        width: 100% !important;
        margin-bottom: 10px;
      }

      .thumb img {
        max-height: 90vh !important;
        object-fit: contain !important;
      }

      .gallery-item .t small {
        color: #e5e7eb !important;
      }

      /* Print screenshot appendix */
      .print-screenshot-page {
        display: block !important;
        break-inside: avoid;
        page-break-inside: avoid;
        page-break-after: always;
        break-after: page;
        padding: 20px 0;
        background: #0b1224 !important;
      }
      .print-screenshot-page:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      .print-shot-meta {
        font-size: 14px;
        color: #94a3b8 !important;
        padding: 4px 0;
      }
      .print-shot-img-wrap {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 16px 0;
      }
      .print-shot-img-wrap img {
        max-width: 100%;
        max-height: 80vh;
        object-fit: contain;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,.12);
      }
    }

    /* ── Print screenshot appendix (hidden on screen) ─────────────────── */
    .print-screenshot-appendix { display: none; }
    @media print {
      .print-screenshot-appendix { display: block !important; }
    }

    /* ── Scrollbar ──────────────────────────────────────────────────────── */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 4px; }
  </style>
</head>
<body>

  <!-- ══════════════════════════════════════════════════════════════════════ -->
  <!-- TOP BAR                                                              -->
  <!-- ══════════════════════════════════════════════════════════════════════ -->
  <div class="topbar">
    <div class="wrap">
      <h1>📋 QA Report</h1>
      <div class="row" style="gap:14px;">
        <span class="badge minor">Run</span>
        <span style="color:var(--muted);font-size:13px;">${escapeHtml(now)}</span>
      </div>
    </div>
  </div>

  <div class="wrap" id="reportContent">

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- EXECUTIVE SUMMARY                                                  -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <h2>QA Executive Summary</h2>
    <div class="exec-summary">
      <div class="exec-card">
        <div class="exec-label">Pages Tested</div>
        <div class="exec-value">${totalPagesTested}</div>
      </div>
      <div class="exec-card">
        <div class="exec-label">Passed</div>
        <div class="exec-value health-excellent">${passedPages}</div>
      </div>
      <div class="exec-card">
        <div class="exec-label">Failed</div>
        <div class="exec-value health-critical">${failedPages}</div>
      </div>
      <div class="exec-card">
        <div class="exec-label">Overall QA Health Score</div>
        <div class="exec-value health-score ${healthScore >= 90 ? 'health-excellent' : healthScore >= 70 ? 'health-attention' : 'health-critical'}">${healthScore}%</div>
        <div class="exec-status">${healthStatus}</div>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- STATISTICS DASHBOARD                                               -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <h2>Statistics Overview</h2>
    <div class="stats-grid">
      <div class="card stat">
        <div class="k">Total Pages</div>
        <div class="v">${totalPagesTested}</div>
      </div>
      <div class="card stat">
        <div class="k">Passed</div>
        <div class="v" style="color:var(--good);">${passedPages}</div>
      </div>
      <div class="card stat">
        <div class="k">Failed</div>
        <div class="v" style="color:var(--bad);">${failedPages}</div>
      </div>
      <div class="card stat">
        <div class="k">Total Issues</div>
        <div class="v">${totalIssues}</div>
      </div>
      <div class="card stat">
        <div class="k">Critical Issues</div>
        <div class="v" style="color:var(--bad);">${criticalIssues}</div>
      </div>
      <div class="card stat">
        <div class="k">Major Issues</div>
        <div class="v" style="color:var(--warn);">${majorIssues}</div>
      </div>
      <div class="card stat">
        <div class="k">Minor Issues</div>
        <div class="v" style="color:var(--good);">${minorIssues}</div>
      </div>
      <div class="card stat">
        <div class="k">Screenshots Captured</div>
        <div class="v">${allScreenshotFiles.length}</div>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- FILTER BAR                                                        -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <div class="filter-bar" id="filterBar">
      <select id="filterUrl" onchange="applyFilters()">
        <option value="">All URLs</option>
        ${allUrls.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('')}
      </select>
      <select id="filterDevice" onchange="applyFilters()">
        <option value="">All Devices</option>
        ${allDevices.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
      </select>
      <select id="filterPriority" onchange="applyFilters()">
        <option value="">All Priorities</option>
        <option value="critical">Critical</option>
        <option value="major">Major</option>
        <option value="minor">Minor</option>
      </select>
      <input type="text" id="searchInput" placeholder="🔍 Search Issues..." oninput="applyFilters()" />
      <div class="filter-actions">
       
        <button class="btn" onclick="window.print()">🖨️ Print Report /📥 Download PDF </button>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- PER PAGE RESULTS                                                  -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <h2>Per Page Results <span id="pageResultsCount" style="font-size:13px;color:var(--muted);font-weight:400;">(${entries.length})</span></h2>
    <div class="pageGrid" id="pageGrid">
      ${pageCardsHtml || '<div class="empty-state" style="grid-column:1/-1;">✅ No page results to display.</div>'}
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- ISSUE TABLE                                                       -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <h2>Issue Table <span id="issueTableCount" style="font-size:13px;color:var(--muted);font-weight:400;">(${totalIssues})</span></h2>
    <div class="card" style="padding:16px;overflow-x:auto;">
      ${issueRowsHtml ? `
        <table class="table" id="issueTable">
          <thead>
            <tr>
              <th style="width:20%;">Page URL</th>
              <th style="width:38%;">Issue</th>
              <th style="width:12%;">Severity</th>
              <th style="width:18%;">Category</th>
            </tr>
          </thead>
          <tbody>
            ${issueRowsHtml}
          </tbody>
        </table>
      ` : '<div class="empty-state">✅ No issues detected.</div>'}
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- VISUAL QA FINDINGS                                                -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    
   

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- SCREENSHOT GALLERY                                                -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <h2>Screenshot Gallery <span id="galleryCount" style="font-size:13px;color:var(--muted);font-weight:400;">(${galleryItems.length})</span></h2>
    <div class="row" style="margin-bottom:10px;gap:8px;">
      <select id="galleryDeviceFilter" onchange="filterGallery()" style="background:#0f1831;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px;">
        <option value="">All Devices</option>
        ${allDevices.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
      </select>
      <select id="galleryPageFilter" onchange="filterGallery()" style="background:#0f1831;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px;">
        <option value="">All Pages</option>
          ${allUrls.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('')}
      </select>
    </div>
    <div class="card" style="padding:16px;">
      <div class="thumbs" id="galleryGrid">
        ${galleryHtml}
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- SCREENSHOT APPENDIX (PRINT ONLY)                                  -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <div class="print-screenshot-appendix">
      <h2>Screenshot Appendix</h2>
      ${printShotsHtml}
    </div>

  </div>

  <!-- ══════════════════════════════════════════════════════════════════════ -->
  <!-- LIGHTBOX / VIEWER                                                   -->
  <!-- ══════════════════════════════════════════════════════════════════════ -->
  <div class="viewer" id="viewer" aria-hidden="true">
    <div class="viewer-controls">
  <button class="btn" onclick="zoomIn()">➕ Zoom In</button>
  <button class="btn" onclick="zoomOut()">➖ Zoom Out</button>
  <button class="btn" onclick="resetZoom()">🔄 Reset</button>
  <button class="btn" onclick="toggleFullscreen()">⛶ Fullscreen</button>
</div>
    <div class="viewer-close" onclick="closeViewer()" title="Close (Esc)">✕</div>
    <button class="viewer-nav prev" onclick="navigateViewer(-1)" title="Previous">‹</button>
    <button class="viewer-nav next" onclick="navigateViewer(1)" title="Next">›</button>
    <div class="viewerInner" id="viewerInner">
      <img id="viewerImg" src="" alt="screenshot" />
    </div>
    <div class="viewer-info" id="viewerInfo"></div>
  </div>

  <!-- ══════════════════════════════════════════════════════════════════════ -->
  <!-- JAVASCRIPT                                                          -->
  <!-- ══════════════════════════════════════════════════════════════════════ -->
  <script>
  (function() {
    'use strict';

    // ── Gallery Data ─────────────────────────────────────────────────────
    var galleryData = ${JSON.stringify(galleryItems.map(s => ({
      file: s.file,
      thumbSrc: s.thumbSrc,
      fullSrc: s.fullSrc,
      device: s.device,
      page: s.page,
      url: s.url
    })))};

    var currentViewerIndex = -1;
    var filteredGalleryIndices = [];

    var viewerState = {
      zoom: 1,
      baseWidth: 0,
      baseHeight: 0,
      x: 0,
      y: 0,
      dragging: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      pinchStartDist: 0,
      pinchStartZoom: 1,
      pinchCenterX: 0,
      pinchCenterY: 0,
      rafId: null
    };

    var MIN_ZOOM = 1;
    var MAX_ZOOM = 5;
    var ZOOM_STEP = 0.25;

    function layoutViewerImage() {
      var img = document.getElementById('viewerImg');
      var inner = document.getElementById('viewerInner');
      if (!img || !inner || !img.naturalWidth || !img.naturalHeight) return;

      var innerRect = inner.getBoundingClientRect();
      var maxW = Math.max(1, innerRect.width);
      var maxH = Math.max(1, innerRect.height);
      var nw = img.naturalWidth;
      var nh = img.naturalHeight;
      // Never upscale beyond native pixels at 100% zoom — prevents soft/blurry default view
      var fitScale = Math.min(1, maxW / nw, maxH / nh);
      viewerState.baseWidth = nw * fitScale;
      viewerState.baseHeight = nh * fitScale;
      updateViewerTransform();
      clampPan();
    }

    function updateViewerTransform() {
      var img = document.getElementById('viewerImg');
      if (!img) return;
      if (viewerState.baseWidth > 0 && viewerState.baseHeight > 0) {
        img.style.width = (viewerState.baseWidth * viewerState.zoom) + 'px';
        img.style.height = (viewerState.baseHeight * viewerState.zoom) + 'px';
      }
      img.style.transform =
        'translate3d(' + viewerState.x + 'px,' + viewerState.y + 'px,0)';
    }

window.zoomIn = function() {
  zoomTo(viewerState.zoom + ZOOM_STEP);
};

window.zoomOut = function() {
  zoomTo(viewerState.zoom - ZOOM_STEP);
};

window.resetZoom = function() {
  viewerState.zoom = 1;
  viewerState.x = 0;
  viewerState.y = 0;
  viewerState.lastX = 0;
  viewerState.lastY = 0;
  updateViewerTransform();
};

function clampZoom(z) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, parseFloat(z.toFixed(2))));
}

function clampPan() {
  var inner = document.getElementById('viewerInner');
  if (!inner) return;

  var scale = viewerState.zoom;
  if (scale <= 1 || viewerState.baseWidth <= 0) {
    viewerState.x = 0;
    viewerState.y = 0;
    return;
  }

  var innerRect = inner.getBoundingClientRect();
  var scaledWidth = viewerState.baseWidth * scale;
  var scaledHeight = viewerState.baseHeight * scale;

  var maxX = Math.max(0, (scaledWidth - innerRect.width) / 2);
  var maxY = Math.max(0, (scaledHeight - innerRect.height) / 2);

  viewerState.x = Math.max(-maxX, Math.min(maxX, viewerState.x));
  viewerState.y = Math.max(-maxY, Math.min(maxY, viewerState.y));
}

function zoomTo(newZoom, anchorX, anchorY) {
  var inner = document.getElementById('viewerInner');
  if (!inner) return;

  var prevZoom = viewerState.zoom;
  newZoom = clampZoom(newZoom);
  if (newZoom === prevZoom) return;

  if (newZoom <= 1) {
    viewerState.zoom = 1;
    viewerState.x = 0;
    viewerState.y = 0;
  } else if (typeof anchorX === 'number' && typeof anchorY === 'number') {
    var innerRect = inner.getBoundingClientRect();
    var cx = innerRect.left + innerRect.width / 2;
    var cy = innerRect.top + innerRect.height / 2;
    var ratio = newZoom / prevZoom;
    viewerState.x = (viewerState.x - (anchorX - cx)) * ratio + (anchorX - cx);
    viewerState.y = (viewerState.y - (anchorY - cy)) * ratio + (anchorY - cy);
    viewerState.zoom = newZoom;
    clampPan();
  } else {
    viewerState.zoom = newZoom;
    clampPan();
  }

  updateViewerTransform();
}

function scheduleUpdate() {
  if (viewerState.rafId) return;
  viewerState.rafId = requestAnimationFrame(function() {
    viewerState.rafId = null;
    updateViewerTransform();
  });
}

    // ── Initialize filtered gallery indices ──────────────────────────────
    function initGallery() {
  filteredGalleryIndices = [];

  for (var i = 0; i < galleryData.length; i++) {
    filteredGalleryIndices.push(i);
  }
}
    initGallery();

    // ── Filters ──────────────────────────────────────────────────────────
    window.applyFilters = function() {
      var urlFilter = document.getElementById('filterUrl').value;
      var deviceFilter = document.getElementById('filterDevice').value;
      var priorityFilter = document.getElementById('filterPriority').value;
      var searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();

      // Filter page cards
      var pageCards = document.querySelectorAll('#pageGrid .pageCard');
      var visibleCards = 0;
      pageCards.forEach(function(card) {
        var matchUrl = !urlFilter || card.getAttribute('data-url') === urlFilter;
        var matchDevice = !deviceFilter || card.getAttribute('data-device') === deviceFilter;

        // Priority filter: check if card has issues matching the priority
        var matchPriority = true;
        if (priorityFilter) {
          matchPriority = false;
          var issueItems = card.querySelectorAll('.issue-item .badge');
          issueItems.forEach(function(badge) {
            if (badge.textContent.trim().toLowerCase() === priorityFilter) {
              matchPriority = true;
            }
          });
          // If card has no issues but priority filter is active, hide it
          if (card.getAttribute('data-has-issues') === 'false') matchPriority = false;
        }

        // Search filter
        var matchSearch = true;
        if (searchTerm) {
          var cardSearchText = card.getAttribute('data-search') || '';
          var issueTexts = '';
          card.querySelectorAll('.issue-item').forEach(function(li) {
            issueTexts += ' ' + li.textContent.toLowerCase();
          });
          matchSearch = (cardSearchText + issueTexts).indexOf(searchTerm) !== -1;
        }

        var visible = matchUrl && matchDevice && matchPriority && matchSearch;
        card.style.display = visible ? '' : 'none';
        if (visible) visibleCards++;
      });

      document.getElementById('pageResultsCount').textContent = '(' + visibleCards + ')';

      // Filter issue table rows
      var tableRows = document.querySelectorAll('#issueTable tbody tr');
      var visibleRows = 0;
      tableRows.forEach(function(row) {
        var matchUrl = !urlFilter || row.getAttribute('data-url') === urlFilter;
        var matchDevice = !deviceFilter || row.getAttribute('data-device') === deviceFilter;
        var matchPriority = !priorityFilter || row.getAttribute('data-severity') === priorityFilter;
        var matchSearch = true;
        if (searchTerm) {
          var rowSearch = row.getAttribute('data-search') || '';
          matchSearch = rowSearch.indexOf(searchTerm) !== -1;
        }
        var visible = matchUrl && matchDevice && matchPriority && matchSearch;
        row.style.display = visible ? '' : 'none';
        if (visible) visibleRows++;
      });
      document.getElementById('issueTableCount').textContent = '(' + visibleRows + ')';

      // Filter visual QA findings table
     
    };

    // ── Gallery Filter ───────────────────────────────────────────────────
    window.filterGallery = function() {
      var device = document.getElementById('galleryDeviceFilter').value;
      var page = document.getElementById('galleryPageFilter').value;

      filteredGalleryIndices = [];
      var items = document.querySelectorAll('#galleryGrid .gallery-item');
      var count = 0;
      items.forEach(function(item, idx) {
        var matchDevice = !device || item.getAttribute('data-device') === device;
        var matchPage = !page || item.getAttribute('data-url') === page;
        var visible = matchDevice && matchPage;
        item.style.display = visible ? '' : 'none';
        if (visible) {
          filteredGalleryIndices.push(parseInt(item.getAttribute('data-index')));
          count++;
        }
      });
      document.getElementById('galleryCount').textContent = '(' + count + ')';
    };

    // ── Lightbox / Viewer ────────────────────────────────────────────────
    window.openViewer = function(src) {
      // Find index in gallery data
      var idx = -1;
      for (var i = 0; i < galleryData.length; i++) {
        if (galleryData[i].fullSrc === src || galleryData[i].thumbSrc === src) {
          idx = i;
          break;
        }
      }
      if (idx === -1) idx = 0;
      openGalleryViewer(idx);
    };

    window.openGalleryViewer = function(idx) {
      viewerState.zoom = 1;
      viewerState.baseWidth = 0;
      viewerState.baseHeight = 0;
      viewerState.x = 0;
      viewerState.y = 0;
      viewerState.lastX = 0;
      viewerState.lastY = 0;
      currentViewerIndex = idx;

      var item = galleryData[idx];
      if (!item) return;
      var viewerImg = document.getElementById('viewerImg');
      if (!viewerImg) return;
      viewerImg.style.width = '';
      viewerImg.style.height = '';
      viewerImg.style.maxWidth = 'none';
      viewerImg.style.maxHeight = 'none';
      viewerImg.style.transform = '';
      viewerImg.src = item.fullSrc;
      document.getElementById('viewerInfo').textContent =
        item.file + ' — ' + item.device + ' • ' + item.page;
      document.getElementById('viewer').classList.add('open');
      document.getElementById('viewer').setAttribute('aria-hidden', 'false');

      viewerImg.onload = function() {
        if (viewerImg.decode) {
          viewerImg.decode().then(layoutViewerImage).catch(layoutViewerImage);
        } else {
          layoutViewerImage();
        }
      };
      if (viewerImg.complete && viewerImg.naturalWidth) {
        layoutViewerImage();
      }
    };

    window.closeViewer = function() {
      document.getElementById('viewer').classList.remove('open');
      document.getElementById('viewer').setAttribute('aria-hidden', 'true');
      currentViewerIndex = -1;
    };

    window.navigateViewer = function(dir) {
      if (filteredGalleryIndices.length === 0) return;
      var currentPos = filteredGalleryIndices.indexOf(currentViewerIndex);
      if (currentPos === -1) currentPos = 0;
      var nextPos = (currentPos + dir + filteredGalleryIndices.length) % filteredGalleryIndices.length;
      openGalleryViewer(filteredGalleryIndices[nextPos]);
    };

    window.toggleFullscreen = function() {
      var viewer = document.getElementById('viewer');
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else {
        if (viewer.requestFullscreen) viewer.requestFullscreen();
        else if (viewer.webkitRequestFullscreen) viewer.webkitRequestFullscreen();
      }
    };

    // Close on backdrop click
    var viewer = document.getElementById('viewer');
    if (viewer) {
      viewer.addEventListener('click', function(e) {
        if (e.target === this || e.target.id === 'viewerInner') {
          closeViewer();
        }
      });
    }


    // ── Drag / Pan Support ─────────────────────────────
    var viewerImg = document.getElementById('viewerImg');
    var viewerInner = document.getElementById('viewerInner');

    if (viewerImg) {
      viewerImg.addEventListener('mousedown', function(e) {
        if (viewerState.zoom <= 1) return;
        viewerState.dragging = true;
        viewerState.startX = e.clientX - viewerState.x;
        viewerState.startY = e.clientY - viewerState.y;
        viewerState.lastX = e.clientX;
        viewerState.lastY = e.clientY;
        if (viewerInner) viewerInner.style.cursor = 'grabbing';
      });
    }

    document.addEventListener('mousemove', function(e) {
      if (!viewerState.dragging) return;
      viewerState.lastX = e.clientX;
      viewerState.lastY = e.clientY;
      viewerState.x = e.clientX - viewerState.startX;
      viewerState.y = e.clientY - viewerState.startY;
      clampPan();
      scheduleUpdate();
    });

    document.addEventListener('mouseup', function() {
      if (!viewerState.dragging) return;
      viewerState.dragging = false;
      if (viewerInner) viewerInner.style.cursor = 'grab';
    });

    // ── Mouse Wheel Zoom ────────────────────────────────
    if (viewerInner) {
      viewerInner.addEventListener('wheel', function(e) {
        if (!document.getElementById('viewer').classList.contains('open')) return;
        e.preventDefault();

        var rect = viewerInner.getBoundingClientRect();
        var anchorX = e.clientX - rect.left;
        var anchorY = e.clientY - rect.top;

        var dir = e.deltaY > 0 ? -1 : 1;
        var newZoom = viewerState.zoom + dir * ZOOM_STEP;
        if (dir > 0) {
          newZoom = Math.ceil((viewerState.zoom + 0.001) / ZOOM_STEP) * ZOOM_STEP + ZOOM_STEP;
        } else {
          newZoom = Math.floor((viewerState.zoom - 0.001) / ZOOM_STEP) * ZOOM_STEP - ZOOM_STEP;
        }

        zoomTo(newZoom, e.clientX, e.clientY);
      }, { passive: false });
    }

    // ── Double-Click Zoom ──────────────────────────────
    if (viewerImg) {
      viewerImg.addEventListener('dblclick', function(e) {
        if (viewerState.zoom <= 1) {
          zoomTo(2, e.clientX, e.clientY);
        } else {
          resetZoom();
        }
      });
    }

    // ── Touch / Pinch Support ──────────────────────────
    var touchCount = 0;
    if (viewerInner) {
      viewerInner.addEventListener('touchstart', function(e) {
        touchCount = e.touches.length;
        if (touchCount === 1 && viewerState.zoom > 1) {
          var t = e.touches[0];
          viewerState.dragging = true;
          viewerState.startX = t.clientX - viewerState.x;
          viewerState.startY = t.clientY - viewerState.y;
          viewerState.lastX = t.clientX;
          viewerState.lastY = t.clientY;
        } else if (touchCount === 2) {
          viewerState.dragging = false;
          var t1 = e.touches[0], t2 = e.touches[1];
          viewerState.pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          viewerState.pinchStartZoom = viewerState.zoom;
          viewerState.pinchCenterX = (t1.clientX + t2.clientX) / 2;
          viewerState.pinchCenterY = (t1.clientY + t2.clientY) / 2;
        }
      }, { passive: true });

      viewerInner.addEventListener('touchmove', function(e) {
        if (touchCount === 2 && e.touches.length === 2) {
          var t1 = e.touches[0], t2 = e.touches[1];
          var dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          var scale = dist / viewerState.pinchStartDist;
          var newZoom = clampZoom(viewerState.pinchStartZoom * scale);
          var cx = (t1.clientX + t2.clientX) / 2;
          var cy = (t1.clientY + t2.clientY) / 2;
          zoomTo(newZoom, cx, cy);
        }
      }, { passive: true });

      viewerInner.addEventListener('touchend', function() {
        if (viewerState.dragging) {
          viewerState.dragging = false;
        }
        touchCount = 0;
      }, { passive: true });
    }

    function relayoutOpenViewer() {
      if (document.getElementById('viewer').classList.contains('open')) {
        layoutViewerImage();
      }
    }

    window.addEventListener('resize', relayoutOpenViewer);
    document.addEventListener('fullscreenchange', relayoutOpenViewer);
    document.addEventListener('webkitfullscreenchange', relayoutOpenViewer);

    // ── Print handlers ─────────────────────────────────
    window.addEventListener('beforeprint', function() {
      // Force-load lazy images before printing by removing lazy attribute
      var allImgs = document.querySelectorAll('.print-shot-img-wrap img[loading="lazy"]');
      for (var pi = 0; pi < allImgs.length; pi++) {
        allImgs[pi].removeAttribute('loading');
      }
    });

    // ── Keyboard Navigation ─────────────────────────────
    document.addEventListener('keydown', function(e) {
      if (!document.getElementById('viewer').classList.contains('open')) return;
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowLeft') navigateViewer(-1);
      else if (e.key === 'ArrowRight') navigateViewer(1);
      else if (e.key.toLowerCase() === 'f') toggleFullscreen();
      else if (e.key === '+' || e.key === '=') { zoomTo(viewerState.zoom + ZOOM_STEP); }
      else if (e.key === '-') { zoomTo(viewerState.zoom - ZOOM_STEP); }
      else if (e.key === '0') { resetZoom(); }
    });

    // ── PDF Generation ──────────────────────────────────────────────────
    window.generatePDF = function() {
      var content = document.getElementById('reportContent');
      if (!content) { alert('Report content not found.'); return; }

      // Show loading indicator
      var loadingDiv = document.createElement('div');
      loadingDiv.id = 'pdfLoading';
      loadingDiv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-family:Inter,sans-serif;';
      loadingDiv.textContent = '⏳ Generating PDF, please wait...';
      document.body.appendChild(loadingDiv);

      // Check if libraries are loaded
      var checkLibs = setInterval(function() {
        if (window.html2canvas && window.jspdf) {
          clearInterval(checkLibs);
          doGeneratePDF(content, loadingDiv);
        }
      }, 200);

      // Timeout after 10s
      setTimeout(function() {
        clearInterval(checkLibs);
        var el = document.getElementById('pdfLoading');
        if (el) {
          el.remove();
          if (!window.html2canvas || !window.jspdf) {
            alert('PDF libraries failed to load. Please check your internet connection and try again.');
          }
        }
      }, 10000);
    };

    function doGeneratePDF(content, loadingDiv) {
      // Hide interactive elements for PDF
      var filterBar = document.getElementById('filterBar');
      var viewer = document.getElementById('viewer');
      if (filterBar) filterBar.style.display = 'none';
      if (viewer) viewer.style.display = 'none';

      // Temporarily adjust styles for PDF capture
      content.style.maxWidth = '1200px';
      content.style.margin = '0 auto';
      content.style.padding = '10px';
      content.style.background = '#0b1224';

      window.html2canvas(content, {
        backgroundColor: '#0b1224',
        scale: 1.5,
        useCORS: true,
        logging: false,
        windowWidth: 1200,
        scrollY: 0
      }).then(function(canvas) {
        var jsPDF = window.jspdf.jsPDF;
        var imgWidth = 190;
        var pageHeight = 277;
        var imgHeight = (canvas.height * imgWidth) / canvas.width;
        var heightLeft = imgHeight;
        var position = 10;
        var imgData = canvas.toDataURL('image/jpeg', 0.85);
        var pdf = new jsPDF('p', 'mm', 'a4');
        pdf.addImage(imgData, 'JPEG', 10, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
        while (heightLeft > 0) {
          position = heightLeft - imgHeight + 10;
          pdf.addPage();
          pdf.addImage(imgData, 'JPEG', 10, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
        }
        pdf.save('QA-Report-' + new Date().toISOString().slice(0, 10) + '.pdf');

        // Restore elements
        if (filterBar) filterBar.style.display = '';
        if (viewer) viewer.style.display = '';
        content.style.maxWidth = '';
        content.style.margin = '';
        content.style.padding = '';
        content.style.background = '';
        loadingDiv.remove();
      }).catch(function(err) {
        console.error('PDF generation failed:', err);
        if (filterBar) filterBar.style.display = '';
        if (viewer) viewer.style.display = '';
        content.style.maxWidth = '';
        content.style.margin = '';
        content.style.padding = '';
        content.style.background = '';
        loadingDiv.remove();
        alert('PDF generation failed: ' + err.message);
      });
    }

  })();
  <\/script>
</body>
</html>`;

  ensureDir(path.dirname(outputHtmlPath));
  fs.writeFileSync(outputHtmlPath, html, 'utf8');
  return outputHtmlPath;
};