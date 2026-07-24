const GENERIC_FILENAME = /^(image|img|photo|pic|banner|logo|asset|file|untitled|dsc|wp)[-_]?\d*\.(jpe?g|png|gif|webp|avif|svg)$/i;

function scoreFilename(filename) {
  if (!filename || filename === 'inline-data') return { score: 0, issue: 'no-filename' };
  if (GENERIC_FILENAME.test(filename)) return { score: 30, issue: 'generic-filename' };
  if (filename.length < 5) return { score: 40, issue: 'short-filename' };
  if (/[A-Z]{5,}/.test(filename.replace(/\.[^.]+$/, ''))) return { score: 50, issue: 'non-descriptive' };
  return { score: 90, issue: null };
}

function findStructuredDataImages(scripts) {
  const urls = [];
  for (const raw of scripts || []) {
    try {
      const data = JSON.parse(raw);
      collectImageUrls(data, urls);
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return urls;
}

function collectImageUrls(node, out) {
  if (!node) return;
  if (typeof node === 'string' && /^https?:\/\//i.test(node) && /\.(jpe?g|png|gif|webp|avif|svg)/i.test(node)) {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectImageUrls(n, out));
    return;
  }
  if (typeof node === 'object') {
    if (node.image) collectImageUrls(node.image, out);
    if (node.logo) collectImageUrls(node.logo, out);
    if (node.thumbnailUrl) collectImageUrls(node.thumbnailUrl, out);
    Object.values(node).forEach((v) => collectImageUrls(v, out));
  }
}

function analyzeSeo(img, pageSeo = {}) {
  const issues = [];
  const filename = img.identity?.filename || '';
  const filenameScore = scoreFilename(filename);
  if (filenameScore.issue) issues.push(filenameScore.issue);

  const structuredUrls = findStructuredDataImages(pageSeo.structuredDataScripts);
  const inStructuredData = structuredUrls.some((u) => u === img.identity?.url);
  const ogImage = pageSeo.ogImage || '';
  const twitterImage = pageSeo.twitterImage || '';
  const inOpenGraph = ogImage && (ogImage === img.identity?.url || ogImage.includes(filename));
  const inTwitter = twitterImage && (twitterImage === img.identity?.url || twitterImage.includes(filename));

  return {
    filename,
    filenameScore: filenameScore.score,
    structuredData: inStructuredData,
    openGraph: inOpenGraph,
    twitterImage: inTwitter,
    sitemapReference: false,
    issues,
    status: issues.length ? 'review' : 'pass'
  };
}

function buildSeoReport(images, pageSeo = {}) {
  const rows = images.map((img) => ({
    id: img.id,
    url: img.identity.url,
    ...img.seo
  }));

  const issueCounts = {};
  for (const row of rows) {
    for (const issue of row.issues || []) {
      issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    }
  }

  return {
    pageOgImage: pageSeo.ogImage || null,
    pageTwitterImage: pageSeo.twitterImage || null,
    structuredDataImageCount: findStructuredDataImages(pageSeo.structuredDataScripts).length,
    issueCounts,
    images: rows.filter((r) => (r.issues || []).length > 0)
  };
}

function applySeoToImages(images, pageSeo) {
  return images.map((img) => ({
    ...img,
    seo: analyzeSeo(img, pageSeo)
  }));
}

module.exports = {
  scoreFilename,
  analyzeSeo,
  buildSeoReport,
  applySeoToImages,
  findStructuredDataImages
};