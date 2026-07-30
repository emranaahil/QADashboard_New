/**
 * Public site SEO defaults for QA Dashboard (production Render hosts).
 *
 * Primary (canonical):  https://qadashboard.onrender.com
 * Alternate production: https://qadashboard-nb1q.onrender.com
 *
 * Override with NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_BRAND_NAME / NEXT_PUBLIC_GEO_* if needed.
 */

/** Canonical public origin (no trailing slash). Prefer the short production hostname. */
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

/** Brand shown in title / OG (from package author unless overridden). */
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || "Md Imran";

/** ISO 3166 region, e.g. IN-WB, US-CA — set via env for true local SEO. */
export const GEO_REGION = process.env.NEXT_PUBLIC_GEO_REGION || "IN";

/** City / area for geo.placename */
export const GEO_PLACENAME = process.env.NEXT_PUBLIC_GEO_PLACENAME || "India";

export const GEO_LAT = process.env.NEXT_PUBLIC_GEO_LAT || "22.5726";
export const GEO_LON = process.env.NEXT_PUBLIC_GEO_LON || "88.3639";
export const GEO_POSITION = `${GEO_LAT};${GEO_LON}`;
export const GEO_ICBM = `${GEO_LAT}, ${GEO_LON}`;

/**
 * Title aimed at QA / automation / testing tool searches (≈55–65 chars core brand + keywords).
 */
export const SITE_TITLE =
  "QA Dashboard — Website Testing Tool, QA Automation & Software Quality Assurance | " +
  BRAND_NAME;

/**
 * Meta description for Google/tool searches (≈150–160 chars ideal; slightly longer is ok).
 */
export const SITE_DESCRIPTION =
  "Free online QA Dashboard for website testing and software quality assurance: " +
  "SEO & GEO audits, UI automation checks, broken link scanner, keyword radar, " +
  "sitemap & image audits, security headers, and automation metrics for QA engineers.";

export const SITE_KEYWORDS = [
  "QA Dashboard",
  "website testing tool",
  "QA automation tool",
  "software quality assurance",
  "automation metrics",
  "website QA testing",
  "SEO audit tool",
  "GEO SEO checker",
  "broken link checker",
  "UI testing tool",
  "sitemap checker",
  "image audit tool",
  "security headers checker",
  "web testing dashboard",
  "QA engineer tools",
  "test automation dashboard",
  BRAND_NAME,
];
