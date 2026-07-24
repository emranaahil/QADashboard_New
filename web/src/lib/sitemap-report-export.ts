export type SitemapReportForExport = {
  url?: string;
  sitemapUrl?: string | null;
  sitemaps?: string[];
  generatedAt?: string;
  urls?: Array<{
    url?: string;
    statusCode?: number;
    hasIssue?: boolean;
    issues?: string[];
    redirectStatus?: number | null;
    redirectLocation?: string | null;
    finalUrl?: string;
  }>;
};

const CSV_BOM = "\uFEFF";

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

function resultLabel(row: NonNullable<SitemapReportForExport["urls"]>[number]) {
  const failed =
    row.hasIssue || (row.statusCode != null && Number(row.statusCode) !== 200);
  return failed ? "Fail" : "Pass";
}

export function buildSitemapPagesCsv(report: SitemapReportForExport): string {
  const urls = report.urls || [];
  const siteUrl = report.url || "";
  const headers = [
    "Site URL",
    "Page URL",
    "Status Code",
    "Result",
    "Detail",
    "Redirect Status",
    "Redirect Location",
    "Final URL",
  ];

  const rows = urls.map((row) =>
    [
      siteUrl,
      row.url || "",
      row.statusCode != null ? row.statusCode : "",
      resultLabel(row),
      (row.issues || []).join("; ") || "",
      row.redirectStatus != null ? row.redirectStatus : "",
      row.redirectLocation || "",
      row.finalUrl || "",
    ]
      .map(csvEscape)
      .join(",")
  );

  return `${CSV_BOM}${headers.map(csvEscape).join(",")}\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
}

export function buildSitemapFilesCsv(report: SitemapReportForExport): string {
  const sitemaps = report.sitemaps || [];
  const root = report.sitemapUrl || "";
  const headers = ["#", "Sitemap URL", "Type", "Root Sitemap"];
  const rows = sitemaps.map((sm, idx) =>
    [idx + 1, sm, sm === root ? "Root" : "Nested", root].map(csvEscape).join(",")
  );
  return `${CSV_BOM}${headers.map(csvEscape).join(",")}\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
}

export function exportSitemapPagesCsv(report: SitemapReportForExport): boolean {
  if (!report.urls?.length) return false;
  const date = (report.generatedAt || new Date().toISOString()).slice(0, 10);
  downloadCsv(`Sitemap-Audit-Pages-${date}.csv`, buildSitemapPagesCsv(report));
  return true;
}

export function exportSitemapFilesCsv(report: SitemapReportForExport): boolean {
  if (!report.sitemaps?.length) return false;
  const date = (report.generatedAt || new Date().toISOString()).slice(0, 10);
  downloadCsv(`Sitemap-Audit-Files-${date}.csv`, buildSitemapFilesCsv(report));
  return true;
}
