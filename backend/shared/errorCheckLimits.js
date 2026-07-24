/**
 * Link Radar (error-check) crawl limits.
 * Production: conservative caps. Local dev: bulk crawl (up to 10k pages).
 */

const PROD_MAX_URLS = 500;
const PROD_MAX_DEPTH = 20;
const LOCAL_MAX_URLS = 10000;
const LOCAL_MAX_DEPTH = 20;

function isLocalBulkErrorCheckEnabled() {
  if (process.env.QA_ERROR_CHECK_BULK === '0') return false;
  if (process.env.QA_ERROR_CHECK_BULK === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

function getErrorCheckLimits() {
  const bulk = isLocalBulkErrorCheckEnabled();
  return {
    bulk,
    maxUrls: bulk ? LOCAL_MAX_URLS : PROD_MAX_URLS,
    maxDepth: bulk ? LOCAL_MAX_DEPTH : PROD_MAX_DEPTH,
    defaultMaxUrls: bulk ? 100 : 100,
    defaultMaxDepth: bulk ? 10 : 5,
  };
}

function normalizeErrorCheckOptions(options = {}) {
  const limits = getErrorCheckLimits();
  return {
    maxUrls: Math.min(
      Math.max(parseInt(options.maxUrls, 10) || limits.defaultMaxUrls, 1),
      limits.maxUrls
    ),
    maxDepth: Math.min(
      Math.max(parseInt(options.maxDepth, 10) || limits.defaultMaxDepth, 1),
      limits.maxDepth
    ),
    delay: Math.min(Math.max(parseInt(options.delay, 10) || 400, 100), 5000),
  };
}

module.exports = {
  PROD_MAX_URLS,
  PROD_MAX_DEPTH,
  LOCAL_MAX_URLS,
  LOCAL_MAX_DEPTH,
  isLocalBulkErrorCheckEnabled,
  getErrorCheckLimits,
  normalizeErrorCheckOptions,
};