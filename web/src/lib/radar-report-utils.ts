function csvEscape(value: string) {
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

export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export type KeywordReportRow = {
  url: string;
  statusCode?: number;
  matchedKeywords?: string[];
  isError?: boolean;
};

export type KeywordMatch = { url: string; keyword: string };

export function collectKeywordLinks(
  results: KeywordReportRow[],
  matches: KeywordMatch[]
): string[] {
  const urls = new Set<string>();
  for (const item of results) {
    if (item.url) urls.add(item.url);
  }
  for (const match of matches) {
    if (match.url) urls.add(match.url);
  }
  return Array.from(urls);
}

export function exportKeywordCsv(
  results: KeywordReportRow[],
  matches: KeywordMatch[],
  filenamePrefix = "keyword-radar"
) {
  const rows = results.length
    ? results.map((item) => ({
        url: item.url,
        status:
          item.statusCode != null
            ? String(item.statusCode)
            : (item.matchedKeywords?.length ? "Matched" : "No matches"),
        keywords: (item.matchedKeywords || []).join("; "),
      }))
    : matches.map((m) => ({ url: m.url, status: "—", keywords: m.keyword }));

  if (!rows.length) return false;

  let csv = "URL,Status,Keywords\n";
  for (const row of rows) {
    csv += `${csvEscape(row.url)},${csvEscape(row.status)},${csvEscape(row.keywords)}\n`;
  }
  downloadCsv(`${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  return true;
}

export type BrokenPage = { url: string; detectedErrors?: string[] };
export type BrokenLink = { brokenUrl: string; foundIn: string };
export type CheckedUrl = {
  url: string;
  statusCode?: number;
  detectedErrors?: string[];
};

export function collectErrorCheckLinks(
  brokenPages: BrokenPage[],
  brokenLinks: BrokenLink[],
  allCheckedUrls: CheckedUrl[] = []
): string[] {
  if (allCheckedUrls.length) {
    return allCheckedUrls.map((item) => item.url).filter(Boolean);
  }
  const urls = new Set<string>();
  for (const page of brokenPages) {
    if (page.url) urls.add(page.url);
  }
  for (const link of brokenLinks) {
    if (link.brokenUrl) urls.add(link.brokenUrl);
    if (link.foundIn) urls.add(link.foundIn);
  }
  return Array.from(urls);
}

export function exportErrorCheckCsv(
  brokenPages: BrokenPage[],
  brokenLinks: BrokenLink[],
  allCheckedUrls: CheckedUrl[] = [],
  filenamePrefix = "link-radar"
) {
  if (allCheckedUrls.length) {
    let csv = "URL,Status,Issues\n";
    for (const item of allCheckedUrls) {
      csv += `${csvEscape(item.url)},${csvEscape(item.statusCode != null ? String(item.statusCode) : "")},${csvEscape((item.detectedErrors || []).join("; "))}\n`;
    }
    downloadCsv(`${filenamePrefix}-all-urls-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    return true;
  }

  if (!brokenPages.length && !brokenLinks.length) return false;

  let csv = "Type,URL,Detail\n";
  for (const page of brokenPages) {
    csv += `${csvEscape("Broken Page")},${csvEscape(page.url)},${csvEscape((page.detectedErrors || []).join("; "))}\n`;
  }
  for (const link of brokenLinks) {
    csv += `${csvEscape("Broken Link")},${csvEscape(link.brokenUrl)},${csvEscape(link.foundIn)}\n`;
  }
  downloadCsv(`${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  return true;
}

export function moduleReportHtmlUrl(moduleId: string, reportId: string) {
  return `/api/modules/${moduleId}/reports/${encodeURIComponent(reportId)}/html`;
}