require('../loadEnv');

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_RETRY_COUNT = 2;

function getApiKey() {
  return process.env.PAGESPEED_API_KEY || '';
}

function resolvePageSpeedTimeoutMs() {
  const env = parseInt(process.env.PAGESPEED_TIMEOUT_MS || '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS;
}

function resolvePageSpeedRetryCount() {
  const env = parseInt(process.env.PAGESPEED_RETRY_COUNT || '', 10);
  return Number.isFinite(env) && env >= 0 ? env : DEFAULT_RETRY_COUNT;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPageSpeedUrl(targetUrl, apiKey, strategy = 'MOBILE') {
  const params = new URLSearchParams();
  params.set('url', targetUrl);
  params.set('key', apiKey);
  params.set('strategy', strategy);
  params.append('category', 'PERFORMANCE');
  params.append('category', 'ACCESSIBILITY');
  params.append('category', 'SEO');
  return `${PSI_ENDPOINT}?${params.toString()}`;
}

function scoreToPercent(score) {
  if (score == null || Number.isNaN(Number(score))) return null;
  return Math.round(Number(score) * 100);
}

function getAuditDisplayValue(audits, id) {
  const audit = audits?.[id];
  return audit?.displayValue || '—';
}

function parsePageSpeedResponse(data, strategy = 'MOBILE') {
  const categories = data?.lighthouseResult?.categories || {};
  const audits = data?.lighthouseResult?.audits || {};
  return {
    strategy,
    performance: scoreToPercent(categories.performance?.score),
    accessibility: scoreToPercent(categories.accessibility?.score),
    seo: scoreToPercent(categories.seo?.score),
    metrics: {
      fcp: getAuditDisplayValue(audits, 'first-contentful-paint'),
      lcp: getAuditDisplayValue(audits, 'largest-contentful-paint'),
      cls: getAuditDisplayValue(audits, 'cumulative-layout-shift'),
      tbt: getAuditDisplayValue(audits, 'total-blocking-time')
    },
    fetchedAt: new Date().toISOString()
  };
}

function isRetryablePageSpeedError(message) {
  const msg = String(message || '');
  return (
    /timed out|timeout|abort/i.test(msg) ||
    /HTTP 429|HTTP 500|HTTP 502|HTTP 503|HTTP 504/i.test(msg) ||
    /rate limit|quota|temporarily unavailable|backend error/i.test(msg) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(msg)
  );
}

function computePageSpeedRetryDelayMs(attempt) {
  return Math.min(15000, 3000 + attempt * 4000 + Math.floor(Math.random() * 500));
}

async function fetchPageSpeedInsightsOnce(url, options = {}) {
  const apiKey = options.apiKey || getApiKey();
  const strategy = options.strategy || 'MOBILE';
  const timeoutMs = options.timeoutMs || resolvePageSpeedTimeoutMs();

  if (!apiKey) {
    return {
      strategy,
      skipped: true,
      reason: 'PAGESPEED_API_KEY not configured'
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestUrl = buildPageSpeedUrl(url, apiKey, strategy);
    const response = await fetch(requestUrl, { signal: controller.signal });

    if (!response.ok) {
      let detail = '';
      try {
        const errBody = await response.json();
        detail = errBody?.error?.message ? `: ${errBody.error.message}` : '';
      } catch {
        try {
          detail = `: ${(await response.text()).slice(0, 200)}`;
        } catch {
          // ignore
        }
      }
      return {
        strategy,
        error: `PageSpeed API HTTP ${response.status} ${response.statusText}${detail}`
      };
    }

    const data = await response.json();
    return parsePageSpeedResponse(data, strategy);
  } catch (err) {
    const message =
      err?.name === 'AbortError'
        ? `PageSpeed request timed out after ${timeoutMs}ms`
        : err?.message || String(err);
    return { strategy, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageSpeedInsights(url, options = {}) {
  const strategy = options.strategy || 'MOBILE';
  const apiKey = options.apiKey || getApiKey();
  if (!apiKey) {
    return {
      strategy,
      skipped: true,
      reason: 'PAGESPEED_API_KEY not configured'
    };
  }

  const baseTimeoutMs = options.timeoutMs || resolvePageSpeedTimeoutMs();
  const maxRetries = options.retries != null ? options.retries : resolvePageSpeedRetryCount();
  const totalAttempts = maxRetries + 1;
  let lastResult;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeoutMs = baseTimeoutMs + attempt * 30000;
    if (attempt > 0) {
      const delayMs = computePageSpeedRetryDelayMs(attempt);
      if (options.onRetry) {
        options.onRetry({
          strategy,
          attempt: attempt + 1,
          totalAttempts,
          delayMs,
          timeoutMs,
          lastError: lastResult?.error
        });
      }
      await sleep(delayMs);
    }

    lastResult = await fetchPageSpeedInsightsOnce(url, {
      ...options,
      strategy,
      timeoutMs
    });

    if (!lastResult.error) {
      if (attempt > 0 && options.onRetry) {
        options.onRetry({
          strategy,
          attempt: attempt + 1,
          totalAttempts,
          recovered: true
        });
      }
      return lastResult;
    }

    if (!isRetryablePageSpeedError(lastResult.error) || attempt >= maxRetries) {
      return lastResult;
    }
  }

  return lastResult;
}

function computeStrategyAveragePercent(strategyResult) {
  if (!strategyResult || strategyResult.error || strategyResult.skipped) return 0;
  const scores = [strategyResult.performance, strategyResult.accessibility, strategyResult.seo].filter(
    (n) => n != null && !Number.isNaN(n)
  );
  if (!scores.length) return 0;
  return Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length);
}

function normalizePageSpeedBundle(pageSpeed) {
  if (!pageSpeed) return null;
  if (pageSpeed.skipped) return pageSpeed;
  if (pageSpeed.mobile || pageSpeed.desktop) return pageSpeed;
  if (pageSpeed.error) return pageSpeed;
  const strategy = String(pageSpeed.strategy || 'MOBILE').toUpperCase();
  if (strategy === 'DESKTOP') {
    return { mobile: null, desktop: pageSpeed };
  }
  return { mobile: pageSpeed, desktop: null };
}

function computePageSpeedAveragePercent(pageSpeed) {
  const bundle = normalizePageSpeedBundle(pageSpeed);
  if (!bundle) return 0;
  if (bundle.skipped || (bundle.error && !bundle.mobile && !bundle.desktop)) return 0;

  if (bundle.mobile || bundle.desktop) {
    const strategyAvgs = [];
    if (bundle.mobile) strategyAvgs.push(computeStrategyAveragePercent(bundle.mobile));
    if (bundle.desktop) strategyAvgs.push(computeStrategyAveragePercent(bundle.desktop));
    const valid = strategyAvgs.filter((n) => n > 0);
    if (!valid.length) return 0;
    return Math.round(valid.reduce((sum, n) => sum + n, 0) / valid.length);
  }

  return computeStrategyAveragePercent(bundle);
}

async function fetchPageSpeedInsightsBoth(url, options = {}) {
  const apiKey = options.apiKey || getApiKey();
  if (!apiKey) {
    return {
      skipped: true,
      reason: 'PAGESPEED_API_KEY not configured'
    };
  }

  const sharedRetryOpts = {
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    onRetry: options.onRetry
  };

  const mobile = await fetchPageSpeedInsights(url, { ...sharedRetryOpts, strategy: 'MOBILE' });
  await sleep(1500);
  const desktop = await fetchPageSpeedInsights(url, { ...sharedRetryOpts, strategy: 'DESKTOP' });

  return {
    mobile,
    desktop,
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  PSI_ENDPOINT,
  buildPageSpeedUrl,
  fetchPageSpeedInsights,
  fetchPageSpeedInsightsBoth,
  parsePageSpeedResponse,
  normalizePageSpeedBundle,
  computePageSpeedAveragePercent,
  computeStrategyAveragePercent,
  resolvePageSpeedTimeoutMs,
  resolvePageSpeedRetryCount,
  scoreToPercent
};