/**
 * Shared Playwright navigation helpers for site crawlers (Keyword Radar + SEO).
 */

const { urlHasMeaningfulHash } = require('../keyword-check/urlDiscovery');

const DEFAULT_NAVIGATION_TIMEOUT = 60000;
const DEFAULT_HASH_NAVIGATION_TIMEOUT = 20000;
const DEFAULT_DISCOVERY_NAVIGATION_TIMEOUT = 60000;

/**
 * Navigate to a URL with lighter wait strategy for hash fragments (SPAs).
 */
async function gotoWithHashSupport(page, url, options = {}) {
  const {
    navigationTimeout = DEFAULT_NAVIGATION_TIMEOUT,
    hashNavigationTimeout = DEFAULT_HASH_NAVIGATION_TIMEOUT,
    onHashRetry = null
  } = options;

  const isHashUrl = urlHasMeaningfulHash(url);

  try {
    return await page.goto(url, {
      waitUntil: isHashUrl ? 'domcontentloaded' : 'networkidle',
      timeout: isHashUrl ? hashNavigationTimeout : navigationTimeout
    });
  } catch (navError) {
    if (!isHashUrl) throw navError;

    if (typeof onHashRetry === 'function') {
      onHashRetry(url, navError);
    }

    return page
      .goto(url, {
        waitUntil: 'commit',
        timeout: hashNavigationTimeout
      })
      .catch(() => null);
  }
}

/**
 * Navigation for link-discovery crawls (SEO full-site, etc.).
 * Uses domcontentloaded (not networkidle) but retries with load/commit — never gives up early.
 */
async function gotoForLinkDiscovery(page, url, options = {}) {
  const {
    navigationTimeout = DEFAULT_DISCOVERY_NAVIGATION_TIMEOUT,
    hashNavigationTimeout = DEFAULT_HASH_NAVIGATION_TIMEOUT,
    onRetry = null
  } = options;

  const isHashUrl = urlHasMeaningfulHash(url);
  const timeout = isHashUrl ? hashNavigationTimeout : navigationTimeout;
  const strategies = isHashUrl
    ? [
        { waitUntil: 'domcontentloaded', timeout },
        { waitUntil: 'commit', timeout: hashNavigationTimeout }
      ]
    : [
        { waitUntil: 'domcontentloaded', timeout },
        { waitUntil: 'load', timeout },
        { waitUntil: 'commit', timeout: Math.max(30000, Math.floor(timeout / 2)) }
      ];

  let lastError = null;
  for (const strategy of strategies) {
    try {
      return await page.goto(url, strategy);
    } catch (navError) {
      lastError = navError;
      if (typeof onRetry === 'function') {
        onRetry(url, navError, strategy.waitUntil);
      }
    }
  }

  if (lastError) throw lastError;
  return null;
}

module.exports = {
  gotoWithHashSupport,
  gotoForLinkDiscovery,
  DEFAULT_NAVIGATION_TIMEOUT,
  DEFAULT_HASH_NAVIGATION_TIMEOUT,
  DEFAULT_DISCOVERY_NAVIGATION_TIMEOUT
};