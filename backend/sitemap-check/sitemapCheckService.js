const { detectSitemapUrls, discoverUrlsFromSitemap } = require('./sitemapService');

const DEFAULT_MAX_URLS = 500;
const CHECK_DELAY_MS = 400;
const STATUS_TIMEOUT_MS = 15000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRedirectLocation(baseUrl, location) {
  if (!location) return null;
  try {
    return new URL(location, baseUrl).href;
  } catch {
    return location;
  }
}

/**
 * Check a single page URL like a browser:
 * follow redirects, then Pass only if the final status is 200.
 */
async function checkUrlStatus(url) {
  const headers = {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  let redirectStatus = null;
  let redirectLocation = null;

  try {
    const hopCtrl = new AbortController();
    const hopTimer = setTimeout(() => hopCtrl.abort(), STATUS_TIMEOUT_MS);
    try {
      const hop = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: hopCtrl.signal,
        headers
      });
      if (hop.status >= 300 && hop.status < 400) {
        redirectStatus = hop.status;
        redirectLocation = resolveRedirectLocation(url, hop.headers.get('location') || '');
      }
    } finally {
      clearTimeout(hopTimer);
    }
  } catch {
    // final fetch decides Pass/Fail
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STATUS_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers
    });

    const statusCode = res.status || 0;
    const finalUrl = res.url || url;
    const pass = statusCode === 200;
    const issues = pass ? [] : [`HTTP ${statusCode || 0}`];

    return {
      url,
      statusCode,
      redirectStatus,
      redirectLocation,
      finalUrl,
      issues,
      primaryIssue: pass ? 'Pass' : 'Fail',
      hasIssue: !pass,
      result: pass ? 'pass' : 'fail',
      matchedPatterns: []
    };
  } catch {
    return {
      url,
      statusCode: 0,
      redirectStatus,
      redirectLocation,
      finalUrl: redirectLocation || url,
      issues: ['Page failed to load'],
      primaryIssue: 'Fail',
      hasIssue: true,
      result: 'fail',
      matchedPatterns: []
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover sitemap tree + page URLs, then status-check each page.
 */
async function runSitemapCheck(startUrl, options = {}) {
  const maxUrls = Math.min(Math.max(parseInt(options.maxUrls, 10) || DEFAULT_MAX_URLS, 1), 500);
  const delayMs = Math.min(Math.max(parseInt(options.delayMs, 10) || CHECK_DELAY_MS, 100), 5000);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const shouldCancel = typeof options.shouldCancel === 'function' ? options.shouldCancel : () => false;

  const baseUrl = String(startUrl || '').replace(/\/$/, '');
  const sitemapMeta = await detectSitemapUrls(baseUrl);

  let pageUrls = [];
  let sitemaps = [];
  let rootSitemapUrl = sitemapMeta?.sitemapUrl || null;
  let sitemapFound = Boolean(sitemapMeta?.found);

  if (sitemapFound) {
    const discovery = await discoverUrlsFromSitemap(baseUrl, { maxUrls });
    pageUrls = discovery.pageUrls || [];
    sitemaps = discovery.sitemaps || [];
    rootSitemapUrl = discovery.rootSitemapUrl || rootSitemapUrl;
    sitemapFound = discovery.sitemapFound !== false;
  } else {
    pageUrls = [baseUrl];
    sitemaps = [];
  }

  const urlsToCheck = pageUrls.slice(0, maxUrls);
  const total = urlsToCheck.length;
  const checkedUrls = [];
  let issueCount = 0;

  const buildSummary = () => ({
    totalSitemapFiles: sitemaps.length,
    nestedSitemapFiles: Math.max(0, sitemaps.length - (rootSitemapUrl ? 1 : 0)),
    totalDiscovered: pageUrls.length,
    totalChecked: checkedUrls.length,
    issueCount,
    okCount: checkedUrls.filter((r) => !r.hasIssue).length,
    failCount: issueCount
  });

  for (let i = 0; i < urlsToCheck.length; i++) {
    if (shouldCancel()) {
      return {
        cancelled: true,
        url: startUrl,
        sitemapUrl: rootSitemapUrl,
        sitemapFound,
        sitemaps,
        generatedAt: new Date().toISOString(),
        summary: buildSummary(),
        urls: checkedUrls
      };
    }

    const targetUrl = urlsToCheck[i];
    const result = await checkUrlStatus(targetUrl);
    checkedUrls.push(result);
    if (result.hasIssue) issueCount++;

    const processed = i + 1;
    const progressPct = total
      ? Math.min(95, 10 + Math.floor((processed / total) * 85))
      : 10;

    if (onProgress) {
      await onProgress({
        processed,
        total,
        currentUrl: targetUrl,
        issueCount,
        progressPct,
        message: `Checking URL ${processed} / ${total}`
      });
    }

    if (i < urlsToCheck.length - 1) {
      await sleep(delayMs);
      if (shouldCancel()) break;
    }
  }

  return {
    cancelled: false,
    url: startUrl,
    sitemapUrl: rootSitemapUrl,
    sitemapFound,
    sitemaps,
    generatedAt: new Date().toISOString(),
    summary: buildSummary(),
    urls: checkedUrls
  };
}

module.exports = {
  DEFAULT_MAX_URLS,
  CHECK_DELAY_MS,
  checkUrlStatus,
  runSitemapCheck
};
