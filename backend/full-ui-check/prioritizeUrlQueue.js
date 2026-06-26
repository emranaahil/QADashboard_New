const fs = require('fs');
const path = require('path');

const HIGH_VALUE_SEGMENTS = new Set([
  'about', 'contact', 'pricing', 'price', 'plans', 'services', 'service',
  'products', 'product', 'shop', 'store', 'catalog', 'collections',
  'blog', 'news', 'faq', 'help', 'support', 'login', 'signin', 'signup',
  'register', 'account', 'dashboard', 'home'
]);

const LOW_VALUE_PATTERNS = [
  /\/tag\//i,
  /\/tags\//i,
  /\/category\//i,
  /\/categories\//i,
  /\/author\//i,
  /\/archive\//i,
  /\/feed\/?$/i,
  /\/wp-admin/i,
  /\/wp-content/i,
  /\/cart\/?$/i,
  /\/checkout/i,
  /[?&](page|p|offset|start)=/i,
  /\/page\/\d+/i
];

function pathDepth(url) {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '') || '/';
    if (p === '/') return 0;
    return p.split('/').filter(Boolean).length;
  } catch {
    return 99;
  }
}

function isHomepage(url, seedUrl) {
  try {
    const a = new URL(url);
    const b = new URL(seedUrl);
    const ap = a.pathname.replace(/\/+$/, '') || '/';
    const bp = b.pathname.replace(/\/+$/, '') || '/';
    return a.origin === b.origin && ap === bp;
  } catch {
    return false;
  }
}

function segmentBoost(url) {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean).map(s => s.toLowerCase());
    let boost = 0;
    for (const seg of segments) {
      if (HIGH_VALUE_SEGMENTS.has(seg)) boost += 12;
    }
    return boost;
  } catch {
    return 0;
  }
}

function lowValuePenalty(url) {
  const raw = String(url);
  let penalty = 0;
  for (const pattern of LOW_VALUE_PATTERNS) {
    if (pattern.test(raw)) penalty += 25;
  }
  if (raw.includes('?')) penalty += 8;
  return penalty;
}

function scoreUrl(url, seedUrl) {
  if (isHomepage(url, seedUrl)) return 10000;

  let score = 500;
  score -= pathDepth(url) * 40;
  score += segmentBoost(url);
  score -= lowValuePenalty(url);

  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith('.html') || pathname.endsWith('.php')) score += 4;
  } catch {
    /* ignore */
  }

  return score;
}

function readQueueUrls(urlQueuePath) {
  if (!fs.existsSync(urlQueuePath)) return [];
  const urls = [];
  const seen = new Set();

  for (const line of fs.readFileSync(urlQueuePath, 'utf8').split('\n')) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj?.url && !seen.has(obj.url)) {
        seen.add(obj.url);
        urls.push(obj.url);
      }
    } catch {
      /* skip invalid */
    }
  }
  return urls;
}

/**
 * Rewrite urlQueue.jsonl so higher-value pages are tested first.
 * Safe: preserves URL set; only changes order.
 */
function prioritizeUrlQueue(urlQueuePath, seedUrl) {
  const urls = readQueueUrls(urlQueuePath);
  if (urls.length <= 1) {
    return { total: urls.length, reordered: false };
  }

  const ranked = urls
    .map((url) => ({ url, score: scoreUrl(url, seedUrl) }))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));

  const tmp = `${urlQueuePath}.prioritized.tmp`;
  const lines = ranked.map(({ url }) => JSON.stringify({ url }));
  fs.writeFileSync(tmp, `${lines.join('\n')}\n`, 'utf8');
  fs.renameSync(tmp, urlQueuePath);

  return { total: ranked.length, reordered: true };
}

module.exports = {
  scoreUrl,
  prioritizeUrlQueue
};