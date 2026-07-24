const { normalizeUrl } = require('./urlSecurity');

const DEFAULT_MAX_URLS = 20;
/** Bulk URL list cap for Full Website UI Check (paste from SEO, etc.). */
const FULL_UI_CHECK_MAX_URL_LIST = 600;

/**
 * Parse comma-separated URL input for single-page multi-URL UI checks.
 * Single URL (no comma) behaves exactly as before.
 * Pass maxUrls only when a module should enforce a cap (e.g. UI Testing).
 */
function parseUrlList(input, { maxUrls } = {}) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('URL is required');
  }

  const parts = raw.includes(',')
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [raw];

  if (!parts.length) {
    throw new Error('URL is required');
  }
  if (maxUrls != null && maxUrls > 0 && parts.length > maxUrls) {
    throw new Error(`Maximum ${maxUrls} URLs allowed per run`);
  }

  const urls = [];
  const seen = new Set();

  for (const part of parts) {
    const clean = normalizeUrl(part);
    if (seen.has(clean)) continue;
    seen.add(clean);
    urls.push(clean);
  }

  if (!urls.length) {
    throw new Error('URL is required');
  }
  if (maxUrls != null && maxUrls > 0 && urls.length > maxUrls) {
    throw new Error(`Maximum ${maxUrls} URLs allowed per run`);
  }

  return {
    primaryUrl: urls[0],
    urls
  };
}

function normalizeUrlList(urls, { maxUrls } = {}) {
  if (!Array.isArray(urls) || !urls.length) {
    throw new Error('At least one URL is required');
  }
  if (maxUrls != null && maxUrls > 0 && urls.length > maxUrls) {
    throw new Error(`Maximum ${maxUrls} URLs allowed per run`);
  }

  const normalized = [];
  const seen = new Set();
  for (const entry of urls) {
    const clean = normalizeUrl(entry);
    if (seen.has(clean)) continue;
    seen.add(clean);
    normalized.push(clean);
  }

  if (!normalized.length) {
    throw new Error('At least one URL is required');
  }

  return {
    primaryUrl: normalized[0],
    urls: normalized
  };
}

module.exports = {
  DEFAULT_MAX_URLS,
  FULL_UI_CHECK_MAX_URL_LIST,
  parseUrlList,
  normalizeUrlList
};