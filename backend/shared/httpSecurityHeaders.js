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
  return /(?:geolocation|camera|microphone|payment|usb)\s*=\s*\([^)]*\)/i.test(policy);
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

  const xfo = getHeaderValue(map, 'x-frame-options');
  const xfoPass = /^(DENY|SAMEORIGIN)$/i.test(String(xfo).trim());
  results.push(
    buildResult({
      header: 'X-Frame-Options',
      category: 'essential',
      severity: 'critical',
      pass: xfoPass,
      value: xfo,
      message: xfoPass ? 'OK' : "X-Frame-Options must be 'DENY' or 'SAMEORIGIN'"
    })
  );
  if (!xfoPass) recordIssue('critical', "X-Frame-Options: must be 'DENY' or 'SAMEORIGIN'");

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
  const referrerPass = Boolean(String(referrer).trim());
  results.push(
    buildResult({
      header: 'Referrer-Policy',
      category: 'essential',
      severity: 'minor',
      pass: referrerPass,
      value: referrer,
      message: referrerPass ? 'OK' : 'Referrer-Policy missing or empty'
    })
  );
  if (!referrerPass) recordIssue('minor', 'Referrer-Policy: must be present');

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
        ? 'OK'
        : 'Permissions-Policy missing or does not restrict device APIs (e.g. geolocation=())'
    })
  );
  if (!permissionsPass) {
    recordIssue(
      'minor',
      'Permissions-Policy: must be present and restrict device APIs like geolocation'
    );
  }

  const corp = getHeaderValue(map, 'cross-origin-resource-policy');
  const corpPass = /^(same-origin|same-site)$/i.test(String(corp).trim());
  results.push(
    buildResult({
      header: 'Cross-Origin-Resource-Policy',
      category: 'essential',
      severity: 'minor',
      pass: corpPass,
      value: corp,
      message: corpPass ? 'OK' : "Cross-Origin-Resource-Policy must be 'same-origin' or 'same-site'"
    })
  );
  if (!corpPass) {
    recordIssue('minor', "Cross-Origin-Resource-Policy: must be 'same-origin' or 'same-site'");
  }

  // ——— Warning: advanced isolation (common to omit) ———
  const coep = getHeaderValue(map, 'cross-origin-embedder-policy');
  const coepPass = /^(require-corp|credentialless)$/i.test(String(coep).trim());
  results.push(
    buildResult({
      header: 'Cross-Origin-Embedder-Policy',
      category: 'essential',
      severity: 'warning',
      pass: coepPass,
      value: coep,
      message: coepPass
        ? 'OK'
        : "Cross-Origin-Embedder-Policy must be 'require-corp' or 'credentialless'"
    })
  );
  if (!coepPass) {
    recordIssue(
      'warning',
      "Cross-Origin-Embedder-Policy: must be 'require-corp' or 'credentialless'"
    );
  }

  const coop = getHeaderValue(map, 'cross-origin-opener-policy');
  const coopPass =
    /^(same-origin|same-origin-allow-popups|noopener-allow-popups)$/i.test(
      String(coop).trim()
    );
  results.push(
    buildResult({
      header: 'Cross-Origin-Opener-Policy',
      category: 'essential',
      severity: 'warning',
      pass: coopPass,
      value: coop,
      message: coopPass
        ? 'OK'
        : "Cross-Origin-Opener-Policy must be 'same-origin', 'same-origin-allow-popups', or 'noopener-allow-popups'"
    })
  );
  if (!coopPass) {
    recordIssue(
      'warning',
      "Cross-Origin-Opener-Policy: must be 'same-origin', 'same-origin-allow-popups', or 'noopener-allow-popups'"
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
  normalizeHeaderMap,
  getHeaderValue,
  isProductionUrl,
  isPrivateOrAuthenticatedRoute,
  serverExposesVersion,
  hasPermissionsPolicyRestrictions,
  // Approximate scored critical/leak checks on a typical public page (dynamic total is authoritative).
  HEADER_CHECK_COUNT: 15
};