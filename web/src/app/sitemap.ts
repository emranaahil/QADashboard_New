import type { MetadataRoute } from "next";
import { PAGE_SEO, SITE_URL } from "@/lib/site-seo";

/**
 * Sitemap for the canonical host (https://qadashboard.onrender.com).
 * Paths come from PAGE_SEO so every module page is listed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const paths = Array.from(
    new Set(Object.values(PAGE_SEO).map((p) => p.path))
  );

  return paths.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency: path === "/" || path === "/dashboard" ? "weekly" : "monthly",
    priority: path === "/" || path === "/dashboard" ? 1 : 0.8,
  }));
}
