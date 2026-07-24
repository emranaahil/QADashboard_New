const crypto = require('crypto');

function normalizeImageUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return String(url).trim();
  }
}

function buildDuplicateReport(images) {
  const byUrl = new Map();
  const byFilename = new Map();
  const byDimensions = new Map();

  for (const img of images) {
    const normUrl = normalizeImageUrl(img.identity?.url || img.identity?.normalizedUrl);
    const filename = (img.identity?.filename || '').toLowerCase();
    const dims = `${img.rendering?.naturalWidth || 0}x${img.rendering?.naturalHeight || 0}`;

    if (normUrl) {
      if (!byUrl.has(normUrl)) byUrl.set(normUrl, []);
      byUrl.get(normUrl).push(img.id);
    }
    if (filename && filename !== 'inline-data') {
      if (!byFilename.has(filename)) byFilename.set(filename, []);
      byFilename.get(filename).push(img.id);
    }
    if (dims !== '0x0') {
      const key = `${dims}|${img.metadata?.format || ''}|${Math.round((img.network?.bytes || 0) / 1024)}kb`;
      if (!byDimensions.has(key)) byDimensions.set(key, []);
      byDimensions.get(key).push(img.id);
    }
  }

  const urlDuplicates = [];
  for (const [url, ids] of byUrl) {
    if (ids.length > 1) {
      urlDuplicates.push({ type: 'url', key: url, count: ids.length, imageIds: ids });
    }
  }

  const filenameDuplicates = [];
  for (const [filename, ids] of byFilename) {
    if (ids.length > 1) {
      filenameDuplicates.push({ type: 'filename', key: filename, count: ids.length, imageIds: ids });
    }
  }

  const dimensionDuplicates = [];
  for (const [key, ids] of byDimensions) {
    if (ids.length > 1) {
      dimensionDuplicates.push({ type: 'dimensions', key, count: ids.length, imageIds: ids });
    }
  }

  const duplicateImageIds = new Set();
  [...urlDuplicates, ...filenameDuplicates, ...dimensionDuplicates].forEach((group) => {
    group.imageIds.forEach((id) => duplicateImageIds.add(id));
  });

  return {
    urlDuplicates,
    filenameDuplicates,
    dimensionDuplicates,
    renderedCopies: urlDuplicates.filter((d) => d.count > 1),
    totalDuplicateImages: duplicateImageIds.size,
    duplicateGroups: urlDuplicates.length + filenameDuplicates.length + dimensionDuplicates.length
  };
}

function markDuplicatesOnImages(images, duplicateReport) {
  const dupIds = new Set();
  [
    ...duplicateReport.urlDuplicates,
    ...duplicateReport.filenameDuplicates,
    ...duplicateReport.dimensionDuplicates
  ].forEach((g) => g.imageIds.forEach((id) => dupIds.add(id)));

  return images.map((img) => ({
    ...img,
    duplicate: {
      isDuplicate: dupIds.has(img.id),
      urlMatch: duplicateReport.urlDuplicates.some((d) => d.imageIds.includes(img.id)),
      filenameMatch: duplicateReport.filenameDuplicates.some((d) => d.imageIds.includes(img.id)),
      dimensionMatch: duplicateReport.dimensionDuplicates.some((d) => d.imageIds.includes(img.id))
    }
  }));
}

function contentFingerprint(buffer) {
  if (!buffer || !buffer.length) return null;
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

module.exports = {
  normalizeImageUrl,
  buildDuplicateReport,
  markDuplicatesOnImages,
  contentFingerprint
};