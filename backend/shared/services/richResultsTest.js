/**
 * Google Rich Results Test capture via Playwright.
 * Soft-fails on hard errors — never throws to the SEO job by default.
 *
 * Wait strategy:
 * - Poll until "Test results" (or other result signals) appear in the DOM
 * - Check every POLL_INTERVAL_MS, max MAX_WAIT_MS (4 minutes)
 * - Full-page screenshot after ready signal, OR best-effort screenshot after max wait
 *   (earlier behavior restored so the report still gets a shot when Google is slow)
 */
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  try {
    ({ chromium } = require('../../../node_modules/playwright'));
  } catch {
    chromium = null;
  }
}

const RICH_RESULTS_TEST_ORIGIN = 'https://search.google.com/test/rich-results';
/** Max total wait for result UI (4 minutes). */
const DEFAULT_MAX_WAIT_MS = 4 * 60 * 1000;
/** Between DOM checks. */
const DEFAULT_POLL_INTERVAL_MS = 5000;
/**
 * Primary ready signal (user-confirmed UI heading after the test runs).
 * Manual Google UI shows a "Test results" section when the analysis finishes.
 */
const RESULT_READY_TEXT = 'Test results';
/**
 * Signals that the Rich Results Test finished (wording varies by Google UI / outcome).
 * "Test results" is checked first; others are fallbacks.
 */
const RESULT_READY_PATTERNS = [
  /test\s+results/i,
  /detected\s+structured\s+data/i,
  /no\s+items\s+detected/i,
  /page\s+is\s+eligible/i,
  /not\s+eligible\s+for\s+rich\s+results/i,
  /valid\s+items\s+detected/i,
  /invalid\s+items\s+detected/i,
  /rich\s+result(?:s)?\s+detected/i,
  /preview\s+of\s+how\s+your/i
];

function buildRichResultsTestUrl(targetUrl) {
  const url = String(targetUrl || '').trim();
  if (!url) return RICH_RESULTS_TEST_ORIGIN;
  return `${RICH_RESULTS_TEST_ORIGIN}?url=${encodeURIComponent(url)}`;
}

function createUrlSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page';
}

async function dismissConsentIfPresent(page) {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Accept")',
    '#L2AGLb',
    'button[aria-label="Accept all"]'
  ];
  for (const sel of candidates) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(800);
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

async function pageHasResultReadyText(page) {
  // Primary: "Test results" heading / label (user request)
  try {
    const testResults = page.getByText(RESULT_READY_TEXT, { exact: false }).first();
    if (await testResults.isVisible({ timeout: 800 }).catch(() => false)) {
      return true;
    }
  } catch {
    // fall through
  }
  // Also try exact-ish heading locators
  try {
    const heading = page.locator('h1, h2, h3, [role="heading"]').filter({ hasText: /test\s+results/i }).first();
    if (await heading.isVisible({ timeout: 500 }).catch(() => false)) {
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const t = String(bodyText || '');
    if (!t.trim()) return false;
    return RESULT_READY_PATTERNS.some((re) => re.test(t));
  } catch {
    return false;
  }
}

/**
 * Hard bot wall only — do not treat normal reCAPTCHA iframe or soft errors as instant fail
 * (Google often shows reCAPTCHA scripts even when a human session works).
 */
async function detectHardBlock(page) {
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const t = String(bodyText || '');
    if (/unusual traffic|are you a robot|verify you.?re not a robot|automated queries/i.test(t)) {
      return 'Google bot-check / unusual traffic message detected';
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Soft Google error (not always a permanent CAPTCHA — keep waiting / still screenshot).
 */
async function detectSoftGoogleError(page) {
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const t = String(bodyText || '');
    if (/something went wrong/i.test(t) && /log\s*in\s+and\s+try\s+again/i.test(t)) {
      return 'Google showed "Something went wrong — Log in and try again"';
    }
    if (/something went wrong/i.test(t)) {
      return 'Google showed "Something went wrong"';
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Wait up to maxWaitMs for "Test results" (or fallback result signals).
 * @returns {{ found: boolean, waitedMs: number, hardBlock: string|null, softError: string|null }}
 */
async function waitForTestResults(page, options = {}) {
  const maxWaitMs = Math.max(1000, Number(options.maxWaitMs) || DEFAULT_MAX_WAIT_MS);
  const pollIntervalMs = Math.max(1000, Number(options.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
  const started = Date.now();
  let lastSoftError = null;

  await page.waitForTimeout(2000);

  while (true) {
    const elapsed = Date.now() - started;

    const hardBlock = await detectHardBlock(page);
    if (hardBlock) {
      return {
        found: false,
        waitedMs: elapsed,
        hardBlock,
        softError: lastSoftError
      };
    }

    const soft = await detectSoftGoogleError(page);
    if (soft) lastSoftError = soft;

    if (await pageHasResultReadyText(page)) {
      // Settle layout before screenshot
      await page.waitForTimeout(2500);
      return {
        found: true,
        waitedMs: Date.now() - started,
        hardBlock: null,
        softError: lastSoftError
      };
    }

    if (elapsed >= maxWaitMs) {
      return {
        found: false,
        waitedMs: elapsed,
        hardBlock: null,
        softError: lastSoftError
      };
    }

    const remaining = maxWaitMs - elapsed;
    const sleepMs = Math.min(pollIntervalMs, remaining);
    if (sleepMs <= 0) {
      return {
        found: false,
        waitedMs: Date.now() - started,
        hardBlock: null,
        softError: lastSoftError
      };
    }
    await page.waitForTimeout(sleepMs);
  }
}

async function takeFullPageScreenshot(page) {
  const buffer = await page.screenshot({ fullPage: true, type: 'png' });
  return buffer.toString('base64');
}

/**
 * Capture Rich Results Test for one URL.
 * Prefers waiting for "Test results", then always tries a full-page screenshot.
 */
async function captureRichResultsTest(targetUrl, options = {}) {
  const {
    browser: sharedBrowser = null,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs,
    softFail = true
  } = options;

  const waitBudgetMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : maxWaitMs;
  const target = String(targetUrl || '').trim();
  const toolUrl = buildRichResultsTestUrl(target);
  const startedAt = new Date().toISOString();

  if (!target) {
    return {
      ok: false,
      status: 'error',
      targetUrl: target,
      toolUrl,
      error: 'No target URL provided',
      capturedAt: startedAt
    };
  }

  if (!chromium) {
    const result = {
      ok: false,
      status: 'error',
      targetUrl: target,
      toolUrl,
      error: 'Playwright is not available',
      capturedAt: startedAt
    };
    if (!softFail) throw new Error(result.error);
    return result;
  }

  let ownsBrowser = false;
  let browser = sharedBrowser;
  let context = null;
  let page = null;

  try {
    if (!browser) {
      browser = await chromium.launch({ headless: true });
      ownsBrowser = true;
    }

    context = await browser.newContext({
      viewport: { width: 1360, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-US'
    });
    page = await context.newPage();
    page.setDefaultTimeout(60000);

    await page.goto(toolUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await dismissConsentIfPresent(page);

    // Prefer query-param auto-run; only click TEST URL if input empty / wrong host
    try {
      const urlInput = page.locator('input[type="url"], input[type="text"], textarea').first();
      if (await urlInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        const current = await urlInput.inputValue().catch(() => '');
        let host = '';
        try {
          host = new URL(target).hostname.replace(/^www\./, '');
        } catch {
          host = '';
        }
        if (!current || (host && !current.includes(host))) {
          await urlInput.fill(target).catch(() => {});
          const testBtn = page
            .locator(
              'button:has-text("TEST URL"), button:has-text("Test URL"), button:has-text("Run test"), button[type="submit"]'
            )
            .first();
          if (await testBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await testBtn.click().catch(() => {});
          }
        }
      }
    } catch {
      // query param auto-run
    }

    const waitResult = await waitForTestResults(page, {
      maxWaitMs: waitBudgetMs,
      pollIntervalMs
    });

    const pageTitle = await page.title().catch(() => '');
    const activeUrl = page.url();
    const waitedSec = Math.round((waitResult.waitedMs || 0) / 1000);

    // Always attempt a full-page screenshot (restores earlier report behavior)
    let screenshotBase64 = null;
    try {
      screenshotBase64 = await takeFullPageScreenshot(page);
    } catch (shotErr) {
      if (waitResult.hardBlock && !softFail) throw shotErr;
    }

    const base = {
      targetUrl: target,
      toolUrl,
      activeUrl,
      pageTitle,
      waitedMs: waitResult.waitedMs,
      screenshotMime: 'image/png',
      screenshotFile: null,
      capturedAt: new Date().toISOString()
    };

    if (screenshotBase64) {
      base.screenshotBase64 = screenshotBase64;
    }

    if (waitResult.found && screenshotBase64) {
      return {
        ...base,
        ok: true,
        status: 'captured',
        ready: true,
        note: `Screenshot captured after "${RESULT_READY_TEXT}" (or result UI) appeared (~${waitedSec}s).`
      };
    }

    if (waitResult.found && !screenshotBase64) {
      return {
        ...base,
        ok: false,
        status: 'error',
        ready: true,
        error: 'Result UI appeared but screenshot failed',
        note: 'Test results were visible but the screenshot could not be saved.'
      };
    }

    // Not found ready text — still return screenshot if we got one (partial)
    if (screenshotBase64) {
      const soft = waitResult.softError || waitResult.hardBlock;
      return {
        ...base,
        ok: true,
        status: 'captured-partial',
        ready: false,
        error: soft
          ? `${soft}. "${RESULT_READY_TEXT}" was not confirmed within ${Math.round(waitBudgetMs / 1000)}s; saved a best-effort full-page screenshot (~${waitedSec}s).`
          : `"${RESULT_READY_TEXT}" was not confirmed within ${Math.round(waitBudgetMs / 1000)}s (waited ~${waitedSec}s); saved a best-effort full-page screenshot. Open the tool URL if the shot looks incomplete.`,
        note: soft
          ? `Partial capture — Google UI may not have finished under automation (${soft}).`
          : 'Partial capture — waiting for "Test results" timed out; screenshot still saved for the report.'
      };
    }

    // No screenshot at all
    return {
      ...base,
      ok: false,
      status: waitResult.hardBlock ? 'blocked' : 'timeout',
      ready: false,
      error:
        waitResult.hardBlock ||
        waitResult.softError ||
        `"${RESULT_READY_TEXT}" did not appear within ${Math.round(waitBudgetMs / 1000)}s and screenshot failed. Open the Google tool URL manually.`,
      note: 'No screenshot available.'
    };
  } catch (err) {
    const result = {
      ok: false,
      status: 'error',
      targetUrl: target,
      toolUrl,
      error: err?.message || String(err),
      capturedAt: new Date().toISOString()
    };
    if (!softFail) throw err;
    return result;
  } finally {
    try {
      if (page) await page.close();
    } catch {}
    try {
      if (context) await context.close();
    } catch {}
    try {
      if (ownsBrowser && browser) await browser.close();
    } catch {}
  }
}

async function writeRichResultsScreenshotFiles(reportFolder, pages) {
  const fs = require('fs-extra');
  const list = Array.isArray(pages) ? pages : [];
  const outDir = path.join(reportFolder, 'rich-results');
  let wrote = 0;

  for (const page of list) {
    const rr = page?.richResults;
    if (!rr?.screenshotBase64) continue;
    try {
      await fs.ensureDir(outDir);
      const fileName = `${createUrlSlug(page.url || rr.targetUrl)}.png`;
      const abs = path.join(outDir, fileName);
      await fs.writeFile(abs, Buffer.from(rr.screenshotBase64, 'base64'));
      rr.screenshotFile = `rich-results/${fileName}`;
      wrote += 1;
    } catch {
      // non-fatal
    }
  }
  return wrote;
}

module.exports = {
  RICH_RESULTS_TEST_ORIGIN,
  RESULT_READY_TEXT,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  buildRichResultsTestUrl,
  createUrlSlug,
  captureRichResultsTest,
  writeRichResultsScreenshotFiles
};
