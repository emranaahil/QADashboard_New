const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const NAVIGATION_TIMEOUT = 30000;
const { moduleReportsDir } = require('../shared/storagePaths');
const REPORTS_DIR = moduleReportsDir('error-check');

function saveReport(startUrl, result) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const host = (() => {
    try { return new URL(startUrl).hostname.replace(/[^a-z0-9.-]/gi, '_'); }
    catch { return 'site'; }
  })();
  const filePath = path.join(REPORTS_DIR, `error-check-${host}-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    url: startUrl,
    generatedAt: new Date().toISOString(),
    ...result
  }, null, 2), 'utf8');
  return filePath;
}

// Simple live progress for the error checker (shared across calls)
let progress = {
  currentUrl: '',
  checked: 0,
  total: 0,
  status: 'idle',
  lastUpdated: Date.now(),
  recentUrls: [],
  currentBatch: 0,
  errorCount: 0,
  filteredCount: 0
};

function getProgress() {
  return { ...progress };
}

function resetProgress() {
  progress = {
    currentUrl: '',
    checked: 0,
    total: 0,
    status: 'idle',
    lastUpdated: Date.now(),
    recentUrls: [],
    currentBatch: 0,
    errorCount: 0,
    filteredCount: 0
  };
}

const ERROR_TEXT_PATTERNS = [
  'page not found', '404', 'not found', 'error 404',
  'sorry, this page', 'this page doesn\'t exist',
  'page cannot be found', 'the page you requested',
  'page you were looking for', 'oops! something went wrong',
  'internal server error', 'page is unavailable',
  'under construction', 'coming soon',
  'temporarily unavailable', 'content not available',
  'this content has been removed', 'access denied',
  'you do not have permission', 'login required',
  'the requested page could not be found'
];

async function checkForBrokenPages(startUrl, options = {}) {
  const maxUrls = options.maxUrls || 500;
  const delay = options.delay || 400;
  const maxDepth = options.maxDepth || 5;

  console.log(`Starting error content check for ${startUrl} (max: ${maxUrls}, delay: ${delay}ms, depth: ${maxDepth})`);

  try {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
      bypassCSP: true,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    const seen = new Set();
    const queue = [];
    const pageData = new Map();
    const brokenPages = [];
    const brokenLinks = [];
    let checked = 0;

    const baseHost = new URL(startUrl).hostname;
    const rootDomain = baseHost.split('.').slice(-2).join('.');

    resetProgress();
    progress.status = 'running';
    progress.total = maxUrls;

    function normalizeAndValidate(rawHref, currentBase) {
      try {
        const u = new URL(rawHref, currentBase);
        u.hash = '';
        let normalized = u.href;
        if (normalized.endsWith('/') && normalized.length > u.origin.length + 1) {
          normalized = normalized.slice(0, -1);
        }

        // Relaxed Domain Check: allow any subdomain of the root domain
        const isSameDomain = u.hostname === baseHost || u.hostname.endsWith('.' + rootDomain);
        if (!isSameDomain) {
          progress.filteredCount++;
          return null;
        }
        return normalized;
      } catch {
        return null;
      }
    }

    function sleep(ms) {
      return new Promise(r => setTimeout(r, ms));
    }

    const initial = normalizeAndValidate(startUrl, startUrl);
    if (initial) {
      seen.add(initial);
      queue.push({ url: initial, depth: 0 });
    }

    while (queue.length > 0 && checked < maxUrls) {
      const { url, depth } = queue.shift();

      // Update live progress immediately upon picking up a URL
      progress.currentUrl = url;
      progress.lastUpdated = Date.now();

      if (depth > maxDepth) {
        checked++; // Count as processed even if skipped due to depth
        progress.checked = checked;
        continue;
      }

      checked++;
      progress.checked = checked;

      // Track recent URLs for live display
      if (!progress.recentUrls) progress.recentUrls = [];
      progress.recentUrls.push(url);
      if (progress.recentUrls.length > 8) progress.recentUrls.shift();

      // Simple batch for display
      const BATCH_DISPLAY_SIZE = 10;
      progress.currentBatch = Math.floor(checked / BATCH_DISPLAY_SIZE) + 1;

      // For stats grid mimic
      progress.urlsDiscovered = seen.size;
      progress.urlsProcessed = checked;
      progress.errorCount = progress.errorCount || 0;

      console.log(`Processing ${checked}/${maxUrls}: ${url} (depth ${depth}) - Queue: ${queue.length}, Discovered: ${seen.size}`);

      let isBroken = false;
      let detectedErrors = [];
      let outgoing = [];
      let statusCode = 0;
      let finalUrl = url;

      try {
        // Use 'domcontentloaded' instead of 'networkidle' - more reliable for many sites
        // and less likely to timeout on JS-heavy or tracking-heavy pages
        const resp = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: NAVIGATION_TIMEOUT
        });
        statusCode = resp ? resp.status() : 0;
        finalUrl = page.url();

        // Give the page more time for client-side rendering of product grids
        await page.waitForTimeout(1500);

        const evalResult = await page.evaluate(() => {
          const text = document.body ? document.body.innerText.toLowerCase() : '';
          return { text };
        });

        const title = await page.title();
        const fullText = (title.toLowerCase() + ' ' + evalResult.text).toLowerCase();

        for (const pat of ERROR_TEXT_PATTERNS) {
          if (fullText.includes(pat)) detectedErrors.push(pat);
        }

        if (detectedErrors.length > 0) isBroken = true;

        if (statusCode >= 400) {
          detectedErrors.push('http ' + statusCode);
          isBroken = true;
        }

        // collect outgoing
        const hrefs = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).filter(Boolean)
        );

        for (let h of hrefs) {
          const norm = normalizeAndValidate(h, url);
          if (norm) {
            outgoing.push(norm);
            if (!seen.has(norm)) {
              seen.add(norm);
              queue.push({ url: norm, depth: depth + 1 });
            }
          }
        }

      } catch (e) {
        isBroken = true;
        detectedErrors.push('page failed to load');
        console.warn(`Failed to load ${url}: ${e.message}`);
      }

      pageData.set(url, {
        isBroken,
        detectedErrors: [...new Set(detectedErrors)],
        outgoingLinks: outgoing,
        statusCode,
        finalUrl
      });

      if (isBroken) {
        brokenPages.push({
          url,
          detectedErrors: [...new Set(detectedErrors)],
          statusCode,
          finalUrl
        });
        progress.errorCount = (progress.errorCount || 0) + 1;
      }

      if (queue.length > 0) await sleep(delay);
    }

    await browser.close();

    progress.status = 'done';
    progress.currentUrl = '';
    progress.lastUpdated = Date.now();

    // build broken links
    const brokenSet = new Set(brokenPages.map(p => p.url));
    const rawBrokenLinks = [];
    for (const [src, dat] of pageData.entries()) {
      for (const lnk of dat.outgoingLinks) {
        if (brokenSet.has(lnk)) rawBrokenLinks.push({ brokenUrl: lnk, foundIn: src });
      }
    }

    // dedup
    const uniqueBL = [];
    const keySet = new Set();
    rawBrokenLinks.forEach(bl => {
      const k = bl.brokenUrl + '|' + bl.foundIn;
      if (!keySet.has(k)) { keySet.add(k); uniqueBL.push(bl); }
    });

    const allChecked = Array.from(pageData.entries()).map(([u, d]) => ({
      url: u,
      isBroken: !!d.isBroken,
      detectedErrors: d.detectedErrors || [],
      statusCode: d.statusCode || 0
    }));

    const result = {
      checked,
      brokenPages: brokenPages.sort((a,b) => a.url.localeCompare(b.url)),
      brokenLinks: uniqueBL.sort((a,b) => a.foundIn.localeCompare(b.foundIn)),
      allCheckedUrls: allChecked
    };

    saveReport(startUrl, result);
    return result;

  } catch (error) {
    console.error('Error in checkForBrokenPages:', error);
    throw error;
  }
}

module.exports = { checkForBrokenPages, getProgress, resetProgress };
