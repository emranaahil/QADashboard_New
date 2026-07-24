const CDN_PATTERNS = [
  { id: 'cloudflare', label: 'Cloudflare', patterns: [/cloudflare/i, /cdn-cgi/i, /\.cf\./i] },
  { id: 'cloudinary', label: 'Cloudinary', patterns: [/res\.cloudinary\.com/i, /cloudinary\.com/i] },
  { id: 'imgix', label: 'Imgix', patterns: [/\.imgix\.net/i, /imgix\.net/i] },
  { id: 'imagekit', label: 'ImageKit', patterns: [/ik\.imagekit\.io/i, /imagekit\.io/i] },
  { id: 'akamai', label: 'Akamai', patterns: [/akamaized\.net/i, /akamaihd\.net/i, /akamai\.net/i] },
  { id: 'fastly', label: 'Fastly', patterns: [/fastly\.net/i, /fastlylb\.net/i] },
  { id: 'bunnycdn', label: 'BunnyCDN', patterns: [/b-cdn\.net/i, /bunnycdn\.com/i] },
  { id: 'cloudfront', label: 'AWS CloudFront', patterns: [/cloudfront\.net/i] },
  { id: 'azure', label: 'Azure CDN', patterns: [/azureedge\.net/i, /azurefd\.net/i, /azure-api\.net/i] }
];

function detectCdn(url, headers = {}) {
  const haystack = `${url || ''} ${JSON.stringify(headers || {})}`;
  const matches = [];
  for (const cdn of CDN_PATTERNS) {
    if (cdn.patterns.some((re) => re.test(haystack))) {
      matches.push(cdn.label);
    }
  }
  const server = headers['server'] || headers['Server'] || '';
  if (/cloudflare/i.test(server) && !matches.includes('Cloudflare')) {
    matches.push('Cloudflare');
  }
  return {
    detected: matches.length > 0,
    providers: matches,
    primary: matches[0] || null
  };
}

function buildCdnReport(images) {
  const byProvider = {};
  const cdnImages = images.filter((img) => img.network?.cdn?.detected);
  for (const img of cdnImages) {
    const provider = img.network.cdn.primary || 'Unknown';
    byProvider[provider] = (byProvider[provider] || 0) + 1;
  }
  return {
    totalCdnImages: cdnImages.length,
    totalNonCdnImages: images.length - cdnImages.length,
    byProvider,
    images: cdnImages.map((img) => ({
      id: img.id,
      url: img.identity.url,
      providers: img.network.cdn.providers
    }))
  };
}

module.exports = {
  CDN_PATTERNS,
  detectCdn,
  buildCdnReport
};