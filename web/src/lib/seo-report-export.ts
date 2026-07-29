export type SeoIssueElement = {
  issueCode: string;
  elementType: string;
  elementUrl?: string;
  elementText?: string;
  detail?: string;
};

export type SeoReportPage = {
  url: string;
  title?: string;
  description?: string;
  keywords?: string;
  seoScore?: number;
  h1Count?: number;
  h2Count?: number;
  h3Count?: number;
  hierarchyStatus?: string;
  counts?: {
    hrefHash?: number;
    jsVoid?: number;
    missingAlt?: number;
    missingOpenGraph?: number;
    missingGeo?: number;
  };
  issueElements?: SeoIssueElement[];
  issues?: {
    critical?: string[];
    minor?: string[];
    geo?: string[];
    hidden?: string[];
  };
};

export type SeoReportPayload = {
  mainUrl?: string;
  scanDate?: string;
  pages?: SeoReportPage[];
};

type IssueSeverity = "critical" | "minor" | "geo" | "hidden";

const CSV_BOM = "\uFEFF";

const ISSUES_DETAIL_HEADERS = [
  "Site URL",
  "Page URL",
  "SEO Score",
  "Severity",
  "Issue Category",
  "Issue Code",
  "Issue Title",
  "Issue Summary",
  "Element Type",
  "Element URL",
  "Element Text",
  "Issue Detail",
  "Page Title",
  "Meta Description",
];

function csvEscape(value: string | number | null | undefined) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function joinIssues(items?: string[]) {
  return (items || []).filter(Boolean).join("; ");
}

function parseIssueCode(summary: string): string {
  const text = summary.trim();
  const lower = text.toLowerCase();
  if (lower.startsWith("images without alt")) return "missing-alt";
  if (lower.startsWith("broken heading hierarchy")) return "broken-hierarchy";
  if (lower.startsWith("missing <h1>")) return "missing-h1";
  if (lower.startsWith("multiple <h1>") || /^h1 tags\s*\(/i.test(text)) return "multiple-h1";
  if (lower.startsWith("empty <h1>")) return "empty-h1";
  if (lower.startsWith("duplicate <h1>")) return "duplicate-h1";
  if (lower.startsWith("missing <title>")) return "missing-title";
  if (lower.startsWith("empty <title>")) return "empty-title";
  if (/^title tags\s*\(/i.test(text)) return "multiple-title";
  if (lower.startsWith("empty/invalid title")) return "empty-title-dom";
  if (lower.startsWith("duplicate title")) return "duplicate-title";
  if (lower.startsWith("duplicate description")) return "duplicate-description";
  if (lower.startsWith("page meta description")) return "meta-description";
  if (lower.startsWith("page meta keywords")) return "meta-keywords";
  if (lower.startsWith("meta description tags")) return "multiple-meta-description";
  if (lower.startsWith("meta keywords tags")) return "multiple-meta-keywords";
  if (lower.startsWith("missing canonical")) return "missing-canonical";
  if (lower.startsWith("missing open graph")) return "missing-og";
  if (lower.startsWith("missing twitter card")) return "missing-twitter-card";
  if (lower.startsWith("empty og:") || lower.startsWith("empty twitter:")) return "empty-social-meta";
  if (lower.startsWith("http security header") || lower.startsWith("csp strictness")) {
    return "http-security-header";
  }
  if (/^bad links/i.test(text) && /javascript\s*:\s*void/i.test(lower)) return "bad-js-void";
  if (/^bad links/i.test(text) && (lower.includes("href") || lower.includes("#"))) {
    return "bad-href-hash";
  }
  if (lower.startsWith("missing viewport")) return "missing-viewport";
  if (lower.startsWith("missing <html lang>")) return "missing-html-lang";
  if (lower.startsWith("robots meta conflict")) return "robots-meta-conflict";
  if (lower.startsWith("empty seo meta content") || lower.startsWith("empty meta content")) {
    return "empty-meta-content";
  }
  if (lower.startsWith("commented h1")) return "commented-h1";
  if (lower.startsWith("commented title")) return "commented-title";
  if (lower.startsWith("non-descriptive headings")) return "non-descriptive-headings";
  if (lower.startsWith("duplicate heading")) return "duplicate-heading";
  if (lower.startsWith("duplicate paragraph")) return "duplicate-paragraph";
  if (lower.startsWith("no schema.org")) return "no-schema";
  if (lower.startsWith("invalid schema.org")) return "invalid-schema";
  if (lower.startsWith("invalid geojson")) return "invalid-geojson";
  if (lower.startsWith("invalid microdata")) return "invalid-microdata";
  if (lower.startsWith("invalid rdfa")) return "invalid-rdfa";
  if (lower.startsWith("missing faq")) return "missing-faq";
  if (lower.startsWith("semantic html")) return "semantic-html";
  if (lower.startsWith("map present")) return "map-without-geo";
  if (lower.startsWith("placeholder content")) return "placeholder-content";
  if (lower.startsWith("outdated copyright")) return "outdated-copyright";
  if (lower.startsWith("outdated content date")) return "outdated-content-date";
  const colon = text.indexOf(":");
  if (colon > 0) {
    return text
      .slice(0, colon)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
  return "issue";
}

function parseIssueName(summary: string): string {
  const text = summary.trim();
  const sec = text.match(/^HTTP Security Header:\s*(.+)$/i);
  if (sec) {
    const rest = sec[1].trim();
    const headerColon = rest.indexOf(":");
    if (headerColon > 0) return rest.slice(0, headerColon).trim();
    return rest.slice(0, 80);
  }
  if (/^CSP Strictness:/i.test(text)) return "CSP Strictness";
  if (/^Permissions-Policy Strictness:/i.test(text)) return "Permissions-Policy Strictness";
  const colon = text.indexOf(":");
  if (colon > 0) return text.slice(0, colon).trim();
  return text;
}

function securityHeaderSeverityTag(issueSummary: string): string | null {
  const s = String(issueSummary || "");
  if (
    !/^HTTP Security Header:/i.test(s) &&
    !/^CSP Strictness:/i.test(s) &&
    !/^Permissions-Policy Strictness:/i.test(s) &&
    !/security header/i.test(s)
  ) {
    return null;
  }
  const t = s.toLowerCase();
  if (
    /cross-origin-embedder-policy|cross-origin-opener-policy|content-security-policy-report-only|x-xss-protection|expect-ct/.test(
      t
    )
  ) {
    return "Warning";
  }
  if (
    /referrer-policy|permissions-policy|cross-origin-resource-policy|x-powered-by|server:/.test(t)
  ) {
    return "Minor";
  }
  if (
    /content-security-policy|csp strictness|strict-transport-security|x-frame-options|x-content-type-options|cache-control/.test(
      t
    )
  ) {
    return "Critical";
  }
  return "Minor";
}

/** GEO issue severity (mirrors backend uiseocheck.js). */
function geoIssueSeverityTag(issueSummary: string): string | null {
  const t = String(issueSummary || "");
  if (!t) return null;
  if (/^No Schema\.org structured data/i.test(t)) return "Critical";
  if (/^Invalid Schema\.org structured data/i.test(t)) return "Critical";
  if (/^Invalid GeoJSON/i.test(t)) return "Critical";
  if (/^Map present without GeoJSON/i.test(t)) return "Warning";
  if (/^Placeholder content detected/i.test(t)) return "Warning";
  if (/^Outdated copyright year/i.test(t)) return "Warning";
  if (/^Invalid Microdata/i.test(t)) return "Minor";
  if (/^Invalid RDFa/i.test(t)) return "Minor";
  if (/^Missing FAQ section/i.test(t)) return "Minor";
  if (/^Semantic HTML issue/i.test(t)) return "Minor";
  if (/^Outdated content date/i.test(t)) return "Minor";
  if (
    /schema\.org|json-ld|geojson|microdata|rdfa|faq section|semantic html|placeholder content|copyright year|content date|map present/i.test(
      t
    )
  ) {
    return "Critical";
  }
  return null;
}

function severityLabel(severity: IssueSeverity | string, issueSummary = ""): string {
  const sec = securityHeaderSeverityTag(issueSummary);
  if (sec) return sec;
  if (severity === "geo") {
    return geoIssueSeverityTag(issueSummary) || "Critical";
  }
  const map: Record<string, string> = {
    critical: "Critical",
    minor: "Minor",
    geo: "Critical",
    hidden: "Minor",
    pagespeed: "Minor",
    warning: "Warning",
  };
  return map[severity] || String(severity);
}

function issueModuleCategory(severity: string, issueSummary: string): string {
  const s = String(issueSummary || "");
  if (severity === "geo") return "GEO";
  if (
    /^HTTP Security Header:/i.test(s) ||
    /^CSP Strictness:/i.test(s) ||
    /^Permissions-Policy Strictness:/i.test(s) ||
    /security header/i.test(s)
  ) {
    return "Security Headers";
  }
  if (/^PageSpeed\b|^Page Speed\b/i.test(s) || severity === "pagespeed") {
    return "Page Speed";
  }
  return "SEO";
}

function inferElementType(issueCode: string): string {
  if (issueCode === "missing-alt") return "img";
  if (issueCode === "bad-href-hash" || issueCode === "bad-js-void") return "a";
  if (issueCode.startsWith("meta-") || issueCode === "missing-canonical" || issueCode === "missing-og") {
    return "meta";
  }
  if (issueCode === "broken-hierarchy" || issueCode.includes("h1")) return "heading";
  if (
    issueCode.includes("geojson") ||
    issueCode.includes("map") ||
    issueCode.includes("microdata") ||
    issueCode.includes("rdfa")
  ) {
    return "markup";
  }
  if (issueCode.includes("schema") || issueCode.includes("json-ld")) return "json-ld";
  if (issueCode.includes("pagespeed") || issueCode.includes("page-speed")) return "pagespeed";
  return "page";
}

function buildFullIssueDetail(
  summary: string,
  el?: { detail?: string; elementText?: string; elementUrl?: string; sectionSnippet?: string }
): string {
  const parts: string[] = [];
  const full = String(summary || "").trim();
  if (full) parts.push(full);
  if (el?.detail && !full.includes(String(el.detail))) parts.push(String(el.detail));
  if (el?.elementText) parts.push(`Context: ${String(el.elementText).slice(0, 300)}`);
  if (el?.elementUrl) parts.push(`Resource: ${el.elementUrl}`);
  if (el?.sectionSnippet) parts.push(`Section: ${String(el.sectionSnippet).slice(0, 300)}`);
  return parts.filter(Boolean).join(" | ") || full;
}

function inferDetail(summary: string): string {
  const colon = summary.indexOf(":");
  return colon >= 0 ? summary.slice(colon + 1).trim() : summary;
}

function getElementsForIssue(page: SeoReportPage, issueCode: string): SeoIssueElement[] {
  return (page.issueElements || []).filter((el) => el.issueCode === issueCode);
}

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
  issueDetail,
}: {
  siteUrl: string;
  page: SeoReportPage;
  severity: IssueSeverity | string;
  issueCode: string;
  issueTitle: string;
  issueSummary: string;
  elementType: string;
  elementUrl: string;
  elementText: string;
  issueDetail: string;
}): string {
  return [
    siteUrl,
    page.url,
    page.seoScore ?? "",
    severityLabel(severity, issueSummary),
    issueModuleCategory(severity, issueSummary),
    issueCode,
    issueTitle,
    issueSummary,
    elementType,
    elementUrl,
    elementText,
    issueDetail || buildFullIssueDetail(issueSummary, { elementText, elementUrl }),
    page.title ?? "",
    page.description ?? "",
  ]
    .map(csvEscape)
    .join(",");
}

function appendPageSpeedIssueRows(
  rows: string[],
  siteUrl: string,
  page: SeoReportPage & { pageSpeed?: Record<string, unknown> }
) {
  const ps = page.pageSpeed as
    | {
        skipped?: boolean;
        reason?: string;
        mobile?: { error?: string; skipped?: boolean; reason?: string; performance?: number };
        desktop?: { error?: string; skipped?: boolean; reason?: string; performance?: number };
      }
    | undefined;
  if (!ps) return;

  const push = (title: string, detail: string, severity: string) => {
    const summary = `PageSpeed: ${title}: ${detail}`;
    rows.push(
      buildIssueDetailRow({
        siteUrl,
        page,
        severity,
        issueCode: "pagespeed",
        issueTitle: `PageSpeed: ${title}`,
        issueSummary: summary,
        elementType: "pagespeed",
        elementUrl: page.url || "",
        elementText: "",
        issueDetail: summary,
      })
    );
  };

  if (ps.skipped) {
    push("Skipped", ps.reason || "API key not configured", "minor");
    return;
  }

  for (const strategy of ["mobile", "desktop"] as const) {
    const side = ps[strategy];
    if (!side) continue;
    if (side.error) {
      push(`${strategy} error`, side.error, "critical");
      continue;
    }
    if (side.skipped) {
      push(`${strategy} skipped`, side.reason || "skipped", "minor");
      continue;
    }
    const perf = Number(side.performance);
    if (Number.isFinite(perf) && perf < 50) {
      push(
        `${strategy} performance`,
        `Performance score ${perf}/100 is below 50`,
        "critical"
      );
    } else if (Number.isFinite(perf) && perf < 90) {
      push(
        `${strategy} performance`,
        `Performance score ${perf}/100 is below 90`,
        "minor"
      );
    }
  }
}

export function buildSeoPagesSummaryCsv(report: SeoReportPayload): string {
  const pages = report.pages || [];
  const siteUrl = report.mainUrl || "";

  const headers = [
    "Site URL",
    "Page URL",
    "SEO Score",
    "Page Title",
    "Meta Description",
    "Meta Keywords",
    "H1 Count",
    "H2 Count",
    "H3 Count",
    "Heading Hierarchy",
    "Missing Alt Count",
    "Href # Count",
    "JS Void Link Count",
    "Missing OG Count",
    "Missing GEO Count",
    "Critical Count",
    "Minor Count",
    "GEO Count",
    "Hidden Count",
    "Critical Issues",
    "Minor Issues",
    "GEO Issues",
    "Hidden Issues",
  ];

  const rows = pages.map((page) => {
    const issues = page.issues || {};
    return [
      siteUrl,
      page.url,
      page.seoScore ?? "",
      page.title ?? "",
      page.description ?? "",
      page.keywords ?? "",
      page.h1Count ?? 0,
      page.h2Count ?? 0,
      page.h3Count ?? 0,
      page.hierarchyStatus ?? "",
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
      joinIssues(issues.hidden),
    ]
      .map(csvEscape)
      .join(",");
  });

  return `${CSV_BOM}${headers.join(",")}\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
}

export function buildSeoIssuesDetailCsv(report: SeoReportPayload): string {
  const pages = report.pages || [];
  const siteUrl = report.mainUrl || "";
  const rows: string[] = [];

  for (const page of pages) {
    const issues = page.issues || {};
    const severities: IssueSeverity[] = ["critical", "minor", "geo", "hidden"];

    for (const severity of severities) {
      for (const summary of issues[severity] || []) {
        if (!summary) continue;
        const issueCode = parseIssueCode(summary);
        const issueTitle = parseIssueName(summary);
        const elements = getElementsForIssue(page, issueCode);

        if (elements.length > 0) {
          for (const el of elements) {
            rows.push(
              buildIssueDetailRow({
                siteUrl,
                page,
                severity,
                issueCode,
                issueTitle,
                issueSummary: summary,
                elementType: el.elementType || inferElementType(issueCode),
                elementUrl: el.elementUrl || "",
                elementText: el.elementText ?? "",
                issueDetail: buildFullIssueDetail(summary, el),
              })
            );
          }
        } else {
          rows.push(
            buildIssueDetailRow({
              siteUrl,
              page,
              severity,
              issueCode,
              issueTitle,
              issueSummary: summary,
              elementType: inferElementType(issueCode),
              elementUrl: "",
              elementText: "",
              issueDetail: summary,
            })
          );
        }
      }
    }
    appendPageSpeedIssueRows(rows, siteUrl, page as SeoReportPage & { pageSpeed?: Record<string, unknown> });
  }

  return `${CSV_BOM}${ISSUES_DETAIL_HEADERS.join(",")}\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
}

export function exportSeoPagesSummaryCsv(
  report: SeoReportPayload,
  filenamePrefix = "seo-report"
): boolean {
  if (!report.pages?.length) return false;
  const date = (report.scanDate || new Date().toISOString()).slice(0, 10);
  const csv = buildSeoPagesSummaryCsv(report);
  downloadCsv(`SeoGeo-Audit-Pages-${date}.csv`, csv);
  return true;
}

export function exportSeoIssuesDetailCsv(
  report: SeoReportPayload,
  filenamePrefix = "seo-report"
): boolean {
  if (!report.pages?.length) return false;
  const hasIssues = report.pages.some((page) => {
    const issues = page.issues || {};
    return (
      (issues.critical?.length || 0) +
        (issues.minor?.length || 0) +
        (issues.geo?.length || 0) +
        (issues.hidden?.length || 0) >
      0
    );
  });
  if (!hasIssues) return false;
  const date = (report.scanDate || new Date().toISOString()).slice(0, 10);
  const csv = buildSeoIssuesDetailCsv(report);
  downloadCsv(`SeoGeo-Audit-Issues-${date}.csv`, csv);
  return true;
}

export function exportSeoReportCsvs(
  report: SeoReportPayload,
  filenamePrefix = "seo-report"
): { pages: boolean; issues: boolean } {
  return {
    pages: exportSeoPagesSummaryCsv(report, filenamePrefix),
    issues: exportSeoIssuesDetailCsv(report, filenamePrefix),
  };
}