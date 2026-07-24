const { chromium } = require('playwright');
const { validateW3cHtml } = require('./services/w3cHtmlValidator');
const { auditRobotsTxt, originFromUrl } = require('./services/robotsTxtAuditor');
const { traceRedirectPath } = require('./services/redirectPathTracer');
const { runPageSpeedCheck } = require('./services/pageSpeedCheck');
const { analyzeSslLabsHost, hostnameFromUrl: sslLabsHostname } = require('./services/sslLabsAuditor');
const {
  discoverSiteUrlsByCrawl,
  DEFAULT_MAX_URLS
} = require('../shared/services/siteUrlCrawler');
const { computePageSpeedAveragePercent } = require('../shared/services/pageSpeedInsights');

const DEFAULT_FULL_MAX_URLS = 100;
const DEFAULT_CONCURRENCY = 3;

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'site';
  }
}

function resolveJobUrls(options, startUrl) {
  if (Array.isArray(options?.urls) && options.urls.length) return options.urls;
  return [startUrl];
}

function normalizeCheckOptions(options = {}) {
  return {
    includePageSpeed: options.includePageSpeed === true,
    includeW3cValidator: options.includeW3cValidator === true,
    includeRobotsTxt: options.includeRobotsTxt === true,
    includeRedirectTrace: options.includeRedirectTrace === true,
    includeSslLabs: options.includeSslLabs === true
  };
}

function anyChecksEnabled(checks) {
  return (
    checks.includePageSpeed ||
    checks.includeW3cValidator ||
    checks.includeRobotsTxt ||
    checks.includeRedirectTrace ||
    checks.includeSslLabs
  );
}

function needsSerialConcurrency(checks) {
  return checks.includePageSpeed || checks.includeSslLabs;
}

function pageHasIssues(pageResult, domainChecks, sslLabsByHost) {
  if (pageResult.w3c?.errors > 0) return true;
  if (pageResult.redirects?.error) return true;
  if (pageResult.redirects?.truncated) return true;
  if (pageResult.pageSpeed?.mobile?.error || pageResult.pageSpeed?.desktop?.error) return true;

  if (pageResult.robotsTxtOrigin) {
    const robots = domainChecks[pageResult.robotsTxtOrigin];
    if (robots && !robots.ok) return true;
  }

  if (pageResult.sslLabsHost) {
    const ssl = sslLabsByHost[pageResult.sslLabsHost];
    if (ssl && (ssl.error || ssl.weakGrade)) return true;
  }

  return false;
}

function buildSummary(pages, domainChecks, sslLabsByHost, checks) {
  let w3cErrors = 0;
  let w3cWarnings = 0;
  let redirectIssues = 0;
  let pageSpeedScores = [];
  let robotsTxtIssues = 0;
  let sslLabsIssues = 0;

  for (const page of pages) {
    if (page.w3c) {
      w3cErrors += page.w3c.errors || 0;
      w3cWarnings += page.w3c.warnings || 0;
      if (page.w3c.error) redirectIssues += 0;
    }
    if (page.redirects?.error || page.redirects?.truncated) redirectIssues += 1;
    if (page.pageSpeed && !page.pageSpeed.skipped) {
      const avg = computePageSpeedAveragePercent(page.pageSpeed);
      if (avg > 0) pageSpeedScores.push(avg);
    }
  }

  if (checks.includeRobotsTxt) {
    for (const robots of Object.values(domainChecks)) {
      if (!robots.ok) robotsTxtIssues += 1;
    }
  }

  if (checks.includeSslLabs) {
    for (const ssl of Object.values(sslLabsByHost)) {
      if (ssl.error || ssl.weakGrade) sslLabsIssues += 1;
    }
  }

  const pagesWithIssues = pages.filter((p) => pageHasIssues(p, domainChecks, sslLabsByHost)).length;

  return {
    pagesAudited: pages.length,
    w3cErrors,
    w3cWarnings,
    redirectIssues,
    robotsTxtIssues,
    sslLabsIssues,
    sslLabsHostsChecked: Object.keys(sslLabsByHost).length,
    domainsChecked: Object.keys(domainChecks).length,
    pageSpeedAverage:
      pageSpeedScores.length
        ? Math.round(pageSpeedScores.reduce((s, n) => s + n, 0) / pageSpeedScores.length)
        : null,
    pagesWithIssues,
    checksEnabled: checks
  };
}

async function auditSinglePage(pageUrl, checks, domainChecks, robotsOriginsSeen, sslLabsByHost, runtime = {}) {
  const result = {
    url: pageUrl,
    robotsTxtOrigin: null,
    sslLabsHost: null
  };

  if (checks.includePageSpeed) {
    result.pageSpeed = await runPageSpeedCheck(pageUrl);
  }

  if (checks.includeW3cValidator) {
    result.w3c = await validateW3cHtml(pageUrl);
  }

  if (checks.includeRedirectTrace) {
    result.redirects = await traceRedirectPath(pageUrl);
  }

  if (checks.includeRobotsTxt) {
    let origin;
    try {
      origin = originFromUrl(pageUrl);
    } catch {
      origin = null;
    }
    if (origin) {
      result.robotsTxtOrigin = origin;
      if (!robotsOriginsSeen.has(origin)) {
        robotsOriginsSeen.add(origin);
        domainChecks[origin] = await auditRobotsTxt(origin);
      }
    }
  }

  if (checks.includeSslLabs) {
    try {
      result.sslLabsHost = sslLabsHostname(pageUrl);
    } catch {
      result.sslLabsHost = null;
    }
  }

  return result;
}

function uniqueHostnamesFromUrls(urls) {
  const hosts = new Set();
  for (const url of urls || []) {
    try {
      hosts.add(sslLabsHostname(url));
    } catch {
      // skip invalid
    }
  }
  return [...hosts];
}

async function runSslLabsForHosts(hosts, sslLabsByHost, options = {}) {
  const onProgress = options.onProgress;
  const shouldCancel = options.shouldCancel || (() => false);
  const total = hosts.length;

  for (let i = 0; i < hosts.length; i++) {
    if (shouldCancel()) return { cancelled: true };
    const host = hosts[i];

    const basePct = 24 + Math.floor((i / Math.max(total, 1)) * 6);

    if (onProgress) {
      await onProgress({
        progressPct: basePct,
        phase: 'ssl-labs',
        processed: i + 1,
        total,
        currentUrl: host,
        message: `SSL Labs ${i + 1} / ${total}: ${host} (checking cache first)…`
      });
    }

    const result = await analyzeSslLabsHost(host, {
      shouldCancel,
      onProgress: async (info) => {
        if (!onProgress) return;
        const elapsedBoost = info.elapsedSec != null
          ? Math.min(5, Math.floor(info.elapsedSec / 36))
          : 0;
        await onProgress({
          progressPct: Math.min(29, basePct + elapsedBoost),
          phase: 'ssl-labs',
          currentUrl: host,
          message: info.message || `SSL Labs: ${host}`
        });
      }
    });

    sslLabsByHost[host] = result;
  }

  return { cancelled: false };
}

/**
 * Run security audit — single page, URL list, or full-site crawl.
 */
async function runSecurityAudit(startUrl, options = {}) {
  const mode = options.mode || 'single';
  const checks = normalizeCheckOptions(options);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const shouldCancel = typeof options.shouldCancel === 'function' ? options.shouldCancel : () => false;
  const maxUrls = Math.min(
    Math.max(parseInt(options.maxUrls, 10) || DEFAULT_FULL_MAX_URLS, 1),
    DEFAULT_MAX_URLS
  );

  if (!anyChecksEnabled(checks)) {
    const err = new Error('At least one security check must be enabled');
    err.code = 'NO_CHECKS_ENABLED';
    throw err;
  }

  let urlsToAudit = mode === 'single' ? resolveJobUrls(options, startUrl) : [startUrl];
  let discoveryMethod = mode === 'full' ? 'crawl' : (urlsToAudit.length > 1 ? 'url-list' : 'single-url');

  const concurrency = needsSerialConcurrency(checks) ? 1 : DEFAULT_CONCURRENCY;
  const domainChecks = {};
  const sslLabsByHost = {};
  const robotsOriginsSeen = new Set();
  let browser = null;

  try {
    if (mode === 'full') {
      browser = await chromium.launch({ headless: true });
      if (onProgress) {
        await onProgress({ progressPct: 8, message: 'Crawling site to discover pages...' });
      }
      urlsToAudit = await discoverSiteUrlsByCrawl(startUrl, {
        browser,
        maxUrls,
        skipFacetedFilterUrls: true,
        onProgress: async (info) => {
          if (!onProgress) return;
          const pct = 8 + Math.min(22, Math.floor(((info.processed || 0) / Math.max(info.discovered || 1, 1)) * 22));
          await onProgress({
            progressPct: pct,
            phase: 'crawl',
            processed: info.processed,
            total: info.discovered,
            currentUrl: info.currentUrl,
            message: info.message || 'Crawling site...'
          });
        }
      });
      if (!urlsToAudit.length) urlsToAudit = [startUrl];
    }

    if (checks.includeSslLabs) {
      const hosts = uniqueHostnamesFromUrls(urlsToAudit);
      const sslResult = await runSslLabsForHosts(hosts, sslLabsByHost, {
        shouldCancel,
        onProgress
      });
      if (sslResult.cancelled) {
        return { cancelled: true, url: startUrl };
      }
    }

    const totalPages = urlsToAudit.length;
    const pages = [];
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < totalPages) {
        if (shouldCancel()) return;
        const i = nextIndex++;
        const targetUrl = urlsToAudit[i];
        const scanPct = 30 + Math.floor((i / Math.max(totalPages, 1)) * 58);

        if (onProgress) {
          await onProgress({
            progressPct: scanPct,
            phase: 'audit',
            processed: i + 1,
            total: totalPages,
            currentPage: i + 1,
            totalPages,
            currentUrl: targetUrl,
            message: `Auditing page ${i + 1} / ${totalPages}: ${targetUrl}`
          });
        }

        try {
          const pageResult = await auditSinglePage(
            targetUrl,
            checks,
            domainChecks,
            robotsOriginsSeen,
            sslLabsByHost,
            { shouldCancel }
          );
          pages.push(pageResult);
        } catch (err) {
          pages.push({
            url: targetUrl,
            error: err.message || String(err)
          });
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, totalPages) },
      () => worker()
    );
    await Promise.all(workers);

    if (shouldCancel()) {
      return { cancelled: true, url: startUrl };
    }

    const summary = buildSummary(pages, domainChecks, sslLabsByHost, checks);

    return {
      cancelled: false,
      url: startUrl,
      domain: hostnameFromUrl(startUrl),
      mode,
      discoveryMethod,
      pagesAudited: pages.length,
      auditedUrls: pages.map((p) => p.url),
      generatedAt: new Date().toISOString(),
      options: checks,
      summary,
      domainChecks,
      sslLabsByHost,
      pages
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = {
  DEFAULT_FULL_MAX_URLS,
  hostnameFromUrl,
  resolveJobUrls,
  normalizeCheckOptions,
  runSecurityAudit
};