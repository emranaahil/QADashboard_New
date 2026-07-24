const { fetchPageSpeedInsightsBoth } = require('../../shared/services/pageSpeedInsights');

/**
 * Run Google PageSpeed Insights (mobile + desktop) for a page URL.
 */
async function runPageSpeedCheck(pageUrl, options = {}) {
  const result = await fetchPageSpeedInsightsBoth(pageUrl, {
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    onRetry: options.onRetry
  });

  if (result.skipped) {
    return {
      skipped: true,
      reason: result.reason || 'PageSpeed skipped',
      mobile: null,
      desktop: null
    };
  }

  return {
    skipped: false,
    mobile: result.mobile || null,
    desktop: result.desktop || null,
    fetchedAt: result.fetchedAt || new Date().toISOString()
  };
}

module.exports = {
  runPageSpeedCheck
};