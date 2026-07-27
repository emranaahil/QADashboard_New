export const MODULE_LABELS: Record<string, string> = {
  "keyword-check": "Keyword Radar",
  "error-check": "Link Radar",
  seo: "Seo/Geo Audit",
  "ui-check": "UI Testing",
  "full-ui-check": "Full UI Testing",
  "sitemap-check": "Sitemap Audit",
  "image-audit": "Image Audit",
  "security-audit": "Security Audit",
  "visual-twin": "Visual Twin",
};

export function moduleLabel(moduleId: string): string {
  return MODULE_LABELS[moduleId] || moduleId;
}