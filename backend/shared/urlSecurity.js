/**
 * URL validation with SSRF protection — blocks internal/private targets.
 */

const MAX_URL_LENGTH = 2048;
const INVALID_URL_CHARS = /[\s<>"'`\\^{|}]/;

function validateUrlInput(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required');
  }
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('URL is required');
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new Error(`URL must be ${MAX_URL_LENGTH} characters or less`);
  }
  if (INVALID_URL_CHARS.test(trimmed)) {
    throw new Error('URL contains invalid characters');
  }
  if (/^javascript:/i.test(trimmed) || /^data:/i.test(trimmed) || /^file:/i.test(trimmed)) {
    throw new Error('Only HTTP and HTTPS URLs are allowed');
  }
  return trimmed;
}

function normalizeUrl(url) {
  const trimmed = validateUrlInput(url);
  let clean = trimmed;
  if (!/^https?:\/\//i.test(clean)) {
    clean = `https://${clean}`;
  }
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error('Invalid URL format');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL must not include username or password');
  }
  if (parsed.hostname.length > 253) {
    throw new Error('Hostname is too long');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('URL targets a blocked or internal address');
  }
  clean = parsed.toString();
  if (clean.length > MAX_URL_LENGTH) {
    throw new Error(`URL must be ${MAX_URL_LENGTH} characters or less`);
  }
  if (clean.endsWith('/') && clean.length > parsed.origin.length + 1) {
    clean = clean.slice(0, -1);
  }
  return clean;
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host === '169.254.169.254' ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }

  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;

  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }

  return false;
}

module.exports = { MAX_URL_LENGTH, normalizeUrl, validateUrlInput, isBlockedHostname };