function analyzeAccessibility(img) {
  const issues = [];
  const alt = img.accessibility?.alt;
  const role = img.accessibility?.role || '';
  const ariaLabel = img.accessibility?.ariaLabel || '';
  const isDecorative = alt === '' || role === 'presentation' || role === 'none';
  const isCss = img.css?.source === 'css';

  if (!isCss && img.source?.tag === 'img') {
    if (alt == null) {
      issues.push('missing-alt');
    } else if (alt === '') {
      issues.push('empty-alt');
      if (!isDecorative && !ariaLabel) {
        issues.push('decorative-ambiguous');
      }
    }
    if (!alt && !ariaLabel && img.source?.visible) {
      issues.push('no-text-alternative');
    }
  }

  if (ariaLabel) {
    issues.push('aria-label-present');
  }

  return {
    alt: alt == null ? null : String(alt),
    emptyAlt: alt === '',
    decorative: isDecorative,
    ariaLabel: ariaLabel || null,
    issues: issues.filter((i) => i !== 'aria-label-present' || issues.length === 1),
    status: issues.filter((i) => i !== 'aria-label-present').length ? 'fail' : 'pass'
  };
}

function buildAccessibilityReport(images) {
  const rows = images
    .filter((img) => img.css?.source !== 'css')
    .map((img) => ({
      id: img.id,
      url: img.identity.url,
      pageUrl: img.identity.pageUrl,
      ...img.accessibility
    }));

  const issueCounts = {};
  for (const row of rows) {
    for (const issue of row.issues || []) {
      issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    }
  }

  return {
    totalChecked: rows.length,
    issueCounts,
    failingImages: rows.filter((r) => r.status === 'fail'),
    images: rows
  };
}

function applyAccessibilityToImages(images) {
  return images.map((img) => ({
    ...img,
    accessibility: analyzeAccessibility(img)
  }));
}

module.exports = {
  analyzeAccessibility,
  buildAccessibilityReport,
  applyAccessibilityToImages
};