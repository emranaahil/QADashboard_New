require('../../shared/loadEnv');

const VALIDATOR_BASE = 'https://validator.w3.org/nu/';
const DEFAULT_TIMEOUT_MS = 45000;

function getUserAgent() {
  return (
    process.env.W3C_VALIDATOR_USER_AGENT ||
    'QA-Dashboard-SecurityAudit/1.0 (contact: support@example.com)'
  );
}

function resolveTimeoutMs() {
  const env = parseInt(process.env.W3C_VALIDATOR_TIMEOUT_MS || '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS;
}

function buildValidatorUrl(pageUrl) {
  const params = new URLSearchParams();
  params.set('doc', pageUrl);
  params.set('out', 'json');
  return `${VALIDATOR_BASE}?${params.toString()}`;
}

const DEFAULT_MAX_ISSUES_PER_TYPE = 200;

function resolveMaxIssuesPerType() {
  const env = parseInt(process.env.W3C_VALIDATOR_MAX_ISSUES || '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_MAX_ISSUES_PER_TYPE;
}

function classifyMessageType(msg) {
  const type = String(msg?.type || '').toLowerCase();
  if (type === 'error' || type === 'non-document-error') return 'error';
  if (type === 'warning') return 'warning';
  if (type === 'info' && String(msg?.subType || '').toLowerCase() === 'warning') return 'warning';
  return null;
}

function normalizeIssue(msg) {
  const kind = classifyMessageType(msg);
  if (!kind) return null;
  const line = msg?.lastLine ?? msg?.line ?? null;
  const column = msg?.lastColumn ?? msg?.firstColumn ?? msg?.column ?? null;
  return {
    type: kind,
    message: String(msg?.message || '').trim() || '—',
    line: Number.isFinite(line) ? line : null,
    column: Number.isFinite(column) ? column : null,
    extract: msg?.extract ? String(msg.extract).trim().slice(0, 500) : null
  };
}

function partitionMessages(messages, maxPerType = resolveMaxIssuesPerType()) {
  const errors = [];
  const warnings = [];
  let errorTotal = 0;
  let warningTotal = 0;

  for (const raw of messages || []) {
    const kind = classifyMessageType(raw);
    if (kind === 'error') errorTotal += 1;
    else if (kind === 'warning') warningTotal += 1;

    const issue = normalizeIssue(raw);
    if (!issue) continue;
    if (issue.type === 'error' && errors.length < maxPerType) errors.push(issue);
    if (issue.type === 'warning' && warnings.length < maxPerType) warnings.push(issue);
  }

  return {
    errors,
    warnings,
    errorTotal,
    warningTotal,
    truncated: errorTotal > errors.length || warningTotal > warnings.length
  };
}

function countMessageTypes(messages) {
  const { errorTotal, warningTotal } = partitionMessages(messages, Number.MAX_SAFE_INTEGER);
  return { errors: errorTotal, warnings: warningTotal };
}

/**
 * Validate a page URL via the W3C Nu HTML checker (JSON output).
 */
async function validateW3cHtml(pageUrl, options = {}) {
  const timeoutMs = options.timeoutMs || resolveTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestUrl = buildValidatorUrl(pageUrl);
    const response = await fetch(requestUrl, {
      signal: controller.signal,
      headers: {
        'user-agent': getUserAgent(),
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      return {
        url: pageUrl,
        skipped: false,
        errors: 0,
        warnings: 0,
        error: `W3C validator HTTP ${response.status} ${response.statusText}`
      };
    }

    const data = await response.json();
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const partitioned = partitionMessages(messages);

    return {
      url: pageUrl,
      skipped: false,
      errors: partitioned.errorTotal,
      warnings: partitioned.warningTotal,
      issues: {
        errors: partitioned.errors,
        warnings: partitioned.warnings,
        truncated: partitioned.truncated
      },
      messageCount: messages.length,
      fetchedAt: new Date().toISOString()
    };
  } catch (err) {
    const message =
      err?.name === 'AbortError'
        ? `W3C validator timed out after ${timeoutMs}ms`
        : err?.message || String(err);
    return {
      url: pageUrl,
      skipped: false,
      errors: 0,
      warnings: 0,
      error: message
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  VALIDATOR_BASE,
  buildValidatorUrl,
  validateW3cHtml,
  classifyMessageType,
  normalizeIssue,
  partitionMessages,
  countMessageTypes
};