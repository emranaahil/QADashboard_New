/**
 * URL validation with SSRF protection — blocks internal/private targets.
 */

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required');
  }
  let clean = url.trim();
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
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('URL targets a blocked or internal address');
  }
  clean = parsed.toString();
  if (clean.endsWith('/') && clean.length > 8) {
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

module.exports = { normalizeUrl, isBlockedHostname };