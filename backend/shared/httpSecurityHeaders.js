/**
 * HTTP response security header assertions for SEO / QA audits.
 */

const PRIVATE_ROUTE_RE =
  /\/(login|signin|sign-in|signup|sign-up|register|account|profile|dashboard|admin|checkout|cart|billing|settings|my-account|my-profile|auth|oauth|session|wp-admin|wp-login)(\/|$)/i;

const NON_PRODUCTION_HOST_RE =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$|\.local$|^(staging|stage|stg|dev|test|uat|preview|demo|sandbox)[.-]/i;

function normalizeHeaderMap(headers) {
  const map = {};
  if (!headers) return map;
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      map[String(key).toLowerCase()] = value;
    });
    return map;
  }
  for (const [key, value] of Object.entries(headers)) {
    map[String(key).toLowerCase()] = value;
  }
  return map;
}

function getHeaderValue(map, key) {
  return map[String(key).toLowerCase()] || '';
}

function isProductionUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (NON_PRODUCTION_HOST_RE.test(host)) return false;
    if (/[.-](staging|stage|stg|dev|test|uat|preview|demo|sandbox)\./i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function isPrivateOrAuthenticatedRoute(url, map) {
  try {
    const path = new URL(url).pathname;
    if (PRIVATE_ROUTE_RE.test(path)) return true;
  } catch {
    // ignore invalid URL
  }

  const setCookie = getHeaderValue(map, 'set-cookie');
  return Boolean(setCookie && /(session|sess|auth|token|jwt|sid|PHPSESSID)=/i.test(setCookie));
}

function serverExposesVersion(value) {
  const server = String(value || '').trim();
  if (!server) return false;
  return /\d+\.\d+/.test(server);
}

function hasPermissionsPolicyRestrictions(value) {
  const policy = String(value || '').trim();
  if (!policy) return false;
  // Explicit device-API lockdown (recommended shape)
  if (/(?:geolocation|camera|microphone|payment|usb)\s*=\s*\([^)]*\)/i.test(policy)) {
    return true;
  }
  // Any non-empty Permissions-Policy is better than none (many valid site policies
  // only list interest-cohort / browsing-topics / etc.)
  return policy.length >= 3;
}

/** Sensitive device / privacy features used for Permissions-Policy quality. */
const PP_SENSITIVE_FEATURES = [
  'geolocation',
  'camera',
  'microphone',
  'payment',
  'usb',
  'display-capture',
  'fullscreen'
];

/**
 * feature=() | feature=(self) | feature=("self") | feature=(none)
 * — treated as restricted for that API.
 */
function permissionsFeatureIsRestricted(policy, feature) {
  const re = new RegExp(
    `(?:^|[,;\\s])${feature}\\s*=\\s*(?:\\(\\s*\\)|\\(\\s*['"]?self['"]?\\s*\\)|\\(\\s*none\\s*\\))`,
    'i'
  );
  return re.test(String(policy || ''));
}

/** feature=* — allow all origins (weak for sensitive APIs). */
function permissionsFeatureIsAllowAll(policy, feature) {
  const re = new RegExp(`(?:^|[,;\\s])${feature}\\s*=\\s*\\*(?:\\s|$|[,;])`, 'i');
  return re.test(String(policy || ''));
}

/**
 * Rate Permissions-Policy strictness without changing the presence check.
 * Returns Strict | Moderate | Weak | N/A.
 */
function analyzePermissionsPolicyStrictness(value) {
  const policy = String(value || '').trim();
  if (!policy) {
    return {
      level: 'N/A',
      pass: true,
      applicable: false,
      message: 'N/A — Permissions-Policy not present',
      reasons: []
    };
  }

  const weakReasons = [];
  for (const feature of PP_SENSITIVE_FEATURES) {
    if (permissionsFeatureIsAllowAll(policy, feature)) {
      weakReasons.push(`${feature}=*`);
    }
  }

  if (weakReasons.length) {
    return {
      level: 'Weak',
      pass: false,
      applicable: true,
      message: `Fail — Weak — sensitive APIs allow all origins (${weakReasons.join('; ')})`,
      reasons: weakReasons
    };
  }

  const restrictedSensitive = PP_SENSITIVE_FEATURES.filter((f) =>
    permissionsFeatureIsRestricted(policy, f)
  );
  const privacyTopics =
    permissionsFeatureIsRestricted(policy, 'interest-cohort') ||
    permissionsFeatureIsRestricted(policy, 'browsing-topics') ||
    /interest-cohort\s*=\s*\(\s*\)/i.test(policy) ||
    /browsing-topics\s*=\s*\(\s*\)/i.test(policy);

  // Strict: most high-risk device APIs locked down
  if (restrictedSensitive.length >= 4) {
    return {
      level: 'Strict',
      pass: true,
      applicable: true,
      message: `Pass — Strict — ${restrictedSensitive.length} sensitive APIs restricted (${restrictedSensitive.slice(0, 5).join(', ')})`,
      reasons: []
    };
  }

  // Moderate: some real restrictions (device APIs, empty allowlists, or privacy topics)
  if (restrictedSensitive.length >= 1 || privacyTopics || /=\s*\(\s*\)/.test(policy)) {
    const note =
      restrictedSensitive.length > 0
        ? `${restrictedSensitive.join(', ')} restricted`
        : privacyTopics
          ? 'privacy / topics directives only'
          : 'some features restricted';
    return {
      level: 'Moderate',
      pass: true,
      applicable: true,
      message: `Pass — Moderate — ${note}`,
      reasons: []
    };
  }

  // Present but little/no sensitive-API lockdown — still better than missing; do not fail
  return {
    level: 'Moderate',
    pass: true,
    applicable: true,
    message:
      'Pass — Moderate — limited sensitive-API coverage (prefer geolocation/camera/microphone/payment/usb = () or (self))',
    reasons: ['limited sensitive feature restrictions']
  };
}

/** Weak Referrer-Policy values that leak full URLs too aggressively. */
function isWeakReferrerPolicy(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (!v) return true;
  return v === 'unsafe-url' || v === 'no-referrer-when-downgrade';
}

/** CSP frame-ancestors is the modern replacement for X-Frame-Options. */
function cspHasFrameAncestors(cspValue) {
  return /frame-ancestors\s+/i.test(String(cspValue || ''));
}

/**
 * Parse CSP header into directive → source-list map (case-insensitive names).
 * Multiple policies in one header (comma-separated) are merged directive-wise.
 */
function parseCspDirectives(cspValue) {
  const map = Object.create(null);
  let raw = String(cspValue || '').trim();
  if (!raw) return map;

  // Multiple CSP policies may be comma-joined; treat ", directive-name " as a separator.
  raw = raw.replace(/,\s*(?=[a-zA-Z][a-zA-Z0-9-]*\s)/g, '; ');

  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const space = trimmed.search(/\s/);
    let name;
    let rest = '';
    if (space === -1) {
      name = trimmed.toLowerCase();
    } else {
      name = trimmed.slice(0, space).toLowerCase();
      rest = trimmed.slice(space + 1).trim();
    }
    if (!name) continue;
    const sources = rest ? rest.split(/\s+/).filter(Boolean) : [];
    if (!map[name]) map[name] = [];
    if (sources.length) map[name] = map[name].concat(sources);
  }
  return map;
}

function cspSourcesMatch(sources, predicate) {
  if (!sources || !sources.length) return false;
  return sources.some((s) => predicate(String(s)));
}

function cspHasToken(sources, token) {
  const t = String(token).toLowerCase();
  return cspSourcesMatch(sources, (s) => s.toLowerCase() === t);
}

function cspHasNonceOrHash(sources) {
  return cspSourcesMatch(
    sources,
    (s) => /^'nonce-/i.test(s) || /^'sha(256|384|512)-/i.test(s)
  );
}

function cspHasBareWildcard(sources) {
  return cspSourcesMatch(sources, (s) => s === '*');
}

function cspHasDataScheme(sources) {
  return cspSourcesMatch(sources, (s) => /^data:/i.test(s));
}

function cspHasSchemeSource(sources) {
  // e.g. https: or http: (scheme-only allow-all for that scheme)
  return cspSourcesMatch(sources, (s) => /^https?:$/i.test(s));
}

function cspHasHostWildcard(sources) {
  return cspSourcesMatch(sources, (s) => s.includes('*') && s !== '*');
}

function cspIsNoneOnly(sources) {
  return (
    !!sources &&
    sources.length > 0 &&
    sources.every((s) => /^'none'$/i.test(s) || /^none$/i.test(s))
  );
}

function cspIsSelfOrNone(sources) {
  return (
    !!sources &&
    sources.length > 0 &&
    sources.every(
      (s) =>
        /^'none'$/i.test(s) ||
        /^none$/i.test(s) ||
        /^'self'$/i.test(s)
    )
  );
}

function cspHasSelfOrNone(sources) {
  return (
    cspHasToken(sources, "'self'") ||
    cspHasToken(sources, "'none'") ||
    cspHasToken(sources, 'none')
  );
}

/** Explicit script directives if any; else default-src (CSP fallback). */
function getEffectiveScriptSources(map) {
  const hasExplicit =
    Object.prototype.hasOwnProperty.call(map, 'script-src') ||
    Object.prototype.hasOwnProperty.call(map, 'script-src-elem') ||
    Object.prototype.hasOwnProperty.call(map, 'script-src-attr');
  if (hasExplicit) {
    const sources = []
      .concat(map['script-src'] || [])
      .concat(map['script-src-elem'] || [])
      .concat(map['script-src-attr'] || []);
    return { sources, fromDefault: false, present: true };
  }
  if (Object.prototype.hasOwnProperty.call(map, 'default-src')) {
    return { sources: map['default-src'] || [], fromDefault: true, present: true };
  }
  return { sources: null, fromDefault: false, present: false };
}

function getEffectiveObjectSources(map) {
  if (map['object-src']) return map['object-src'];
  if (map['default-src']) return map['default-src'];
  return null;
}

/**
 * Rate CSP strictness. Always applicable so the report always lists this check.
 * Directive-aware: Weak targets script XSS risks; style-only unsafe-inline is Moderate.
 * Returns Strict | Moderate | Weak | N/A (N/A = CSP missing → Fail in report).
 */
function analyzeCspStrictness(cspValue) {
  const csp = String(cspValue || '').trim();
  if (!csp) {
    return {
      level: 'N/A',
      pass: false,
      applicable: true,
      message: 'Fail — N/A — Content-Security-Policy not present (cannot rate strictness)',
      reasons: ['Content-Security-Policy not present']
    };
  }

  const map = parseCspDirectives(csp);
  const weakReasons = [];
  const moderateReasons = [];

  const script = getEffectiveScriptSources(map);
  const scriptSrc = script.sources;
  const objectSrc = getEffectiveObjectSources(map);
  const styleSrc = map['style-src'] || map['style-src-elem'] || null;
  const defaultSrc = map['default-src'] || null;
  const baseUri = map['base-uri'] || null;
  const frameAncestors = map['frame-ancestors'] || null;

  const scriptNonceOrHash = cspHasNonceOrHash(scriptSrc);
  // Browsers ignore 'unsafe-inline' for scripts when a nonce or hash is present.
  const scriptUnsafeInlineActive =
    cspHasToken(scriptSrc, "'unsafe-inline'") && !scriptNonceOrHash;

  // ——— Weak: script XSS / open script execution ———
  if (script.present && scriptUnsafeInlineActive) {
    weakReasons.push(
      script.fromDefault
        ? "default-src allows 'unsafe-inline' (applies to scripts)"
        : "script-src allows 'unsafe-inline'"
    );
  }
  if (script.present && cspHasToken(scriptSrc, "'unsafe-eval'")) {
    weakReasons.push(
      script.fromDefault
        ? "default-src allows 'unsafe-eval' (applies to scripts)"
        : "script-src allows 'unsafe-eval'"
    );
  }
  if (script.present && cspHasBareWildcard(scriptSrc)) {
    weakReasons.push(
      script.fromDefault ? 'default-src allows * (applies to scripts)' : 'script-src allows *'
    );
  }
  if (script.present && cspHasDataScheme(scriptSrc)) {
    weakReasons.push(
      script.fromDefault ? 'default-src allows data: (scripts)' : 'script-src allows data:'
    );
  }
  if (objectSrc && cspHasBareWildcard(objectSrc)) {
    weakReasons.push('object-src allows *');
  }
  if (defaultSrc && cspHasBareWildcard(defaultSrc) && !map['script-src'] && !map['script-src-elem']) {
    // already covered when script falls back; keep if no script path
    if (!script.present) weakReasons.push('default-src allows *');
  }

  // ——— Moderate signals (do not fail score) ———
  if (!script.present) {
    moderateReasons.push('no default-src or script-src');
  }

  // Style-only unsafe-inline is common and not script XSS — moderate note only
  if (
    styleSrc &&
    cspHasToken(styleSrc, "'unsafe-inline'") &&
    !cspHasNonceOrHash(styleSrc)
  ) {
    moderateReasons.push("style-src allows 'unsafe-inline'");
  }

  // Broad script allowlist without nonce/hash/strict-dynamic
  if (
    script.present &&
    !scriptNonceOrHash &&
    !cspHasToken(scriptSrc, "'strict-dynamic'") &&
    (cspHasSchemeSource(scriptSrc) || cspHasHostWildcard(scriptSrc))
  ) {
    moderateReasons.push('broad script hosts without nonce/hash');
  }

  if (script.present && cspHasToken(scriptSrc, "'wasm-unsafe-eval'")) {
    moderateReasons.push("script allows 'wasm-unsafe-eval'");
  }

  if (weakReasons.length) {
    return {
      level: 'Weak',
      pass: false,
      applicable: true,
      message: `Fail — Weak — ${weakReasons.join('; ')}`,
      reasons: weakReasons
    };
  }

  // Hardening signals (directive-aware)
  const hasStrongDefault = cspHasSelfOrNone(defaultSrc);
  const hasObjectNone =
    cspIsNoneOnly(map['object-src']) ||
    (!map['object-src'] && cspIsNoneOnly(defaultSrc));
  const hasBaseUriLocked = cspIsSelfOrNone(baseUri);
  const hasFrameAncestorsLocked =
    cspIsSelfOrNone(frameAncestors) ||
    (frameAncestors && frameAncestors.some((s) => /^none$/i.test(s)));
  const hasScriptNonceOrHash = scriptNonceOrHash;
  const hasStrictDynamic = cspHasToken(scriptSrc, "'strict-dynamic'");

  // Strict = no weak + real script integrity + plugin lockdown + baseline policy shape.
  // style-src 'unsafe-inline' alone does not block Strict (common and not script XSS).
  const blockingModerate = moderateReasons.filter((r) => !/^style-src allows/.test(r));
  const strictReady =
    hasScriptNonceOrHash &&
    hasObjectNone &&
    (hasStrongDefault || script.present) &&
    (hasBaseUriLocked || hasFrameAncestorsLocked || hasStrictDynamic) &&
    blockingModerate.length === 0;

  if (strictReady) {
    return {
      level: 'Strict',
      pass: true,
      applicable: true,
      message:
        'Pass — Strict — script nonce/hash, object-src locked, no script unsafe-inline/eval',
      reasons: []
    };
  }

  const noteParts = [];
  if (moderateReasons.length) noteParts.push(...moderateReasons);
  if (!hasScriptNonceOrHash) noteParts.push('no script nonce/hash');
  if (!hasObjectNone) noteParts.push("object-src not 'none'");
  if (!hasStrongDefault && !script.present) noteParts.push('weak default-src');
  const note = [...new Set(noteParts)].join('; ') || 'present with limited hardening';

  return {
    level: 'Moderate',
    pass: true,
    applicable: true,
    message: `Pass — Moderate — ${note}`,
    reasons: moderateReasons
  };
}

function buildResult({ header, category, severity, pass, value, message, applicable = true }) {
  return {
    header,
    category,
    severity,
    pass,
    applicable,
    value: value || null,
    message
  };
}

/**
 * Warning-tier rows that only "pass" because the header is optional/absent.
 * Displayed under Warning (not Pass) and count as not-passed in X/Y.
 */
function isSecurityDisplayAdvisory(r) {
  if (!r || r.applicable === false) return false;
  if (r.severity !== 'warning') return false;
  if (!r.pass) return false;
  const msg = String(r.message || '');
  if (/not present/i.test(msg) && /optional/i.test(msg)) return true;
  if (/present\s*\(acceptable on non-production\)/i.test(msg)) return true;
  return false;
}

/**
 * X/Y score aligned with UI buckets (Pass points vs Issues Critical/Minor/Warning).
 * N/A (applicable:false) rows are excluded. Advisories count toward total but not passed.
 */
function summarizeSecurityHeaderResults(results) {
  const list = Array.isArray(results) ? results : [];
  const applicable = list.filter((r) => r && r.applicable !== false);
  const passedList = applicable.filter((r) => r.pass && !isSecurityDisplayAdvisory(r));
  const notPassedList = applicable.filter((r) => !r.pass || isSecurityDisplayAdvisory(r));
  const passed = passedList.length;
  const total = applicable.length;
  return {
    passed,
    total,
    label: total ? `${passed}/${total}` : '0/0',
    // Green only when every applicable check is a true pass (no fails, no advisories)
    ok: total > 0 && notPassedList.length === 0,
    requiredOk:
      applicable
        .filter((r) => r.severity === 'critical' || r.severity === 'minor')
        .every((r) => r.pass)
  };
}

/** Collect Set-Cookie header values (supports multi-header arrays). */
function collectSetCookieValues(map, options = {}) {
  if (Array.isArray(options.setCookies) && options.setCookies.length) {
    return options.setCookies.map((c) => String(c || '').trim()).filter(Boolean);
  }
  const raw = map['set-cookie'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((c) => String(c || '').trim()).filter(Boolean);
  // Some stacks join cookies with newlines
  return String(raw)
    .split(/\n/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function parseSetCookieFlags(setCookieLine) {
  const parts = String(setCookieLine || '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const nameValue = parts[0] || '';
  const name = nameValue.split('=')[0] || '(cookie)';
  let sameSite = null;
  for (const p of parts.slice(1)) {
    const m = p.match(/^SameSite\s*=\s*(.+)$/i);
    if (m) sameSite = m[1].trim();
  }
  return {
    name,
    httpOnly: parts.some((p) => /^HttpOnly$/i.test(p)),
    secure: parts.some((p) => /^Secure$/i.test(p)),
    sameSite
  };
}

/**
 * Detect active/passive mixed content (http:// assets on https pages).
 */
function analyzeMixedContent(html, pageUrl) {
  let isHttps = false;
  try {
    isHttps = new URL(pageUrl).protocol === 'https:';
  } catch {
    isHttps = /^https:/i.test(String(pageUrl || ''));
  }
  if (!isHttps) {
    return {
      pass: true,
      applicable: true,
      severity: 'warning',
      message: 'N/A — page is not served over HTTPS',
      activeCount: 0,
      passiveCount: 0
    };
  }
  const body = String(html || '');
  if (!body.trim()) {
    return {
      pass: true,
      applicable: true,
      severity: 'warning',
      message: 'Not scanned — page HTML not available in this check path',
      activeCount: 0,
      passiveCount: 0
    };
  }

  const countMatches = (re) => {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    const r = new RegExp(re.source, flags);
    const found = body.match(r);
    return found ? found.length : 0;
  };

  // Active mixed content (can break pages / XSS risk)
  const activeCount =
    countMatches(/<script\b[^>]*\bsrc\s*=\s*["']http:\/\//i) +
    countMatches(/<iframe\b[^>]*\bsrc\s*=\s*["']http:\/\//i) +
    countMatches(/<link\b[^>]*\bhref\s*=\s*["']http:\/\/[^"']*\.css/i) +
    countMatches(/<object\b[^>]*\bdata\s*=\s*["']http:\/\//i) +
    countMatches(/<embed\b[^>]*\bsrc\s*=\s*["']http:\/\//i);

  // Passive mixed content (images/media)
  const passiveCount =
    countMatches(/<img\b[^>]*\bsrc\s*=\s*["']http:\/\//i) +
    countMatches(/<audio\b[^>]*\bsrc\s*=\s*["']http:\/\//i) +
    countMatches(/<video\b[^>]*\bsrc\s*=\s*["']http:\/\//i) +
    countMatches(/<source\b[^>]*\bsrc\s*=\s*["']http:\/\//i) +
    countMatches(/url\(\s*['"]?http:\/\//i);

  if (activeCount > 0) {
    return {
      pass: false,
      applicable: true,
      severity: 'critical',
      message: `Fail — ${activeCount} active mixed-content resource(s) (script/iframe/css over http:)`,
      activeCount,
      passiveCount
    };
  }
  if (passiveCount > 0) {
    return {
      pass: false,
      applicable: true,
      severity: 'minor',
      message: `Fail — ${passiveCount} passive mixed-content resource(s) (img/media over http:)`,
      activeCount,
      passiveCount
    };
  }
  return {
    pass: true,
    applicable: true,
    severity: 'critical',
    message: 'Pass — no http: assets found on this HTTPS page',
    activeCount: 0,
    passiveCount: 0
  };
}

/**
 * Assert HTTP security headers / transport / cookie / mixed-content rules.
 * @param {object} rawHeaders - Response headers (fetch or Playwright)
 * @param {{ url?: string, html?: string, setCookies?: string[] }} options
 */
function assertHttpSecurityHeaders(rawHeaders, options = {}) {
  const { url = '', html = '' } = options;
  const map = normalizeHeaderMap(rawHeaders);
  const results = [];
  /** @type {string[]} Critical failures (score-heavy) */
  const failures = [];
  /** @type {string[]} Minor hygiene issues */
  const minors = [];
  /** @type {string[]} Warnings (advanced / deprecated) */
  const warnings = [];

  function recordIssue(severity, message) {
    if (severity === 'critical') failures.push(message);
    else if (severity === 'minor') minors.push(message);
    else warnings.push(message);
  }

  // ——— Transport: HTTPS / SSL / TLS ———
  let pageProtocol = '';
  try {
    pageProtocol = new URL(url).protocol.replace(':', '').toLowerCase();
  } catch {
    pageProtocol = '';
  }
  const isHttps = pageProtocol === 'https';

  results.push(
    buildResult({
      header: 'HTTPS',
      category: 'essential',
      severity: 'critical',
      pass: isHttps,
      value: pageProtocol || null,
      message: isHttps
        ? 'Pass — page URL uses HTTPS'
        : 'Fail — page URL is not HTTPS (use https://)'
    })
  );
  if (!isHttps) recordIssue('critical', 'HTTPS: page URL is not HTTPS');

  results.push(
    buildResult({
      header: 'SSL / TLS',
      category: 'essential',
      severity: 'critical',
      pass: isHttps,
      value: isHttps ? 'TLS (HTTPS connection)' : 'none',
      message: isHttps
        ? 'Pass — traffic is encrypted via HTTPS/TLS'
        : 'Fail — no TLS (page not loaded over HTTPS)'
    })
  );
  if (!isHttps) recordIssue('critical', 'SSL / TLS: no TLS — page not loaded over HTTPS');

  // Exact TLS version needs platform/socket inspection; document clearly in report
  results.push(
    buildResult({
      header: 'TLS Version',
      category: 'quality',
      severity: 'warning',
      pass: true,
      applicable: true,
      value: isHttps ? 'negotiated' : 'n/a',
      message: isHttps
        ? 'Pass — TLS version is negotiated by the platform; exact version not verified here'
        : 'N/A — not applicable without HTTPS'
    })
  );

  // Mixed content (needs HTML when available)
  const mixed = analyzeMixedContent(html, url);
  results.push(
    buildResult({
      header: 'Mixed Content',
      category: 'essential',
      severity: mixed.severity || 'critical',
      pass: mixed.pass,
      value:
        mixed.activeCount || mixed.passiveCount
          ? `active=${mixed.activeCount}, passive=${mixed.passiveCount}`
          : null,
      message: mixed.message
    })
  );
  if (!mixed.pass) {
    recordIssue(
      mixed.severity === 'minor' ? 'minor' : 'critical',
      `Mixed Content: ${mixed.message}`
    );
  }

  // ——— Critical baseline (headers) ———
  const csp = getHeaderValue(map, 'content-security-policy');
  const cspPass = Boolean(String(csp).trim());
  results.push(
    buildResult({
      header: 'Content-Security-Policy',
      category: 'essential',
      severity: 'critical',
      pass: cspPass,
      value: csp,
      message: cspPass ? 'OK' : 'Content-Security-Policy missing or empty'
    })
  );
  if (!cspPass) recordIssue('critical', 'Content-Security-Policy: missing or empty');

  // CSP Strictness: always listed — Fail when missing/weak; Pass when Moderate/Strict
  const cspStrict = analyzeCspStrictness(csp);
  results.push(
    buildResult({
      header: 'CSP Strictness',
      category: 'quality',
      severity: 'critical',
      pass: cspStrict.pass,
      applicable: true,
      value: cspStrict.level,
      message: cspStrict.message
    })
  );
  if (!cspStrict.pass) {
    recordIssue('critical', `CSP Strictness: ${cspStrict.message}`);
  }

  // XSS / CSP Protection — always-visible composite (CSP present + not Weak/N/A fail)
  const xssCspPass = cspPass && cspStrict.pass;
  let xssCspMessage;
  if (!cspPass) {
    xssCspMessage =
      'Fail — no Content-Security-Policy (primary XSS mitigation header missing)';
  } else if (!cspStrict.pass) {
    xssCspMessage = `Fail — CSP present but weak (${cspStrict.level}): ${cspStrict.message.replace(/^Fail — /i, '')}`;
  } else {
    xssCspMessage = `Pass — CSP present (${cspStrict.level}) without script-unsafe weaknesses`;
  }
  results.push(
    buildResult({
      header: 'XSS / CSP Protection',
      category: 'essential',
      severity: 'critical',
      pass: xssCspPass,
      value: cspStrict.level || (cspPass ? 'present' : 'missing'),
      message: xssCspMessage
    })
  );
  if (!xssCspPass) {
    recordIssue('critical', `XSS / CSP Protection: ${xssCspMessage}`);
  }

  const hsts = getHeaderValue(map, 'strict-transport-security');
  const hstsPass = /max-age/i.test(String(hsts));
  results.push(
    buildResult({
      header: 'Strict-Transport-Security',
      category: 'essential',
      severity: 'critical',
      pass: hstsPass,
      value: hsts,
      message: hstsPass ? 'OK' : "Strict-Transport-Security missing or 'max-age' not set"
    })
  );
  if (!hstsPass) recordIssue('critical', "Strict-Transport-Security: must contain 'max-age'");

  // Clickjacking = X-Frame-Options OR CSP frame-ancestors
  const xfo = getHeaderValue(map, 'x-frame-options');
  const xfoClassic = /^(DENY|SAMEORIGIN)$/i.test(String(xfo).trim());
  const frameAncestorsOk = cspHasFrameAncestors(csp);
  const clickjackPass = xfoClassic || frameAncestorsOk;
  let clickjackMessage = 'Pass';
  if (clickjackPass && xfoClassic) {
    clickjackMessage = `Pass — X-Frame-Options ${String(xfo).trim()}`;
  } else if (clickjackPass && frameAncestorsOk) {
    clickjackMessage =
      'Pass — framing protected via CSP frame-ancestors (X-Frame-Options not required)';
  } else if (String(xfo).trim()) {
    clickjackMessage =
      'Fail — X-Frame-Options invalid (use DENY/SAMEORIGIN) and no CSP frame-ancestors';
  } else {
    clickjackMessage =
      'Fail — missing framing protection (set X-Frame-Options DENY/SAMEORIGIN or CSP frame-ancestors)';
  }
  results.push(
    buildResult({
      header: 'Clickjacking Protection',
      category: 'essential',
      severity: 'critical',
      pass: clickjackPass,
      value: xfo || (frameAncestorsOk ? '(via CSP frame-ancestors)' : xfo),
      message: clickjackMessage
    })
  );
  if (!clickjackPass) {
    recordIssue(
      'critical',
      'Clickjacking Protection: set X-Frame-Options to DENY/SAMEORIGIN or CSP frame-ancestors'
    );
  }

  // MIME sniffing = X-Content-Type-Options: nosniff
  const xcto = getHeaderValue(map, 'x-content-type-options');
  const mimePass = String(xcto).trim().toLowerCase() === 'nosniff';
  results.push(
    buildResult({
      header: 'MIME Sniffing Protection',
      category: 'essential',
      severity: 'critical',
      pass: mimePass,
      value: xcto,
      message: mimePass
        ? "Pass — X-Content-Type-Options: nosniff"
        : "Fail — X-Content-Type-Options must be 'nosniff'"
    })
  );
  if (!mimePass) {
    recordIssue('critical', "MIME Sniffing Protection: X-Content-Type-Options must be 'nosniff'");
  }

  // ——— Cookies (Set-Cookie flags) ———
  const setCookies = collectSetCookieValues(map, options);
  const cookieFlags = setCookies.map(parseSetCookieFlags);
  const hasCookies = cookieFlags.length > 0;

  const missingHttpOnly = cookieFlags.filter((c) => !c.httpOnly);
  const httpOnlyPass = !hasCookies || missingHttpOnly.length === 0;
  results.push(
    buildResult({
      header: 'HttpOnly Cookies',
      category: 'essential',
      severity: 'minor',
      pass: httpOnlyPass,
      value: hasCookies ? `${cookieFlags.length} cookie(s)` : 'none',
      message: !hasCookies
        ? 'Pass — no Set-Cookie headers on this response'
        : httpOnlyPass
          ? `Pass — all ${cookieFlags.length} Set-Cookie value(s) include HttpOnly`
          : `Fail — ${missingHttpOnly.length} cookie(s) missing HttpOnly (${missingHttpOnly
              .slice(0, 3)
              .map((c) => c.name)
              .join(', ')})`
    })
  );
  if (!httpOnlyPass) {
    recordIssue('minor', 'HttpOnly Cookies: one or more Set-Cookie values lack HttpOnly');
  }

  const missingSecure = cookieFlags.filter((c) => !c.secure);
  // Secure required when site is HTTPS; if HTTP, Secure cookies are still recommended for future HTTPS
  const securePass = !hasCookies || missingSecure.length === 0;
  results.push(
    buildResult({
      header: 'Secure Cookies',
      category: 'essential',
      severity: 'minor',
      pass: securePass,
      value: hasCookies ? `${cookieFlags.length} cookie(s)` : 'none',
      message: !hasCookies
        ? 'Pass — no Set-Cookie headers on this response'
        : securePass
          ? `Pass — all ${cookieFlags.length} Set-Cookie value(s) include Secure`
          : `Fail — ${missingSecure.length} cookie(s) missing Secure (${missingSecure
              .slice(0, 3)
              .map((c) => c.name)
              .join(', ')})`
    })
  );
  if (!securePass) {
    recordIssue('minor', 'Secure Cookies: one or more Set-Cookie values lack Secure');
  }

  const missingSameSite = cookieFlags.filter((c) => !c.sameSite);
  const sameSitePass = !hasCookies || missingSameSite.length === 0;
  results.push(
    buildResult({
      header: 'SameSite Cookies',
      category: 'essential',
      severity: 'minor',
      pass: sameSitePass,
      value: hasCookies ? `${cookieFlags.length} cookie(s)` : 'none',
      message: !hasCookies
        ? 'Pass — no Set-Cookie headers on this response'
        : sameSitePass
          ? `Pass — all ${cookieFlags.length} Set-Cookie value(s) set SameSite`
          : `Fail — ${missingSameSite.length} cookie(s) missing SameSite (${missingSameSite
              .slice(0, 3)
              .map((c) => c.name)
              .join(', ')})`
    })
  );
  if (!sameSitePass) {
    recordIssue('minor', 'SameSite Cookies: one or more Set-Cookie values lack SameSite');
  }

  // ——— Minor hygiene ———
  const referrer = getHeaderValue(map, 'referrer-policy');
  const referrerPresent = Boolean(String(referrer).trim());
  const referrerWeak = isWeakReferrerPolicy(referrer);
  const referrerPass = referrerPresent && !referrerWeak;
  results.push(
    buildResult({
      header: 'Referrer-Policy',
      category: 'essential',
      severity: 'minor',
      pass: referrerPass,
      value: referrer,
      message: !referrerPresent
        ? 'Referrer-Policy missing or empty'
        : referrerWeak
          ? `Weak Referrer-Policy "${String(referrer).trim()}" (avoid unsafe-url / no-referrer-when-downgrade)`
          : 'OK'
    })
  );
  if (!referrerPass) {
    recordIssue(
      'minor',
      referrerPresent
        ? `Referrer-Policy: weak value "${String(referrer).trim()}" — use strict-origin-when-cross-origin or stricter`
        : 'Referrer-Policy: must be present'
    );
  }

  const permissions = getHeaderValue(map, 'permissions-policy');
  const permissionsPass = hasPermissionsPolicyRestrictions(permissions);
  results.push(
    buildResult({
      header: 'Permissions-Policy',
      category: 'essential',
      severity: 'minor',
      pass: permissionsPass,
      value: permissions,
      message: permissionsPass
        ? String(permissions).trim()
          ? 'OK'
          : 'OK'
        : 'Permissions-Policy missing or empty (recommend restricting geolocation/camera/etc.)'
    })
  );
  if (!permissionsPass) {
    recordIssue('minor', 'Permissions-Policy: must be present (non-empty)');
  }

  // Permissions-Policy Strictness: Weak = minor; N/A when header missing (no double-count)
  const ppStrict = analyzePermissionsPolicyStrictness(permissions);
  results.push(
    buildResult({
      header: 'Permissions-Policy Strictness',
      category: 'quality',
      severity: 'minor',
      pass: ppStrict.pass,
      applicable: ppStrict.applicable,
      value: ppStrict.level,
      message: ppStrict.message
    })
  );
  if (ppStrict.applicable && !ppStrict.pass) {
    recordIssue('minor', `Permissions-Policy Strictness: ${ppStrict.message}`);
  }

  // CORP: optional on HTML documents — only fail if present with a bad value
  const corp = getHeaderValue(map, 'cross-origin-resource-policy');
  const corpPresent = Boolean(String(corp).trim());
  const corpValid = /^(same-origin|same-site|cross-origin)$/i.test(String(corp).trim());
  const corpPass = !corpPresent || corpValid;
  results.push(
    buildResult({
      header: 'Cross-Origin-Resource-Policy',
      category: 'essential',
      severity: 'warning',
      pass: corpPass,
      value: corp,
      message: !corpPresent
        ? 'Not present (optional for HTML pages; recommended for APIs/static assets)'
        : corpValid
          ? 'OK'
          : "Invalid Cross-Origin-Resource-Policy (use same-origin, same-site, or cross-origin)"
    })
  );
  if (corpPresent && !corpValid) {
    recordIssue(
      'warning',
      "Cross-Origin-Resource-Policy: invalid value (use same-origin, same-site, or cross-origin)"
    );
  }

  // COEP / COOP: advanced isolation — optional; only fail if present but invalid
  const coep = getHeaderValue(map, 'cross-origin-embedder-policy');
  const coepPresent = Boolean(String(coep).trim());
  const coepValid = /^(require-corp|credentialless|unsafe-none)$/i.test(String(coep).trim());
  const coepPass = !coepPresent || coepValid;
  results.push(
    buildResult({
      header: 'Cross-Origin-Embedder-Policy',
      category: 'essential',
      severity: 'warning',
      pass: coepPass,
      value: coep,
      message: !coepPresent
        ? 'Not present (optional — only needed for cross-origin isolation)'
        : coepValid
          ? 'OK'
          : "Invalid Cross-Origin-Embedder-Policy (use require-corp or credentialless)"
    })
  );
  if (coepPresent && !coepValid) {
    recordIssue(
      'warning',
      "Cross-Origin-Embedder-Policy: invalid value (use require-corp or credentialless)"
    );
  }

  const coop = getHeaderValue(map, 'cross-origin-opener-policy');
  const coopPresent = Boolean(String(coop).trim());
  const coopValid =
    /^(same-origin|same-origin-allow-popups|noopener-allow-popups|unsafe-none)$/i.test(
      String(coop).trim()
    );
  const coopPass = !coopPresent || coopValid;
  results.push(
    buildResult({
      header: 'Cross-Origin-Opener-Policy',
      category: 'essential',
      severity: 'warning',
      pass: coopPass,
      value: coop,
      message: !coopPresent
        ? 'Not present (optional — only needed for cross-origin isolation)'
        : coopValid
          ? 'OK'
          : "Invalid Cross-Origin-Opener-Policy"
    })
  );
  if (coopPresent && !coopValid) {
    recordIssue(
      'warning',
      "Cross-Origin-Opener-Policy: invalid value"
    );
  }

  // ——— Critical when applicable (private routes) ———
  const privateRoute = isPrivateOrAuthenticatedRoute(url, map);
  const cacheControl = getHeaderValue(map, 'cache-control');
  const cachePass = !privateRoute || /no-store/i.test(String(cacheControl));
  results.push(
    buildResult({
      header: 'Cache-Control',
      category: 'essential',
      severity: 'critical',
      pass: cachePass,
      applicable: privateRoute,
      value: cacheControl,
      message: !privateRoute
        ? 'Not required for public route'
        : cachePass
          ? 'OK'
          : "Cache-Control must contain 'no-store' on private/authenticated routes"
    })
  );
  if (privateRoute && !cachePass) {
    recordIssue('critical', "Cache-Control: must contain 'no-store' on private/authenticated routes");
  }

  // ——— Warning: environment ———
  const cspReportOnly = getHeaderValue(map, 'content-security-policy-report-only');
  const cspReportOnlyPresent = Boolean(String(cspReportOnly).trim());
  const production = isProductionUrl(url);
  const cspRoWarn = production && cspReportOnlyPresent;
  results.push(
    buildResult({
      header: 'Content-Security-Policy-Report-Only',
      category: 'environment',
      severity: 'warning',
      pass: !cspRoWarn,
      value: cspReportOnly,
      message: cspRoWarn
        ? 'Found on production URL — should use enforcing CSP only'
        : cspReportOnlyPresent
          ? 'Present (acceptable on non-production)'
          : 'Not present'
    })
  );
  if (cspRoWarn) {
    recordIssue(
      'warning',
      'Content-Security-Policy-Report-Only: present on production URL (use enforcing CSP in production)'
    );
  }

  // ——— Minor: info disclosure ———
  const server = getHeaderValue(map, 'server');
  const serverLeak = serverExposesVersion(server);
  results.push(
    buildResult({
      header: 'Server',
      category: 'leak',
      severity: 'minor',
      pass: !serverLeak,
      value: server,
      message: serverLeak
        ? 'Server header exposes software version numbers'
        : server
          ? 'OK (no version leak detected)'
          : 'Not present'
    })
  );
  if (serverLeak) {
    recordIssue('minor', 'Server: exposes explicit software version numbers');
  }

  const poweredBy = getHeaderValue(map, 'x-powered-by');
  const poweredByAbsent = !String(poweredBy).trim();
  results.push(
    buildResult({
      header: 'X-Powered-By',
      category: 'leak',
      severity: 'minor',
      pass: poweredByAbsent,
      value: poweredBy,
      message: poweredByAbsent ? 'OK (absent)' : 'X-Powered-By must be absent'
    })
  );
  if (!poweredByAbsent) {
    recordIssue('minor', 'X-Powered-By: must be completely absent');
  }

  // ——— Warning: deprecated ———
  const xss = getHeaderValue(map, 'x-xss-protection');
  const xssPresent = Boolean(String(xss).trim());
  results.push(
    buildResult({
      header: 'X-XSS-Protection',
      category: 'deprecated',
      severity: 'warning',
      pass: !xssPresent,
      value: xss,
      message: xssPresent ? 'Deprecated — remove this header' : 'OK (not present)'
    })
  );
  if (xssPresent) {
    recordIssue('warning', 'X-XSS-Protection: deprecated header should be removed');
  }

  const expectCt = getHeaderValue(map, 'expect-ct');
  const expectCtPresent = Boolean(String(expectCt).trim());
  results.push(
    buildResult({
      header: 'Expect-CT',
      category: 'deprecated',
      severity: 'warning',
      pass: !expectCtPresent,
      value: expectCt,
      message: expectCtPresent ? 'Deprecated — remove this header' : 'OK (not present)'
    })
  );
  if (expectCtPresent) {
    recordIssue('warning', 'Expect-CT: deprecated header should be removed');
  }

  // X/Y matches UI: every applicable row is Pass, Critical, Minor, or Warning (incl. advisories)
  const summary = summarizeSecurityHeaderResults(results);

  return {
    ok: summary.ok,
    // No critical failures (minors/warnings still reflected in X/Y and chip color via ok)
    criticalOk: failures.length === 0,
    requiredOk: summary.requiredOk,
    passed: summary.passed,
    total: summary.total,
    label: summary.label,
    results,
    failures,
    minors,
    warnings,
    categories: {
      essential: results.filter((r) => r.category === 'essential'),
      environment: results.filter((r) => r.category === 'environment'),
      leak: results.filter((r) => r.category === 'leak'),
      deprecated: results.filter((r) => r.category === 'deprecated'),
      quality: results.filter((r) => r.category === 'quality')
    }
  };
}

module.exports = {
  assertHttpSecurityHeaders,
  analyzeCspStrictness,
  analyzeMixedContent,
  parseCspDirectives,
  analyzePermissionsPolicyStrictness,
  summarizeSecurityHeaderResults,
  isSecurityDisplayAdvisory,
  normalizeHeaderMap,
  getHeaderValue,
  isProductionUrl,
  isPrivateOrAuthenticatedRoute,
  serverExposesVersion,
  hasPermissionsPolicyRestrictions,
  isWeakReferrerPolicy,
  cspHasFrameAncestors,
  // Typical public page: all applicable rows (dynamic total from summarize is authoritative).
  HEADER_CHECK_COUNT: 26
};