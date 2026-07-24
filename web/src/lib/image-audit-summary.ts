export type ImageAuditSummary = {
  totalImages: number;
  uniqueImages: number;
  brokenImages: number;
  duplicateImages: number;
  totalCdnImages: number;
  lazyImages: number;
  responsiveImages: number;
  totalBytesFormatted: string;
  potentialSavingsFormatted: string;
  optimizationIssueCount: number;
  pagesAudited: number;
};

type ImageRow = {
  identity?: { url?: string; normalizedUrl?: string; pageUrl?: string };
  verification?: { broken?: boolean };
  optimization?: { issues?: string[] };
  rendering?: {
    viewports?: Record<
      string,
      { optimization?: { issues?: string[] } }
    >;
  };
  network?: { bytes?: number; cdn?: { detected?: boolean } };
  source?: { loading?: string; lazy?: boolean; responsive?: boolean; hasSrcset?: boolean; hasSizes?: boolean };
  duplicate?: { isDuplicate?: boolean };
};

type ImageAuditReportPayload = {
  pagesAudited?: number;
  summary?: Partial<ImageAuditSummary> & {
    totalBytes?: number;
    potentialSavings?: number;
  };
  images?: ImageRow[];
};

function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function collectOptimizationIssues(img: ImageRow): string[] {
  const issues = new Set<string>();
  for (const issue of img.optimization?.issues || []) {
    if (issue) issues.add(issue);
  }
  const viewports = img.rendering?.viewports || {};
  for (const slot of Object.values(viewports)) {
    for (const issue of slot.optimization?.issues || []) {
      if (issue) issues.add(issue);
    }
  }
  return [...issues];
}

export function imageHasIssues(img: ImageRow): boolean {
  if (img.verification?.broken) return true;
  return collectOptimizationIssues(img).length > 0;
}

export function resolveImageAuditSummary(report: ImageAuditReportPayload | null | undefined): ImageAuditSummary {
  const images = report?.images || [];
  const summary = report?.summary;
  const pagesAudited = report?.pagesAudited ?? summary?.pagesAudited ?? 1;

  if (summary) {
    return {
      totalImages: summary.totalImages ?? images.length,
      uniqueImages: summary.uniqueImages ?? 0,
      brokenImages: summary.brokenImages ?? 0,
      duplicateImages: summary.duplicateImages ?? 0,
      totalCdnImages: summary.totalCdnImages ?? 0,
      lazyImages: summary.lazyImages ?? 0,
      responsiveImages: summary.responsiveImages ?? 0,
      totalBytesFormatted:
        summary.totalBytesFormatted ??
        (summary.totalBytes != null ? formatBytes(summary.totalBytes) : "0 B"),
      potentialSavingsFormatted:
        summary.potentialSavingsFormatted ??
        (summary.potentialSavings != null ? formatBytes(summary.potentialSavings) : "0 B"),
      optimizationIssueCount: summary.optimizationIssueCount ?? 0,
      pagesAudited,
    };
  }

  const urls = images.map((i) => i.identity?.normalizedUrl || i.identity?.url).filter(Boolean);
  const bytes = images.map((i) => i.network?.bytes || 0);
  const totalBytes = bytes.reduce((a, b) => a + b, 0);

  return {
    totalImages: images.length,
    uniqueImages: new Set(urls).size,
    brokenImages: images.filter((i) => i.verification?.broken).length,
    duplicateImages: images.filter((i) => i.duplicate?.isDuplicate).length,
    totalCdnImages: images.filter((i) => i.network?.cdn?.detected).length,
    lazyImages: images.filter((i) => i.source?.loading === "lazy" || i.source?.lazy).length,
    responsiveImages: images.filter(
      (i) => i.source?.responsive || i.source?.hasSrcset || i.source?.hasSizes
    ).length,
    totalBytesFormatted: formatBytes(totalBytes),
    potentialSavingsFormatted: "—",
    optimizationIssueCount: images.filter((i) => collectOptimizationIssues(i).length > 0).length,
    pagesAudited,
  };
}

export function formatImageIssueList(img: ImageRow): string {
  const issues = collectOptimizationIssues(img);
  return issues.length ? issues.join(", ") : "—";
}