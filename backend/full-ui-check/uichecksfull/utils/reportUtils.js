const fs = require('fs');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  ensureDir(require('path').dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizeIssues(issues) {
  if (!Array.isArray(issues)) return [];
  const out = [];
  for (const i of issues) {
    if (typeof i === 'string' && i.trim()) out.push(i.trim());
  }
  return [...new Set(out)];
}

function classifyIssue(issueStr) {
  const s = String(issueStr ?? '').toLowerCase();

  const type = (() => {
    if (s.includes('broken image') || s.includes('broken images')) return 'Broken Images';
    if (s.includes('blank page')) return 'Blank Page';
    if (s.includes('failed request') || s.includes('console error') || s.includes('js error') || s.includes('javascript error')) return 'Runtime Errors';
    if (s.includes('overflow')) return 'Overflow';
    if (s.includes('overlap') || s.includes('possible overlaps')) return 'Overlap';
    if (s.includes('alignment')) return 'Alignment';
    if (s.includes('text clipping') || s.includes('clipped text')) return 'Text Clipping';
    if (s.includes('navbar')) return 'Navbar';
    if (s.includes('hero')) return 'Hero';
    if (s.includes('card issues') || s.includes('card')) return 'Card';
    if (s.includes('distorted') || s.includes('image distortion')) return 'Image Distortion';
    if (s.includes('small buttons')) return 'Button Size';
    if (s.includes('layering issues')) return 'Layering';
    if (s.includes('popup')) return 'Popup';
    if (s.includes('modal')) return 'Modal';
    if (s.includes('faq')) return 'FAQ';
    if (s.includes('cta not visible')) return 'CTA';
    if (s.includes('missing headings') || s.includes('missing paragraphs')) return 'Content Comparison';
    if (s.includes('layout shifts')) return 'Layout Shift';
    if (s.includes('offscreen')) return 'Offscreen';
    if (s.includes('spacing') || s.includes('spacing inconsistencies')) return 'Spacing';
    if (s.includes('touch target')) return 'Touch Target';
    if (s.includes('distorted images')) return 'Image Distortion';
    if (s.includes('console') || s.includes('error')) return 'Runtime Errors';
    return 'UI Issue';
  })();

  const severity = (() => {
    if (s.includes('broken') || s.includes('blank page')) return 'critical';
    if (s.includes('overflow') || s.includes('overlap') || s.includes('alignment')) return 'major';
    return 'minor';
  })();

  return { type, severity };
}

function calculateSummary(items) {
  const pages = Array.isArray(items) ? items : [];
  const totalPages = pages.length;
  let passedPages = 0;
  let failedPages = 0;
  let totalIssues = 0;
  let criticalIssues = 0;
  let warningIssues = 0;

  for (const p of pages) {
    const issues = normalizeIssues(p.issues);
    const hasIssues = issues.length > 0;
    if (hasIssues) failedPages++; else passedPages++;
    totalIssues += issues.length;

    for (const i of issues) {
      const { severity } = classifyIssue(i);
      if (severity === 'critical') criticalIssues++;
      else if (severity === 'major') warningIssues++;
    }
  }

  return {
    totalPages,
    passedPages,
    failedPages,
    totalIssues,
    criticalIssues,
    warningIssues,
    executedAt: new Date().toISOString()
  };
}

function groupIssuesByPage(results) {
  return Array.isArray(results)
    ? results.map(r => ({
        page: r.page || 'Page',
        device: r.device || 'Device',
        url: r.url || r.pageUrl || null,
        issues: normalizeIssues(r.issues)
      }))
    : [];
}

module.exports = {
  ensureDir,
  loadJson,
  saveJson,
  normalizeIssues,
  classifyIssue,
  calculateSummary,
  groupIssuesByPage
};

