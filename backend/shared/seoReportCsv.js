/**
 * SEO report CSV builders (server + HTML report export).
 */

const CSV_BOM = '\uFEFF';

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function joinIssues(items) {
  return (items || []).filter(Boolean).join('; ');
}

function parseIssueCode(summary) {
  const text = String(summary || '').trim();
  const lower = text.toLowerCase();

  if (lower.startsWith('images without alt')) return 'missing-alt';
  if (lower.startsWith('broken heading hierarchy')) return 'broken-hierarchy';
  if (lower.startsWith('missing <h1>')) return 'missing-h1';
  if (lower.startsWith('multiple <h1>') || /^h1 tags\s*\(/i.test(text)) return 'multiple-h1';
  if (lower.startsWith('empty <h1>')) return 'empty-h1';
  if (lower.startsWith('duplicate <h1>')) return 'duplicate-h1';
  if (lower.startsWith('missing <title>')) return 'missing-title';
  if (lower.startsWith('empty <title>')) return 'empty-title';
  if (/^title tags\s*\(/i.test(text)) return 'multiple-title';
  if (lower.startsWith('empty/invalid title')) return 'empty-title-dom';
  if (lower.startsWith('duplicate title')) return 'duplicate-title';
  if (lower.startsWith('duplicate description')) return 'duplicate-description';
  if (lower.startsWith('page meta description')) return 'meta-description';
  if (lower.startsWith('page meta keywords')) return 'meta-keywords';
  if (lower.startsWith('meta description tags')) return 'multiple-meta-description';
  if (lower.startsWith('meta keywords tags')) return 'multiple-meta-keywords';
  if (lower.startsWith('missing canonical')) return 'missing-canonical';
  if (lower.startsWith('missing open graph')) return 'missing-og';
  if (lower.startsWith('missing twitter card')) return 'missing-twitter-card';
  if (lower.startsWith('empty og:') || lower.startsWith('empty twitter:')) return 'empty-social-meta';
  if (
    lower.startsWith('http security header') ||
    lower.startsWith('csp strictness') ||
    /^content-security-policy:|^strict-transport-security:|^x-frame-options:|^x-content-type-options:|^referrer-policy:|^permissions-policy:|^cross-origin-|^x-powered-by:|^x-xss-protection:|^expect-ct:|^cache-control:|^server:/i.test(
      text
    )
  ) {
    return 'http-security-header';
  }
  // Bad links — titles use em dash: "Bad links — href=\"#\"" / "Bad links — javascript:void(0)"
  if (/^bad links/i.test(text) && /javascript\s*:\s*void/i.test(lower)) return 'bad-js-void';
  if (/^bad links/i.test(text) && (lower.includes('href') || lower.includes('#'))) return 'bad-href-hash';
  if (lower.startsWith('missing viewport')) return 'missing-viewport';
  if (lower.startsWith('missing <html lang>')) return 'missing-html-lang';
  if (lower.startsWith('robots meta conflict')) return 'robots-meta-conflict';
  if (lower.startsWith('empty seo meta content') || lower.startsWith('empty meta content')) {
    return 'empty-meta-content';
  }
  if (lower.startsWith('commented h1')) return 'commented-h1';
  if (lower.startsWith('commented title')) return 'commented-title';
  if (lower.startsWith('non-descriptive headings')) return 'non-descriptive-headings';
  if (lower.startsWith('duplicate heading')) return 'duplicate-heading';
  if (lower.startsWith('duplicate paragraph')) return 'duplicate-paragraph';
  if (
    lower.startsWith('exact content duplicate') ||
    lower.startsWith('near-duplicate') ||
    lower.includes('content duplicate across pages') ||
    lower.includes('near-duplicate content')
  ) {
    return 'cross-page-content-duplicate';
  }
  // GEO
  if (lower.startsWith('no schema.org')) return 'no-schema';
  if (lower.startsWith('invalid schema.org')) return 'invalid-schema';
  if (lower.startsWith('invalid geojson')) return 'invalid-geojson';
  if (lower.startsWith('invalid microdata')) return 'invalid-microdata';
  if (lower.startsWith('invalid rdfa')) return 'invalid-rdfa';
  if (lower.startsWith('missing faq')) return 'missing-faq';
  if (lower.startsWith('semantic html')) return 'semantic-html';
  if (lower.startsWith('map present')) return 'map-without-geo';
  if (lower.startsWith('placeholder content')) return 'placeholder-content';
  if (lower.startsWith('outdated copyright')) return 'outdated-copyright';
  if (lower.startsWith('outdated content date')) return 'outdated-content-date';

  const colon = text.indexOf(':');
  if (colon > 0) {
    return text
      .slice(0, colon)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
  return 'issue';
}

/**
 * Human Issue Title for CSV.
 * Security: use the specific header name (e.g. Content-Security-Policy) not generic label.
 */
function parseIssueName(summary) {
  const text = String(summary || '').trim();
  const sec = text.match(/^HTTP Security Header:\s*(.+)$/i);
  if (sec) {
    const rest = sec[1].trim();
    const headerColon = rest.indexOf(':');
    if (headerColon > 0) return rest.slice(0, headerColon).trim();
    return rest.slice(0, 80);
  }
  if (/^CSP Strictness:/i.test(text)) return 'CSP Strictness';
  if (/^Permissions-Policy Strictness:/i.test(text)) return 'Permissions-Policy Strictness';
  const colon = text.indexOf(':');
  if (colon > 0) return text.slice(0, colon).trim();
  return text;
}

/** GEO issue severity (mirrors uiseocheck.js inferGeoSeverityFromText). */
function geoIssueSeverityTag(issueSummary) {
  const t = String(issueSummary || '');
  if (!t) return null;
  if (/^No Schema\.org structured data/i.test(t)) return 'Critical';
  if (/^Invalid Schema\.org structured data/i.test(t)) return 'Critical';
  if (/^Invalid GeoJSON/i.test(t)) return 'Critical';
  if (/^Map present without GeoJSON/i.test(t)) return 'Warning';
  if (/^Placeholder content detected/i.test(t)) return 'Warning';
  if (/^Outdated copyright year/i.test(t)) return 'Warning';
  if (/^Invalid Microdata/i.test(t)) return 'Minor';
  if (/^Invalid RDFa/i.test(t)) return 'Minor';
  if (/^Missing FAQ section/i.test(t)) return 'Minor';
  if (/^Semantic HTML issue/i.test(t)) return 'Minor';
  if (/^Outdated content date/i.test(t)) return 'Minor';
  // Default GEO bucket without a known prefix
  if (
    /schema\.org|json-ld|geojson|microdata|rdfa|faq section|semantic html|placeholder content|copyright year|content date|map present/i.test(
      t
    )
  ) {
    return 'Critical';
  }
  return null;
}

/** Length / quality meta issues export as Warning (matches Meta tags panel). */
function metaIssueSeverityTag(issueSummary) {
  const t = String(issueSummary || '');
  if (/^Page title length:/i.test(t)) return 'Warning';
  if (/^Page meta description:/i.test(t) && /\b(short|long)\s*\(/i.test(t)) return 'Warning';
  if (/^Page marked noindex:/i.test(t)) return 'Warning';
  return null;
}

function isMetaTagCsvIssue(summary) {
  const t = String(summary || '').trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (/^missing <title>|^empty <title>|^title tags\s*\(|^empty\/invalid title|^page title length:|^commented title|^duplicate title\b/i.test(t)) {
    return true;
  }
  if (/^page meta description:|^page meta keywords:|^meta description tags|^meta keywords tags/i.test(t)) {
    return true;
  }
  if (/^missing canonical|^multiple canonical|^empty canonical|^canonical /i.test(t)) return true;
  if (/^page marked noindex:|^robots meta/i.test(t)) return true;
  if (/^missing viewport|^missing charset|^missing favicon|^hreflang/i.test(t)) return true;
  if (/^missing open graph|^missing twitter card|^empty og:|^empty twitter:/i.test(t)) return true;
  if (/^empty seo meta content|^empty meta content|^duplicate description/i.test(t)) return true;
  if (lower.startsWith('og:') || lower.startsWith('twitter:')) return true;
  return false;
}

function severityLabel(severity, issueSummary = '') {
  // Prefer Security Headers policy tags when the line is a header issue
  const sec = securityHeaderSeverityTag(issueSummary);
  if (sec) return sec;

  const meta = metaIssueSeverityTag(issueSummary);
  if (meta) return meta;

  if (severity === 'geo') {
    return geoIssueSeverityTag(issueSummary) || 'Critical';
  }

  const map = {
    critical: 'Critical',
    minor: 'Minor',
    geo: 'Critical',
    hidden: 'Minor',
    pagespeed: 'Minor',
    warning: 'Warning'
  };
  return map[severity] || severity;
}

/** Critical / Minor / Warning for Security Headers lines (matches httpSecurityHeaders.js). */
function securityHeaderSeverityTag(issueSummary) {
  const s = String(issueSummary || '');
  if (
    !/^HTTP Security Header:/i.test(s) &&
    !/^CSP Strictness:/i.test(s) &&
    !/^Permissions-Policy Strictness:/i.test(s) &&
    !/security header/i.test(s)
  ) {
    return null;
  }
  const t = s.toLowerCase();
  // Warning (advanced / deprecated / environment)
  if (
    /cross-origin-embedder-policy|cross-origin-opener-policy|content-security-policy-report-only|x-xss-protection|expect-ct/.test(
      t
    )
  ) {
    return 'Warning';
  }
  // Minor (hygiene / disclosure / PP quality / cookies)
  if (
    /referrer-policy|permissions-policy|cross-origin-resource-policy|x-powered-by|server:|httponly cookies|secure cookies|samesite cookies/.test(
      t
    )
  ) {
    return 'Minor';
  }
  // Critical baseline
  if (
    /content-security-policy|csp strictness|xss\s*\/\s*csp|strict-transport-security|x-frame-options|clickjacking|x-content-type-options|mime sniffing|cache-control|\bhttps\b|ssl\s*\/\s*tls|mixed content/.test(
      t
    )
  ) {
    return 'Critical';
  }
  return 'Minor';
}

/** Module section for CSV Issue Category column. */
function issueModuleCategory(severity, issueSummary) {
  const s = String(issueSummary || '');
  if (severity === 'geo') return 'GEO';
  if (
    /^HTTP Security Header:/i.test(s) ||
    /^CSP Strictness:/i.test(s) ||
    /^Permissions-Policy Strictness:/i.test(s) ||
    /security header/i.test(s)
  ) {
    return 'Security Headers';
  }
  if (isMetaTagCsvIssue(s)) return 'SEO · Meta tags';
  if (/^PageSpeed\b|^Page Speed\b/i.test(s) || severity === 'pagespeed') {
    return 'Page Speed';
  }
  return 'SEO';
}

function inferElementType(issueCode) {
  if (issueCode === 'missing-alt') return 'img';
  if (issueCode === 'bad-href-hash' || issueCode === 'bad-js-void') return 'a';
  if (issueCode.startsWith('meta-') || issueCode === 'missing-canonical' || issueCode === 'missing-og') {
    return 'meta';
  }
  if (issueCode === 'broken-hierarchy' || issueCode.includes('h1')) return 'heading';
  if (issueCode.includes('geojson') || issueCode.includes('map') || issueCode.includes('microdata') || issueCode.includes('rdfa')) {
    return 'markup';
  }
  if (issueCode.includes('schema') || issueCode.includes('json-ld')) return 'json-ld';
  if (issueCode.includes('pagespeed') || issueCode.includes('page-speed')) return 'pagespeed';
  return 'page';
}

function inferDetail(summary, issueCode) {
  const text = String(summary || '');
  const colon = text.indexOf(':');
  return colon >= 0 ? text.slice(colon + 1).trim() : text;
}

/** Full issue line + element context for Issue Detail column. */
function buildFullIssueDetail(summary, el) {
  const parts = [];
  const full = String(summary || '').trim();
  if (full) parts.push(full);
  if (el?.detail && !full.includes(String(el.detail))) {
    parts.push(String(el.detail));
  }
  if (el?.elementText) parts.push(`Context: ${String(el.elementText).slice(0, 300)}`);
  if (el?.elementUrl) parts.push(`Resource: ${el.elementUrl}`);
  if (el?.sectionSnippet) parts.push(`Section: ${String(el.sectionSnippet).slice(0, 300)}`);
  return parts.filter(Boolean).join(' | ') || full;
}

function getElementsForIssue(page, issueCode) {
  return (page.issueElements || []).filter((el) => el.issueCode === issueCode);
}

const ISSUES_DETAIL_HEADERS = [
  'Site URL',
  'Page URL',
  'SEO Score',
  'Severity',
  'Issue Category',
  'Issue Code',
  'Issue Title',
  'Issue Summary',
  'Element Type',
  'Element URL',
  'Element Text',
  'Issue Detail',
  'Page Title',
  'Meta Description'
];

function buildIssueDetailRow({
  siteUrl,
  page,
  severity,
  issueCode,
  issueTitle,
  issueSummary,
  elementType,
  elementUrl,
  elementText,
  issueDetail
}) {
  const category = issueModuleCategory(severity, issueSummary);
  const detail = issueDetail || buildFullIssueDetail(issueSummary, {
    detail: issueDetail,
    elementText,
    elementUrl
  });
  return [
    siteUrl,
    page.url,
    page.seoScore ?? '',
    severityLabel(severity, issueSummary),
    category,
    issueCode,
    issueTitle,
    issueSummary,
    elementType,
    elementUrl,
    elementText,
    detail,
    page.title ?? '',
    page.description ?? ''
  ]
    .map(csvEscape)
    .join(',');
}

function appendPageSpeedIssueRows(rows, { siteUrl, page }) {
  const ps = page.pageSpeed;
  if (!ps || typeof ps !== 'object') return;

  const push = (title, detail, severity = 'minor') => {
    const summary = `PageSpeed: ${title}: ${detail}`;
    rows.push(
      buildIssueDetailRow({
        siteUrl,
        page,
        severity,
        issueCode: 'pagespeed',
        issueTitle: `PageSpeed: ${title}`,
        issueSummary: summary,
        elementType: 'pagespeed',
        elementUrl: page.url || '',
        elementText: '',
        issueDetail: summary
      })
    );
  };

  if (ps.skipped) {
    push('Skipped', ps.reason || 'API key not configured', 'minor');
    return;
  }

  for (const strategy of ['mobile', 'desktop']) {
    const side = ps[strategy];
    if (!side) continue;
    if (side.error) {
      push(`${strategy} error`, side.error, 'critical');
      continue;
    }
    if (side.skipped) {
      push(`${strategy} skipped`, side.reason || 'skipped', 'minor');
      continue;
    }
    const perf = Number(side.performance);
    if (Number.isFinite(perf) && perf < 50) {
      push(
        `${strategy} performance`,
        `Performance score ${perf}/100 is below 50 (full line: mobile/desktop Lighthouse performance for this page URL)`,
        'critical'
      );
    } else if (Number.isFinite(perf) && perf < 90) {
      push(
        `${strategy} performance`,
        `Performance score ${perf}/100 is below 90`,
        'minor'
      );
    }
  }
}

function buildSeoPagesSummaryCsv(report) {
  const pages = report.pages || [];
  const siteUrl = report.mainUrl || '';

  const headers = [
    'Site URL',
    'Page URL',
    'SEO Score',
    'Page Title',
    'Meta Description',
    'Meta Keywords',
    'H1 Count',
    'H2 Count',
    'H3 Count',
    'Heading Hierarchy',
    'Missing Alt Count',
    'Href # Count',
    'JS Void Link Count',
    'Missing OG Count',
    'Missing GEO Count',
    'Critical Count',
    'Minor Count',
    'GEO Count',
    'Hidden Count',
    'Critical Issues',
    'Minor Issues',
    'GEO Issues',
    'Hidden Issues'
  ];

  const rows = pages.map((page) => {
    const issues = page.issues || {};
    return [
      siteUrl,
      page.url,
      page.seoScore ?? '',
      page.title ?? '',
      page.description ?? '',
      page.keywords ?? '',
      page.h1Count ?? 0,
      page.h2Count ?? 0,
      page.h3Count ?? 0,
      page.hierarchyStatus ?? '',
      page.counts?.missingAlt ?? 0,
      page.counts?.hrefHash ?? 0,
      page.counts?.jsVoid ?? 0,
      page.counts?.missingOpenGraph ?? 0,
      page.counts?.missingGeo ?? issues.geo?.length ?? 0,
      issues.critical?.length ?? 0,
      issues.minor?.length ?? 0,
      issues.geo?.length ?? 0,
      issues.hidden?.length ?? 0,
      joinIssues(issues.critical),
      joinIssues(issues.minor),
      joinIssues(issues.geo),
      joinIssues(issues.hidden)
    ]
      .map(csvEscape)
      .join(',');
  });

  return `${CSV_BOM}${headers.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

function buildSeoIssuesDetailCsv(report) {
  const pages = report.pages || [];
  const siteUrl = report.mainUrl || '';
  const rows = [];

  for (const page of pages) {
    const issues = page.issues || {};
    for (const severity of ['critical', 'minor', 'geo', 'hidden']) {
      for (const summary of issues[severity] || []) {
        if (!summary) continue;
        const issueCode = parseIssueCode(summary);
        const issueTitle = parseIssueName(summary);
        const elements = getElementsForIssue(page, issueCode);

        if (elements.length > 0) {
          for (const el of elements) {
            const fullDetail = buildFullIssueDetail(summary, el);
            rows.push(
              buildIssueDetailRow({
                siteUrl,
                page,
                severity,
                issueCode,
                issueTitle,
                issueSummary: summary,
                elementType: el.elementType || inferElementType(issueCode),
                elementUrl: el.elementUrl || '',
                elementText: el.elementText ?? '',
                issueDetail: fullDetail
              })
            );
          }
        } else {
          // Full issue line in Issue Detail when no element-level hit
          rows.push(
            buildIssueDetailRow({
              siteUrl,
              page,
              severity,
              issueCode,
              issueTitle,
              issueSummary: summary,
              elementType: inferElementType(issueCode),
              elementUrl: '',
              elementText: '',
              issueDetail: summary
            })
          );
        }
      }
    }
    appendPageSpeedIssueRows(rows, { siteUrl, page });
  }

  return `${CSV_BOM}${ISSUES_DETAIL_HEADERS.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

function buildSeoScannedUrlsList(pages) {
  const seen = new Set();
  const urls = [];
  for (const page of pages || []) {
    const url = String(page?.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function buildSeoScannedUrlsCsv(pages) {
  return buildSeoScannedUrlsList(pages).join(',');
}

function buildSeoReportExportPayload(mainUrl, scanDate, pages) {
  return {
    mainUrl,
    scanDate,
    pages: (pages || []).map((page) => ({
      url: page.url,
      title: page.title,
      description: page.description,
      keywords: page.keywords,
      seoScore: page.seoScore,
      h1Count: page.h1Count,
      h2Count: page.h2Count,
      h3Count: page.h3Count,
      hierarchyStatus: page.hierarchyStatus,
      counts: page.counts,
      issueElements: page.issueElements || [],
      issues: page.issues,
      geoIssueSeverities: page.geoIssueSeverities || null,
      securityHeaders: page.securityHeaders || null,
      pageSpeed: page.pageSpeed || null,
      richResults: page.richResults || null,
      auditModules: page.auditModules || null
    }))
  };
}

module.exports = {
  buildSeoPagesSummaryCsv,
  buildSeoIssuesDetailCsv,
  buildSeoReportExportPayload,
  buildSeoScannedUrlsList,
  buildSeoScannedUrlsCsv,
  issueModuleCategory,
  buildFullIssueDetail,
  parseIssueCode,
  parseIssueName,
  csvEscape
};