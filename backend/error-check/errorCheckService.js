const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { renderLogHtml } = require('../shared/logViewUtils');

const NAVIGATION_TIMEOUT = 30000;
const RATE_LIMIT_STATUSES = new Set([429, 503]);
const RATE_LIMIT_RETRY_DELAYS_MS = [4000, 8000, 16000];
const RATE_LIMIT_MAX_RETRIES = 3;

function isCloudflareChallengeUrl(url) {
  return String(url || '').includes('__cf_chl');
}

function isRateLimitStatus(statusCode) {
  return RATE_LIMIT_STATUSES.has(statusCode);
}

async function gotoWithRateLimitRetry(page, url, sleepFn) {
  let lastStatus = 0;
  let lastFinalUrl = url;
  let lastError = null;

  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    try {
      const resp = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT
      });
      lastStatus = resp ? resp.status() : 0;
      lastFinalUrl = page.url();

      const challenged = isCloudflareChallengeUrl(lastFinalUrl);
      const rateLimited = isRateLimitStatus(lastStatus) || challenged;

      if (rateLimited && attempt < RATE_LIMIT_MAX_RETRIES) {
        const waitMs = RATE_LIMIT_RETRY_DELAYS_MS[attempt] || 16000;
        console.warn(
          `Rate limited (${lastStatus || 'challenge'}) for ${url} — retry ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES} in ${waitMs}ms`
        );
        await sleepFn(waitMs);
        continue;
      }

      return {
        ok: true,
        statusCode: lastStatus,
        finalUrl: lastFinalUrl,
        rateLimited: rateLimited && attempt >= RATE_LIMIT_MAX_RETRIES,
        challenged
      };
    } catch (err) {
      lastError = err;
      if (attempt < RATE_LIMIT_MAX_RETRIES) {
        const waitMs = RATE_LIMIT_RETRY_DELAYS_MS[attempt] || 8000;
        await sleepFn(waitMs);
        continue;
      }
      return {
        ok: false,
        statusCode: lastStatus,
        finalUrl: lastFinalUrl,
        rateLimited: false,
        challenged: isCloudflareChallengeUrl(lastFinalUrl),
        error: err
      };
    }
  }

  return {
    ok: false,
    statusCode: lastStatus,
    finalUrl: lastFinalUrl,
    rateLimited: isRateLimitStatus(lastStatus) || isCloudflareChallengeUrl(lastFinalUrl),
    challenged: isCloudflareChallengeUrl(lastFinalUrl),
    error: lastError
  };
}
const { moduleReportsDir } = require('../shared/storagePaths');
const { normalizeErrorCheckOptions } = require('../shared/errorCheckLimits');
const ephemeralLiveReports = require('../shared/ephemeralLiveReports');
const REPORTS_DIR = moduleReportsDir('error-check');

function saveReport(startUrl, result, sessionId = null) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const host = (() => {
    try { return new URL(startUrl).hostname.replace(/[^a-z0-9.-]/gi, '_'); }
    catch { return 'site'; }
  })();
  const filePath = path.join(REPORTS_DIR, `error-check-${host}-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    url: startUrl,
    sessionId: sessionId || null,
    generatedAt: new Date().toISOString(),
    ...result
  }, null, 2), 'utf8');
  ephemeralLiveReports.registerErrorCheckReport(filePath);
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

let lastRun = {
  id: null,
  url: null,
  status: 'idle',
  error: null,
  logs: [],
  startedAt: null,
  completedAt: null
};

let cancelRequested = false;
let activeRunPromise = null;
let activeBrowser = null;

const MAX_LAST_RUN_LOG_ENTRIES = 250;

function appendLastRunLog(message) {
  if (!Array.isArray(lastRun.logs)) lastRun.logs = [];
  lastRun.logs.push({ at: new Date().toISOString(), message });
  if (lastRun.logs.length > MAX_LAST_RUN_LOG_ENTRIES) {
    lastRun.logs = lastRun.logs.slice(-MAX_LAST_RUN_LOG_ENTRIES);
  }
}

function beginLastRun(startUrl, sessionId = null) {
  cancelRequested = false;
  lastRun = {
    id: new Date().toISOString(),
    sessionId: sessionId || null,
    url: startUrl,
    status: 'running',
    error: null,
    logs: [],
    startedAt: new Date().toISOString(),
    completedAt: null
  };
  appendLastRunLog(`Starting error content check for ${startUrl}`);
}

function failLastRun(error) {
  lastRun.status = 'failed';
  lastRun.error = error.message || String(error);
  lastRun.completedAt = new Date().toISOString();
  appendLastRunLog(`[ERROR] ${lastRun.error}`);
  if (error.stack) appendLastRunLog(error.stack);
}

function completeLastRun(summary) {
  lastRun.status = 'completed';
  lastRun.completedAt = new Date().toISOString();
  appendLastRunLog(summary);
}

function getLastRun() {
  return { ...lastRun, logs: [...(lastRun.logs || [])] };
}

function renderLastRunLogsHtml() {
  if (!lastRun.id && lastRun.status === 'idle') return null;

  const lines = [];
  if (lastRun.error) lines.push(`[ERROR] ${lastRun.error}`);
  for (const entry of lastRun.logs || []) {
    const stamp = entry.at ? `[${entry.at}] ` : '';
    lines.push(`${stamp}${entry.message}`);
  }

  if (progress.recentUrls?.length) {
    lines.push('[RECENT URLS]');
    for (const url of progress.recentUrls) lines.push(`  ${url}`);
  }

  const isRunning = lastRun.status === 'running';
  return renderLogHtml({
    title: 'Error Check Logs',
    subtitle: lastRun.url || '',
    meta: {
      Status: lastRun.status,
      'Started At': lastRun.startedAt,
      'Completed At': lastRun.completedAt
    },
    lines,
    autoRefreshSec: isRunning ? 5 : 0
  });
}

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

function beginProgress(maxUrls) {
  resetProgress();
  progress.status = 'running';
  progress.total = maxUrls;
  progress.lastUpdated = Date.now();
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

async function checkForBrokenPages(startUrl, options = {}, runOpts = {}) {
  const normalized = normalizeErrorCheckOptions(options);
  const maxUrls = normalized.maxUrls;
  const delay = normalized.delay;
  const maxDepth = normalized.maxDepth;

  if (!runOpts.skipBegin) beginLastRun(startUrl);
  if (!runOpts.skipProgressInit) beginProgress(maxUrls);
  appendLastRunLog(`Options: maxUrls=${maxUrls}, delay=${delay}ms, maxDepth=${maxDepth}`);
  appendLastRunLog(`Starting error content check for ${startUrl}`);
  console.log(`Starting error content check for ${startUrl} (max: ${maxUrls}, delay: ${delay}ms, depth: ${maxDepth})`);

  try {
    appendLastRunLog('Launching browser…');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    activeBrowser = browser;
    appendLastRunLog('Browser ready — crawling pages for broken links/content');

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
    const rateLimitedPages = [];
    let checked = 0;

    const baseHost = new URL(startUrl).hostname;
    const rootDomain = baseHost.split('.').slice(-2).join('.');

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

    async function sleep(ms) {
      const chunk = 150;
      let elapsed = 0;
      while (elapsed < ms) {
        if (cancelRequested) return;
        const wait = Math.min(chunk, ms - elapsed);
        await new Promise((r) => setTimeout(r, wait));
        elapsed += wait;
      }
    }

    const initial = normalizeAndValidate(startUrl, startUrl);
    if (initial) {
      seen.add(initial);
      queue.push({ url: initial, depth: 0 });
    }

    while (queue.length > 0 && checked < maxUrls && !cancelRequested) {

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

      const progressMsg = `Processing ${checked}/${maxUrls}: ${url} (depth ${depth}) — queue ${queue.length}, discovered ${seen.size}`;
      console.log(progressMsg);
      // Log every page for the first few, then every 5th, so View Log stays useful while running
      if (checked <= 5 || checked % 5 === 0 || checked === maxUrls) {
        appendLastRunLog(progressMsg);
      }

      let isBroken = false;
      let detectedErrors = [];
      let outgoing = [];
      let statusCode = 0;
      let finalUrl = url;

      try {
        const nav = await gotoWithRateLimitRetry(page, url, sleep);
        statusCode = nav.statusCode || 0;
        finalUrl = nav.finalUrl || url;

        if (nav.rateLimited) {
          rateLimitedPages.push({
            url,
            statusCode,
            finalUrl,
            note: 'Rate limited by server (HTTP 429/503 or Cloudflare) — page not marked broken'
          });
          pageData.set(url, {
            isBroken: false,
            detectedErrors: ['rate limited (skipped)'],
            outgoingLinks: [],
            statusCode,
            finalUrl,
            rateLimited: true
          });
          if (queue.length > 0) {
            await sleep(Math.max(delay, 800));
          }
          continue;
        }

        if (!nav.ok) {
          isBroken = true;
          detectedErrors.push('page failed to load');
          console.warn(`Failed to load ${url}: ${nav.error?.message || 'navigation failed'}`);
        } else {
          await sleep(1500);
          if (cancelRequested) break;

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

          if (statusCode >= 400 && !isRateLimitStatus(statusCode)) {
            detectedErrors.push('http ' + statusCode);
            isBroken = true;
          }

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
        }
      } catch (e) {
        if (cancelRequested) break;
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
        const errs = [...new Set(detectedErrors)];
        brokenPages.push({
          url,
          detectedErrors: errs,
          statusCode,
          finalUrl
        });
        progress.errorCount = (progress.errorCount || 0) + 1;
        appendLastRunLog(
          `Broken page: ${url} (HTTP ${statusCode || '—'}) — ${errs.join(', ') || 'error'}`
        );
      }

      if (queue.length > 0) {
        await sleep(delay);
        if (cancelRequested) break;
      }
    }

    if (cancelRequested) {
      progress.status = 'cancelled';
      lastRun.status = 'cancelled';
      lastRun.completedAt = new Date().toISOString();
      appendLastRunLog('Check cancelled by user');
      await browser.close().catch(() => {});
      activeBrowser = null;
      resetProgress();
      return {
        checked,
        cancelled: true,
        brokenPages: brokenPages.sort((a, b) => a.url.localeCompare(b.url)),
        brokenLinks: [],
        rateLimitedPages: [],
        allCheckedUrls: []
      };
    }

    await browser.close();
    activeBrowser = null;

    progress.status = 'completed';
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
      rateLimitedPages: rateLimitedPages.sort((a, b) => a.url.localeCompare(b.url)),
      allCheckedUrls: allChecked
    };

    saveReport(startUrl, result, lastRun.sessionId);
    completeLastRun(
      `Completed. Checked ${checked} pages, found ${brokenPages.length} broken pages and ${uniqueBL.length} broken links.`
    );
    return result;

  } catch (error) {
    if (cancelRequested) {
      progress.status = 'cancelled';
      lastRun.status = 'cancelled';
      lastRun.completedAt = new Date().toISOString();
      appendLastRunLog('Check cancelled by user');
      resetProgress();
      return { checked: progress.checked || 0, cancelled: true, brokenPages: [], brokenLinks: [], allCheckedUrls: [] };
    }
    console.error('Error in checkForBrokenPages:', error);
    failLastRun(error);
    throw error;
  } finally {
    if (activeBrowser) {
      await activeBrowser.close().catch(() => {});
      activeBrowser = null;
    }
  }
}

function requestCancel() {
  if (progress.status !== 'running' && lastRun.status !== 'running') {
    return false;
  }

  cancelRequested = true;
  progress.status = 'cancelled';
  progress.currentUrl = '';
  progress.lastUpdated = Date.now();
  lastRun.status = 'cancelled';
  lastRun.completedAt = new Date().toISOString();
  appendLastRunLog('Check cancelled by user');

  if (activeBrowser) {
    activeBrowser.close().catch(() => {});
    activeBrowser = null;
  }

  return true;
}

function isCheckRunning(sessionId = null) {
  const running = Boolean(activeRunPromise) || progress.status === 'running' || lastRun.status === 'running';
  if (!running) return false;
  if (!sessionId) return running;
  return lastRun.sessionId === sessionId;
}

function isCheckRunningGlobally() {
  return Boolean(activeRunPromise) || progress.status === 'running' || lastRun.status === 'running';
}

function startCheck(startUrl, options = {}, sessionId = null) {
  const { isParallelExecutionEnabled } = require('../shared/executionEnv');
  const blocked = isParallelExecutionEnabled()
    ? isCheckRunning(sessionId)
    : isCheckRunningGlobally();
  if (blocked) {
    const err = new Error('An error check is already running');
    err.code = 'SCAN_ALREADY_RUNNING';
    throw err;
  }
  beginLastRun(startUrl, sessionId);
  const normalized = normalizeErrorCheckOptions(options);
  beginProgress(normalized.maxUrls);
  const runId = lastRun.id;
  activeRunPromise = checkForBrokenPages(startUrl, normalized, { skipBegin: true, skipProgressInit: true })
    .catch((err) => {
      if (!cancelRequested) throw err;
      return { checked: progress.checked || 0, cancelled: true };
    })
    .finally(() => {
      activeRunPromise = null;
      const wasCancelled = cancelRequested || lastRun.status === 'cancelled';
      cancelRequested = false;
      if (wasCancelled) {
        resetProgress();
      }
    });
  return { runId, promise: activeRunPromise };
}

module.exports = {
  checkForBrokenPages,
  startCheck,
  requestCancel,
  isCheckRunning,
  isCheckRunningGlobally,
  getProgress,
  resetProgress,
  getLastRun,
  renderLastRunLogsHtml
};
