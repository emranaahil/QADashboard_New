/**
 * Browser-side CSV export for embedded SEO HTML reports.
 * Reads from #seo-report-export-data (preferred) or window.SEO_REPORT_DATA (legacy).
 */
(function () {
  var CSV_BOM = '\uFEFF';

  function loadSeoReportData() {
    if (window.SEO_REPORT_DATA) return window.SEO_REPORT_DATA;
    var el = document.getElementById('seo-report-export-data');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || '');
    } catch (e) {
      return null;
    }
  }

  function csvEscape(value) {
    return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  }

  function parseIssueCode(summary) {
    var text = String(summary || '').trim();
    var lower = text.toLowerCase();
    if (lower.indexOf('images without alt') === 0) return 'missing-alt';
    if (lower.indexOf('broken heading hierarchy') === 0) return 'broken-hierarchy';
    if (lower.indexOf('missing <h1>') === 0) return 'missing-h1';
    if (lower.indexOf('multiple <h1>') === 0 || /^h1 tags\s*\(/i.test(text)) return 'multiple-h1';
    if (lower.indexOf('empty <h1>') === 0) return 'empty-h1';
    if (lower.indexOf('duplicate <h1>') === 0) return 'duplicate-h1';
    if (lower.indexOf('missing <title>') === 0) return 'missing-title';
    if (lower.indexOf('empty <title>') === 0) return 'empty-title';
    if (/^title tags\s*\(/i.test(text)) return 'multiple-title';
    if (lower.indexOf('empty/invalid title') === 0) return 'empty-title-dom';
    if (lower.indexOf('duplicate title') === 0) return 'duplicate-title';
    if (lower.indexOf('duplicate description') === 0) return 'duplicate-description';
    if (lower.indexOf('page meta description') === 0) return 'meta-description';
    if (lower.indexOf('page meta keywords') === 0) return 'meta-keywords';
    if (lower.indexOf('meta description tags') === 0) return 'multiple-meta-description';
    if (lower.indexOf('meta keywords tags') === 0) return 'multiple-meta-keywords';
    if (lower.indexOf('missing canonical') === 0) return 'missing-canonical';
    if (lower.indexOf('missing open graph') === 0) return 'missing-og';
    if (lower.indexOf('missing twitter card') === 0) return 'missing-twitter-card';
    if (lower.indexOf('empty og:') === 0 || lower.indexOf('empty twitter:') === 0) return 'empty-social-meta';
    if (
      lower.indexOf('http security header') === 0 ||
      lower.indexOf('csp strictness') === 0
    ) {
      return 'http-security-header';
    }
    if (/^bad links/i.test(text) && /javascript\s*:\s*void/i.test(lower)) return 'bad-js-void';
    if (/^bad links/i.test(text) && (lower.indexOf('href') >= 0 || lower.indexOf('#') >= 0)) {
      return 'bad-href-hash';
    }
    if (lower.indexOf('missing viewport') === 0) return 'missing-viewport';
    if (lower.indexOf('missing <html lang>') === 0) return 'missing-html-lang';
    if (lower.indexOf('robots meta conflict') === 0) return 'robots-meta-conflict';
    if (lower.indexOf('empty seo meta content') === 0 || lower.indexOf('empty meta content') === 0) {
      return 'empty-meta-content';
    }
    if (lower.indexOf('commented h1') === 0) return 'commented-h1';
    if (lower.indexOf('commented title') === 0) return 'commented-title';
    if (lower.indexOf('non-descriptive headings') === 0) return 'non-descriptive-headings';
    if (lower.indexOf('duplicate heading') === 0) return 'duplicate-heading';
    if (lower.indexOf('duplicate paragraph') === 0) return 'duplicate-paragraph';
    if (lower.indexOf('no schema.org') === 0) return 'no-schema';
    if (lower.indexOf('invalid schema.org') === 0) return 'invalid-schema';
    if (lower.indexOf('invalid geojson') === 0) return 'invalid-geojson';
    if (lower.indexOf('invalid microdata') === 0) return 'invalid-microdata';
    if (lower.indexOf('invalid rdfa') === 0) return 'invalid-rdfa';
    if (lower.indexOf('missing faq') === 0) return 'missing-faq';
    if (lower.indexOf('semantic html') === 0) return 'semantic-html';
    if (lower.indexOf('map present') === 0) return 'map-without-geo';
    if (lower.indexOf('placeholder content') === 0) return 'placeholder-content';
    if (lower.indexOf('outdated copyright') === 0) return 'outdated-copyright';
    if (lower.indexOf('outdated content date') === 0) return 'outdated-content-date';
    var colon = text.indexOf(':');
    if (colon > 0) {
      return text
        .slice(0, colon)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    return 'issue';
  }

  function parseIssueName(summary) {
    var text = String(summary || '').trim();
    var sec = text.match(/^HTTP Security Header:\s*(.+)$/i);
    if (sec) {
      var rest = sec[1].trim();
      var headerColon = rest.indexOf(':');
      if (headerColon > 0) return rest.slice(0, headerColon).trim();
      return rest.slice(0, 80);
    }
    if (/^CSP Strictness:/i.test(text)) return 'CSP Strictness';
    if (/^Permissions-Policy Strictness:/i.test(text)) return 'Permissions-Policy Strictness';
    var colon = text.indexOf(':');
    return colon > 0 ? text.slice(0, colon).trim() : text;
  }

  function securityHeaderSeverityTag(issueSummary) {
    var s = String(issueSummary || '');
    if (
      !/^HTTP Security Header:/i.test(s) &&
      !/^CSP Strictness:/i.test(s) &&
      !/^Permissions-Policy Strictness:/i.test(s) &&
      !/security header/i.test(s)
    ) {
      return null;
    }
    var t = s.toLowerCase();
    if (
      /cross-origin-embedder-policy|cross-origin-opener-policy|content-security-policy-report-only|x-xss-protection|expect-ct/.test(
        t
      )
    ) {
      return 'Warning';
    }
    if (
      /referrer-policy|permissions-policy|cross-origin-resource-policy|x-powered-by|server:|httponly cookies|secure cookies|samesite cookies/.test(
        t
      )
    ) {
      return 'Minor';
    }
    if (
      /content-security-policy|csp strictness|xss\s*\/\s*csp|strict-transport-security|x-frame-options|clickjacking|x-content-type-options|mime sniffing|cache-control|\bhttps\b|ssl\s*\/\s*tls|mixed content/.test(
        t
      )
    ) {
      return 'Critical';
    }
    return 'Minor';
  }

  function geoIssueSeverityTag(issueSummary) {
    var t = String(issueSummary || '');
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
    if (
      /schema\.org|json-ld|geojson|microdata|rdfa|faq section|semantic html|placeholder content|copyright year|content date|map present/i.test(
        t
      )
    ) {
      return 'Critical';
    }
    return null;
  }

  function severityLabel(severity, issueSummary) {
    var sec = securityHeaderSeverityTag(issueSummary || '');
    if (sec) return sec;
    if (severity === 'geo') {
      return geoIssueSeverityTag(issueSummary || '') || 'Critical';
    }
    var map = {
      critical: 'Critical',
      minor: 'Minor',
      geo: 'Critical',
      hidden: 'Minor',
      pagespeed: 'Minor',
      warning: 'Warning'
    };
    return map[severity] || severity;
  }

  function issueModuleCategory(severity, issueSummary) {
    var s = String(issueSummary || '');
    if (severity === 'geo') return 'GEO';
    if (
      /^HTTP Security Header:/i.test(s) ||
      /^CSP Strictness:/i.test(s) ||
      /^Permissions-Policy Strictness:/i.test(s) ||
      /security header/i.test(s)
    ) {
      return 'Security Headers';
    }
    if (/^PageSpeed\b|^Page Speed\b/i.test(s) || severity === 'pagespeed') return 'Page Speed';
    return 'SEO';
  }

  function buildFullIssueDetail(summary, el) {
    var parts = [];
    var full = String(summary || '').trim();
    if (full) parts.push(full);
    if (el && el.detail && full.indexOf(String(el.detail)) < 0) parts.push(String(el.detail));
    if (el && el.elementText) parts.push('Context: ' + String(el.elementText).slice(0, 300));
    if (el && el.elementUrl) parts.push('Resource: ' + el.elementUrl);
    return parts.filter(Boolean).join(' | ') || full;
  }

  function inferElementType(issueCode) {
    if (issueCode === 'missing-alt') return 'img';
    if (issueCode === 'bad-href-hash' || issueCode === 'bad-js-void') return 'a';
    if (issueCode.indexOf('meta-') === 0 || issueCode === 'missing-canonical' || issueCode === 'missing-og') {
      return 'meta';
    }
    if (issueCode === 'broken-hierarchy' || issueCode.indexOf('h1') >= 0) return 'heading';
    return 'page';
  }

  function inferDetail(summary) {
    var text = String(summary || '');
    var colon = text.indexOf(':');
    return colon >= 0 ? text.slice(colon + 1).trim() : text;
  }

  function getElementsForIssue(page, issueCode) {
    return (page.issueElements || []).filter(function (el) {
      return el.issueCode === issueCode;
    });
  }

  var ISSUES_DETAIL_HEADERS = [
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

  var PAGES_SUMMARY_HEADERS = [
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

  function buildIssueDetailRow(siteUrl, page, severity, issueCode, issueTitle, issueSummary, elementType, elementUrl, elementText, issueDetail) {
    return [
      siteUrl,
      page.url,
      page.seoScore != null ? page.seoScore : '',
      severityLabel(severity, issueSummary),
      issueModuleCategory(severity, issueSummary),
      issueCode,
      issueTitle,
      issueSummary,
      elementType,
      elementUrl,
      elementText,
      issueDetail || buildFullIssueDetail(issueSummary, { elementText: elementText, elementUrl: elementUrl }),
      page.title || '',
      page.description || ''
    ].map(csvEscape).join(',');
  }

  function downloadCsv(filename, csv) {
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function buildIssuesDetailCsv(report) {
    var pages = report.pages || [];
    var siteUrl = report.mainUrl || '';
    var rows = [];

    pages.forEach(function (page) {
      var issues = page.issues || {};
      ['critical', 'minor', 'geo', 'hidden'].forEach(function (severity) {
        (issues[severity] || []).forEach(function (summary) {
          if (!summary) return;
          var issueCode = parseIssueCode(summary);
          var issueTitle = parseIssueName(summary);
          var elements = getElementsForIssue(page, issueCode);

          if (elements.length > 0) {
            elements.forEach(function (el) {
              rows.push(
                buildIssueDetailRow(
                  siteUrl,
                  page,
                  severity,
                  issueCode,
                  issueTitle,
                  summary,
                  el.elementType || inferElementType(issueCode),
                  el.elementUrl || '',
                  el.elementText != null ? el.elementText : '',
                  buildFullIssueDetail(summary, el)
                )
              );
            });
          } else {
            rows.push(
              buildIssueDetailRow(
                siteUrl,
                page,
                severity,
                issueCode,
                issueTitle,
                summary,
                inferElementType(issueCode),
                '',
                '',
                summary
              )
            );
          }
        });
      });

      // Page Speed rows (if present on page payload)
      var ps = page.pageSpeed;
      if (ps && typeof ps === 'object') {
        function pushPs(title, detail, sev) {
          var sum = 'PageSpeed: ' + title + ': ' + detail;
          rows.push(
            buildIssueDetailRow(
              siteUrl,
              page,
              sev,
              'pagespeed',
              'PageSpeed: ' + title,
              sum,
              'pagespeed',
              page.url || '',
              '',
              sum
            )
          );
        }
        if (ps.skipped) {
          pushPs('Skipped', ps.reason || 'API key not configured', 'minor');
        } else {
          ['mobile', 'desktop'].forEach(function (strategy) {
            var side = ps[strategy];
            if (!side) return;
            if (side.error) {
              pushPs(strategy + ' error', side.error, 'critical');
              return;
            }
            if (side.skipped) {
              pushPs(strategy + ' skipped', side.reason || 'skipped', 'minor');
              return;
            }
            var perf = Number(side.performance);
            if (isFinite(perf) && perf < 50) {
              pushPs(strategy + ' performance', 'Performance score ' + perf + '/100 is below 50', 'critical');
            } else if (isFinite(perf) && perf < 90) {
              pushPs(strategy + ' performance', 'Performance score ' + perf + '/100 is below 90', 'minor');
            }
          });
        }
      }
    });

    return CSV_BOM + ISSUES_DETAIL_HEADERS.join(',') + '\n' + rows.join('\n') + (rows.length ? '\n' : '');
  }

  function reportDate(report) {
    return String(report.scanDate || new Date().toISOString()).slice(0, 10);
  }

  function buildScannedUrlsCsv(report) {
    var seen = {};
    var urls = [];
    (report.pages || []).forEach(function (page) {
      var url = String(page && page.url || '').trim();
      if (!url || seen[url]) return;
      seen[url] = true;
      urls.push(url);
    });
    return urls.join(',');
  }

  function collectPageUrlsFromDom() {
    var urls = [];
    var seen = {};

    function addUrl(url) {
      url = String(url || '').trim();
      if (!url || seen[url]) return;
      seen[url] = true;
      urls.push(url);
    }

    document.querySelectorAll('.pageCard .pageUrl').forEach(function (el) {
      addUrl(el.textContent);
    });

    if (!urls.length) {
      document.querySelectorAll('.data-row .url-link').forEach(function (el) {
        addUrl(el.getAttribute('href'));
      });
    }

    return urls;
  }

  function loadSeoPageUrls() {
    var el = document.getElementById('seo-report-page-urls');
    if (el) {
      try {
        var parsed = JSON.parse(el.textContent || '');
        if (Array.isArray(parsed) && parsed.length) {
          return parsed.map(function (url) {
            return String(url || '').trim();
          }).filter(Boolean);
        }
      } catch (e) {}
    }

    var report = loadSeoReportData();
    if (report && report.pages && report.pages.length) {
      return buildScannedUrlsCsv(report).split(',').filter(Boolean);
    }

    return collectPageUrlsFromDom();
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        if (document.execCommand('copy')) resolve();
        else reject(new Error('Copy failed'));
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(textarea);
      }
    });
  }

  function flashButtonLabel(button, nextLabel, restoreLabel) {
    if (!button) return;
    button.textContent = nextLabel;
    button.disabled = true;
    window.setTimeout(function () {
      button.textContent = restoreLabel;
      button.disabled = false;
    }, 1600);
  }

  function finishCopy(button, originalLabel, csv) {
    if (!csv) {
      alert('No scanned page URLs available to copy.');
      return;
    }

    copyTextToClipboard(csv)
      .then(function () {
        flashButtonLabel(button, 'Copied!', originalLabel);
      })
      .catch(function () {
        alert('Could not copy URLs to clipboard. Please copy manually from the page results table.');
      });
  }

  window.copySeoScannedUrls = function (event) {
    var button = event && event.currentTarget ? event.currentTarget : null;
    var originalLabel = button ? button.textContent : 'Copy Scanned URLs';

    if (window.SEO_REPORT_URLS_COPY_URL && window.fetch) {
      window
        .fetch(window.SEO_REPORT_URLS_COPY_URL)
        .then(function (res) {
          if (!res.ok) throw new Error('fetch failed');
          return res.text();
        })
        .then(function (csv) {
          finishCopy(button, originalLabel, String(csv || '').trim());
        })
        .catch(function () {
          finishCopy(button, originalLabel, loadSeoPageUrls().join(','));
        });
      return;
    }

    finishCopy(button, originalLabel, loadSeoPageUrls().join(','));
  };

  function joinIssues(items) {
    return (items || []).filter(Boolean).join('; ');
  }

  function buildPagesSummaryCsv(report) {
    var pages = report.pages || [];
    var siteUrl = report.mainUrl || '';
    var rows = pages.map(function (page) {
      var issues = page.issues || {};
      var counts = page.counts || {};
      return [
        siteUrl,
        page.url,
        page.seoScore != null ? page.seoScore : '',
        page.title || '',
        page.description || '',
        page.keywords || '',
        page.h1Count != null ? page.h1Count : 0,
        page.h2Count != null ? page.h2Count : 0,
        page.h3Count != null ? page.h3Count : 0,
        page.hierarchyStatus || '',
        counts.missingAlt != null ? counts.missingAlt : 0,
        counts.hrefHash != null ? counts.hrefHash : 0,
        counts.jsVoid != null ? counts.jsVoid : 0,
        counts.missingOpenGraph != null ? counts.missingOpenGraph : 0,
        counts.missingGeo != null ? counts.missingGeo : (issues.geo ? issues.geo.length : 0),
        issues.critical ? issues.critical.length : 0,
        issues.minor ? issues.minor.length : 0,
        issues.geo ? issues.geo.length : 0,
        issues.hidden ? issues.hidden.length : 0,
        joinIssues(issues.critical),
        joinIssues(issues.minor),
        joinIssues(issues.geo),
        joinIssues(issues.hidden)
      ].map(csvEscape).join(',');
    });
    return CSV_BOM + PAGES_SUMMARY_HEADERS.map(csvEscape).join(',') + '\n' + rows.join('\n') + (rows.length ? '\n' : '');
  }

  window.exportSeoPagesCsv = function () {
    if (window.SEO_REPORT_PAGES_CSV_URL) {
      window.location.href = window.SEO_REPORT_PAGES_CSV_URL;
      return;
    }

    var report = loadSeoReportData();
    if (!report || !report.pages || !report.pages.length) {
      alert('No report data available for CSV export.');
      return;
    }
    var csv = buildPagesSummaryCsv(report);
    downloadCsv('SeoGeo-Audit-Pages-' + reportDate(report) + '.csv', csv);
  };

  window.exportSeoIssuesCsv = function () {
    if (window.SEO_REPORT_CSV_URL) {
      window.location.href = window.SEO_REPORT_CSV_URL;
      return;
    }

    var report = loadSeoReportData();
    if (!report || !report.pages || !report.pages.length) {
      alert('No report data available for CSV export.');
      return;
    }
    var csv = buildIssuesDetailCsv(report);
    var lines = csv.split('\n').filter(Boolean);
    if (lines.length <= 1) {
      alert('No issues found to export.');
      return;
    }
    downloadCsv('SeoGeo-Audit-Issues-' + reportDate(report) + '.csv', csv);
  };
})();