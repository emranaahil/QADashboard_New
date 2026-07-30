/**
 * Public site SEO for QA Dashboard (production Render hosts).
 *
 * Primary (canonical):  https://qadashboard.onrender.com
 * Alternate production: https://qadashboard-nb1q.onrender.com
 */

import type { Metadata } from "next";

/** Canonical public origin (no trailing slash). */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SITE_URL ||
  "https://qadashboard.onrender.com"
).replace(/\/$/, "");

/** Secondary Render host (same app / alternate deploy). */
export const ALTERNATE_SITE_URL = (
  process.env.NEXT_PUBLIC_ALTERNATE_SITE_URL ||
  "https://qadashboard-nb1q.onrender.com"
).replace(/\/$/, "");

export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || "Md Imran";

export const GEO_REGION = process.env.NEXT_PUBLIC_GEO_REGION || "IN";
export const GEO_PLACENAME = process.env.NEXT_PUBLIC_GEO_PLACENAME || "India";
export const GEO_LAT = process.env.NEXT_PUBLIC_GEO_LAT || "22.5726";
export const GEO_LON = process.env.NEXT_PUBLIC_GEO_LON || "88.3639";
export const GEO_POSITION = `${GEO_LAT};${GEO_LON}`;
export const GEO_ICBM = `${GEO_LAT}, ${GEO_LON}`;

/** Shared keywords used on every page (platform-wide discovery + long-tail search phrases). */
export const CORE_KEYWORDS = [
  "QA Dashboard",
  "qadashboard",
  "website testing tool",
  "website testing tools free",
  "online website testing tool",
  "web testing tool",
  "web application testing tool",
  "website QA tool",
  "website QA testing",
  "website quality assurance",
  "software quality assurance",
  "software QA tools",
  "QA automation tool",
  "QA automation tools free",
  "test automation tool",
  "test automation dashboard",
  "automation testing tool",
  "automation metrics",
  "QA metrics dashboard",
  "web QA platform",
  "online website auditor",
  "website audit tool free",
  "website analyzer online",
  "website health checker",
  "website quality checker",
  "site quality checker",
  "website crawler tool",
  "website crawl testing",
  "QA engineer tools",
  "QA tools for testers",
  "manual and automation QA",
  "regression testing tool",
  "release testing checklist tool",
  "technical QA tools",
  "frontend testing tool",
  "Playwright testing dashboard",
  "free QA tools online",
  "best website testing tools",
  "all in one website tester",
  BRAND_NAME,
];

export const SITE_TITLE =
  "QA Dashboard — Website Testing Tool, QA Automation & Software Quality Assurance | " +
  BRAND_NAME;

export const SITE_DESCRIPTION =
  "Free online QA Dashboard for website testing and software quality assurance: " +
  "SEO & GEO audits, UI automation checks, broken link scanner, keyword radar, " +
  "sitemap & image audits, security headers, visual twin, and automation metrics for QA engineers.";

export const SITE_KEYWORDS = [
  ...CORE_KEYWORDS,
  "SEO audit tool",
  "SEO checker free online",
  "GEO SEO checker",
  "broken link checker free",
  "UI testing tool online",
  "visual QA tool",
  "sitemap checker free",
  "image audit tool",
  "security headers checker online",
  "CSP checker free",
  "HSTS checker",
  "SSL checker",
  "visual regression testing",
  "website crawl testing tool",
  "keyword scanner website",
  "how to test website quality",
  "check website for errors free",
  "website bug finder",
  "automated website testing online",
];

export type PageSeoKey =
  | "home"
  | "dashboard"
  | "seo-testing"
  | "ui-testing"
  | "keyword-radar"
  | "link-radar"
  | "sitemap-check"
  | "image-audit"
  | "security-audit"
  | "visual-twin"
  | "reports"
  | "history";

export type PageSeoEntry = {
  path: string;
  title: string;
  description: string;
  keywords: string[];
};

/**
 * Per-route SEO: title / description / keywords match what each module actually checks.
 */
export const PAGE_SEO: Record<PageSeoKey, PageSeoEntry> = {
  home: {
    path: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    keywords: SITE_KEYWORDS,
  },
  dashboard: {
    path: "/dashboard",
    title: "QA Dashboard Overview — Website Testing Hub & Automation Metrics",
    description:
      "Central QA Dashboard overview for website testing: track runs, automation metrics, " +
      "SEO/GEO, UI checks, link radar, keyword scans, image & sitemap audits, and security reports in one place.",
    keywords: [
      ...CORE_KEYWORDS,
      "QA dashboard overview",
      "website testing hub",
      "automation metrics dashboard",
      "QA run history",
      "multi module QA platform",
      "website audit dashboard",
      "quality assurance metrics",
      "test run tracking",
      "all in one QA dashboard",
      "centralized testing platform",
      "website testing home",
      "QA project dashboard free",
      "software testing control panel",
      "live website testing dashboard",
    ],
  },
  "seo-testing": {
    path: "/seo-testing",
    title: "SEO & GEO Audit Tool — On-Page SEO, Meta Tags, Security Headers Checker",
    description:
      "Run SEO and GEO audits: titles, meta descriptions, H1 hierarchy, Open Graph, schema/GEO signals, " +
      "HTTP security headers (CSP, HSTS, HTTPS, mixed content, cookies), PageSpeed, and Rich Results checks.",
    keywords: [
      ...CORE_KEYWORDS,
      "SEO audit tool",
      "SEO checker online",
      "SEO checker free",
      "website SEO checker free",
      "on page SEO checker",
      "on-page SEO scanner",
      "website SEO analyzer",
      "SEO analyzer free online",
      "SEO audit free tool",
      "technical SEO checker",
      "GEO SEO audit",
      "generative engine optimization checker",
      "meta title checker",
      "meta description checker",
      "meta title description checker",
      "title tag checker",
      "heading hierarchy checker",
      "H1 H2 checker",
      "Open Graph checker",
      "OG tags checker",
      "Twitter card checker",
      "schema markup checker",
      "JSON-LD checker",
      "structured data tester",
      "security headers checker",
      "security headers scanner free",
      "HTTP security headers test",
      "CSP checker",
      "CSP strictness checker",
      "content security policy checker",
      "HSTS checker",
      "strict transport security test",
      "mixed content checker",
      "HTTPS checker online",
      "is website secure checker",
      "HttpOnly cookie checker",
      "Secure cookie checker",
      "SameSite cookie checker",
      "clickjacking protection test",
      "X-Frame-Options checker",
      "MIME sniffing nosniff",
      "X-Content-Type-Options checker",
      "XSS CSP protection",
      "Permissions Policy checker",
      "Referrer Policy checker",
      "PageSpeed Insights audit",
      "Core Web Vitals checker",
      "Rich Results test",
      "Google rich results checker",
      "website meta tags generator check",
      "SEO report tool free",
    ],
  },
  "ui-testing": {
    path: "/ui-testing",
    title: "UI Testing Tool — Layout Bugs, Overflow, Broken Images & Visual QA",
    description:
      "Automated UI testing for websites: detect layout overflow, horizontal scroll, broken images, " +
      "element overlap, clipped text, small touch targets, contrast issues, blank pages, and full-site visual QA.",
    keywords: [
      ...CORE_KEYWORDS,
      "UI testing tool",
      "UI testing tool free",
      "UI testing online",
      "visual QA tool",
      "visual testing tool",
      "website layout checker",
      "website UI bug finder",
      "UI bug finder",
      "layout bug detector",
      "horizontal scroll detector",
      "horizontal scrollbar website check",
      "content overflow checker",
      "CSS overflow detector",
      "broken image detector",
      "broken images checker website",
      "responsive design tester",
      "mobile UI testing tool",
      "desktop tablet mobile UI test",
      "touch target checker",
      "small clickable area checker",
      "low contrast checker",
      "color contrast checker WCAG",
      "accessibility contrast test",
      "CLS layout shift",
      "layout shift detector",
      "full website UI crawl",
      "website screenshot testing",
      "Playwright UI testing",
      "automated UI regression testing",
      "visual defect detection",
      "cross device UI testing",
      "element overlap checker",
      "clipped text detector",
      "blank page detector",
      "frontend UI automation",
      "check website UI issues free",
    ],
  },
  "keyword-radar": {
    path: "/keyword-radar",
    title: "Keyword Radar — Website Keyword Scanner & Content Keyword Checker",
    description:
      "Keyword Radar crawls your site to find keyword matches across pages: content keyword scanning, " +
      "site-wide keyword discovery, and reports for SEO and content QA teams.",
    keywords: [
      ...CORE_KEYWORDS,
      "keyword scanner",
      "keyword scanner free",
      "website keyword checker",
      "website keyword finder",
      "keyword density tool",
      "keyword density checker free",
      "content keyword finder",
      "find keywords on website",
      "search keyword on website pages",
      "site crawl keyword search",
      "SEO keyword radar",
      "keyword research website crawl",
      "page keyword match tool",
      "keyword occurrence checker",
      "multi page keyword audit",
      "keyword presence checker",
      "on page keyword analyzer",
      "content SEO keyword scan",
      "crawl site for keywords",
    ],
  },
  "link-radar": {
    path: "/link-radar",
    title: "Link Radar — Broken Link Checker & Internal Link Auditor",
    description:
      "Link Radar finds broken pages and bad internal links: crawl link health, 404 detection, " +
      "href issues, and plain-English link QA reports for website quality assurance.",
    keywords: [
      ...CORE_KEYWORDS,
      "broken link checker",
      "broken link checker free",
      "broken link checker online",
      "dead link scanner",
      "dead link checker free",
      "find broken links on website",
      "internal link auditor",
      "internal link checker",
      "404 link finder",
      "404 error checker website",
      "website link health",
      "href checker",
      "broken URL detector",
      "site link crawl tool",
      "link radar QA",
      "website crawl broken links",
      "check all links on website free",
      "broken hyperlink checker",
      "external link checker",
      "link validation tool",
      "website link scanner",
    ],
  },
  "sitemap-check": {
    path: "/sitemap-check",
    title: "Sitemap Checker — XML Sitemap Audit & URL Status Validator",
    description:
      "Audit XML sitemaps and child sitemaps: validate sitemap structure, check page HTTP status, " +
      "find non-200 URLs, and verify crawl coverage for SEO and technical QA.",
    keywords: [
      ...CORE_KEYWORDS,
      "sitemap checker",
      "sitemap checker free",
      "XML sitemap validator",
      "XML sitemap checker online",
      "sitemap audit tool",
      "sitemap URL status checker",
      "sitemap crawl test",
      "robots sitemap checker",
      "sitemap index auditor",
      "sitemap index checker",
      "HTTP status sitemap scan",
      "SEO sitemap validation",
      "check sitemap.xml",
      "validate sitemap free",
      "sitemap broken URLs",
      "google sitemap checker",
      "submit sitemap readiness check",
    ],
  },
  "image-audit": {
    path: "/image-audit",
    title: "Image Audit Tool — Alt Text, Duplicates, CDN & Image SEO Checker",
    description:
      "Image audit for websites: missing alt text, duplicates, CDN usage, optimization signals, " +
      "accessibility and SEO image checks with reports for QA and content teams.",
    keywords: [
      ...CORE_KEYWORDS,
      "image audit tool",
      "website image audit free",
      "missing alt text checker",
      "alt text checker free",
      "image SEO checker",
      "image SEO audit tool",
      "duplicate image finder",
      "duplicate images on website",
      "CDN image audit",
      "image accessibility checker",
      "website image optimization audit",
      "broken image SEO",
      "img alt attribute checker",
      "check images without alt",
      "image accessibility WCAG",
      "website image crawler",
      "optimize images SEO check",
    ],
  },
  "security-audit": {
    path: "/security-audit",
    title: "Security Audit Tool — SSL Labs, Headers, Robots & Redirect Checks",
    description:
      "Website security audit module: SSL/TLS grades via SSL Labs, robots.txt checks, redirect path tracing, " +
      "W3C HTML validation options, and PageSpeed alongside technical security QA signals.",
    keywords: [
      ...CORE_KEYWORDS,
      "website security audit",
      "website security checker free",
      "website security scanner",
      "SSL Labs checker",
      "SSL test online",
      "TLS security grade",
      "SSL certificate checker",
      "HTTPS SSL test",
      "robots.txt auditor",
      "robots.txt checker",
      "redirect chain checker",
      "redirect checker free",
      "URL redirect path tracer",
      "W3C HTML validator",
      "HTML validation tool",
      "security QA tool",
      "technical security audit",
      "website vulnerability scan basic",
      "check website SSL grade",
      "is my website secure test",
    ],
  },
  "visual-twin": {
    path: "/visual-twin",
    title: "Visual Twin — Visual Comparison & Content Structure Diff for Websites",
    description:
      "Visual Twin compares pages for content and structure differences: missing or extra sections, " +
      "heading and image mismatches, and twinning reports for regression and release QA.",
    keywords: [
      ...CORE_KEYWORDS,
      "visual twin comparison",
      "website visual diff",
      "website page comparison tool",
      "compare two websites",
      "compare staging and production",
      "content structure comparison",
      "page twinning tool",
      "visual regression web",
      "visual regression testing free",
      "DOM structure compare",
      "missing section detector",
      "staging vs production compare",
      "website change detection",
      "webpage difference checker",
      "UI comparison tool",
      "release regression compare",
    ],
  },
  reports: {
    path: "/reports",
    title: "QA Reports Center — Download Website Testing & Audit Reports",
    description:
      "Browse and open QA Dashboard reports: SEO/GEO, UI testing, link radar, keyword scans, " +
      "sitemap, image, security, and other website testing report exports in one reports center.",
    keywords: [
      ...CORE_KEYWORDS,
      "QA reports",
      "website audit reports",
      "test report download",
      "SEO report center",
      "UI testing reports",
      "broken link report",
      "automation test reports",
      "QA report PDF HTML",
      "website testing report free",
      "export QA audit report",
      "test results dashboard reports",
    ],
  },
  history: {
    path: "/history",
    title: "QA Run History — Past Website Tests & Automation Runs",
    description:
      "View history of QA Dashboard runs: previous website tests, SEO audits, UI checks, " +
      "link and keyword scans, and other module executions for tracking automation metrics over time.",
    keywords: [
      ...CORE_KEYWORDS,
      "QA run history",
      "test history log",
      "website audit history",
      "automation run tracking",
      "previous test results",
      "QA job history",
      "test execution history",
      "past website scans",
      "QA activity log",
    ],
  },
};

/** Build Next.js Metadata for a module page (title, description, keywords, OG, Twitter, canonical). */
export function pageMetadata(key: PageSeoKey): Metadata {
  const page = PAGE_SEO[key];
  const url = `${SITE_URL}${page.path === "/" ? "" : page.path}`;
  const keywords = Array.from(new Set(page.keywords.filter(Boolean)));

  return {
    title: page.title,
    description: page.description,
    keywords,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      url,
      siteName: "QA Dashboard",
      title: page.title,
      description: page.description,
      images: [
        {
          url: "/og-image.svg",
          width: 1200,
          height: 630,
          alt: page.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: ["/og-image.svg"],
    },
  };
}
