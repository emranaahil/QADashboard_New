const { chromium } = require('playwright');
const { discoverImagesInPage } = require('./imageDiscovery');
const {
  formatFromMime,
  formatFromUrl,
  isImageResponse,
  getBrowserFormatConfig
} = require('./imageFormatRegistry');
const { detectCdn, buildCdnReport } = require('./engines/cdnEngine');
const {
  normalizeImageUrl,
  buildDuplicateReport,
  markDuplicatesOnImages
} = require('./engines/duplicateEngine');
const {
  applyOptimizationToImages,
  buildOptimizationReport
} = require('./engines/optimizationEngine');
const {
  applyAccessibilityToImages,
  buildAccessibilityReport
} = require('./engines/accessibilityEngine');
const { applySeoToImages, buildSeoReport } = require('./engines/seoEngine');
const { buildSummary } = require('./engines/summaryEngine');
const {
  discoverSiteUrlsByCrawl,
  DEFAULT_MAX_URLS
} = require('../shared/services/siteUrlCrawler');
const { probeImageUrl, parseImageDimensions } = require('./imageProbeUtils');
const {
  DEFAULT_AUDIT_VIEWPORTS,
  resolveAuditViewports,
  initViewportMap,
  computeDiffPct,
  viewportSummaryLine
} = require('./viewportConfig');

const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_FULL_MAX_URLS = 100;
const IMAGE_PROBE_CONCURRENCY = 10;

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'site';
  }
}

function resolveJobUrls(jobOrOptions, startUrl) {
  if (Array.isArray(jobOrOptions?.urls) && jobOrOptions.urls.length) {
    return jobOrOptions.urls;
  }
  if (Array.isArray(jobOrOptions?.options?.urls) && jobOrOptions.options.urls.length) {
    return jobOrOptions.options.urls;
  }
  return [startUrl];
}

function needsImageProbe(norm, networkMap) {
  const net = networkMap[norm] || {};
  if (net.status != null && net.status >= 400) return false;
  if (net.bytes > 0 && net.status >= 200 && net.status < 400) {
    return !(net.probedWidth > 0 || net.probedHeight > 0);
  }
  return true;
}

async function probeSourceOnlyImages(page, candidates, networkMap) {
  const toProbe = [];
  const seen = new Set();

  for (const raw of candidates || []) {
    const url = raw.url;
    if (!url || url.startsWith('data:') || url.startsWith('inline-svg:') || url.startsWith('blob:')) {
      continue;
    }
    const norm = normalizeImageUrl(url);
    if (seen.has(norm) || !needsImageProbe(norm, networkMap)) continue;
    seen.add(norm);
    toProbe.push(url);
  }

  let index = 0;
  async function worker() {
    while (index < toProbe.length) {
      const url = toProbe[index++];
      const norm = normalizeImageUrl(url);
      const prev = networkMap[norm] || {};
      const result = await probeImageUrl(page.request, url, { formatFromMime, formatFromUrl });
      networkMap[norm] = {
        ...prev,
        ...result,
        bytes: Math.max(result.bytes || 0, prev.bytes || 0),
        probedWidth: result.probedWidth || prev.probedWidth || 0,
        probedHeight: result.probedHeight || prev.probedHeight || 0,
        requestCount: (prev.requestCount || 0) + (result.requestCount || 1)
      };
    }
  }

  if (!toProbe.length) return;

  const workers = Array.from(
    { length: Math.min(IMAGE_PROBE_CONCURRENCY, toProbe.length) },
    () => worker()
  );
  await Promise.all(workers);
}

async function preparePageForImageAudit(page) {
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const step = Math.max(window.innerHeight || 800, 400);
      let y = 0;
      const maxY = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const timer = setInterval(() => {
        window.scrollTo(0, y);
        y += step;
        if (y >= maxY) {
          window.scrollTo(0, 0);
          clearInterval(timer);
          resolve();
        }
      }, 120);
      setTimeout(() => {
        clearInterval(timer);
        window.scrollTo(0, 0);
        resolve();
      }, 8000);
    });
  });
  await page.waitForTimeout(1200);
}

function resolveVerification(raw, net) {
  if (raw.url?.startsWith('inline-svg:') || raw.url?.startsWith('data:')) {
    return { ok: true, broken: false, error: null };
  }

  if (net.status != null && net.status >= 400) {
    return { ok: false, broken: true, error: `http-${net.status}` };
  }

  if (net.status >= 200 && net.status < 400) {
    return { ok: true, broken: false, error: null };
  }

  if (raw.domBroken) {
    return { ok: false, broken: true, error: 'failed-to-load' };
  }

  if (net.error === 'probe-failed' && (raw.sourceType === 'css' || raw.tag === 'background')) {
    return { ok: false, broken: true, error: 'probe-failed' };
  }

  if (raw.tag === 'img' && !raw.complete && raw.naturalWidth === 0) {
    return { ok: net.bytes > 0 || net.status >= 200, broken: false, error: null };
  }

  return {
    ok: net.status == null ? !raw.domBroken : net.status < 400,
    broken: false,
    error: net.error === 'probe-failed' ? null : (net.error || null)
  };
}

function attachResponseCollector(page, networkMap) {
  page.on('response', async (response) => {
    try {
      const url = response.url();
      const ct = response.headers()['content-type'] || '';
      if (!isImageResponse(url, ct)) return;

      const status = response.status();
      let bytes = 0;
      let probedWidth = 0;
      let probedHeight = 0;
      try {
        const buf = await response.body();
        bytes = buf?.length || 0;
        const dims = parseImageDimensions(buf);
        if (dims) {
          probedWidth = dims.width || 0;
          probedHeight = dims.height || 0;
        }
      } catch {
        const cl = response.headers()['content-length'];
        bytes = cl ? parseInt(cl, 10) || 0 : 0;
      }
      const norm = normalizeImageUrl(url);
      const prev = networkMap[norm] || networkMap[url] || {};
      networkMap[norm] = {
        status,
        bytes: Math.max(bytes, prev.bytes || 0),
        contentType: ct,
        headers: response.headers(),
        requestCount: (prev.requestCount || 0) + 1,
        format: formatFromMime(ct) || formatFromUrl(url) || prev.format,
        probedWidth: Math.max(probedWidth, prev.probedWidth || 0),
        probedHeight: Math.max(probedHeight, prev.probedHeight || 0)
      };
    } catch {
      // ignore
    }
  });
}

function buildMasterImage(raw, networkMap) {
  const normUrl = normalizeImageUrl(raw.url);
  const net = networkMap[normUrl] || networkMap[raw.url] || {};
  const naturalWidth = raw.naturalWidth || net.probedWidth || 0;
  const naturalHeight = raw.naturalHeight || net.probedHeight || 0;
  const attrWidth = raw.displayWidth || 0;
  const attrHeight = raw.displayHeight || 0;
  const layoutVisible = Boolean(raw.layoutVisible);
  const renderedWidth = layoutVisible ? (raw.layoutWidth || 0) : 0;
  const renderedHeight = layoutVisible ? (raw.layoutHeight || 0) : 0;
  const verification = resolveVerification(raw, net);

  return {
    id: raw.id,
    identity: {
      url: raw.url,
      normalizedUrl: normUrl,
      filename: raw.filename,
      pageUrl: raw.pageUrl
    },
    network: {
      status: net.status ?? null,
      bytes: net.bytes || 0,
      contentType: net.contentType || null,
      cdn: detectCdn(raw.url, net.headers || {}),
      requestCount: net.requestCount || 1
    },
    rendering: {
      naturalWidth,
      naturalHeight,
      attrWidth,
      attrHeight,
      renderedWidth,
      renderedHeight,
      visible: layoutVisible,
      currentSrc: raw.currentSrc || '',
      scaling:
        naturalWidth && renderedWidth
          ? Number((renderedWidth / naturalWidth).toFixed(2))
          : null
    },
    metadata: {
      format: raw.format || net.format || 'UNKNOWN',
      sizeBytes: net.bytes || 0,
      dimensions: `${naturalWidth}x${naturalHeight}`
    },
    css: {
      source: raw.sourceType === 'css' ? 'css' : 'html',
      selector: raw.selector || ''
    },
    source: {
      tag: raw.tag,
      lazy: raw.loading === 'lazy',
      responsive: Boolean(raw.hasSrcset || raw.hasSizes),
      srcset: raw.srcsetUrls || [],
      belowFold: Boolean(raw.belowFold),
      loading: raw.loading || '',
      hasSrcset: Boolean(raw.hasSrcset),
      hasSizes: Boolean(raw.hasSizes),
      visible: Boolean(raw.visible)
    },
    verification: {
      ...verification,
      inSource: Boolean(raw.discoveredVia)
    },
    accessibility: {
      alt: raw.alt == null ? null : String(raw.alt),
      ariaLabel: raw.ariaLabel || null,
      role: raw.role || ''
    },
    optimization: {},
    seo: {},
    duplicate: {}
  };
}

function mergeImagesAcrossViewports(viewportRuns, viewports = DEFAULT_AUDIT_VIEWPORTS) {
  const byKey = new Map();

  for (const run of viewportRuns) {
    const { viewport, images } = run;
    for (const img of images) {
      const idKey = `${img.identity.pageUrl}|${img.identity.normalizedUrl}`;
      if (!byKey.has(idKey)) {
        byKey.set(idKey, {
          ...img,
          rendering: {
            naturalWidth: img.rendering.naturalWidth || 0,
            naturalHeight: img.rendering.naturalHeight || 0,
            attrWidth: img.rendering.attrWidth || 0,
            attrHeight: img.rendering.attrHeight || 0,
            viewports: initViewportMap(viewports)
          }
        });
      }

      const merged = byKey.get(idKey);
      merged.rendering.naturalWidth = Math.max(
        merged.rendering.naturalWidth,
        img.rendering.naturalWidth || 0
      );
      merged.rendering.naturalHeight = Math.max(
        merged.rendering.naturalHeight,
        img.rendering.naturalHeight || 0
      );
      if (!merged.rendering.attrWidth && img.rendering.attrWidth) {
        merged.rendering.attrWidth = img.rendering.attrWidth;
      }
      if (!merged.rendering.attrHeight && img.rendering.attrHeight) {
        merged.rendering.attrHeight = img.rendering.attrHeight;
      }

      if (img.network?.bytes > (merged.network?.bytes || 0) || merged.network?.status == null) {
        merged.network = { ...merged.network, ...img.network };
      }

      const nw = merged.rendering.naturalWidth;
      const nh = merged.rendering.naturalHeight;
      const rw = img.rendering.visible ? (img.rendering.renderedWidth || 0) : 0;
      const rh = img.rendering.visible ? (img.rendering.renderedHeight || 0) : 0;

      merged.rendering.viewports[viewport.key] = {
        label: viewport.label,
        width: viewport.width,
        height: viewport.height,
        renderedWidth: rw,
        renderedHeight: rh,
        visible: Boolean(img.rendering.visible),
        widthDiffPct: computeDiffPct(rw, nw),
        heightDiffPct: computeDiffPct(rh, nh),
        currentSrc: img.rendering.currentSrc || '',
        optimization: { issues: [], recommendations: [], potentialSavingsBytes: 0 }
      };
    }
  }

  return Array.from(byKey.values());
}

async function auditPageAtViewport(browser, pageUrl, viewport, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const formatConfig = options.formatConfig || getBrowserFormatConfig();
  const networkMap = {};

  const context = await browser.newContext({
    userAgent: 'image-audit/1.0 QA-Dashboard (+playwright)',
    viewport: { width: viewport.width, height: viewport.height }
  });
  const page = await context.newPage();
  attachResponseCollector(page, networkMap);

  try {
    await page.goto(pageUrl, { waitUntil: 'load', timeout: timeoutMs });
    await preparePageForImageAudit(page);

    const discovery = await page.evaluate(discoverImagesInPage, formatConfig);
    await probeSourceOnlyImages(page, discovery.candidates, networkMap);

    const images = discovery.candidates.map((raw) => buildMasterImage(raw, networkMap));

    return {
      viewport,
      url: pageUrl,
      pageTitle: discovery.pageTitle || '',
      pageUrl: discovery.pageUrl || pageUrl,
      imageCount: images.length,
      images
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function auditSinglePage(browser, pageUrl, options = {}) {
  const formatConfig = options.formatConfig || getBrowserFormatConfig();
  const viewports = options.viewports || DEFAULT_AUDIT_VIEWPORTS;
  const viewportRuns = [];

  for (const viewport of viewports) {
    if (typeof options.onViewportProgress === 'function') {
      await options.onViewportProgress(viewport);
    }
    const run = await auditPageAtViewport(browser, pageUrl, viewport, {
      ...options,
      formatConfig
    });
    viewportRuns.push(run);
  }

  const images = mergeImagesAcrossViewports(viewportRuns, viewports);
  const first = viewportRuns[0] || {};

  return {
    url: pageUrl,
    pageTitle: first.pageTitle || '',
    pageUrl: first.pageUrl || pageUrl,
    imageCount: images.length,
    images,
    viewports: viewports.map((vp) => ({
      key: vp.key,
      label: vp.label,
      width: vp.width,
      height: vp.height
    }))
  };
}

function finalizeAuditReport(mergedImages, meta, viewports = DEFAULT_AUDIT_VIEWPORTS) {
  const requestCounts = {};
  mergedImages.forEach((img) => {
    const u = img.identity.normalizedUrl || img.identity.url;
    requestCounts[u] = (requestCounts[u] || 0) + 1;
  });

  let images = applyOptimizationToImages(mergedImages, requestCounts);
  images = applyAccessibilityToImages(images);

  const duplicateReport = buildDuplicateReport(images);
  images = markDuplicatesOnImages(images, duplicateReport);
  const cdnReport = buildCdnReport(images);
  const optimizationReport = buildOptimizationReport(images);
  const accessibilityReport = buildAccessibilityReport(images);
  const seoReport = buildSeoReport(images, {});

  const summary = buildSummary(images, {
    optimization: optimizationReport,
    accessibility: accessibilityReport,
    seo: seoReport,
    duplicates: duplicateReport
  });

  return {
    cancelled: false,
    url: meta.startUrl,
    domain: meta.domain,
    mode: meta.mode,
    discoveryMethod: meta.discoveryMethod,
    pagesAudited: meta.pagesAudited,
    auditedUrls: meta.auditedUrls,
    pageTitle: meta.pageTitle || '',
    pageUrl: meta.pageUrl || meta.startUrl,
    viewports: viewports.map((vp) => ({
      key: vp.key,
      label: vp.label,
      width: vp.width,
      height: vp.height
    })),
    generatedAt: new Date().toISOString(),
    summary: {
      ...summary,
      pagesAudited: meta.pagesAudited
    },
    images,
    reports: {
      duplicates: duplicateReport,
      cdn: cdnReport,
      optimization: optimizationReport,
      accessibility: accessibilityReport,
      seo: seoReport
    }
  };
}

/**
 * Run image audit — single page, comma-separated URLs, or full-site crawl.
 */
async function runImageAudit(startUrl, options = {}) {
  const mode = options.mode || 'single';
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxUrls = Math.min(
    Math.max(parseInt(options.maxUrls, 10) || DEFAULT_FULL_MAX_URLS, 1),
    DEFAULT_MAX_URLS
  );
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const shouldCancel = typeof options.shouldCancel === 'function' ? options.shouldCancel : () => false;
  const formatConfig = getBrowserFormatConfig();
  const viewports = resolveAuditViewports(options);
  const viewportLabel = viewportSummaryLine(viewports);

  let urlsToAudit = mode === 'single' ? resolveJobUrls(options, startUrl) : [startUrl];
  let discoveryMethod = mode === 'full' ? 'crawl' : (urlsToAudit.length > 1 ? 'url-list' : 'single-url');

  const browser = await chromium.launch({ headless: true });

  try {
    if (onProgress) {
      await onProgress({ progressPct: 5, message: 'Launching browser...' });
    }

    if (mode === 'full') {
      if (onProgress) {
        await onProgress({ progressPct: 10, message: 'Crawling site to discover pages...' });
      }
      urlsToAudit = await discoverSiteUrlsByCrawl(startUrl, {
        browser,
        maxUrls,
        skipFacetedFilterUrls: true,
        onProgress: async (info) => {
          if (!onProgress) return;
          const pct = 10 + Math.min(20, Math.floor(((info.processed || 0) / Math.max(info.discovered || 1, 1)) * 20));
          await onProgress({
            progressPct: pct,
            phase: 'crawl',
            processed: info.processed,
            total: info.discovered,
            currentUrl: info.currentUrl,
            message: info.message || 'Crawling site...'
          });
        }
      });
      if (!urlsToAudit.length) urlsToAudit = [startUrl];
    }

    const totalPages = urlsToAudit.length;
    const pageResults = [];

    for (let i = 0; i < urlsToAudit.length; i++) {
      if (shouldCancel()) {
        return { cancelled: true, url: startUrl };
      }

      const targetUrl = urlsToAudit[i];
      const scanPct = mode === 'full'
        ? 30 + Math.floor((i / Math.max(totalPages, 1)) * 55)
        : 15 + Math.floor((i / Math.max(totalPages, 1)) * 70);

      if (onProgress) {
        await onProgress({
          progressPct: scanPct,
          phase: 'audit',
          processed: i + 1,
          total: totalPages,
          currentPage: i + 1,
          totalPages,
          currentUrl: targetUrl,
          message: `Auditing page ${i + 1} / ${totalPages} at ${viewportLabel}: ${targetUrl}`
        });
      }

      try {
        const pageResult = await auditSinglePage(browser, targetUrl, {
          timeoutMs,
          formatConfig,
          viewports,
          onViewportProgress: async (viewport) => {
            if (!onProgress) return;
            await onProgress({
              progressPct: scanPct,
              phase: 'audit',
              processed: i + 1,
              total: totalPages,
              currentPage: i + 1,
              totalPages,
              currentUrl: targetUrl,
              message: `Auditing page ${i + 1} / ${totalPages} at ${viewport.label}: ${targetUrl}`
            });
          }
        });
        pageResults.push(pageResult);
      } catch (err) {
        pageResults.push({
          url: targetUrl,
          pageTitle: '',
          pageUrl: targetUrl,
          imageCount: 0,
          images: [],
          error: err.message || String(err)
        });
      }
    }

    let seq = 0;
    const mergedImages = [];
    for (const pageResult of pageResults) {
      for (const img of pageResult.images || []) {
        mergedImages.push({ ...img, id: `img-${++seq}` });
      }
    }

    if (onProgress) {
      await onProgress({
        progressPct: 88,
        message: `Finalizing report (${mergedImages.length} images from ${pageResults.length} pages)...`
      });
    }

    return finalizeAuditReport(
      mergedImages,
      {
        startUrl,
        domain: hostnameFromUrl(startUrl),
        mode,
        discoveryMethod,
        pagesAudited: pageResults.length,
        auditedUrls: pageResults.map((p) => p.url),
        pageTitle: pageResults.length === 1 ? pageResults[0].pageTitle : `${pageResults.length} pages`,
        pageUrl: startUrl
      },
      viewports
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  DEFAULT_AUDIT_VIEWPORTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_FULL_MAX_URLS,
  hostnameFromUrl,
  resolveJobUrls,
  runImageAudit
};