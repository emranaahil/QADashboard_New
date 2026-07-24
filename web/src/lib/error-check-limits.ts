/** Link Radar crawl limits — mirrors backend/shared/errorCheckLimits.js for local dev. */

const PROD_MAX_URLS = 500;
const PROD_MAX_DEPTH = 20;
const LOCAL_MAX_URLS = 10000;
const LOCAL_MAX_DEPTH = 20;

export function isLocalBulkErrorCheckEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_QA_ERROR_CHECK_BULK === "0") return false;
  if (process.env.NEXT_PUBLIC_QA_ERROR_CHECK_BULK === "1") return true;
  return process.env.NODE_ENV === "development";
}

export function getErrorCheckLimits() {
  const bulk = isLocalBulkErrorCheckEnabled();
  return {
    bulk,
    maxUrls: bulk ? LOCAL_MAX_URLS : PROD_MAX_URLS,
    maxDepth: bulk ? LOCAL_MAX_DEPTH : PROD_MAX_DEPTH,
    defaultMaxUrls: 100,
    defaultMaxDepth: bulk ? 10 : 5,
  };
}

export function normalizeErrorCheckOptions(options?: { maxUrls?: number; maxDepth?: number }) {
  const limits = getErrorCheckLimits();
  const maxUrls = Math.min(
    Math.max(parseInt(String(options?.maxUrls ?? limits.defaultMaxUrls), 10) || limits.defaultMaxUrls, 1),
    limits.maxUrls
  );
  const maxDepth = Math.min(
    Math.max(parseInt(String(options?.maxDepth ?? limits.defaultMaxDepth), 10) || limits.defaultMaxDepth, 1),
    limits.maxDepth
  );
  return { maxUrls, maxDepth };
}