const NON_PAGE_HREF_SCHEMES = new Set([
  'tel', 'mailto', 'sms', 'fax', 'callto', 'javascript', 'data', 'blob',
  'geo', 'skype', 'whatsapp', 'viber', 'facetime', 'intent'
]);

const ASSET_EXTENSIONS = new Set([
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '.pdf', '.zip', '.mp4', '.mp3', '.avi', '.mov', '.mkv', '.webm',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.map', '.ico'
]);

function stripTrailingSlash(pathname) {
  if (!pathname) return '/';
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function isProbablyApiPath(pathname) {
  const p = String(pathname || '').toLowerCase();
  return p.startsWith('/api/') || p.startsWith('/v1/') || p.startsWith('/graphql');
}

function isAssetByPath(pathname) {
  const p = String(pathname || '');
  const lower = p.toLowerCase();

  for (const ext of ASSET_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }

  // Also treat common Next/React/static asset buckets as non-pages.
  if (lower.includes('/static/') || lower.includes('/assets/') || lower.includes('/images/')) {
    // Only reject when there’s also a typical filename extension.
    const hasDotExt = /\.[a-z0-9]{2,5}$/i.test(lower);
    if (hasDotExt) return true;
  }

  return false;
}

/**
 * True when href is not a navigable web page (tel:, mailto:, anchors, etc.).
 */
function isNonPageHref(rawHref) {
  const trimmed = String(rawHref || '').trim();
  if (!trimmed || trimmed === '#' || trimmed.startsWith('#')) return true;

  const lower = trimmed.toLowerCase();
  for (const scheme of NON_PAGE_HREF_SCHEMES) {
    if (lower.startsWith(`${scheme}:`)) return true;
  }

  return false;
}

/**
 * Detect phone-number paths wrongly resolved from bare numeric hrefs
 * e.g. href="4805730829" -> https://domain.com/4805730829
 */
function isPhoneNumberLikePath(pathname) {
  const seg = decodeURIComponent(stripTrailingSlash(pathname).split('/').pop() || '');
  if (!seg) return false;

  const digits = seg.replace(/\D/g, '');
  if (digits.length < 7) return false;

  const compact = seg.replace(/\s/g, '');
  if (/^\+?[\d().\-\s]+$/.test(seg) && digits.length >= 7) return true;
  if (/^\d{7,}$/.test(compact)) return true;

  return false;
}

/**
 * Detect email paths wrongly resolved from bare email hrefs
 * e.g. href="support@domain.com" -> https://domain.com/support@domain.com
 */
function isEmailLikePath(pathname) {
  const seg = decodeURIComponent(stripTrailingSlash(pathname).split('/').pop() || '');
  return /^[^\s/]+@[^\s/]+\.[^\s/]+$/.test(seg);
}

function isHttpNavigableUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isFetchOrXhrLike(urlOrPath) {
  const s = String(urlOrPath || '').toLowerCase();
  // Pattern-based exclusion: examples requested /api, /v1, /graphql.
  // Add heuristic for xhr/fetch endpoints in case they appear in hrefs.
  return (
    s.includes('/api/') ||
    s.includes('/v1/') ||
    s.includes('/graphql') ||
    s.includes('xhr') ||
    s.includes('fetch')
  );
}

function isValidCleanPagePath(normalizedPath) {
  if (!normalizedPath || !normalizedPath.startsWith('/')) return false;

  const p = stripTrailingSlash(normalizedPath);
  if (p === '') return false;

  if (isProbablyApiPath(p)) return false;
  if (isAssetByPath(p)) return false;
  if (isFetchOrXhrLike(p)) return false;
  if (isPhoneNumberLikePath(p)) return false;
  if (isEmailLikePath(p)) return false;

  // Must not be obviously a file request (extension heuristic)
  const lastSeg = p.split('/').pop() || '';
  if (lastSeg.includes('.') && !lastSeg.startsWith('.')) {
    return false;
  }

  return true;
}

module.exports = {
  isValidCleanPagePath,
  isAssetByPath,
  isNonPageHref,
  isPhoneNumberLikePath,
  isEmailLikePath,
  isHttpNavigableUrl
};

