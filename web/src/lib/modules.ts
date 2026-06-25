export const MODULE_LABELS: Record<string, string> = {
  "keyword-check": "Keyword Radar",
  "error-check": "Link Radar",
  seo: "SEO Testing",
  "ui-check": "UI Testing",
  "full-ui-check": "Full UI Testing",
};

export function moduleLabel(moduleId: string): string {
  return MODULE_LABELS[moduleId] || moduleId;
}