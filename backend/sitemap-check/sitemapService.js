/**
 * Sitemap discovery and parsing for Sitemap Audit.
 * Walks the full tree: open sitemap → nested .xml sitemaps → collect page URLs.
 */

const FETCH_HEADERS = { 'user-agent': 'sitemap-check/1.0 (+node)' };
const MAX_SITEMAP_DEPTH = 5;
const DEFAULT_FETCH_TIMEOUT_MS = 15000;

function stripHashAndQuery(u) {
  try {
    const urlObj = new URL(u);
    urlObj.hash = '';
    urlObj.search = '';
    return urlObj.toString().replace(/\/$/, '');
  } catch {
    return String(u || '').trim();
  }
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function extractLocsFromXml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const matches = xmlText.match(/<loc>\s*([^<\s]+?)\s*<\/loc>/gi) || [];
  return matches
    .map((m) => m.replace(/<\/?loc>/gi, '').trim())
    .filter(Boolean);
}

/** True when loc is a nested sitemap (not a page to status-check). */
function isSitemapXmlUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  try {
    const path = new URL(s).pathname.toLowerCase();
    return path.endsWith('.xml');
  } catch {
    const pathOnly = s.toLowerCase().split('?')[0].split('#')[0];
    return pathOnly.endsWith('.xml');
  }
}

async function fetchTextWithTimeout(url, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: FETCH_HEADERS,
      redirect: 'follow'
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, finalUrl: res.url };
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fetch one sitemap URL and return all <loc> values (indexes and urlsets).
 */
async function extractUrlsFromSitemap(url, visited = new Set(), depth = 0) {
  if (!url) return [];
  if (visited.has(url)) return [];
  if (depth > MAX_SITEMAP_DEPTH) return [];

  visited.add(url);

  let res;
  try {
    res = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
  } catch {
    return [];
  }

  const xmlText = await res.text().catch(() => '');
  const locs = extractLocsFromXml(xmlText);
  return uniq(locs.map(stripHashAndQuery).filter(Boolean));
}

async function detectSitemapUrls(mainUrl) {
  const base = String(mainUrl || '').replace(/\/$/, '');
  const candidates = [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`];

  for (const sitemapUrl of candidates) {
    const r = await fetchTextWithTimeout(sitemapUrl, 8000).catch(() => null);
    if (r && r.ok && r.text && /<loc[\s>]/i.test(r.text)) {
      return { found: true, sitemapUrl, xmlText: r.text };
    }
  }

  return { found: false, sitemapUrl: null, xmlText: '' };
}

/**
 * Recursively walk sitemap tree:
 * - loc ending with .xml → open nested sitemap
 * - otherwise → page URL to check
 */
async function walkSitemapTree(sitemapUrl, state) {
  const {
    pageUrls,
    pageSet,
    visitedSitemaps,
    sitemapList,
    maxUrls,
    maxDepth,
    depth
  } = state;

  // Always inventory sitemap files; only page collection is capped by maxUrls.
  if (depth > maxDepth) return;

  const key = stripHashAndQuery(sitemapUrl) || String(sitemapUrl).trim();
  if (!key || visitedSitemaps.has(key)) return;
  visitedSitemaps.add(key);
  sitemapList.push(key);

  const r = await fetchTextWithTimeout(key, DEFAULT_FETCH_TIMEOUT_MS).catch(() => null);
  if (!r || !r.text) return;

  const locs = extractLocsFromXml(r.text);
  for (const raw of locs) {
    const loc = stripHashAndQuery(raw) || String(raw).trim();
    if (!loc) continue;

    if (isSitemapXmlUrl(loc)) {
      await walkSitemapTree(loc, {
        ...state,
        depth: depth + 1
      });
    } else if (pageUrls.length < maxUrls && !pageSet.has(loc)) {
      pageSet.add(loc);
      pageUrls.push(loc);
    }
  }
}

/**
 * Collect all page URLs + sitemap file inventory from the sitemap tree.
 * @returns {{ pageUrls: string[], sitemaps: string[], rootSitemapUrl: string|null, sitemapFound: boolean }}
 */
async function discoverUrlsFromSitemap(mainUrl, { maxUrls = 5000 } = {}) {
  const baseUrl = String(mainUrl || '').replace(/\/$/, '');
  const cap = Math.max(1, Math.min(Number(maxUrls) || 5000, 10000));
  const sitemap = await detectSitemapUrls(baseUrl);

  if (!sitemap?.found || !sitemap.sitemapUrl) {
    return {
      pageUrls: [baseUrl],
      sitemaps: [],
      rootSitemapUrl: null,
      sitemapFound: false
    };
  }

  const pageUrls = [];
  const pageSet = new Set();
  const visitedSitemaps = new Set();
  const sitemapList = [];

  await walkSitemapTree(sitemap.sitemapUrl, {
    pageUrls,
    pageSet,
    visitedSitemaps,
    sitemapList,
    maxUrls: cap,
    maxDepth: MAX_SITEMAP_DEPTH,
    depth: 0
  });

  return {
    pageUrls: pageUrls.length ? pageUrls : [baseUrl],
    sitemaps: sitemapList,
    rootSitemapUrl: sitemap.sitemapUrl,
    sitemapFound: true
  };
}

module.exports = {
  detectSitemapUrls,
  extractUrlsFromSitemap,
  discoverUrlsFromSitemap,
  extractLocsFromXml,
  isSitemapXmlUrl,
  stripHashAndQuery,
  walkSitemapTree
};
