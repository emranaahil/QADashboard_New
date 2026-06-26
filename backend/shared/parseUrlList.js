const { normalizeUrl } = require('./urlSecurity');

const DEFAULT_MAX_URLS = 20;

/**
 * Parse comma-separated URL input for single-page multi-URL UI checks.
 * Single URL (no comma) behaves exactly as before.
 */
function parseUrlList(input, { maxUrls = DEFAULT_MAX_URLS } = {}) {
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
  if (parts.length > maxUrls) {
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

  return {
    primaryUrl: urls[0],
    urls
  };
}

function normalizeUrlList(urls, { maxUrls = DEFAULT_MAX_URLS } = {}) {
  if (!Array.isArray(urls) || !urls.length) {
    throw new Error('At least one URL is required');
  }
  if (urls.length > maxUrls) {
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
  parseUrlList,
  normalizeUrlList
};