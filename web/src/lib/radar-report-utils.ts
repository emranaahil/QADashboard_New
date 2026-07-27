function csvEscape(value: string) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function excelEscape(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadCsv(filename: string, csv: string) {
  downloadBlob(filename, csv, "text/csv;charset=utf-8;");
}

const CSV_BOM = "\uFEFF";

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
            : item.matchedKeywords?.length
              ? "Matched"
              : "No matches",
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

export type BrokenPageExplanation = {
  shortLabel?: string;
  summary?: string;
  whatItMeans?: string;
  fixHint?: string;
  howToCheck?: string;
  statusCode?: number | null;
  technicalDetail?: string;
  visuallyLooksOk?: boolean;
};

export type BrokenPage = {
  url: string;
  detectedErrors?: string[];
  statusCode?: number;
  pageTitle?: string;
  explanation?: BrokenPageExplanation | null;
};
export type BrokenLink = { brokenUrl: string; foundIn: string };
export type CheckedUrl = {
  url: string;
  statusCode?: number;
  detectedErrors?: string[];
  isBroken?: boolean;
  explanation?: BrokenPageExplanation | null;
};

/** Plain-English issue line for CSV / UI (works for old and new reports). */
export function formatBrokenPageIssue(page: BrokenPage): string {
  if (page.explanation?.summary) return page.explanation.summary;
  const status = page.statusCode;
  const errs = page.detectedErrors || [];
  const httpErr = errs.find((e) => /^http\s+\d{3}$/i.test(e));
  const code = status || (httpErr ? Number(httpErr.replace(/http\s+/i, "")) : 0);
  if (code === 410) {
    return "Looks OK in browser, but server says “Gone” (HTTP 410)";
  }
  if (code === 404 || errs.some((e) => /page not found/i.test(e))) {
    return "Page not found (HTTP 404)";
  }
  if (code >= 400) return `Problem response (HTTP ${code})`;
  return errs.join("; ") || "Issue detected";
}

/** Full Issues cell text for export (Main URL | URL | Issues). */
export function formatBrokenPageIssuesCell(page: BrokenPage): string {
  const exp = page.explanation;
  const parts: string[] = [];
  const summary = exp?.summary || formatBrokenPageIssue(page);
  if (summary) parts.push(summary);
  if (exp?.whatItMeans) parts.push(`What it means: ${exp.whatItMeans}`);
  if (exp?.fixHint) parts.push(`What to do: ${exp.fixHint}`);
  const code = exp?.statusCode ?? page.statusCode;
  if (code) parts.push(`HTTP status: ${code}`);
  if (!parts.length) {
    const errs = page.detectedErrors || [];
    return errs.join("; ") || "Issue detected";
  }
  return parts.join("\n\n");
}

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

type IssueExportRow = { mainUrl: string; url: string; issues: string };

function buildErrorCheckIssueRows(
  mainUrl: string,
  brokenPages: BrokenPage[],
  brokenLinks: BrokenLink[]
): IssueExportRow[] {
  const pageByUrl = new Map<string, BrokenPage>();
  for (const page of brokenPages) {
    if (page?.url) pageByUrl.set(page.url, page);
  }
  for (const link of brokenLinks) {
    if (link?.brokenUrl && !pageByUrl.has(link.brokenUrl)) {
      pageByUrl.set(link.brokenUrl, {
        url: link.brokenUrl,
        detectedErrors: [],
        statusCode: 0,
      });
    }
  }
  return [...pageByUrl.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((url) => {
      const page = pageByUrl.get(url)!;
      return {
        mainUrl: mainUrl || "",
        url,
        issues: formatBrokenPageIssuesCell(page),
      };
    });
}

/**
 * Export Link Radar issues as CSV:
 * Main URL | URL | Issues
 * Also downloads a formatted Excel-compatible .xls (bold headers, wrap, borders).
 */
export function exportErrorCheckCsv(
  brokenPages: BrokenPage[],
  brokenLinks: BrokenLink[],
  allCheckedUrls: CheckedUrl[] = [],
  filenamePrefix = "link-radar",
  mainUrl = ""
) {
  // Prefer broken pages; fall back to broken subset of allCheckedUrls
  let pages = brokenPages;
  if (!pages.length && allCheckedUrls.length) {
    pages = allCheckedUrls
      .filter((u) => u.isBroken || (u.detectedErrors || []).length)
      .map((u) => ({
        url: u.url,
        statusCode: u.statusCode,
        detectedErrors: u.detectedErrors,
        explanation: u.explanation,
      }));
  }

  const rows = buildErrorCheckIssueRows(mainUrl, pages, brokenLinks);
  if (!rows.length) return false;

  const date = new Date().toISOString().slice(0, 10);
  const base = `${filenamePrefix}-issues-${date}`;

  // Plain CSV — 3 columns
  const csvLines = [["Main URL", "URL", "Issues"].map(csvEscape).join(",")];
  for (const row of rows) {
    csvLines.push([row.mainUrl, row.url, row.issues].map(csvEscape).join(","));
  }
  downloadCsv(`${base}.csv`, `${CSV_BOM}${csvLines.join("\r\n")}\r\n`);

  // Formatted Excel HTML (.xls) — bold header, wrap, top-left, borders
  const headerStyle =
    "font-weight:bold;font-size:12pt;text-align:left;vertical-align:top;" +
    "white-space:normal;word-wrap:break-word;" +
    "background:#D9E2F3;color:#000000;" +
    "border:2.5pt solid #000000;padding:8px;";
  const cellStyle =
    "font-weight:normal;font-size:11pt;text-align:left;vertical-align:top;" +
    "white-space:normal;word-wrap:break-word;" +
    "border:1pt solid #000000;padding:8px;";

  const body = rows
    .map((row) => {
      const issuesHtml = excelEscape(row.issues).replace(/\n/g, "<br/>");
      return `<tr>
  <td style="${cellStyle}">${excelEscape(row.mainUrl)}</td>
  <td style="${cellStyle}">${excelEscape(row.url)}</td>
  <td style="${cellStyle}">${issuesHtml}</td>
</tr>`;
    })
    .join("\n");

  const excelHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="UTF-8" />
<style>
  table { border-collapse: collapse; table-layout: fixed; width: 100%; }
  th, td { font-family: Calibri, Arial, sans-serif; }
</style>
</head>
<body>
<table border="1" cellspacing="0" cellpadding="8">
  <thead>
    <tr>
      <th style="${headerStyle}">Main URL</th>
      <th style="${headerStyle}">URL</th>
      <th style="${headerStyle}">Issues</th>
    </tr>
  </thead>
  <tbody>
${body}
  </tbody>
</table>
</body>
</html>`;

  downloadBlob(
    `${base}.xls`,
    excelHtml,
    "application/vnd.ms-excel;charset=utf-8"
  );

  return true;
}

export function moduleReportHtmlUrl(moduleId: string, reportId: string) {
  return `/api/modules/${moduleId}/reports/${encodeURIComponent(reportId)}/html`;
}
