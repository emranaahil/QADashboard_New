const { uuidv4 } = require('../shared/uuidUtils');

function urlHostSlug(url) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_').toLowerCase();
  } catch {
    return 'site';
  }
}

function buildScanFilename(url, startedAt) {
  const host = urlHostSlug(url);
  const ts = (startedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  return `${host}-${ts}`;
}

function scanTitleFromData(data, fallbackName) {
  if (data?.url) {
    try {
      return new URL(data.url).hostname;
    } catch {
      return data.url;
    }
  }
  if (data?.storageFilename) return data.storageFilename;
  return fallbackName?.replace('.json', '') || 'Keyword scan';
}

module.exports = {
  urlHostSlug,
  buildScanFilename,
  scanTitleFromData
};