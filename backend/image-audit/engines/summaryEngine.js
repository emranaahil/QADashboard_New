function buildSummary(images, reports = {}) {
  const urls = images.map((i) => i.identity?.url).filter(Boolean);
  const uniqueUrls = new Set(urls);
  const bytes = images.map((i) => i.network?.bytes || 0);
  const totalBytes = bytes.reduce((a, b) => a + b, 0);
  const sizes = bytes.filter((b) => b > 0);

  const lazyImages = images.filter((i) => i.source?.loading === 'lazy').length;
  const responsiveImages = images.filter((i) => i.source?.hasSrcset || i.source?.hasSizes).length;
  const cssImages = images.filter((i) => i.css?.source === 'css').length;
  const htmlImages = images.filter((i) => i.css?.source !== 'css').length;
  const svgImages = images.filter((i) => (i.metadata?.format || '').toUpperCase() === 'SVG').length;
  const brokenImages = images.filter((i) => i.verification?.broken).length;
  const duplicateImages = images.filter((i) => i.duplicate?.isDuplicate).length;
  const cdnImages = images.filter((i) => i.network?.cdn?.detected).length;

  let largest = null;
  let smallest = null;
  for (const img of images) {
    const b = img.network?.bytes || 0;
    if (!b) continue;
    if (!largest || b > largest.bytes) largest = { url: img.identity.url, bytes: b };
    if (!smallest || b < smallest.bytes) smallest = { url: img.identity.url, bytes: b };
  }

  return {
    totalImages: images.length,
    uniqueImages: uniqueUrls.size,
    cssImages,
    htmlImages,
    svgImages,
    lazyImages,
    responsiveImages,
    brokenImages,
    duplicateImages,
    totalBytes,
    totalBytesFormatted: formatBytes(totalBytes),
    potentialSavings: reports.optimization?.potentialSavingsBytes || 0,
    potentialSavingsFormatted: formatBytes(reports.optimization?.potentialSavingsBytes || 0),
    totalRequests: urls.length,
    totalCdnImages: cdnImages,
    averageSize: sizes.length ? Math.round(totalBytes / sizes.length) : 0,
    averageSizeFormatted: formatBytes(sizes.length ? Math.round(totalBytes / sizes.length) : 0),
    largestImage: largest,
    smallestImage: smallest,
    optimizationIssueCount: reports.optimization?.totalIssues || 0,
    accessibilityFailures: reports.accessibility?.failingImages?.length || 0,
    seoReviewCount: (reports.seo?.images || []).length,
    duplicateGroups: reports.duplicates?.duplicateGroups || 0
  };
}

function formatBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

module.exports = {
  buildSummary,
  formatBytes
};