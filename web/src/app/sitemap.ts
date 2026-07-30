import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-seo";

/**
 * Sitemap for the canonical host (https://qadashboard.onrender.com).
 * Alternate host qadashboard-nb1q.onrender.com will generate its own /sitemap.xml
 * when deployed with NEXT_PUBLIC_SITE_URL set to that origin.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const paths = [
    "/",
    "/dashboard",
    "/seo-testing",
    "/ui-testing",
    "/keyword-radar",
    "/link-radar",
    "/sitemap-check",
    "/image-audit",
    "/security-audit",
    "/reports",
  ];

  return paths.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency: path === "/" || path === "/dashboard" ? "weekly" : "monthly",
    priority: path === "/" || path === "/dashboard" ? 1 : 0.8,
  }));
}
