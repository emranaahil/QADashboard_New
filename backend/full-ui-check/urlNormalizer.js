function normalizePathname(pathname, normalizePathCase = false) {
  let p = pathname || '/';
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (!p) p = '/';
  if (normalizePathCase) p = p.toLowerCase();
  return p;
}

function normalizeUrlToPath(url, options = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  u.hash = '';
  u.search = '';

  return normalizePathname(u.pathname, options.normalizePathCase === true);
}

function getSameDomainKey(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  return `${u.protocol}//${u.host}`;
}

function extractPaginationSearch(search, paginationQueryKeys, preservePaginationQuery) {
  if (!preservePaginationQuery || !search) return '';

  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return '';

  const params = new URLSearchParams(raw);
  const allowed = new Set(
    (paginationQueryKeys || []).map((k) => String(k).toLowerCase())
  );
  const kept = new URLSearchParams();

  for (const [key, val] of params.entries()) {
    if (allowed.has(key.toLowerCase())) {
      kept.set(key.toLowerCase(), val);
    }
  }

  if ([...kept.keys()].length === 0) return '';

  const sorted = new URLSearchParams();
  [...kept.keys()].sort().forEach((k) => sorted.set(k, kept.get(k)));
  const qs = sorted.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Crawl-specific normalizer: case-folded path, optional bounded pagination query.
 */
function normalizeUrlForCrawl(seedUrl, discoveredUrl, crawlOpts = {}) {
  const domainKey = getSameDomainKey(seedUrl);
  if (!domainKey) return null;

  const normalizePathCase = crawlOpts.normalizePathCase !== false;
  const preservePaginationQuery = crawlOpts.preservePaginationQuery !== false;
  const paginationQueryKeys = crawlOpts.paginationQueryKeys || ['page', 'p', 'offset', 'start'];

  let u;
  try {
    u = new URL(discoveredUrl);
  } catch {
    return null;
  }

  u.hostname = u.hostname.toLowerCase();
  u.hash = '';

  const pathname = normalizePathname(u.pathname, normalizePathCase);
  const search = extractPaginationSearch(u.search, paginationQueryKeys, preservePaginationQuery);

  return `${domainKey}${pathname}${search}`;
}

function normalizeFullUrlForQueue(seedUrl, discoveredUrl) {
  const domainKey = getSameDomainKey(seedUrl);
  if (!domainKey) return null;

  const path = normalizeUrlToPath(discoveredUrl);
  if (!path) return null;

  return `${domainKey}${path}`;
}

function getPaginationSuffixFromSearch(search) {
  if (!search) return '';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const key of ['page', 'p', 'offset', 'start']) {
    if (params.has(key)) {
      const val = String(params.get(key) || '').replace(/[^a-z0-9_-]/gi, '') || key;
      return `_page_${val}`;
    }
  }
  return '';
}

/**
 * Human-readable screenshot folder name (no URL-encoding).
 */
function urlToScreenshotFolderName(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let pathname = u.pathname || '/';
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    const pageSuffix = getPaginationSuffixFromSearch(u.search);

    if (!pathname || pathname === '/') {
      const base = `url-${host}`;
      return (base + pageSuffix).length > 120 ? (base + pageSuffix).slice(0, 120) : base + pageSuffix;
    }

    const pathPart = pathname
      .slice(1)
      .replace(/[<>:"|?*\\#%]/g, '-')
      .replace(/\//g, '_');

    const name = `url-${host}_${pathPart}${pageSuffix}`;
    return name.length > 120 ? name.slice(0, 120) : name;
  } catch {
    const safe = String(url)
      .replace(/^https?:\/\//i, '')
      .replace(/[<>:"|?*\\#%]/g, '-')
      .replace(/\//g, '_')
      .slice(0, 120);
    return `url-${safe || 'unknown'}`;
  }
}

module.exports = {
  normalizeUrlToPath,
  normalizePathname,
  getSameDomainKey,
  normalizeFullUrlForQueue,
  normalizeUrlForCrawl,
  extractPaginationSearch,
  urlToScreenshotFolderName
};