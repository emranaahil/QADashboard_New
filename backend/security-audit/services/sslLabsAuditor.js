require('../../shared/loadEnv');

const API_BASE = 'https://api.ssllabs.com/api/v3';
const USER_AGENT =
  process.env.SSL_LABS_USER_AGENT ||
  'QA-Dashboard-SecurityAudit/1.0 (+node; security-audit)';

const INITIAL_POLL_MS = 5000;
const IN_PROGRESS_POLL_MS = 10000;
const DEFAULT_MAX_POLL_ATTEMPTS = 90;
const DEFAULT_MAX_WAIT_MS = 6 * 60 * 1000;
const DEFAULT_CACHE_MAX_AGE_HOURS = 24;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveMaxPollAttempts() {
  const env = parseInt(process.env.SSL_LABS_MAX_POLL_ATTEMPTS || '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_MAX_POLL_ATTEMPTS;
}

function resolveMaxWaitMs() {
  const env = parseInt(process.env.SSL_LABS_MAX_WAIT_MS || '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_MAX_WAIT_MS;
}

function resolveCacheMaxAgeHours() {
  const env = parseInt(process.env.SSL_LABS_CACHE_MAX_AGE_HOURS || '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_CACHE_MAX_AGE_HOURS;
}

function hostnameFromUrl(url) {
  return new URL(url).hostname;
}

const GRADE_RANK = {
  T: 0,
  M: 1,
  F: 2,
  D: 3,
  C: 4,
  B: 5,
  'A-': 6,
  A: 7,
  'A+': 8
};

function gradeRank(grade) {
  if (!grade) return -1;
  return GRADE_RANK[String(grade).trim()] ?? -1;
}

function worstGrade(grades) {
  let worst = null;
  let worstRank = 999;
  for (const g of grades || []) {
    const rank = gradeRank(g);
    if (rank >= 0 && rank < worstRank) {
      worstRank = rank;
      worst = g;
    }
  }
  return worst;
}

function isWeakGrade(grade) {
  const rank = gradeRank(grade);
  return rank >= 0 && rank <= gradeRank('B');
}

function buildAnalyzeUrl(host, params = {}) {
  const url = new URL(`${API_BASE}/analyze`);
  url.searchParams.set('host', host);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchAnalyze(host, params = {}) {
  const response = await fetch(buildAnalyzeUrl(host, params), {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json'
    }
  });

  if (response.status === 429) {
    const err = new Error('SSL Labs rate limit exceeded — try again later or reduce concurrent audits');
    err.code = 'SSL_LABS_RATE_LIMIT';
    throw err;
  }

  if (response.status === 503 || response.status === 529) {
    const err = new Error(`SSL Labs service unavailable (HTTP ${response.status})`);
    err.code = 'SSL_LABS_UNAVAILABLE';
    throw err;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    const err = new Error(`SSL Labs invalid response (HTTP ${response.status})`);
    err.code = 'SSL_LABS_BAD_RESPONSE';
    throw err;
  }

  if (!response.ok) {
    const msg = data?.errors?.[0]?.message || response.statusText;
    const err = new Error(`SSL Labs HTTP ${response.status}: ${msg}`);
    err.code = 'SSL_LABS_HTTP_ERROR';
    throw err;
  }

  if (Array.isArray(data?.errors) && data.errors.length) {
    const msg = data.errors.map((e) => e.message || e.field).filter(Boolean).join('; ');
    return { error: msg || 'SSL Labs request error' };
  }

  return data;
}

function summarizeEndpoint(endpoint) {
  const details = endpoint?.details || {};
  const protocols = (details.protocols || [])
    .filter((p) => !p.q)
    .map((p) => `${p.name} ${p.version}`.trim())
    .join(', ');

  return {
    ipAddress: endpoint.ipAddress || null,
    serverName: endpoint.serverName || null,
    grade: endpoint.grade || null,
    gradeTrustIgnored: endpoint.gradeTrustIgnored || null,
    statusMessage: endpoint.statusMessage || null,
    hasWarnings: Boolean(endpoint.hasWarnings),
    protocols: protocols || null,
    hsts: details.hstsPolicy?.status || null,
    heartbleed: details.heartbleed === true,
    poodle: details.poodle === true,
    opensslCcs: details.openSslCcs ?? null,
    ticketbleed: details.ticketbleed ?? null
  };
}

function parseHostResult(data) {
  const endpoints = (data.endpoints || []).map(summarizeEndpoint);
  const grades = endpoints.map((e) => e.grade).filter(Boolean);
  const grade = worstGrade(grades) || endpoints[0]?.grade || null;

  return {
    host: data.host,
    status: data.status,
    statusMessage: data.statusMessage || null,
    grade,
    endpoints,
    endpointCount: endpoints.length,
    hasWarnings: endpoints.some((e) => e.hasWarnings),
    weakGrade: isWeakGrade(grade),
    reportUrl: `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(data.host)}`,
    testTime: data.testTime || null,
    engineVersion: data.engineVersion || null,
    fetchedAt: new Date().toISOString()
  };
}

function isInProgressStatus(status) {
  return status === 'DNS' || status === 'IN_PROGRESS';
}

function allEndpointsReady(data) {
  const endpoints = data?.endpoints || [];
  if (!endpoints.length) return false;
  return endpoints.every((ep) => {
    const msg = String(ep.statusMessage || '').toLowerCase();
    return Boolean(ep.grade) || msg === 'ready';
  });
}

function formatProgressMessage(host, data, elapsedSec, source) {
  const endpoints = data?.endpoints || [];
  const active = endpoints.find((ep) => {
    const msg = String(ep.statusMessage || '').toLowerCase();
    return msg && msg !== 'ready';
  });
  const epDetail = active
    ? ` — ${active.ipAddress || 'endpoint'}: ${active.statusMessage}${
        active.progress != null ? ` (${active.progress}%)` : ''
      }`
    : '';
  return `SSL Labs (${source}): ${host} [${data.status}]${epDetail} — ${elapsedSec}s elapsed`;
}

function sslLabsReportUrl(host) {
  return `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(host)}`;
}

/**
 * Run SSL Labs assessment for a hostname.
 * Uses cached results when available, then polls until READY or timeout.
 */
async function analyzeSslLabsHost(urlOrHost, options = {}) {
  let host;
  try {
    host = urlOrHost.includes('://') ? hostnameFromUrl(urlOrHost) : String(urlOrHost).trim();
  } catch (err) {
    return {
      host: null,
      status: 'ERROR',
      grade: null,
      error: err?.message || 'Invalid hostname'
    };
  }

  if (!host) {
    return { host: null, status: 'ERROR', grade: null, error: 'Hostname required' };
  }

  const shouldCancel = typeof options.shouldCancel === 'function' ? options.shouldCancel : () => false;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const maxAttempts = options.maxPollAttempts || resolveMaxPollAttempts();
  const maxWaitMs = options.maxWaitMs || resolveMaxWaitMs();
  const cacheMaxAgeHours = options.cacheMaxAgeHours || resolveCacheMaxAgeHours();
  const startedAt = Date.now();

  const reportProgress = async (data, source = 'live') => {
    if (!onProgress) return;
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    await onProgress({
      host,
      status: data.status,
      elapsedSec,
      source,
      message: formatProgressMessage(host, data, elapsedSec, source)
    });
  };

  const timedOut = () => Date.now() - startedAt >= maxWaitMs;

  try {
    let data = await fetchAnalyze(host, {
      fromCache: 'on',
      all: 'done',
      maxAge: String(cacheMaxAgeHours)
    });

    if (data.error) {
      return { host, status: 'ERROR', grade: null, error: data.error };
    }

    if (data.status === 'READY' || allEndpointsReady(data)) {
      return parseHostResult({ ...data, status: 'READY' });
    }

    let source = 'cache';
    if (!isInProgressStatus(data.status)) {
      data = await fetchAnalyze(host, {
        startNew: 'on',
        all: 'done',
        publish: 'off'
      });
      source = 'live';
      if (data.error) {
        return { host, status: 'ERROR', grade: null, error: data.error };
      }
      if (data.status === 'READY' || allEndpointsReady(data)) {
        return parseHostResult({ ...data, status: 'READY' });
      }
    }

    await reportProgress(data, source);

    let attempts = 0;
    while (isInProgressStatus(data.status) && !allEndpointsReady(data)) {
      if (shouldCancel()) {
        return { host, status: 'CANCELLED', grade: null, cancelled: true };
      }

      if (timedOut()) {
        const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
        return {
          host,
          status: 'ERROR',
          grade: null,
          error: `SSL Labs assessment timed out after ${elapsedSec}s (max ${Math.floor(maxWaitMs / 1000)}s). Results may still complete on SSL Labs — open the report link.`,
          reportUrl: sslLabsReportUrl(host),
          timedOut: true
        };
      }

      const delay = data.status === 'DNS' ? INITIAL_POLL_MS : IN_PROGRESS_POLL_MS;
      await sleep(delay);

      if (shouldCancel()) {
        return { host, status: 'CANCELLED', grade: null, cancelled: true };
      }

      data = await fetchAnalyze(host, { all: 'done', publish: 'off' });
      if (data.error) {
        return { host, status: 'ERROR', grade: null, error: data.error };
      }

      await reportProgress(data, source);

      if (data.status === 'READY' || allEndpointsReady(data)) {
        return parseHostResult({ ...data, status: 'READY' });
      }

      attempts += 1;
      if (attempts >= maxAttempts) {
        return {
          host,
          status: 'ERROR',
          grade: null,
          error: `SSL Labs assessment timed out after ${attempts} polls`,
          reportUrl: sslLabsReportUrl(host)
        };
      }
    }

    if (data.status === 'ERROR') {
      return {
        host,
        status: 'ERROR',
        grade: null,
        error: data.statusMessage || 'SSL Labs assessment failed',
        reportUrl: sslLabsReportUrl(host)
      };
    }

    if (data.status !== 'READY' && !allEndpointsReady(data)) {
      return {
        host,
        status: data.status || 'UNKNOWN',
        grade: null,
        error: data.statusMessage || `Unexpected SSL Labs status: ${data.status}`,
        reportUrl: sslLabsReportUrl(host)
      };
    }

    return parseHostResult({ ...data, status: 'READY' });
  } catch (err) {
    return {
      host,
      status: 'ERROR',
      grade: null,
      error: err.message || String(err),
      code: err.code || null,
      reportUrl: sslLabsReportUrl(host)
    };
  }
}

module.exports = {
  API_BASE,
  analyzeSslLabsHost,
  hostnameFromUrl,
  worstGrade,
  isWeakGrade,
  gradeRank
};