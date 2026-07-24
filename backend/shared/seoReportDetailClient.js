/**
 * Lazy-loaded collapsible page issue details for large SEO HTML reports.
 */
(function () {
  var GEO_AUDIT_CHECK_COUNT = 7;
  var GEO_AUDIT_CHECKS = [
    { label: 'FAQ section', prefixes: ['Missing FAQ section'] },
    {
      label: 'Schema.org structured data',
      prefixes: ['Invalid Schema.org structured data', 'No Schema.org structured data']
    },
    { label: 'Microdata / RDFa', prefixes: ['Invalid Microdata', 'Invalid RDFa'] },
    {
      label: 'GeoJSON / map location data',
      prefixes: [
        'Invalid GeoJSON',
        'Map present without GeoJSON or coordinates',
        'Map present without GeoJSON'
      ]
    },
    { label: 'Placeholder content', prefixes: ['Placeholder content detected'] },
    { label: 'Content freshness', prefixes: ['Outdated content date', 'Outdated copyright year'] },
    { label: 'Semantic HTML', prefixes: ['Semantic HTML issue'] }
  ];
  var LAZY_PAGE_THRESHOLD = 80;
  var EXPAND_ALL_WARN_THRESHOLD = 100;
  var EXPAND_ALL_BATCH = 20;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isSecurityHeaderIssueLine(text) {
    return String(text || '').startsWith('HTTP Security Header:');
  }

  function splitSecurityHeaderIssues(items) {
    var security = [];
    var other = [];
    (items || []).forEach(function (item) {
      if (isSecurityHeaderIssueLine(item)) security.push(item);
      else other.push(item);
    });
    return { security: security, other: other };
  }

  function formatSecurityHeaderIssueLine(text) {
    return String(text || '').replace(/^HTTP Security Header:\s*/i, '');
  }

  function failedSecurityHeaderResults(results) {
    return (results || []).filter(function (r) {
      return r.applicable !== false && !r.pass;
    });
  }

  function applicableSecurityHeaderResults(results) {
    return (results || []).filter(function (r) {
      return r.applicable !== false;
    });
  }

  function splitSecurityResultsBySeverity(results) {
    var failed = failedSecurityHeaderResults(results);
    var critical = failed.filter(function (r) {
      return r.severity === 'critical';
    });
    var minor = failed.filter(function (r) {
      return r.severity === 'minor';
    });
    var warning = failed.filter(function (r) {
      return r.severity === 'warning' || (r.severity !== 'critical' && r.severity !== 'minor');
    });
    return {
      critical: critical,
      minor: minor,
      warning: warning,
      passed: applicableSecurityHeaderResults(results).filter(function (r) {
        return r.pass;
      })
    };
  }

  function buildSeoScore(criticalCount, minorCount) {
    var score = 100 - criticalCount * 10 - minorCount * 3;
    return Math.max(0, Math.min(100, score));
  }

  function classifyHiddenIssueSeverity(text) {
    var t = String(text || '').toLowerCase();
    if (
      /commented\s*<h1>|commented\s*h1|commented\s*<title>|commented\s*title|hidden\s*h1|missing\s*<h1>|multiple\s*<h1>|title tags/.test(
        t
      )
    ) {
      return 'critical';
    }
    return 'minor';
  }

  function mergeHiddenIntoIssueLists(critical, minor, hidden) {
    var mergedCritical = (critical || []).slice();
    var mergedMinor = (minor || []).slice();
    (hidden || []).forEach(function (item) {
      if (classifyHiddenIssueSeverity(item) === 'critical') mergedCritical.push(item);
      else mergedMinor.push(item);
    });
    return { critical: mergedCritical, minor: mergedMinor };
  }

  function computeSeoPassPercent(criticalCount, minorCount) {
    return buildSeoScore(criticalCount, minorCount);
  }

  function pieSegmentsFromCounts(opts) {
    opts = opts || {};
    var crit = Math.max(0, Number(opts.critical) || 0);
    var min = Math.max(0, Number(opts.minor) || 0);
    var passCnt = Math.max(0, Number(opts.passed) || 0);
    var pct = Number(opts.percent);
    if (!isFinite(pct)) pct = 0;
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    var segments = [];
    var issueTotal = crit + min;
    var countTotal = passCnt + issueTotal;

    if (countTotal > 0 && passCnt > 0) {
      pct = Math.round((passCnt / countTotal) * 100);
      segments.push({ value: passCnt, color: '#4ade80', label: 'Pass', count: passCnt });
      if (crit > 0) segments.push({ value: crit, color: '#f87171', label: 'Critical', count: crit });
      if (min > 0) segments.push({ value: min, color: '#fbbf24', label: 'Minor', count: min });
    } else if (issueTotal > 0) {
      if (pct <= 0) pct = computeSeoPassPercent(crit, min);
      if (pct > 0) segments.push({ value: pct, color: '#4ade80', label: 'Pass', count: null });
      var failShare = Math.max(0, 100 - pct);
      if (failShare > 0) {
        var critShare = crit > 0 ? Math.max(1, Math.round(failShare * (crit / issueTotal))) : 0;
        var minShare = min > 0 ? Math.max(1, failShare - critShare) : 0;
        if (crit > 0) {
          segments.push({
            value: critShare || failShare,
            color: '#f87171',
            label: 'Critical',
            count: crit
          });
        }
        if (min > 0) {
          segments.push({
            value: minShare || Math.max(1, failShare - (crit > 0 ? critShare : 0)),
            color: '#fbbf24',
            label: 'Minor',
            count: min
          });
        }
      }
    } else {
      pct = pct > 0 ? pct : 100;
      segments.push({ value: 100, color: '#4ade80', label: 'Pass', count: 0 });
    }

    var cleaned = segments.filter(function (s) {
      return s.value > 0;
    });
    return {
      segments: cleaned.length
        ? cleaned
        : [{ value: 100, color: '#4ade80', label: 'Pass', count: 0 }],
      percent: pct
    };
  }

  function polarToCartesian(cx, cy, radius, angleDeg) {
    var rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  function describeDonutSlice(cx, cy, outerR, innerR, startAngle, endAngle) {
    var start = polarToCartesian(cx, cy, outerR, endAngle);
    var end = polarToCartesian(cx, cy, outerR, startAngle);
    var innerStart = polarToCartesian(cx, cy, innerR, startAngle);
    var innerEnd = polarToCartesian(cx, cy, innerR, endAngle);
    var largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return [
      'M ' + start.x.toFixed(2) + ' ' + start.y.toFixed(2),
      'A ' + outerR + ' ' + outerR + ' 0 ' + largeArc + ' 0 ' + end.x.toFixed(2) + ' ' + end.y.toFixed(2),
      'L ' + innerStart.x.toFixed(2) + ' ' + innerStart.y.toFixed(2),
      'A ' + innerR + ' ' + innerR + ' 0 ' + largeArc + ' 1 ' + innerEnd.x.toFixed(2) + ' ' + innerEnd.y.toFixed(2),
      'Z'
    ].join(' ');
  }

  function renderAuditPieChart(opts) {
    opts = opts || {};
    var built = pieSegmentsFromCounts(opts);
    var segments = built.segments;
    var pct = built.percent;
    var total =
      segments.reduce(function (sum, seg) {
        return sum + seg.value;
      }, 0) || 1;
    var cx = 60;
    var cy = 60;
    var outerR = 46;
    var innerR = 30;
    var angle = 0;
    var slices = segments
      .map(function (seg) {
        var sweep = (seg.value / total) * 360;
        if (sweep <= 0) return '';
        var endAngle = angle + Math.min(sweep, 359.99);
        var path = describeDonutSlice(cx, cy, outerR, innerR, angle, endAngle);
        angle += sweep;
        return (
          '<path d="' +
          path +
          '" fill="' +
          seg.color +
          '" stroke="rgba(15,23,42,.55)" stroke-width="1.5" />'
        );
      })
      .join('');
    var legend = segments
      .map(function (seg) {
        var share = Math.round((seg.value / total) * 100);
        var countPart = seg.count == null ? '' : ' · ' + seg.count;
        return (
          '<div class="audit-pie-legend-item"><span class="audit-pie-swatch" style="background:' +
          seg.color +
          '"></span><span>' +
          seg.label +
          countPart +
          ' · ' +
          share +
          '%</span></div>'
        );
      })
      .join('');
    var centerLabel =
      '<text x="' +
      cx +
      '" y="' +
      cy +
      '" text-anchor="middle" dominant-baseline="central" class="audit-pie-svg-value">' +
      pct +
      '%</text>';
    return (
      '<div class="audit-pie-chart" role="img" aria-label="' +
      escapeHtml(opts.title || 'Overview') +
      ': ' +
      pct +
      '% pass">' +
      '<div class="audit-pie-ring">' +
      '<svg class="audit-pie-svg" viewBox="0 0 120 120" aria-hidden="true">' +
      slices +
      centerLabel +
      '</svg></div>' +
      '<div class="audit-pie-legend">' +
      legend +
      '</div></div>'
    );
  }

  function renderAuditPieChartGroup(opts) {
    opts = opts || {};
    var built = pieSegmentsFromCounts(opts);
    return (
      '<div class="audit-issue-group audit-issue-group--chart">' +
      '<div class="audit-issue-group-head">' +
      escapeHtml(opts.title || 'Overview') +
      ' · ' +
      built.percent +
      '%</div>' +
      renderAuditPieChart({
        title: opts.title,
        percent: built.percent,
        critical: opts.critical,
        minor: opts.minor,
        passed: opts.passed
      }) +
      '</div>'
    );
  }

  function inferGeoSeverityFromText(text) {
    var t = String(text || '');
    if (/^No Schema\.org structured data/i.test(t)) return 'critical';
    if (/^Invalid Schema\.org structured data/i.test(t)) return 'critical';
    if (/^Invalid GeoJSON/i.test(t)) return 'critical';
    if (/^Map present without GeoJSON/i.test(t)) return 'warning';
    if (/^Placeholder content detected/i.test(t)) return 'warning';
    if (/^Outdated copyright year/i.test(t)) return 'warning';
    if (/^Invalid Microdata/i.test(t)) return 'minor';
    if (/^Invalid RDFa/i.test(t)) return 'minor';
    if (/^Missing FAQ section/i.test(t)) return 'minor';
    if (/^Semantic HTML issue/i.test(t)) return 'minor';
    if (/^Outdated content date/i.test(t)) return 'minor';
    return 'critical';
  }

  function geoIssueText(entry) {
    if (entry == null) return '';
    if (typeof entry === 'string') return entry;
    if (entry.text) return String(entry.text);
    if (entry.name != null) return String(entry.name) + ': ' + String(entry.detail || '');
    return String(entry);
  }

  function splitGeoIssuesBySeverity(geoIssues) {
    var critical = [];
    var minor = [];
    var warning = [];
    (geoIssues || []).forEach(function (entry) {
      var text = geoIssueText(entry);
      if (!text) return;
      var sev =
        entry && typeof entry === 'object' && entry.severity
          ? entry.severity
          : inferGeoSeverityFromText(text);
      if (sev === 'warning') warning.push(text);
      else if (sev === 'minor') minor.push(text);
      else critical.push(text);
    });
    return { critical: critical, minor: minor, warning: warning };
  }

  function computeGeoPassPercent(passCount, issueTotal) {
    var total = (passCount || 0) + (issueTotal || 0);
    if (!total) return 100;
    return Math.round(((passCount || 0) / total) * 100);
  }

  function computeSecurityPassPercent(securityHeaders) {
    var total = Number(securityHeaders && securityHeaders.total) || 0;
    var passed = Number(securityHeaders && securityHeaders.passed) || 0;
    if (!total) return 0;
    return Math.round((passed / total) * 100);
  }

  function passPercentMeta(percent) {
    if (percent >= 80) return { variant: 'good', icon: '✓' };
    if (percent >= 50) return { variant: 'warn', icon: '!' };
    return { variant: 'bad', icon: '✗' };
  }

  function sortMinorIssuesForDisplay(issues) {
    return (issues || []).slice().sort(function (a, b) {
      var priority = function (line) {
        var text = String(line || '');
        if (text.indexOf('Page meta description:') === 0) return 0;
        if (text.indexOf('Page meta keywords:') === 0) return 1;
        return 2;
      };
      return priority(a) - priority(b);
    });
  }

  function formatIssueLineForDisplay(text) {
    var t = String(text || '');
    var mHref = t.match(/Bad links:\s*href="#":\s*Found\s*(\d+)\s+href="#"\s+link\(s\)\.?/i);
    if (mHref) return { label: 'Bad links — href="#"', detail: mHref[1] + ' found' };
    var mHref2 = t.match(/Bad links[^:]*href="#":\s*Found\s*(\d+)/i);
    if (mHref2) return { label: 'Bad links — href="#"', detail: mHref2[1] + ' found' };
    var mHref3 = t.match(/Bad links — href="#":\s*Found\s*(\d+)/i);
    if (mHref3) return { label: 'Bad links — href="#"', detail: mHref3[1] + ' found' };
    var mJs = t.match(/Bad links:\s*javascript:void\(0\):\s*Found\s*(\d+)\s+javascript:void\(0\)\s+link\(s\)\.?/i);
    if (mJs) return { label: 'Bad links — javascript:void(0)', detail: mJs[1] + ' found' };
    var mJs2 = t.match(/Bad links[^:]*javascript:void\(0\):\s*Found\s*(\d+)/i);
    if (mJs2) return { label: 'Bad links — javascript:void(0)', detail: mJs2[1] + ' found' };
    var mJs3 = t.match(/Bad links — javascript:void\(0\):\s*Found\s*(\d+)/i);
    if (mJs3) return { label: 'Bad links — javascript:void(0)', detail: mJs3[1] + ' found' };
    var colon = t.indexOf(':');
    if (colon > 0) {
      return { label: t.slice(0, colon).trim(), detail: t.slice(colon + 1).trim() };
    }
    return { label: null, detail: t };
  }

  function renderIssueLineItem(text) {
    var formatted = formatIssueLineForDisplay(text);
    if (formatted.label) {
      return (
        '<li class="issue-line"><span class="issue-line-label">' +
        escapeHtml(formatted.label) +
        '</span><span class="issue-line-detail"><code>' +
        escapeHtml(formatted.detail) +
        '</code></span></li>'
      );
    }
    return (
      '<li class="issue-line"><code class="issue-line-code">' + escapeHtml(formatted.detail) + '</code></li>'
    );
  }

  function renderIssueListItems(items, emptyLabel) {
    emptyLabel = emptyLabel || 'None detected';
    var list = (items || []).map(function (x) {
      return renderIssueLineItem(x);
    }).join('');
    return list || '<li>' + emptyLabel + '</li>';
  }

  function renderSeoMinorListItems(items) {
    return (items || [])
      .map(function (x) {
        var isMetaLine =
          x.indexOf('Page meta description:') === 0 || x.indexOf('Page meta keywords:') === 0;
        if (isMetaLine) {
          var formatted = formatIssueLineForDisplay(x);
          return (
            '<li class="issue-line minor-meta-line"><span class="issue-line-label">' +
            escapeHtml(formatted.label || '') +
            '</span><span class="issue-line-detail"><code>' +
            escapeHtml(formatted.detail) +
            '</code></span></li>'
          );
        }
        return renderIssueLineItem(x);
      })
      .join('');
  }

  function renderIssueSeverityTag(severity) {
    if (severity === 'critical') {
      return '<span class="issue-severity-tag issue-severity-tag--critical">Critical</span>';
    }
    if (severity === 'warning') {
      return '<span class="issue-severity-tag issue-severity-tag--warning">Warning</span>';
    }
    return '<span class="issue-severity-tag issue-severity-tag--minor">Minor</span>';
  }

  function renderTaggedIssueLineItem(text, severity) {
    var tag = renderIssueSeverityTag(severity);
    var formatted = formatIssueLineForDisplay(text);
    if (formatted.label) {
      return (
        '<li class="issue-line issue-line--tagged"><span class="issue-line-tags">' +
        tag +
        '</span><span class="issue-line-label">' +
        escapeHtml(formatted.label) +
        '</span><span class="issue-line-detail"><code>' +
        escapeHtml(formatted.detail) +
        '</code></span></li>'
      );
    }
    return (
      '<li class="issue-line issue-line--tagged"><span class="issue-line-tags">' +
      tag +
      '</span><code class="issue-line-code">' +
      escapeHtml(formatted.detail) +
      '</code></li>'
    );
  }

  function renderTaggedSeoIssueLineItem(text, severity) {
    var isMetaLine =
      severity === 'minor' &&
      (text.indexOf('Page meta description:') === 0 || text.indexOf('Page meta keywords:') === 0);
    if (isMetaLine) {
      var formatted = formatIssueLineForDisplay(text);
      var tag = renderIssueSeverityTag('minor');
      return (
        '<li class="issue-line issue-line--tagged minor-meta-line"><span class="issue-line-tags">' +
        tag +
        '</span><span class="issue-line-label">' +
        escapeHtml(formatted.label || '') +
        '</span><span class="issue-line-detail"><code>' +
        escapeHtml(formatted.detail) +
        '</code></span></li>'
      );
    }
    return renderTaggedIssueLineItem(text, severity);
  }

  function renderUnifiedSeoIssueGroup(opts) {
    var critical = opts.critical || [];
    var minor = opts.minor || [];
    var total = critical.length + minor.length;
    var items = critical
      .map(function (x) {
        return renderTaggedSeoIssueLineItem(x, 'critical');
      })
      .concat(
        minor.map(function (x) {
          return renderTaggedSeoIssueLineItem(x, 'minor');
        })
      )
      .join('');
    var list = items || '<li>None detected</li>';
    return (
      '<div class="audit-issue-group audit-issue-group--unified">' +
      '<div class="audit-issue-group-head">Issues <span class="audit-issue-count">(' +
      total +
      ')</span></div>' +
      '<ul>' +
      list +
      '</ul></div>'
    );
  }

  function geoIssueMatchesCheck(issueText, check) {
    var t = String(issueText || '');
    return (check.prefixes || []).some(function (prefix) {
      return t.indexOf(prefix + ':') === 0 || t.indexOf(prefix) === 0;
    });
  }

  function deriveGeoPassPoints(geoIssues) {
    var issues = (geoIssues || []).map(geoIssueText);
    return GEO_AUDIT_CHECKS.filter(function (check) {
      return !issues.some(function (issue) {
        return geoIssueMatchesCheck(issue, check);
      });
    }).map(function (check) {
      return check.label;
    });
  }

  function renderPassLineItem(text) {
    return (
      '<li class="audit-pass-item"><span class="audit-pass-status">Pass</span><code>' +
      escapeHtml(text) +
      '</code></li>'
    );
  }

  function renderAuditPassGroup(opts) {
    var passItems = opts.items || [];
    var label = opts.label || 'Pass points';
    var list = passItems.length
      ? passItems
          .map(function (x) {
            return renderPassLineItem(x);
          })
          .join('')
      : '<li>None yet</li>';
    return (
      '<div class="audit-issue-group audit-issue-group--pass">' +
      '<div class="audit-issue-group-head">' +
      label +
      ' <span class="audit-issue-count">(' +
      passItems.length +
      ')</span></div><ul>' +
      list +
      '</ul></div>'
    );
  }

  function renderUnifiedGeoIssueGroup(geoIssues, geoIssueSeverities) {
    var items = geoIssues || [];
    var total = items.length;
    var sevMap = {};
    (geoIssueSeverities || []).forEach(function (e) {
      var key = geoIssueText(e && (e.text != null ? e.text : e));
      if (key) sevMap[key] = (e && e.severity) || 'critical';
    });
    var list = total
      ? items
          .map(function (x) {
            var text = geoIssueText(x);
            var sev = sevMap[text] || inferGeoSeverityFromText(text);
            return renderTaggedIssueLineItem(text, sev);
          })
          .join('')
      : '<li>None detected</li>';
    return (
      '<div class="audit-issue-group audit-issue-group--unified audit-issue-group--geo-issues">' +
      '<div class="audit-issue-group-head">Issues <span class="audit-issue-count">(' +
      total +
      ')</span></div><ul>' +
      list +
      '</ul></div>'
    );
  }

  function renderUnifiedSecurityIssueGroup(criticalItems, minorItems, warningItems) {
    var critical = criticalItems || [];
    var minor = minorItems || [];
    var warning = warningItems || [];
    var total = critical.length + minor.length + warning.length;
    var list = total
      ? critical
          .map(function (x) {
            return renderTaggedIssueLineItem(x, 'critical');
          })
          .concat(
            minor.map(function (x) {
              return renderTaggedIssueLineItem(x, 'minor');
            })
          )
          .concat(
            warning.map(function (x) {
              return renderTaggedIssueLineItem(x, 'warning');
            })
          )
          .join('')
      : '<li>None detected</li>';
    return (
      '<div class="audit-issue-group audit-issue-group--unified audit-issue-group--security-issues">' +
      '<div class="audit-issue-group-head">Issues <span class="audit-issue-count">(' +
      total +
      ')</span></div><ul>' +
      list +
      '</ul></div>'
    );
  }

  function renderSecurityPassGroup(passedResults) {
    var items = (passedResults || []).map(function (r) {
      return r.header + ': ' + (r.message || 'OK');
    });
    return renderAuditPassGroup({ items: items, label: 'Pass points' });
  }

  function renderAuditIssueGroup(opts) {
    var list = opts.renderItems
      ? opts.renderItems(opts.items)
      : renderIssueListItems(opts.items, opts.emptyLabel);
    return (
      '<div class="audit-issue-group audit-issue-group--' +
      opts.modifier +
      '">' +
      '<div class="audit-issue-group-head">' +
      opts.label +
      ' <span class="audit-issue-count">(' +
      opts.count +
      ')</span></div>' +
      '<ul>' +
      list +
      '</ul></div>'
    );
  }

  function computeStrategyAveragePercent(strategyResult) {
    if (!strategyResult || strategyResult.error || strategyResult.skipped) return 0;
    var scores = [];
    if (strategyResult.performance != null) scores.push(strategyResult.performance);
    if (strategyResult.accessibility != null) scores.push(strategyResult.accessibility);
    if (strategyResult.seo != null) scores.push(strategyResult.seo);
    if (!scores.length) return 0;
    var sum = scores.reduce(function (acc, n) {
      return acc + n;
    }, 0);
    return Math.round(sum / scores.length);
  }

  function normalizePageSpeedBundle(pageSpeed) {
    if (!pageSpeed) return null;
    if (pageSpeed.skipped) return pageSpeed;
    if (pageSpeed.mobile || pageSpeed.desktop) return pageSpeed;
    if (pageSpeed.error) return pageSpeed;
    var strategy = String(pageSpeed.strategy || 'MOBILE').toUpperCase();
    if (strategy === 'DESKTOP') {
      return { mobile: null, desktop: pageSpeed };
    }
    return { mobile: pageSpeed, desktop: null };
  }

  function computePageSpeedAveragePercent(pageSpeed) {
    var bundle = normalizePageSpeedBundle(pageSpeed);
    if (!bundle) return 0;
    if (bundle.skipped || (bundle.error && !bundle.mobile && !bundle.desktop)) return 0;

    if (bundle.mobile || bundle.desktop) {
      var strategyAvgs = [];
      if (bundle.mobile) strategyAvgs.push(computeStrategyAveragePercent(bundle.mobile));
      if (bundle.desktop) strategyAvgs.push(computeStrategyAveragePercent(bundle.desktop));
      var valid = strategyAvgs.filter(function (n) {
        return n > 0;
      });
      if (!valid.length) return 0;
      var total = valid.reduce(function (acc, n) {
        return acc + n;
      }, 0);
      return Math.round(total / valid.length);
    }

    return computeStrategyAveragePercent(bundle);
  }

  function cardIcon(modifier) {
    if (modifier === 'seo') {
      return '<svg class="audit-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
    }
    if (modifier === 'geo') {
      return '<svg class="audit-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2a7 7 0 0 0-4 12.7V17l4 4 4-4v-2.3A7 7 0 0 0 12 2Z"/><circle cx="12" cy="9" r="2.5"/></svg>';
    }
    if (modifier === 'pagespeed') {
      return '<svg class="audit-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>';
    }
    if (modifier === 'richresults') {
      return '<svg class="audit-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></svg>';
    }
    return '<svg class="audit-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>';
  }

  function buildRichResultsTestUrl(targetUrl) {
    var url = String(targetUrl || '').trim();
    if (!url) return 'https://search.google.com/test/rich-results';
    return 'https://search.google.com/test/rich-results?url=' + encodeURIComponent(url);
  }

  function renderRichResultsCategoryCard(richResults) {
    if (!richResults) return '';
    var toolUrl = richResults.toolUrl || buildRichResultsTestUrl(richResults.targetUrl || '');
    var targetUrl = richResults.targetUrl || '';
    var status = richResults.status || (richResults.ok ? 'captured' : 'error');
    var isOk = richResults.ok === true && !!richResults.screenshotBase64;
    var scoreVariant = isOk ? (richResults.ready === false ? 'warn' : 'good') : 'bad';
    var scoreLabel = isOk ? (richResults.ready === false ? 'Partial' : 'Captured') : 'Failed';
    var scoreIcon = isOk ? (richResults.ready === false ? '!' : '✓') : '✗';
    var screenshotHtml = '';
    if (richResults.screenshotBase64) {
      var mime = richResults.screenshotMime || 'image/png';
      var dataUri = 'data:' + mime + ';base64,' + richResults.screenshotBase64;
      var fileHint = richResults.screenshotFile
        ? '<div class="richresults-file mono">Saved file: ' +
          escapeHtml(richResults.screenshotFile) +
          '</div>'
        : '';
      screenshotHtml =
        '<div class="richresults-shot-wrap"><div class="richresults-shot-head"><span>Google Rich Results screenshot</span>' +
        '<a class="richresults-open-img" href="' +
        dataUri +
        '" target="_blank" rel="noopener" download="rich-results-snapshot.png">Open / copy screenshot</a></div>' +
        '<a class="richresults-shot-link" href="' +
        dataUri +
        '" target="_blank" rel="noopener" title="Open full screenshot">' +
        '<img class="richresults-shot" src="' +
        dataUri +
        '" alt="Google Rich Results Test screenshot for ' +
        escapeHtml(targetUrl) +
        '" /></a>' +
        fileHint +
        '<p class="richresults-hint">Tip: open the image, then right-click → Copy image / Save as.</p></div>';
    } else if (richResults.error) {
      screenshotHtml =
        '<div class="richresults-message richresults-message--error">Could not capture screenshot: ' +
        escapeHtml(richResults.error) +
        '</div>';
    } else {
      screenshotHtml =
        '<div class="richresults-message">No screenshot available. Use the Google tool link below.</div>';
    }

    var metaRows = '';
    if (targetUrl) {
      metaRows +=
        '<div class="richresults-meta-row"><span class="richresults-meta-label">Target URL</span>' +
        '<a class="richresults-meta-value mono" href="' +
        escapeHtml(targetUrl) +
        '" target="_blank" rel="noopener">' +
        escapeHtml(targetUrl) +
        '</a></div>';
    }
    if (toolUrl) {
      metaRows +=
        '<div class="richresults-meta-row"><span class="richresults-meta-label">Google tool</span>' +
        '<a class="richresults-meta-value mono" href="' +
        escapeHtml(toolUrl) +
        '" target="_blank" rel="noopener">' +
        escapeHtml(toolUrl) +
        '</a></div>';
    }
    if (richResults.activeUrl) {
      metaRows +=
        '<div class="richresults-meta-row"><span class="richresults-meta-label">Active tool URL</span>' +
        '<span class="richresults-meta-value mono">' +
        escapeHtml(richResults.activeUrl) +
        '</span></div>';
    }
    if (richResults.pageTitle) {
      metaRows +=
        '<div class="richresults-meta-row"><span class="richresults-meta-label">Tool page title</span>' +
        '<span class="richresults-meta-value">' +
        escapeHtml(richResults.pageTitle) +
        '</span></div>';
    }
    if (richResults.capturedAt) {
      metaRows +=
        '<div class="richresults-meta-row"><span class="richresults-meta-label">Captured at</span>' +
        '<span class="richresults-meta-value mono">' +
        escapeHtml(richResults.capturedAt) +
        '</span></div>';
    }
    if (richResults.note) {
      metaRows +=
        '<div class="richresults-meta-row"><span class="richresults-meta-label">Note</span>' +
        '<span class="richresults-meta-value">' +
        escapeHtml(richResults.note) +
        '</span></div>';
    }

    return (
      '<article class="audit-card audit-card--richresults">' +
      '<header class="audit-card-head"><div class="audit-card-intro">' +
      '<div class="audit-card-title">' +
      cardIcon('richresults') +
      '<span>Google Rich Results — Test</span></div>' +
      '<div class="audit-card-subtitle">Structured data eligibility via Google&#39;s Rich Results Test</div></div>' +
      '<div class="audit-card-score audit-card-score--' +
      scoreVariant +
      '" aria-label="' +
      scoreLabel +
      '"><span class="audit-card-score-icon" aria-hidden="true">' +
      scoreIcon +
      '</span><span class="audit-card-score-value" style="font-size:.875rem">' +
      scoreLabel +
      '</span></div></header>' +
      '<div class="audit-card-stats">' +
      '<span class="audit-stat audit-stat--critical"><span class="audit-stat-icon" aria-hidden="true">●</span> Status ' +
      escapeHtml(status) +
      '</span>' +
      '<span class="audit-stat audit-stat--minor"><span class="audit-stat-icon" aria-hidden="true">●</span> Main URL only</span></div>' +
      '<div class="audit-card-body audit-card-body--richresults">' +
      '<div class="richresults-meta">' +
      (metaRows || '<div class="richresults-message">No metadata</div>') +
      (toolUrl
        ? '<a class="richresults-cta" href="' +
          escapeHtml(toolUrl) +
          '" target="_blank" rel="noopener">Open in Google Rich Results Test ↗</a>'
        : '') +
      '</div>' +
      screenshotHtml +
      '</div></article>'
    );
  }

  function pageSpeedScoreTone(score) {
    if (score == null || isNaN(Number(score))) {
      return { variant: 'muted', color: '#64748b', label: '—' };
    }
    var n = Number(score);
    if (n >= 90) return { variant: 'good', color: '#0cce6b', label: String(n) };
    if (n >= 50) return { variant: 'warn', color: '#ffa400', label: String(n) };
    return { variant: 'bad', color: '#ff4e42', label: String(n) };
  }

  function pageSpeedDeviceIcon(modifier) {
    if (modifier === 'mobile') {
      return '<svg class="pagespeed-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>';
    }
    return '<svg class="pagespeed-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 20h8M12 18v2"/></svg>';
  }

  function renderPageSpeedRing(score) {
    var tone = pageSpeedScoreTone(score);
    var pct = score == null || isNaN(Number(score)) ? 0 : Math.max(0, Math.min(100, Number(score)));
    var radius = 26;
    var circumference = 2 * Math.PI * radius;
    var offset = circumference - (pct / 100) * circumference;
    return (
      '<div class="pagespeed-ring pagespeed-ring--' +
      tone.variant +
      '" aria-label="' +
      tone.label +
      ' out of 100">' +
      '<svg class="pagespeed-ring-svg" viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle class="pagespeed-ring-track" cx="32" cy="32" r="' +
      radius +
      '" fill="none" stroke-width="5"/>' +
      '<circle class="pagespeed-ring-fill" cx="32" cy="32" r="' +
      radius +
      '" fill="none" stroke-width="5" stroke="' +
      tone.color +
      '" stroke-dasharray="' +
      circumference.toFixed(2) +
      '" stroke-dashoffset="' +
      offset.toFixed(2) +
      '" transform="rotate(-90 32 32)" stroke-linecap="round"/>' +
      '</svg><span class="pagespeed-ring-value">' +
      escapeHtml(tone.label) +
      '</span></div>'
    );
  }

  function renderPageSpeedBar(label, score) {
    var tone = pageSpeedScoreTone(score);
    var pct = score == null || isNaN(Number(score)) ? 0 : Math.max(0, Math.min(100, Number(score)));
    return (
      '<div class="pagespeed-bar pagespeed-bar--' +
      tone.variant +
      '"><div class="pagespeed-bar-meta"><span class="pagespeed-bar-label">' +
      escapeHtml(label) +
      '</span><span class="pagespeed-bar-value">' +
      escapeHtml(tone.label) +
      '</span></div><div class="pagespeed-bar-track" aria-hidden="true"><span class="pagespeed-bar-fill" style="width:' +
      pct +
      '%;background:' +
      tone.color +
      '"></span></div></div>'
    );
  }

  function renderPageSpeedTileIntro(label, subtitle) {
    subtitle = subtitle || '';
    return (
      '<div class="pagespeed-tile-intro"><div class="pagespeed-tile-title">' +
      escapeHtml(label) +
      '</div>' +
      (subtitle ? '<div class="pagespeed-tile-sub">' + escapeHtml(subtitle) + '</div>' : '') +
      '</div>'
    );
  }

  function renderPageSpeedTileHead(label, modifier, opts) {
    opts = opts || {};
    var subtitle = opts.subtitle || '';
    var scoreHtml = opts.scoreHtml || '';
    var headClass = scoreHtml
      ? 'pagespeed-tile-head pagespeed-tile-head--compact'
      : 'pagespeed-tile-head pagespeed-tile-head--compact pagespeed-tile-head--no-score';
    return (
      '<div class="' +
      headClass +
      '"><span class="pagespeed-tile-icon-wrap">' +
      pageSpeedDeviceIcon(modifier) +
      '</span>' +
      renderPageSpeedTileIntro(label, subtitle) +
      (scoreHtml ? '<div class="pagespeed-tile-score">' + scoreHtml + '</div>' : '') +
      '</div>'
    );
  }

  function renderPageSpeedStrategyTile(label, modifier, strategyResult) {
    if (!strategyResult) {
      return (
        '<section class="pagespeed-tile pagespeed-tile--' +
        modifier +
        ' pagespeed-tile--empty">' +
        renderPageSpeedTileHead(label, modifier) +
        '<p class="pagespeed-message">Not available</p></section>'
      );
    }

    if (strategyResult.skipped) {
      return (
        '<section class="pagespeed-tile pagespeed-tile--' +
        modifier +
        ' pagespeed-tile--muted">' +
        renderPageSpeedTileHead(label, modifier) +
        '<p class="pagespeed-message">Skipped: ' +
        escapeHtml(strategyResult.reason || 'not configured') +
        '</p></section>'
      );
    }

    if (strategyResult.error) {
      return (
        '<section class="pagespeed-tile pagespeed-tile--' +
        modifier +
        ' pagespeed-tile--error">' +
        renderPageSpeedTileHead(label, modifier) +
        '<p class="pagespeed-message pagespeed-message--error">' +
        escapeHtml(strategyResult.error) +
        '</p></section>'
      );
    }

    var avgPercent = computeStrategyAveragePercent(strategyResult);
    return (
      '<section class="pagespeed-tile pagespeed-tile--' +
      modifier +
      '">' +
      renderPageSpeedTileHead(label, modifier, {
        subtitle: 'Lighthouse',
        scoreHtml: renderPageSpeedRing(avgPercent)
      }) +
      '<div class="pagespeed-tile-bars">' +
      renderPageSpeedBar('Performance', strategyResult.performance) +
      renderPageSpeedBar('Accessibility', strategyResult.accessibility) +
      renderPageSpeedBar('SEO', strategyResult.seo) +
      '</div></section>'
    );
  }

  function renderPageSpeedScoreCell(score) {
    var tone = pageSpeedScoreTone(score);
    return (
      '<span class="pagespeed-matrix-cell pagespeed-matrix-cell--' +
      tone.variant +
      '">' +
      escapeHtml(tone.label) +
      '</span>'
    );
  }

  function renderPageSpeedScoreMatrix(mobile, desktop) {
    var rows = [
      { label: 'Performance', m: mobile ? mobile.performance : null, d: desktop ? desktop.performance : null },
      { label: 'Accessibility', m: mobile ? mobile.accessibility : null, d: desktop ? desktop.accessibility : null },
      { label: 'SEO', m: mobile ? mobile.seo : null, d: desktop ? desktop.seo : null }
    ];
    var body = rows
      .map(function (row) {
        return (
          '<div class="pagespeed-matrix-row"><span class="pagespeed-matrix-label">' +
          escapeHtml(row.label) +
          '</span>' +
          renderPageSpeedScoreCell(row.m) +
          renderPageSpeedScoreCell(row.d) +
          '</div>'
        );
      })
      .join('');
    return (
      '<div class="pagespeed-aside-card"><div class="pagespeed-aside-head">Score comparison</div>' +
      '<div class="pagespeed-matrix"><div class="pagespeed-matrix-row pagespeed-matrix-row--head">' +
      '<span class="pagespeed-matrix-label">Category</span><span class="pagespeed-matrix-col">Mobile</span>' +
      '<span class="pagespeed-matrix-col">Desktop</span></div>' +
      body +
      '</div></div>'
    );
  }

  function renderPageSpeedVitalValue(value) {
    return '<code class="pagespeed-vital-value">' + escapeHtml(value || '—') + '</code>';
  }

  function renderPageSpeedVitalsCompare(mobile, desktop) {
    var mobileMetrics = (mobile && mobile.metrics) || {};
    var desktopMetrics = (desktop && desktop.metrics) || {};
    var rows = [
      { label: 'First Contentful Paint', short: 'FCP', m: mobileMetrics.fcp, d: desktopMetrics.fcp },
      { label: 'Largest Contentful Paint', short: 'LCP', m: mobileMetrics.lcp, d: desktopMetrics.lcp },
      { label: 'Cumulative Layout Shift', short: 'CLS', m: mobileMetrics.cls, d: desktopMetrics.cls },
      { label: 'Total Blocking Time', short: 'TBT', m: mobileMetrics.tbt, d: desktopMetrics.tbt }
    ];
    var body = rows
      .map(function (row) {
        return (
          '<div class="pagespeed-vitals-row"><div class="pagespeed-vitals-metric"><span class="pagespeed-vitals-short">' +
          escapeHtml(row.short) +
          '</span><span class="pagespeed-vitals-name">' +
          escapeHtml(row.label) +
          '</span></div><div class="pagespeed-vitals-values">' +
          renderPageSpeedVitalValue(row.m) +
          renderPageSpeedVitalValue(row.d) +
          '</div></div>'
        );
      })
      .join('');
    return (
      '<div class="pagespeed-aside-card pagespeed-aside-card--vitals"><div class="pagespeed-aside-head">Core Web Vitals</div>' +
      '<div class="pagespeed-vitals-legend"><span class="pagespeed-vitals-legend-item pagespeed-vitals-legend-item--mobile">Mobile</span>' +
      '<span class="pagespeed-vitals-legend-item pagespeed-vitals-legend-item--desktop">Desktop</span></div>' +
      '<div class="pagespeed-vitals-list">' +
      body +
      '</div></div>'
    );
  }

  function renderPageSpeedLegend() {
    return (
      '<div class="pagespeed-legend" aria-label="Lighthouse score legend">' +
      '<span class="pagespeed-legend-item"><span class="pagespeed-legend-swatch pagespeed-legend-swatch--good"></span>90–100 Good</span>' +
      '<span class="pagespeed-legend-item"><span class="pagespeed-legend-swatch pagespeed-legend-swatch--warn"></span>50–89 Needs work</span>' +
      '<span class="pagespeed-legend-item"><span class="pagespeed-legend-swatch pagespeed-legend-swatch--bad"></span>0–49 Poor</span>' +
      '</div>'
    );
  }

  function renderPageSpeedHealthOverview(mobile, desktop) {
    var mobileAvg = computeStrategyAveragePercent(mobile);
    var desktopAvg = computeStrategyAveragePercent(desktop);
    if (!mobileAvg && !desktopAvg) {
      return (
        '<div class="audit-issue-group audit-issue-group--chart pagespeed-health-card">' +
        '<div class="audit-issue-group-head">Health overview</div>' +
        '<p class="pagespeed-message">No Lighthouse scores available</p></div>'
      );
    }
    return (
      '<div class="audit-issue-group audit-issue-group--chart pagespeed-health-card">' +
      '<div class="audit-issue-group-head">Health overview</div>' +
      '<div class="pagespeed-health-charts">' +
      (mobileAvg > 0
        ? '<div class="pagespeed-mini-chart"><div class="pagespeed-mini-chart-label pagespeed-mini-chart-label--mobile">Mobile</div>' +
          renderAuditPieChart({
            title: 'Mobile',
            percent: mobileAvg,
            critical: Math.max(0, 100 - mobileAvg),
            minor: 0,
            passed: mobileAvg
          }) +
          '</div>'
        : '') +
      (desktopAvg > 0
        ? '<div class="pagespeed-mini-chart"><div class="pagespeed-mini-chart-label pagespeed-mini-chart-label--desktop">Desktop</div>' +
          renderAuditPieChart({
            title: 'Desktop',
            percent: desktopAvg,
            critical: Math.max(0, 100 - desktopAvg),
            minor: 0,
            passed: desktopAvg
          }) +
          '</div>'
        : '') +
      '</div></div>'
    );
  }

  function renderPageSpeedDetailsRow(mobile, desktop) {
    return (
      '<div class="pagespeed-details-row">' +
      renderPageSpeedVitalsCompare(mobile, desktop) +
      renderPageSpeedScoreMatrix(mobile, desktop) +
      '</div>'
    );
  }

  function renderPageSpeedCategoryCard(pageSpeed) {
    if (!pageSpeed) return '';

    var bundle = normalizePageSpeedBundle(pageSpeed);
    if (!bundle) return '';

    if (bundle.skipped) {
      return (
        '<article class="audit-card audit-card--pagespeed audit-card--pagespeed-muted">' +
        '<header class="audit-card-head"><div class="audit-card-intro">' +
        '<div class="audit-card-title">' +
        cardIcon('pagespeed') +
        '<span>Page Speed — Google Insights</span></div>' +
        '<div class="audit-card-subtitle">Mobile &amp; Desktop Lighthouse audits</div></div></header>' +
        '<div class="audit-card-body audit-card-body--pagespeed-message">' +
        '<p class="pagespeed-message">PageSpeed skipped: ' +
        escapeHtml(bundle.reason || 'API key not configured') +
        '</p></div></article>'
      );
    }

    if (bundle.error && !bundle.mobile && !bundle.desktop) {
      return (
        '<article class="audit-card audit-card--pagespeed audit-card--pagespeed-error">' +
        '<header class="audit-card-head"><div class="audit-card-intro">' +
        '<div class="audit-card-title">' +
        cardIcon('pagespeed') +
        '<span>Page Speed — Google Insights</span></div>' +
        '<div class="audit-card-subtitle">Mobile &amp; Desktop Lighthouse audits</div></div></header>' +
        '<div class="audit-card-body audit-card-body--pagespeed-message">' +
        '<p class="pagespeed-message pagespeed-message--error">' +
        escapeHtml(bundle.error) +
        '</p></div></article>'
      );
    }

    var avgPercent = computePageSpeedAveragePercent(bundle);
    var meta = passPercentMeta(avgPercent);

    return (
      '<article class="audit-card audit-card--pagespeed">' +
      '<header class="audit-card-head">' +
      '<div class="audit-card-intro">' +
      '<div class="audit-card-title">' +
      cardIcon('pagespeed') +
      '<span>Page Speed — Google Insights</span></div>' +
      '<div class="audit-card-subtitle">Mobile &amp; Desktop · Lighthouse categories &amp; Core Web Vitals</div></div>' +
      '<div class="audit-card-score audit-card-score--' +
      meta.variant +
      '" aria-label="' +
      avgPercent +
      '% combined average score">' +
      '<span class="audit-card-score-icon" aria-hidden="true">' +
      meta.icon +
      '</span><span class="audit-card-score-value">' +
      avgPercent +
      '%</span></div></header>' +
      renderPageSpeedLegend() +
      '<div class="audit-card-body audit-card-body--pagespeed-pro">' +
      renderPageSpeedStrategyTile('Mobile', 'mobile', bundle.mobile) +
      renderPageSpeedStrategyTile('Desktop', 'desktop', bundle.desktop) +
      renderPageSpeedHealthOverview(bundle.mobile, bundle.desktop) +
      renderPageSpeedDetailsRow(bundle.mobile, bundle.desktop) +
      '</div></article>'
    );
  }

  function renderAuditCategoryCard(opts) {
    var meta = passPercentMeta(opts.percent);
    return (
      '<article class="audit-card audit-card--' +
      opts.modifier +
      '">' +
      '<header class="audit-card-head">' +
      '<div class="audit-card-intro">' +
      '<div class="audit-card-title">' +
      cardIcon(opts.modifier) +
      '<span>' +
      opts.title +
      '</span></div>' +
      (opts.subtitle
        ? '<div class="audit-card-subtitle">' + escapeHtml(opts.subtitle) + '</div>'
        : '') +
      '</div>' +
      '<div class="audit-card-score audit-card-score--' +
      meta.variant +
      '" aria-label="' +
      opts.percent +
      '% pass rate">' +
      '<span class="audit-card-score-icon" aria-hidden="true">' +
      meta.icon +
      '</span>' +
      '<span class="audit-card-score-value">' +
      opts.percent +
      '%</span></div></header>' +
      '<div class="audit-card-stats">' +
      '<span class="audit-stat audit-stat--critical"><span class="audit-stat-icon" aria-hidden="true">●</span> Critical ' +
      opts.critical +
      '</span>' +
      '<span class="audit-stat audit-stat--minor"><span class="audit-stat-icon" aria-hidden="true">●</span> Minor ' +
      opts.minor +
      '</span></div>' +
      '<div class="audit-card-body">' +
      opts.bodyHtml +
      '</div></article>'
    );
  }

  function renderSecurityHeaderGroups(securityHeaders, fallbackIssues, chartOpts) {
    fallbackIssues = fallbackIssues || [];
    chartOpts = chartOpts || {};
    var results = (securityHeaders && securityHeaders.results) || [];
    var criticalItems = [];
    var minorItems = [];
    var criticalCount = 0;
    var minorCount = 0;
    var passedCount = chartOpts.passed || 0;

    var warningItems = [];
    var warningCount = 0;
    if (!results.length) {
      fallbackIssues.forEach(function (item) {
        if (!isSecurityHeaderIssueLine(item)) return;
        var line = formatSecurityHeaderIssueLine(item);
        if (/deprecated|expect-ct|xss-protection|embedder-policy|opener-policy|report-only/i.test(line)) {
          warningItems.push(line);
        } else if (/referrer-policy|permissions-policy|resource-policy|x-powered-by|^server:/i.test(line)) {
          minorItems.push(line);
        } else {
          criticalItems.push(line);
        }
      });
      criticalCount = criticalItems.length;
      minorCount = minorItems.length;
      warningCount = warningItems.length;
    } else {
      var groups = splitSecurityResultsBySeverity(results);
      criticalItems = groups.critical.map(function (r) {
        return r.header + ': ' + (r.message || 'Failed');
      });
      minorItems = groups.minor.map(function (r) {
        return r.header + ': ' + (r.message || 'Failed');
      });
      warningItems = (groups.warning || []).map(function (r) {
        return r.header + ': ' + (r.message || 'Warning');
      });
      criticalCount = groups.critical.length;
      minorCount = groups.minor.length;
      warningCount = (groups.warning || []).length;
      passedCount = groups.passed.length;
    }

    if (chartOpts.critical != null) criticalCount = chartOpts.critical;
    if (chartOpts.minor != null) minorCount = chartOpts.minor;
    if (chartOpts.warning != null) warningCount = chartOpts.warning;
    if (chartOpts.passed != null) passedCount = chartOpts.passed;

    var pieMinor = minorCount + warningCount;
    var percent = chartOpts.percent;
    if (percent == null) {
      var t = passedCount + criticalCount + pieMinor;
      percent = t > 0 ? Math.round((passedCount / t) * 100) : computeSecurityPassPercent(securityHeaders);
    }
    var passedResults = results.length
      ? splitSecurityResultsBySeverity(results).passed
      : [];

    return [
      renderUnifiedSecurityIssueGroup(criticalItems, minorItems, warningItems),
      renderSecurityPassGroup(passedResults),
      renderAuditPieChartGroup({
        title: 'Header health',
        percent: percent,
        critical: criticalCount,
        minor: pieMinor,
        passed: passedCount
      })
    ].join('');
  }

  function renderScoreChip(score) {
    var n = Number(score) || 0;
    var variant = n >= 80 ? 'success' : n >= 50 ? 'warning' : 'danger';
    return (
      '<span class="chip chip--' +
      variant +
      ' chip--mono" title="SEO score">' +
      escapeHtml(String(n)) +
      '</span>'
    );
  }

  function buildPageDetailHtml(page, index, totalPages) {
    var issues = page.issues || { critical: [], minor: [], geo: [], hidden: [] };
    var geoIssues = issues.geo || [];
    var criticalSplit = splitSecurityHeaderIssues(issues.critical || []);
    var minorSplit = splitSecurityHeaderIssues(issues.minor || []);
    var seoMerged = mergeHiddenIntoIssueLists(criticalSplit.other, minorSplit.other, issues.hidden);
    var sortedPageCritical = seoMerged.critical;
    var sortedPageMinor = sortMinorIssuesForDisplay(seoMerged.minor);
    var allSecurityIssues = criticalSplit.security.concat(minorSplit.security);
    var securityResults = (page.securityHeaders && page.securityHeaders.results) || [];
    var securitySplit = securityResults.length
      ? splitSecurityResultsBySeverity(securityResults)
      : null;
    var securityCriticalCount = securitySplit
      ? securitySplit.critical.length
      : criticalSplit.security.length;
    var securityMinorCount = securitySplit ? securitySplit.minor.length : minorSplit.security.length;
    var securityPassedCount = securitySplit
      ? securitySplit.passed.length
      : Math.max(0, (page.securityHeaders && page.securityHeaders.passed) || 0);
    var seoCrit = sortedPageCritical.length;
    var seoMin = sortedPageMinor.length;
    var seoPassPercent = computeSeoPassPercent(seoCrit, seoMin);
    var geoSplit = splitGeoIssuesBySeverity(
      page.geoIssueSeverities && page.geoIssueSeverities.length
        ? page.geoIssueSeverities
        : geoIssues.map(function (t) {
            return { text: t, severity: inferGeoSeverityFromText(t) };
          })
    );
    var geoPassPoints = deriveGeoPassPoints(geoIssues);
    var geoIssueTotal =
      geoSplit.critical.length + geoSplit.minor.length + geoSplit.warning.length;
    var geoPassPercent = computeGeoPassPercent(geoPassPoints.length, geoIssueTotal);
    var securityWarningCount = securitySplit
      ? (securitySplit.warning || []).length
      : 0;
    var securityPassPercent =
      securityResults.length && securitySplit
        ? (function () {
            var total =
              securitySplit.passed.length +
              securitySplit.critical.length +
              securitySplit.minor.length +
              (securitySplit.warning || []).length;
            if (!total) return computeSecurityPassPercent(page.securityHeaders);
            return Math.round((securitySplit.passed.length / total) * 100);
          })()
        : computeSecurityPassPercent(page.securityHeaders);
    var securityScoreLabel =
      page.securityHeaders && page.securityHeaders.label
        ? page.securityHeaders.label + ' headers passed'
        : 'HTTP response headers';

    var seoCard = renderAuditCategoryCard({
      modifier: 'seo',
      title: 'SEO — On-Page Optimization',
      subtitle: 'Titles, links, meta tags, and content issues',
      percent: seoPassPercent,
      critical: seoCrit,
      minor: seoMin,
      bodyHtml: [
        renderUnifiedSeoIssueGroup({
          critical: sortedPageCritical,
          minor: sortedPageMinor
        }),
        renderAuditPieChartGroup({
          title: 'SEO health',
          percent: seoPassPercent,
          critical: seoCrit,
          minor: seoMin,
          passed: 0
        })
      ].join('')
    });

    var geoCard = renderAuditCategoryCard({
      modifier: 'geo',
      title: 'GEO — Generative Engine Optimization',
      subtitle: 'Schema, semantics, freshness, and AI-readiness',
      percent: geoPassPercent,
      critical: geoSplit.critical.length,
      minor: geoSplit.minor.length + geoSplit.warning.length,
      bodyHtml: [
        renderUnifiedGeoIssueGroup(geoIssues, page.geoIssueSeverities),
        renderAuditPassGroup({ items: geoPassPoints }),
        renderAuditPieChartGroup({
          title: 'GEO health',
          percent: geoPassPercent,
          critical: geoSplit.critical.length,
          minor: geoSplit.minor.length + geoSplit.warning.length,
          passed: geoPassPoints.length
        })
      ].join('')
    });

    var securityCard = renderAuditCategoryCard({
      modifier: 'security',
      title: 'Security Headers — HTTP Response',
      subtitle: securityScoreLabel,
      percent: securityPassPercent,
      critical: securityCriticalCount,
      minor: securityMinorCount + securityWarningCount,
      bodyHtml: renderSecurityHeaderGroups(page.securityHeaders, allSecurityIssues, {
        percent: securityPassPercent,
        passed: securityPassedCount,
        critical: securityCriticalCount,
        minor: securityMinorCount,
        warning: securityWarningCount
      })
    });

    var pageSpeedCard = renderPageSpeedCategoryCard(page.pageSpeed);
    var richResultsCard = renderRichResultsCategoryCard(page.richResults);

    return (
      '<div class="page-detail-content">' +
      '<div class="page-detail-meta">' +
      '<div class="pageMeta">Title: <b>' +
      escapeHtml(page.title || '—') +
      '</b></div>' +
      '<div class="pageMeta">Description: <b>' +
      escapeHtml(page.description || '—') +
      '</b></div>' +
      '<div class="pageMeta">Keywords: <b>' +
      escapeHtml(page.keywords || '—') +
      '</b></div>' +
      '<div class="page-detail-score">' +
      renderScoreChip(page.seoScore) +
      '</div></div>' +
      '<div class="audit-cards">' +
      seoCard +
      geoCard +
      securityCard +
      pageSpeedCard +
      richResultsCard +
      '</div></div>'
    );
  }

  function loadReportData() {
    if (window.SEO_REPORT_DATA) return window.SEO_REPORT_DATA;
    var el = document.getElementById('seo-report-export-data');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || '');
    } catch (e) {
      return null;
    }
  }

  function loadPageDetail(index) {
    var report = loadReportData();
    if (!report || !report.pages || !report.pages[index]) return '';
    return buildPageDetailHtml(report.pages[index], index, report.pages.length);
  }

  function ensurePageDetailLoaded(detailsEl) {
    var body = detailsEl.querySelector('.page-detail-body');
    if (!body || body.getAttribute('data-loaded') === 'true') return;
    var index = parseInt(detailsEl.getAttribute('data-page-index'), 10);
    if (Number.isNaN(index)) return;
    body.innerHTML =
      '<div class="page-detail-loading"><span class="page-detail-spinner" aria-hidden="true"></span> Loading page details…</div>';
    window.requestAnimationFrame(function () {
      body.innerHTML = loadPageDetail(index);
      body.setAttribute('data-loaded', 'true');
    });
  }

  function initPageDetailLazyLoad() {
    var list = document.getElementById('issue-details-list');
    if (!list) return;

    list.addEventListener(
      'toggle',
      function (event) {
        var target = event.target;
        if (!target || target.tagName !== 'DETAILS' || !target.classList.contains('page-detail')) return;
        if (!target.open) return;
        ensurePageDetailLoaded(target);
      },
      true
    );

    var filterInput = document.getElementById('page-detail-filter');
    if (filterInput) {
      filterInput.addEventListener('input', function () {
        var query = String(filterInput.value || '')
          .trim()
          .toLowerCase();
        list.querySelectorAll('.page-detail').forEach(function (detail) {
          var haystack = (
            detail.getAttribute('data-search') ||
            detail.textContent ||
            ''
          ).toLowerCase();
          detail.classList.toggle('page-detail--hidden', query && haystack.indexOf(query) === -1);
        });
      });
    }

    var collapseBtn = document.getElementById('collapse-all-pages');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', function () {
        list.querySelectorAll('.page-detail[open]').forEach(function (detail) {
          detail.open = false;
        });
      });
    }

    var expandBtn = document.getElementById('expand-all-pages');
    if (expandBtn) {
      expandBtn.addEventListener('click', function () {
        var details = Array.prototype.slice.call(list.querySelectorAll('.page-detail:not(.page-detail--hidden)'));
        if (details.length > EXPAND_ALL_WARN_THRESHOLD) {
          var ok = window.confirm(
            'This report has ' +
              details.length +
              ' pages. Expanding all may slow your browser. Continue with the first ' +
              EXPAND_ALL_BATCH +
              ' visible pages?'
          );
          if (!ok) return;
          details = details.slice(0, EXPAND_ALL_BATCH);
        }
        var i = 0;
        function step() {
          var batch = details.slice(i, i + EXPAND_ALL_BATCH);
          batch.forEach(function (detail) {
            detail.open = true;
            ensurePageDetailLoaded(detail);
          });
          i += EXPAND_ALL_BATCH;
          if (i < details.length) window.requestAnimationFrame(step);
        }
        step();
      });
    }
  }

  window.SeoReportDetails = {
    LAZY_PAGE_THRESHOLD: LAZY_PAGE_THRESHOLD,
    buildPageDetailHtml: buildPageDetailHtml,
    initPageDetailLazyLoad: initPageDetailLazyLoad
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageDetailLazyLoad);
  } else {
    initPageDetailLazyLoad();
  }
})();