import type { Job } from "@/lib/api";

export type SearchNavItem = {
  kind: "page";
  id: string;
  label: string;
  href: string;
  description: string;
};

export type SearchRunItem = {
  kind: "run";
  id: string;
  label: string;
  href: string;
  description: string;
  status: string;
  moduleId: string;
  reportAvailable?: boolean;
};

export type SearchResult = SearchNavItem | SearchRunItem;

export const SEARCH_NAV_ITEMS: SearchNavItem[] = [
  { kind: "page", id: "dashboard", label: "Dashboard", href: "/dashboard", description: "Overview and quick actions" },
  { kind: "page", id: "ui-testing", label: "UI Testing", href: "/ui-testing", description: "Single page and full website UI checks" },
  { kind: "page", id: "seo-testing", label: "SEO Testing", href: "/seo-testing", description: "SEO audits and reports" },
  { kind: "page", id: "keyword-radar", label: "Keyword Radar", href: "/keyword-radar", description: "Keyword crawl and PDF reports" },
  { kind: "page", id: "link-radar", label: "Link Radar", href: "/link-radar", description: "Broken links and error checks" },
  { kind: "page", id: "history", label: "History", href: "/history", description: "All execution history" },
  { kind: "page", id: "reports", label: "Reports", href: "/reports", description: "Reports center" },
];

function moduleHref(moduleId: string) {
  if (moduleId === "seo") return "/seo-testing";
  if (moduleId === "ui-check") return "/ui-testing?mode=single";
  if (moduleId === "full-ui-check") return "/ui-testing?mode=full";
  if (moduleId === "keyword-check") return "/keyword-radar";
  if (moduleId === "error-check") return "/link-radar";
  return "/history";
}

export function matchNavItems(query: string, limit = 4): SearchNavItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return SEARCH_NAV_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) ||
      item.description.toLowerCase().includes(needle) ||
      item.href.toLowerCase().includes(needle)
  ).slice(0, limit);
}

export function mapRunsToResults(runs: Job[], limit = 8): SearchRunItem[] {
  return runs.slice(0, limit).map((run) => ({
    kind: "run",
    id: run.id,
    label: run.url,
    href: moduleHref(run.moduleId),
    description: run.moduleId,
    status: run.status,
    moduleId: run.moduleId,
    reportAvailable: run.reportAvailable,
  }));
}

export function buildSearchResults(nav: SearchNavItem[], runs: SearchRunItem[]): SearchResult[] {
  return [...nav, ...runs];
}