/**
 * Shared URL page checker — same logic as Link Radar (error-check):
 * HTTP status, redirect probe, title/body error phrases.
 */
const { chromium } = require('playwright');

const NAVIGATION_TIMEOUT = 30000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeRedirect(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' }
    });
    const status = res.status;
    if (status >= 300 && status < 400) {
      return {
        redirectStatus: status,
        location: res.headers.get('location') || ''
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatContentIssues(matchedPatterns, statusCode) {
  const issues = [];
  const lower = matchedPatterns.map((p) => String(p).toLowerCase());

  if (lower.some((p) => p.includes('page not found'))) {
    issues.push('Page not found');
  }
  if (lower.some((p) => p === '404' || p === 'not found' || p.includes('error 404'))) {
    if (statusCode === 404) {
      if (!issues.includes('Page not found')) issues.push('Page not found');
    } else {
      issues.push('404 (title/H1)');
    }
  }
  for (const pat of matchedPatterns) {
    const key = String(pat).toLowerCase();
    if (
      key.includes('page not found') ||
      key === '404' ||
      key === 'not found' ||
      key.includes('error 404')
    ) {
      continue;
    }
    issues.push(pat);
  }
  return [...new Set(issues)];
}

function buildIssues({ statusCode, redirectStatus, contentIssues, loadFailed }) {
  const issues = [];

  if (redirectStatus === 301) issues.push('HTTP 301');
  else if (redirectStatus === 302) issues.push('HTTP 302');
  else if (redirectStatus >= 300 && redirectStatus < 400) issues.push(`HTTP ${redirectStatus}`);

  if (statusCode >= 400) issues.push(`HTTP ${statusCode}`);

  for (const item of contentIssues || []) {
    if (!issues.includes(item)) issues.push(item);
  }

  if (loadFailed && !issues.includes('Page failed to load')) {
    issues.push('Page failed to load');
  }

  return issues;
}

/**
 * Create a reusable checker that shares one Playwright browser instance.
 */
async function createUrlChecker() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    bypassCSP: true,
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();
  let closed = false;

  async function checkUrl(url) {
    let statusCode = 0;
    let finalUrl = url;
    let matchedPatterns = [];
    let loadFailed = false;

    const redirect = await probeRedirect(url);
    const redirectStatus = redirect?.redirectStatus || 0;

    try {
      const resp = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT
      });
      statusCode = resp ? resp.status() : 0;
      finalUrl = page.url();

      await sleep(800);

      const evalResult = await page.evaluate(() => {
        const title = document.title || '';
        const h1 = document.querySelector('h1')?.innerText || '';
        const text = document.body ? document.body.innerText : '';
        return { title, h1, text };
      });

      const fullText = `${evalResult.title} ${evalResult.h1} ${evalResult.text}`.toLowerCase();
      for (const pat of ERROR_TEXT_PATTERNS) {
        if (fullText.includes(pat)) matchedPatterns.push(pat);
      }
    } catch {
      loadFailed = true;
    }

    const contentIssues = formatContentIssues(matchedPatterns, statusCode);
    const issues = buildIssues({
      statusCode,
      redirectStatus,
      contentIssues,
      loadFailed
    });

    return {
      url,
      statusCode,
      redirectStatus: redirectStatus || null,
      redirectLocation: redirect?.location || null,
      finalUrl,
      issues,
      primaryIssue: issues[0] || 'OK',
      hasIssue: issues.length > 0,
      matchedPatterns: [...new Set(matchedPatterns)]
    };
  }

  async function close() {
    if (closed) return;
    closed = true;
    await browser.close().catch(() => {});
  }

  return { checkUrl, close };
}

module.exports = {
  ERROR_TEXT_PATTERNS,
  probeRedirect,
  createUrlChecker,
  buildIssues,
  formatContentIssues
};