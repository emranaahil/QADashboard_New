require('../../shared/loadEnv');

const DEFAULT_TIMEOUT_MS = 8000;
const USER_AGENT =
  process.env.SECURITY_AUDIT_USER_AGENT ||
  'QA-Dashboard-SecurityAudit/1.0 (+node)';

function resolveTimeoutMs() {
  const env = parseInt(process.env.ROBOTS_TXT_TIMEOUT_MS || '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS;
}

function originFromUrl(url) {
  return new URL(url).origin;
}

function previewLines(text, maxLines = 5) {
  return String(text || '')
    .split(/\r?\n/)
    .slice(0, maxLines)
    .map((line) => line.trimEnd());
}

/**
 * Fetch robots.txt for a URL's origin — status + first 5 lines.
 */
async function auditRobotsTxt(urlOrOrigin, options = {}) {
  const timeoutMs = options.timeoutMs || resolveTimeoutMs();
  let origin;
  try {
    origin = originFromUrl(urlOrOrigin);
  } catch (err) {
    return {
      url: null,
      status: null,
      ok: false,
      previewLines: [],
      error: err?.message || 'Invalid URL'
    };
  }

  const robotsUrl = `${origin}/robots.txt`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/plain,*/*'
      }
    });
    const status = response.status;
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }

    const trimmed = body.trim();
    const preview = previewLines(trimmed);

    return {
      url: robotsUrl,
      origin,
      status,
      ok: status >= 200 && status < 400 && trimmed.length > 0,
      previewLines: preview,
      empty: trimmed.length === 0,
      fetchedAt: new Date().toISOString()
    };
  } catch (err) {
    const message =
      err?.name === 'AbortError'
        ? `robots.txt request timed out after ${timeoutMs}ms`
        : err?.message || String(err);
    return {
      url: robotsUrl,
      origin,
      status: null,
      ok: false,
      previewLines: [],
      error: message
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  auditRobotsTxt,
  originFromUrl,
  previewLines
};