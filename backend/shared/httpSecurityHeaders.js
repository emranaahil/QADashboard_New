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
      message: `Weak — sensitive APIs allow all origins (${weakReasons.join('; ')})`,
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
      message: `Strict — ${restrictedSensitive.length} sensitive APIs restricted (${restrictedSensitive.slice(0, 5).join(', ')})`,
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
      message: `Moderate — ${note}`,
      reasons: []
    };
  }

  // Present but little/no sensitive-API lockdown — still better than missing; do not fail
  return {
    level: 'Moderate',
    pass: true,
    applicable: true,
    message:
      'Moderate — limited sensitive-API coverage (prefer geolocation/camera/microphone/payment/usb = () or (self))',
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
 * Rate CSP strictness without changing the CSP presence check.
 * Returns Strict | Moderate | Weak | N/A.
 */
function analyzeCspStrictness(cspValue) {
  const csp = String(cspValue || '').trim();
  if (!csp) {
    return {
      level: 'N/A',
      pass: true,
      applicable: false,
      message: "N/A — Content-Security-Policy not present",
      reasons: []
    };
  }

  const lower = csp.toLowerCase();
  const weakReasons = [];
  const moderateReasons = [];

  if (/['"]unsafe-inline['"]/i.test(csp)) {
    weakReasons.push("'unsafe-inline'");
  }
  if (/['"]unsafe-eval['"]/i.test(csp)) {
    weakReasons.push("'unsafe-eval'");
  }
  if (/\*\s*(?:;|$)/.test(lower) || /(?:default-src|script-src|object-src)\s+[^;]*\*/i.test(csp)) {
    weakReasons.push('wildcard * source');
  }
  if (/(?:script-src)[^;]*\bdata:/i.test(lower)) {
    weakReasons.push('script-src allows data:');
  }

  if (!/(?:default-src|script-src)\s+/i.test(csp)) {
    moderateReasons.push('no default-src or script-src');
  }
  if (/(?:script-src)[^;]*\bhttps?:/i.test(lower) && !/['"]nonce-/i.test(csp) && !/['"]sha(256|384|512)-/i.test(csp)) {
    moderateReasons.push('broad script hosts without nonce/hash');
  }

  if (weakReasons.length) {
    return {
      level: 'Weak',
      pass: false,
      applicable: true,
      message: `Weak — ${weakReasons.join('; ')}`,
      reasons: weakReasons
    };
  }

  const hasStrongDefault =
    /default-src\s+[^;]*['"]self['"]/i.test(csp) || /default-src\s+[^;]*['"]none['"]/i.test(csp);
  const hasObjectNone = /object-src\s+[^;]*['"]none['"]/i.test(csp);
  const hasBaseUri =
    /base-uri\s+[^;]*['"](?:self|none)['"]/i.test(csp);
  const hasFrameAncestors =
    /frame-ancestors\s+[^;]*['"](?:self|none)['"]/i.test(csp) ||
    /frame-ancestors\s+[^;]*\bnone\b/i.test(csp);
  const hasNonceOrHash = /['"]nonce-/i.test(csp) || /['"]sha(256|384|512)-/i.test(csp);

  const strictSignals = [hasStrongDefault, hasObjectNone, hasBaseUri, hasFrameAncestors, hasNonceOrHash].filter(
    Boolean
  ).length;

  if (moderateReasons.length === 0 && strictSignals >= 2 && !weakReasons.length) {
    return {
      level: 'Strict',
      pass: true,
      applicable: true,
      message: 'Strict — solid directives without unsafe-inline/eval',
      reasons: []
    };
  }

  if (moderateReasons.length || strictSignals < 2) {
    const note = moderateReasons.length
      ? moderateReasons.join('; ')
      : 'present with limited hardening directives';
    return {
      level: 'Moderate',
      pass: true,
      applicable: true,
      message: `Moderate — ${note}`,
      reasons: moderateReasons
    };
  }

  return {
    level: 'Moderate',
    pass: true,
    applicable: true,
    message: 'Moderate — CSP present',
    reasons: []
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
 * Assert HTTP security headers against detection rules
 * (CSP, HSTS, frame/options, CORP/COEP/COOP, leaks, deprecated, etc.).
 * @param {object} rawHeaders - Response headers (fetch or Playwright)
 * @param {{ url?: string }} options
 */
function assertHttpSecurityHeaders(rawHeaders, options = {}) {
  const { url = '' } = options;
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

  // ——— Critical baseline ———
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

  // CSP Strictness: Weak = critical; N/A when CSP missing (no double-count)
  const cspStrict = analyzeCspStrictness(csp);
  results.push(
    buildResult({
      header: 'CSP Strictness',
      category: 'quality',
      severity: 'critical',
      pass: cspStrict.pass,
      applicable: cspStrict.applicable,
      value: cspStrict.level,
      message: cspStrict.message
    })
  );
  if (cspStrict.applicable && !cspStrict.pass) {
    recordIssue('critical', `CSP Strictness: ${cspStrict.message}`);
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

  // X-Frame-Options OR modern CSP frame-ancestors (either is enough for clickjacking baseline)
  const xfo = getHeaderValue(map, 'x-frame-options');
  const xfoClassic = /^(DENY|SAMEORIGIN)$/i.test(String(xfo).trim());
  const frameAncestorsOk = cspHasFrameAncestors(csp);
  const xfoPass = xfoClassic || frameAncestorsOk;
  let xfoMessage = 'OK';
  if (xfoPass && xfoClassic) xfoMessage = 'OK';
  else if (xfoPass && frameAncestorsOk) {
    xfoMessage = "OK — framing protected via CSP frame-ancestors (X-Frame-Options not required)";
  } else if (String(xfo).trim()) {
    xfoMessage = "X-Frame-Options invalid (use DENY/SAMEORIGIN) and no CSP frame-ancestors";
  } else {
    xfoMessage =
      "Missing framing protection — set X-Frame-Options DENY/SAMEORIGIN or CSP frame-ancestors";
  }
  results.push(
    buildResult({
      header: 'X-Frame-Options',
      category: 'essential',
      severity: 'critical',
      pass: xfoPass,
      value: xfo || (frameAncestorsOk ? '(via CSP frame-ancestors)' : xfo),
      message: xfoMessage
    })
  );
  if (!xfoPass) {
    recordIssue(
      'critical',
      "X-Frame-Options / CSP: set X-Frame-Options to 'DENY' or 'SAMEORIGIN', or CSP frame-ancestors"
    );
  }

  const xcto = getHeaderValue(map, 'x-content-type-options');
  const xctoPass = String(xcto).trim().toLowerCase() === 'nosniff';
  results.push(
    buildResult({
      header: 'X-Content-Type-Options',
      category: 'essential',
      severity: 'critical',
      pass: xctoPass,
      value: xcto,
      message: xctoPass ? 'OK' : "X-Content-Type-Options must be 'nosniff'"
    })
  );
  if (!xctoPass) recordIssue('critical', "X-Content-Type-Options: must be 'nosniff'");

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

  // Score X/Y on critical + minor only (warnings visible but don't dominate pass rate)
  const applicableRequired = results.filter(
    (r) =>
      r.applicable !== false && (r.severity === 'critical' || r.severity === 'minor')
  );
  const passed = applicableRequired.filter((r) => r.pass).length;
  const total = applicableRequired.length;

  return {
    ok: failures.length === 0,
    passed,
    total,
    label: `${passed}/${total}`,
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
  analyzePermissionsPolicyStrictness,
  normalizeHeaderMap,
  getHeaderValue,
  isProductionUrl,
  isPrivateOrAuthenticatedRoute,
  serverExposesVersion,
  hasPermissionsPolicyRestrictions,
  isWeakReferrerPolicy,
  cspHasFrameAncestors,
  // Approximate scored critical/leak checks on a typical public page (dynamic total is authoritative).
  HEADER_CHECK_COUNT: 16
};