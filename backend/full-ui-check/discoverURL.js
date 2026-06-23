const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./uichecksfull/browser');
const {
  getSameDomainKey,
  normalizeUrlForCrawl
} = require('./urlNormalizer');
const { isValidCleanPagePath, isNonPageHref, isHttpNavigableUrl } = require('./urlFilter');
const defaultCrawlConfig = require('./crawlConfig');

function getSeenPath(runFolder) {
  return path.join(runFolder, 'seenUrls.txt');
}

function appendJsonl(filePath, obj) {
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableGotoError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('net::err') ||
    msg.includes('net::') ||
    msg.includes('navigation') ||
    msg.includes('econn')
  );
}

async function gotoWithRetry(page, url, { timeoutMs, retries }) {
  let lastErr;
  const maxAttempts = Math.max(1, (retries || 0) + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryableGotoError(err)) throw err;
      await sleep(2000);
    }
  }

  throw lastErr;
}

async function boundedScroll(page, steps, stepPx) {
  if (!steps || steps <= 0) return;
  await page.evaluate(
    async ({ scrollSteps, px }) => {
      for (let i = 0; i < scrollSteps; i++) {
        window.scrollBy(0, px);
        await new Promise((r) => setTimeout(r, 200));
      }
    },
    { scrollSteps: steps, px: stepPx }
  );
}

function createCanonicalizer(seedUrl, crawlConfig, paginationTracker) {
  function canonicalize(rawUrl) {
    if (isNonPageHref(rawUrl)) return null;

    let abs;
    try {
      abs = new URL(String(rawUrl).trim(), seedUrl).toString();
      if (!isHttpNavigableUrl(abs)) return null;
    } catch {
      return null;
    }

    const normalized = normalizeUrlForCrawl(seedUrl, abs, crawlConfig);
    if (!normalized) return null;

    if (!paginationTracker.canAccept(normalized)) return null;

    try {
      const p = new URL(normalized).pathname;
      const cleanPath = p && p !== '/' ? p : '/';
      if (!isValidCleanPagePath(cleanPath)) return null;
    } catch {
      return null;
    }

    return normalized;
  }

  return { canonicalize };
}

function createPaginationTracker(maxVariantsPerPath) {
  const variantsByPath = new Map();

  return {
    canAccept(canonicalUrl) {
      let u;
      try {
        u = new URL(canonicalUrl);
      } catch {
        return false;
      }

      if (!u.search) return true;

      const pathKey = u.pathname || '/';
      const sig = u.search;
      const variants = variantsByPath.get(pathKey) || new Set();

      if (variants.has(sig)) return true;
      if (variants.size >= maxVariantsPerPath) return false;

      variants.add(sig);
      variantsByPath.set(pathKey, variants);
      return true;
    }
  };
}

function isSameDomain(seedUrl, candidateUrl) {
  const seedKey = getSameDomainKey(seedUrl);
  const candKey = getSameDomainKey(candidateUrl);
  return seedKey && candKey && seedKey === candKey;
}

async function discoverURL({
  seedUrl,
  runId,
  urlQueuePath,
  runFolder,
  crawlConfig: crawlConfigOverride = {}
}) {
  const crawlConfig = { ...defaultCrawlConfig, ...crawlConfigOverride };
  const {
    maxDepth,
    maxUrls,
    timeoutMs,
    gotoRetries,
    postGotoWaitMs,
    boundedScrollSteps,
    scrollStepPx,
    maxLinksPerPage,
    maxPagesToScan,
    logUrlListMax,
    maxPaginationVariantsPerPath
  } = crawlConfig;

  if (!seedUrl) throw new Error('seedUrl required');
  ensureDir(runFolder);

  if (fs.existsSync(urlQueuePath)) fs.unlinkSync(urlQueuePath);
  const seenPath = getSeenPath(runFolder);
  if (fs.existsSync(seenPath)) fs.unlinkSync(seenPath);

  const seenSet = new Set();
  const paginationTracker = createPaginationTracker(maxPaginationVariantsPerPath);
  const { canonicalize } = createCanonicalizer(seedUrl, crawlConfig, paginationTracker);

  function hasSeen(canonicalUrl) {
    return seenSet.has(canonicalUrl);
  }

  function markSeen(canonicalUrl) {
    if (seenSet.has(canonicalUrl)) return;
    seenSet.add(canonicalUrl);
    fs.appendFileSync(seenPath, canonicalUrl + '\n', 'utf8');
  }

  const startCanonical = canonicalize(seedUrl);
  if (!startCanonical) {
    console.log('[CRAWL] No valid seed URL — 0 pages to test');
    return { discovered: 0, urls: [] };
  }

  console.log('\n[CRAWL] Starting URL discovery');
  console.log('[CRAWL] Seed:', seedUrl);
  console.log('[CRAWL] Max depth:', maxDepth, '| Max URLs:', maxUrls);

  const trackUrlList = logUrlListMax > 0;
  const discoveredUrls = trackUrlList ? [] : null;

  const browser = await launchBrowser();

  try {
    const queue = [{ url: startCanonical, depth: 0 }];
    let discoveredCount = 0;
    let pagesScanned = 0;

    markSeen(startCanonical);
    appendJsonl(urlQueuePath, { url: startCanonical });
    discoveredCount++;
    if (trackUrlList && discoveredUrls.length < logUrlListMax) discoveredUrls.push(startCanonical);
    console.log(`[CRAWL] Found ${discoveredCount}: ${startCanonical}`);

    const scanLimit = Math.min(maxUrls, maxPagesToScan);

    while (queue.length > 0 && discoveredCount < maxUrls && pagesScanned < scanLimit) {
      const current = queue.shift();
      if (!current) continue;

      const { url: currentUrl, depth } = current;
      if (depth >= maxDepth) continue;

      pagesScanned++;
      console.log(
        `[CRAWL] Scanning page ${pagesScanned} (depth ${depth}, queue ${queue.length}, found ${discoveredCount}): ${currentUrl}`
      );

      const page = await browser.newPage();
      let newOnPage = 0;
      let linksChecked = 0;

      try {
        await gotoWithRetry(page, currentUrl, { timeoutMs, retries: gotoRetries });

        if (postGotoWaitMs > 0) {
          await page.waitForTimeout(postGotoWaitMs);
        }

        await boundedScroll(page, boundedScrollSteps, scrollStepPx);

        let hrefs = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          const out = [];
          for (const a of anchors) {
            const h = a.getAttribute('href');
            if (h) out.push(h);
          }
          return out;
        });

        linksChecked = hrefs.length;
        if (hrefs.length > maxLinksPerPage) {
          console.log(`[CRAWL] Link cap: using first ${maxLinksPerPage} of ${hrefs.length} links`);
          hrefs = hrefs.slice(0, maxLinksPerPage);
        }

        for (const href of hrefs) {
          if (discoveredCount >= maxUrls) break;
          if (isNonPageHref(href)) continue;

          const canonical = canonicalize(href);
          if (!canonical) continue;
          if (!isSameDomain(seedUrl, canonical)) continue;
          if (hasSeen(canonical)) continue;

          markSeen(canonical);
          appendJsonl(urlQueuePath, { url: canonical });
          discoveredCount++;
          if (trackUrlList && discoveredUrls.length < logUrlListMax) discoveredUrls.push(canonical);
          newOnPage++;
          console.log(`[CRAWL] Found ${discoveredCount}: ${canonical}`);

          queue.push({ url: canonical, depth: depth + 1 });
        }

        console.log(
          `[CRAWL] Page done — ${linksChecked} link(s) checked, ${newOnPage} new URL(s): ${currentUrl}`
        );
      } catch (err) {
        console.log(`[CRAWL] Page skipped — ${currentUrl} — ${err?.message || err}`);
      } finally {
        await page.close().catch(() => {});
      }
    }

    console.log(`\n[CRAWL] Discovery complete — ${discoveredCount} URL(s) found`);
    if (trackUrlList && discoveredCount > 0 && discoveredCount <= logUrlListMax) {
      console.log('[CRAWL] URL list:');
      discoveredUrls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
    } else if (discoveredCount > logUrlListMax) {
      console.log(`[CRAWL] URL list omitted (${discoveredCount} URLs — see urlQueue.jsonl)`);
    }
    console.log('');

    return {
      discovered: discoveredCount,
      urls: trackUrlList && discoveredCount <= logUrlListMax ? discoveredUrls : []
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  discoverURL
};