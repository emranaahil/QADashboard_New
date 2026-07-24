require('../../shared/loadEnv');

const MAX_HOPS = 8;
const DEFAULT_TIMEOUT_MS = 12000;
const USER_AGENT =
  process.env.SECURITY_AUDIT_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function resolveTimeoutMs() {
  const env = parseInt(process.env.REDIRECT_TRACE_TIMEOUT_MS || '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS;
}

function resolveLocation(currentUrl, location) {
  if (!location) return null;
  try {
    return new URL(location, currentUrl).href;
  } catch {
    return null;
  }
}

/**
 * Trace redirect chain manually (up to 8 hops).
 */
async function traceRedirectPath(startUrl, options = {}) {
  const maxHops = options.maxHops || MAX_HOPS;
  const timeoutMs = options.timeoutMs || resolveTimeoutMs();
  const hops = [];
  let currentUrl = startUrl;
  let finalUrl = startUrl;
  let hopCount = 0;
  let error = null;

  try {
    new URL(startUrl);
  } catch (err) {
    return {
      startUrl,
      hops: [],
      finalUrl: startUrl,
      hopCount: 0,
      error: err?.message || 'Invalid URL'
    };
  }

  for (let i = 0; i < maxHops; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let status;
    let location = null;
    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,*/*'
        }
      });
      status = response.status;
      if (status >= 300 && status < 400) {
        location = response.headers.get('location');
      }
    } catch (err) {
      error =
        err?.name === 'AbortError'
          ? `Redirect probe timed out after ${timeoutMs}ms`
          : err?.message || String(err);
      break;
    } finally {
      clearTimeout(timer);
    }

    const hop = {
      from: currentUrl,
      status,
      location: location || null
    };
    hops.push(hop);

    if (status >= 300 && status < 400 && location) {
      const nextUrl = resolveLocation(currentUrl, location);
      if (!nextUrl) {
        error = 'Invalid redirect Location header';
        break;
      }
      hopCount += 1;
      currentUrl = nextUrl;
      finalUrl = nextUrl;
      continue;
    }

    finalUrl = currentUrl;
    break;
  }

  if (!error && hopCount >= maxHops && hops.length && hops[hops.length - 1].status >= 300) {
    error = `Exceeded maximum redirect hops (${maxHops})`;
  }

  return {
    startUrl,
    hops,
    finalUrl,
    hopCount,
    truncated: hopCount >= maxHops,
    error,
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  MAX_HOPS,
  traceRedirectPath
};