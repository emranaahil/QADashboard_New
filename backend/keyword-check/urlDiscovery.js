/**
 * Keyword Radar URL discovery helpers.
 * Normalizes, deduplicates, and filters same-domain visitable pages (not assets/APIs).
 */

const {
  isNonPageHref,
  isHttpNavigableUrl,
  isAssetByPath,
  isPhoneNumberLikePath,
  isEmailLikePath
} = require('../full-ui-check/urlFilter');

function isProbablyApiPath(pathname) {
  const p = String(pathname || '').toLowerCase();
  return p.startsWith('/api/') || p.startsWith('/v1/') || p.startsWith('/graphql');
}

const PAGE_EXTENSIONS = new Set(['.html', '.htm', '.php', '.aspx', '.asp', '.jsp']);

function isFetchOrXhrLike(urlOrPath) {
  const s = String(urlOrPath || '').toLowerCase();
  return (
    s.includes('/api/') ||
    s.includes('/v1/') ||
    s.includes('/graphql') ||
    s.includes('xhr') ||
    s.includes('fetch')
  );
}

function stripTrailingSlashPath(pathname) {
  if (!pathname) return '/';
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function isRootPathname(pathname) {
  const p = stripTrailingSlashPath(pathname || '/');
  return p === '/' || p === '';
}

/**
 * Non-empty hash fragment on the homepage (e.g. #abc, #/shop, #route/page).
 */
function hasMeaningfulHash(hash) {
  const frag = String(hash || '').replace(/^#/, '').trim();
  return frag.length > 0;
}

function urlHasMeaningfulHash(url) {
  try {
    return hasMeaningfulHash(new URL(url).hash);
  } catch {
    return false;
  }
}

/**
 * Hash in fragment looks like a client-side route (e.g. #test/page2, #/shop/item).
 */
function hashLooksLikeRoute(hash) {
  const frag = String(hash || '').replace(/^#/, '').trim();
  return frag.includes('/');
}

/**
 * Canonical URL used for duplicate detection and crawling.
 *
 * - test.com/#abc             → kept with hash   (homepage hash view)
 * - test.com/#test/page2      → kept with hash   (hash-route style page on root)
 * - test.com/page/#respond    → test.com/page    (same page as without hash; still checked once)
 */
function canonicalizeKeywordUrl(parsed) {
  const pathname = stripTrailingSlashPath(parsed.pathname || '/');

  if (isRootPathname(parsed.pathname)) {
    if (hasMeaningfulHash(parsed.hash)) {
      parsed.pathname = '/';
      return formatCanonicalHref(parsed);
    }
    parsed.hash = '';
    parsed.pathname = '/';
    return formatCanonicalHref(parsed);
  }

  parsed.hash = '';
  parsed.pathname = pathname;
  return formatCanonicalHref(parsed);
}

function formatCanonicalHref(parsed) {
  let href = parsed.href;
  if (!parsed.hash && href.endsWith('/') && href.length > parsed.origin.length + 1) {
    href = href.slice(0, -1);
  }
  return href;
}

function shouldSkipRawHref(rawHref) {
  const trimmed = String(rawHref || '').trim();
  if (!trimmed || trimmed === '#') return true;

  if (trimmed.startsWith('#')) {
    return false;
  }

  return isNonPageHref(trimmed);
}

/**
 * Faceted filter query strings (Shopify filter.p.* / filter.v.*, etc.) produce
 * near-duplicate collection views — not distinct SEO pages. Pagination (?page=N) is kept.
 */
function hasFacetedFilterQueryParams(searchParams) {
  if (!searchParams) return false;
  for (const key of searchParams.keys()) {
    const lower = String(key).toLowerCase();
    if (lower.startsWith('filter.')) return true;
    if (lower === 'filter' || lower === 'facet' || lower.startsWith('pf_')) return true;
    if (lower.startsWith('constraint') || lower.startsWith('narrow')) return true;
  }
  return false;
}

function isFacetedFilterQueryUrl(urlOrParsed) {
  let parsed = urlOrParsed;
  if (typeof urlOrParsed === 'string') {
    try {
      parsed = new URL(urlOrParsed);
    } catch {
      return false;
    }
  }
  if (!parsed?.search || parsed.search === '?') return false;
  return hasFacetedFilterQueryParams(parsed.searchParams);
}

function filterOutFacetedFilterUrls(urls) {
  return (urls || []).filter((url) => !isFacetedFilterQueryUrl(url));
}

/**
 * True when the path looks like a visitable HTML page for keyword QA
 * (product, content, search, etc.) — not JS/images/APIs.
 */
function isKeywordCrawlablePath(pathname) {
  const p = stripTrailingSlashPath(pathname || '/');
  if (p === '/') return true;

  if (isProbablyApiPath(p)) return false;
  if (isAssetByPath(p)) return false;
  if (isFetchOrXhrLike(p)) return false;
  if (isPhoneNumberLikePath(p)) return false;
  if (isEmailLikePath(p)) return false;

  const lastSeg = p.split('/').pop() || '';
  if (lastSeg.includes('.') && !lastSeg.startsWith('.')) {
    const lower = lastSeg.toLowerCase();
    for (const ext of PAGE_EXTENSIONS) {
      if (lower.endsWith(ext)) return true;
    }
    return false;
  }

  return true;
}

function createCrawlScope(startUrl, options = {}) {
  const skipFacetedFilterUrls = options.skipFacetedFilterUrls === true;
  const start = new URL(startUrl);
  const baseHost = start.hostname.toLowerCase();

  function isSameDomain(hostname) {
    const h = String(hostname || '').toLowerCase();
    if (h === baseHost) return true;
    if (baseHost.startsWith('www.') && h === baseHost.slice(4)) return true;
    if (!baseHost.startsWith('www.') && h === `www.${baseHost}`) return true;
    return false;
  }

  function normalizeDiscoveredUrl(rawHref, pageUrl) {
    if (shouldSkipRawHref(rawHref)) return null;

    let parsed;
    try {
      const absolute = new URL(String(rawHref).trim(), pageUrl).toString();
      if (!isHttpNavigableUrl(absolute)) return null;
      parsed = new URL(absolute);
    } catch {
      return null;
    }

    if (!isSameDomain(parsed.hostname)) return null;
    if (!isKeywordCrawlablePath(parsed.pathname)) return null;
    if (skipFacetedFilterUrls && isFacetedFilterQueryUrl(parsed)) return null;

    return canonicalizeKeywordUrl(parsed);
  }

  function normalizeQueuedUrl(url) {
    if (!url) return null;
    try {
      return normalizeDiscoveredUrl(url, startUrl);
    } catch {
      return null;
    }
  }

  function normalizeStartUrl(url) {
    return normalizeDiscoveredUrl(url, url) || normalizeDiscoveredUrl(url, startUrl);
  }

  return {
    startUrl,
    baseHost,
    isSameDomain,
    normalizeDiscoveredUrl,
    normalizeQueuedUrl,
    normalizeStartUrl,
    isKeywordCrawlablePath
  };
}

/**
 * Extract same-domain page links from anchor hrefs.
 */
function extractInternalLinksFromHrefs(rawHrefs, pageUrl, scope) {
  const links = [];
  const seen = new Set();

  for (const rawHref of rawHrefs || []) {
    const normalized = scope.normalizeDiscoveredUrl(rawHref, pageUrl);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
  }

  return links;
}

function extractLocsFromSitemapXml(xmlText) {
  return [...String(xmlText || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

/**
 * Seed crawl queue from sitemap.xml (and one level of sitemap index).
 */
async function fetchSitemapSeedUrls(startUrl, scope, { limit = 500, timeoutMs = 8000 } = {}) {
  const origin = new URL(startUrl).origin;
  const roots = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seeds = new Set();

  async function fetchXml(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/xml,text/xml,*/*' }
      });
      if (!res.ok) return null;
      const text = await res.text();
      const contentType = String(res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('xml') && !text.includes('<urlset') && !text.includes('<sitemapindex')) {
        return null;
      }
      return text;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function collectFromSitemap(sitemapUrl, depth = 0) {
    if (depth > 2 || seeds.size >= limit) return;

    const xml = await fetchXml(sitemapUrl);
    if (!xml) return;

    const locs = extractLocsFromSitemapXml(xml);
    const isIndex = xml.includes('<sitemapindex');

    if (isIndex) {
      for (const loc of locs) {
        if (seeds.size >= limit) break;
        if (/\.xml(\?.*)?$/i.test(loc)) {
          await collectFromSitemap(loc, depth + 1);
        } else {
          const normalized = scope.normalizeDiscoveredUrl(loc, startUrl);
          if (normalized) seeds.add(normalized);
        }
      }
      return;
    }

    for (const loc of locs) {
      if (seeds.size >= limit) break;
      const normalized = scope.normalizeDiscoveredUrl(loc, startUrl);
      if (normalized) seeds.add(normalized);
    }
  }

  for (const root of roots) {
    await collectFromSitemap(root, 0);
    if (seeds.size > 0) break;
  }

  return [...seeds];
}

module.exports = {
  createCrawlScope,
  extractInternalLinksFromHrefs,
  fetchSitemapSeedUrls,
  isKeywordCrawlablePath,
  canonicalizeKeywordUrl,
  hasMeaningfulHash,
  urlHasMeaningfulHash,
  hashLooksLikeRoute,
  shouldSkipRawHref,
  hasFacetedFilterQueryParams,
  isFacetedFilterQueryUrl,
  filterOutFacetedFilterUrls
};