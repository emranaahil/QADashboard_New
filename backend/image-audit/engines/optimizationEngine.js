const MODERN_FORMATS = new Set(['WEBP', 'AVIF', 'JXL', 'HEIC', 'HEIF', 'APNG']);
const LEGACY_FORMATS = new Set(['JPEG', 'PNG', 'GIF', 'BMP', 'TIFF', 'ICO', 'WBMP']);

function analyzeOptimization(img) {
  const issues = [];
  const recommendations = [];
  const format = (img.metadata?.format || 'UNKNOWN').toUpperCase();
  const bytes = img.network?.bytes || 0;
  const nw = img.rendering?.naturalWidth || 0;
  const nh = img.rendering?.naturalHeight || 0;
  const dw = img.rendering?.displayWidth || 0;
  const dh = img.rendering?.displayHeight || 0;

  if (bytes > 500 * 1024 && dw > 0 && nw > dw * 1.5) {
    issues.push('oversized');
    recommendations.push('resize');
  }

  if (dw > 0 && nw > 0 && (dw > nw * 1.25 || dh > nh * 1.25)) {
    issues.push('undersized');
    recommendations.push('resize');
  }

  if (nw > 0 && dw > 0 && Math.abs(nw / nh - dw / dh) > 0.15) {
    issues.push('scaling');
    recommendations.push('resize');
  }

  if (img.source?.belowFold && img.source?.loading !== 'lazy' && img.css?.source !== 'css') {
    issues.push('missing-lazy-loading');
    recommendations.push('lazy-load');
  }

  if (!img.source?.hasSrcset && !img.source?.hasSizes && dw >= 200 && img.css?.source !== 'css') {
    issues.push('responsive');
    recommendations.push('responsive-images');
  }

  if (LEGACY_FORMATS.has(format) && bytes > 80 * 1024) {
    issues.push('legacy-format');
    recommendations.push('convert-format');
  }

  if (bytes > 150 * 1024 && !MODERN_FORMATS.has(format)) {
    recommendations.push('compress');
  }

  return {
    format,
    issues: [...new Set(issues)],
    recommendations: [...new Set(recommendations)],
    potentialSavingsBytes: estimateSavings(bytes, issues, format)
  };
}

function estimateSavings(bytes, issues, format) {
  if (!bytes) return 0;
  let ratio = 0;
  if (issues.includes('oversized')) ratio += 0.35;
  if (issues.includes('legacy-format')) ratio += 0.25;
  if (issues.includes('responsive')) ratio += 0.1;
  if (ratio === 0 && format === 'PNG' && bytes > 100 * 1024) ratio = 0.2;
  return Math.round(bytes * Math.min(ratio, 0.6));
}

function buildOptimizationReport(images) {
  const analyzed = images.map((img) => ({
    id: img.id,
    url: img.identity.url,
    ...img.optimization
  }));

  const issueCounts = {};
  const recommendationCounts = {};
  let totalSavings = 0;

  for (const row of analyzed) {
    totalSavings += row.potentialSavingsBytes || 0;
    for (const issue of row.issues || []) {
      issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    }
    for (const rec of row.recommendations || []) {
      recommendationCounts[rec] = (recommendationCounts[rec] || 0) + 1;
    }
  }

  return {
    totalIssues: Object.values(issueCounts).reduce((a, b) => a + b, 0),
    issueCounts,
    recommendationCounts,
    potentialSavingsBytes: totalSavings,
    images: analyzed.filter((r) => (r.issues || []).length > 0)
  };
}

function applyOptimizationToImages(images, requestCounts = {}) {
  return images.map((img) => {
    const url = img.identity?.url;
    const viewports = { ...(img.rendering?.viewports || {}) };
    const allIssues = new Set();
    const allRecs = new Set();
    let totalSavings = 0;

    for (const [key, slot] of Object.entries(viewports)) {
      const rw = slot.visible ? (slot.renderedWidth || 0) : 0;
      const rh = slot.visible ? (slot.renderedHeight || 0) : 0;
      const optimization = analyzeOptimization({
        ...img,
        rendering: {
          ...img.rendering,
          displayWidth: rw,
          displayHeight: rh
        }
      });
      viewports[key] = { ...slot, optimization };
      for (const issue of optimization.issues || []) allIssues.add(issue);
      for (const rec of optimization.recommendations || []) allRecs.add(rec);
      totalSavings += optimization.potentialSavingsBytes || 0;
    }

    const combined = {
      issues: [...allIssues],
      recommendations: [...allRecs],
      potentialSavingsBytes: totalSavings
    };

    if (requestCounts[url] > 1) {
      combined.issues.push('duplicate-download');
      for (const key of Object.keys(viewports)) {
        const vpOpt = viewports[key].optimization || { issues: [], recommendations: [] };
        if (!vpOpt.issues.includes('duplicate-download')) {
          viewports[key] = {
            ...viewports[key],
            optimization: {
              ...vpOpt,
              issues: [...(vpOpt.issues || []), 'duplicate-download']
            }
          };
        }
      }
    }

    return {
      ...img,
      rendering: { ...img.rendering, viewports },
      optimization: combined
    };
  });
}

module.exports = {
  analyzeOptimization,
  buildOptimizationReport,
  applyOptimizationToImages,
  MODERN_FORMATS,
  LEGACY_FORMATS
};