/**
 * Same-domain URL discovery by link crawling (Keyword Radar full-site logic).
 * Does NOT use sitemap.xml — follows internal links from the start URL.
 * Discovered URLs are included in the SEO test list; faceted filter query URLs
 * (e.g. Shopify filter.p.tag) are skipped — /collections paths and ?page= are kept.
 */

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('../../../node_modules/playwright'));
}

const {
  createCrawlScope,
  extractInternalLinksFromHrefs,
  filterOutFacetedFilterUrls
} = require('../../keyword-check/urlDiscovery');
const {
  gotoForLinkDiscovery,
  DEFAULT_DISCOVERY_NAVIGATION_TIMEOUT
} = require('../crawlNavigation');

const BATCH_SIZE = 50;
const MAX_CONCURRENT = 1;
const DEFAULT_MAX_URLS = 5000;
const DEFAULT_MAX_DEPTH = 25;
const NAVIGATION_TIMEOUT = DEFAULT_DISCOVERY_NAVIGATION_TIMEOUT;
const CRAWL_PAGE_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CrawlQueue {
  constructor() {
    this.queue = [];
    this.visited = new Set();
    this.discovered = new Set();
    this.visitOrder = [];
    this.normalizeUrl = null;
    this.maxDepth = null;
  }

  initialize(startUrl, { normalizeUrl = null, maxDepth = null } = {}) {
    this.normalizeUrl = typeof normalizeUrl === 'function' ? normalizeUrl : null;
    this.maxDepth = Number.isFinite(maxDepth) ? maxDepth : null;
    const normalizedStart = this._normalize(startUrl);
    this.queue = normalizedStart ? [{ url: normalizedStart, depth: 0 }] : [];
    this.visited = new Set();
    this.discovered = new Set();
    this.visitOrder = [];
    if (normalizedStart) this.discovered.add(normalizedStart);
  }

  _normalize(url) {
    if (!url) return null;
    return this.normalizeUrl ? this.normalizeUrl(url) : url;
  }

  addUrl(url, depth = 0) {
    const normalized = this._normalize(url);
    if (!normalized) return false;
    if (this.maxDepth != null && depth > this.maxDepth) return false;
    if (this.visited.has(normalized)) return false;
    if (this.discovered.has(normalized)) return false;
    this.discovered.add(normalized);
    this.queue.push({ url: normalized, depth });
    return true;
  }

  addUrls(urls, depth = 0) {
    let count = 0;
    for (const url of urls) {
      if (this.addUrl(url, depth)) count += 1;
    }
    return count;
  }

  getNextBatch(size = BATCH_SIZE) {
    const batch = [];
    const n = Math.min(size, this.queue.length);
    for (let i = 0; i < n; i++) {
      const item = this.queue.shift();
      if (item?.url) batch.push(item);
    }
    return batch;
  }

  markVisited(url) {
    const normalized = this._normalize(url);
    if (!normalized || this.visited.has(normalized)) return;
    this.visited.add(normalized);
    this.visitOrder.push(normalized);
  }

  isEmpty() {
    return this.queue.length === 0;
  }

  getDiscoveredCount() {
    return this.discovered.size;
  }

  /** All discovered URLs in visit order, then any not yet visited (queued). */
  getAllUrlsForTesting() {
    const seen = new Set();
    const ordered = [];

    for (const url of this.visitOrder) {
      if (!seen.has(url)) {
        seen.add(url);
        ordered.push(url);
      }
    }

    for (const url of this.discovered) {
      if (!seen.has(url)) {
        seen.add(url);
        ordered.push(url);
      }
    }

    for (const item of this.queue) {
      const normalized = this._normalize(item.url);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        ordered.push(normalized);
      }
    }

    return ordered;
  }
}

async function extractLinksFromPage(page, url, crawlScope) {
  let response = null;

  try {
    response = await gotoForLinkDiscovery(page, url, {
      navigationTimeout: NAVIGATION_TIMEOUT,
      onRetry: (targetUrl, navError, strategy) => {
        console.warn(
          `Crawl navigation retry (${strategy}) for ${targetUrl}: ${navError.message}`
        );
      }
    });
  } catch (err) {
    console.warn(`Crawl navigation exhausted retries for ${url}: ${err.message}`);
    if (page.isClosed()) {
      return { links: [], statusCode: 0, ok: false };
    }
  }

  const statusCode = response ? response.status() : 0;
  if (page.isClosed()) {
    return { links: [], statusCode, ok: false };
  }

  await page.waitForTimeout(800);

  let hrefs = [];
  try {
    hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '')
    );
  } catch {
    return { links: [], statusCode, ok: false };
  }

  const links = extractInternalLinksFromHrefs(hrefs, url, crawlScope);
  const navigated = statusCode > 0 && statusCode < 400;
  return { links, statusCode, ok: navigated || links.length > 0 };
}

async function crawlSingleUrl(browser, item, crawlScope) {
  let lastError = null;

  for (let attempt = 1; attempt <= CRAWL_PAGE_RETRIES; attempt += 1) {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; QA-Dashboard-SiteCrawler/1.0)',
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
    page.setDefaultTimeout(NAVIGATION_TIMEOUT);

    try {
      const { links, ok, statusCode } = await extractLinksFromPage(page, item.url, crawlScope);
      return { url: item.url, depth: item.depth, links, ok, statusCode };
    } catch (err) {
      lastError = err;
      console.warn(
        `Crawl attempt ${attempt}/${CRAWL_PAGE_RETRIES} failed for ${item.url}: ${err.message}`
      );
      if (attempt < CRAWL_PAGE_RETRIES) {
        await sleep(1500 * attempt);
      }
    } finally {
      await context.close().catch(() => {});
    }
  }

  console.warn(`Crawl kept URL for SEO test despite errors: ${item.url}`);
  return {
    url: item.url,
    depth: item.depth,
    links: [],
    ok: false,
    statusCode: 0,
    error: lastError?.message || 'Crawl failed after retries'
  };
}

async function processCrawlBatch(browser, batch, crawlScope, hooks = {}) {
  const { onUrlStart = null, onUrlDone = null } = hooks;
  const results = [];

  for (const item of batch) {
    if (typeof onUrlStart === 'function') {
      await onUrlStart(item);
    }

    const result = await crawlSingleUrl(browser, item, crawlScope);
    results.push(result);

    if (typeof onUrlDone === 'function') {
      await onUrlDone(item, result);
    }
  }

  return results;
}

/**
 * Crawl a site starting at startUrl; returns every discovered same-domain URL for SEO testing.
 */
async function discoverSiteUrlsByCrawl(startUrl, options = {}) {
  const {
    maxUrls = DEFAULT_MAX_URLS,
    maxDepth = DEFAULT_MAX_DEPTH,
    browser: externalBrowser = null,
    onProgress = null,
    skipFacetedFilterUrls = true
  } = options;

  const crawlScope = createCrawlScope(startUrl, { skipFacetedFilterUrls });
  const normalizedStart = crawlScope.normalizeStartUrl(startUrl) || startUrl;
  const queue = new CrawlQueue();
  queue.initialize(normalizedStart, {
    normalizeUrl: (url) => crawlScope.normalizeQueuedUrl(url),
    maxDepth
  });

  const ownsBrowser = !externalBrowser;
  const browser =
    externalBrowser ||
    (await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }));

  let processed = 0;
  let batchNumber = 0;

  const emitProgress = async (extra = {}) => {
    if (typeof onProgress !== 'function') return;
    await onProgress({
      phase: 'crawl',
      batchNumber,
      processed,
      discovered: queue.getDiscoveredCount(),
      message: `Crawling URLs (${processed} visited, ${queue.getDiscoveredCount()} discovered)...`,
      ...extra
    });
  };

  try {
    while (!queue.isEmpty() && processed < maxUrls) {
      batchNumber += 1;
      const batch = queue.getNextBatch();
      if (!batch.length) break;

      const remaining = maxUrls - processed;
      const limitedBatch = batch.slice(0, remaining);

      let results;
      try {
        results = await processCrawlBatch(browser, limitedBatch, crawlScope, {
          onUrlStart: async (item) => {
            await emitProgress({
              currentUrl: item.url,
              message: `Crawling ${processed + 1}/${queue.getDiscoveredCount()}: ${item.url}`
            });
          }
        });
      } catch (batchError) {
        console.error(`SEO crawl batch ${batchNumber} error, keeping all URLs:`, batchError.message);
        results = limitedBatch.map((item) => ({
          url: item.url,
          depth: item.depth,
          links: [],
          ok: false
        }));
      }

      for (const result of results) {
        queue.markVisited(result.url);
        processed += 1;
        if (result.links?.length) {
          queue.addUrls(result.links, (result.depth || 0) + 1);
        }
        await emitProgress({
          currentUrl: result.url,
          message: `Crawled ${processed}/${queue.getDiscoveredCount()} — ${result.url}`
        });
        if (processed >= maxUrls) break;
      }
    }

    let urls = queue.getAllUrlsForTesting();
    if (skipFacetedFilterUrls) {
      urls = filterOutFacetedFilterUrls(urls);
    }
    if (!urls.length && normalizedStart) {
      const fallback = skipFacetedFilterUrls
        ? filterOutFacetedFilterUrls([normalizedStart])
        : [normalizedStart];
      return fallback.length ? fallback : [];
    }
    return urls;
  } finally {
    if (ownsBrowser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  discoverSiteUrlsByCrawl,
  DEFAULT_MAX_URLS,
  DEFAULT_MAX_DEPTH
};