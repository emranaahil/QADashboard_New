/**
 * Browser-side image discovery — passed to page.evaluate with formatConfig.
 */
function discoverImagesInPage(formatConfig) {
  var extMap = formatConfig.extMap || {};
  var extPattern = formatConfig.extPattern || 'png|gif|jpe?g|svg|webp|avif';
  var IMAGE_EXT_PATTERN = new RegExp('\\.(' + extPattern + ')(?:\\?|#|$)', 'i');
  var DATA_IMAGE_PATTERN = /^data:image\/([a-z0-9.+-]+)/i;

  function absUrl(raw, base) {
    if (!raw || typeof raw !== 'string') return null;
    var trimmed = raw.trim().replace(/&amp;/g, '&');
    if (!trimmed || trimmed === '#') return null;
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
    try {
      return new URL(trimmed, base).href;
    } catch (e) {
      return null;
    }
  }

  function parseSrcset(srcset, base) {
    if (!srcset) return [];
    return srcset
      .split(',')
      .map(function (part) { return part.trim().split(/\s+/)[0]; })
      .filter(Boolean)
      .map(function (u) { return absUrl(u, base); })
      .filter(Boolean);
  }

  function filenameFromUrl(url) {
    if (!url) return '';
    if (url.startsWith('data:')) return 'inline-data';
    if (url.startsWith('inline-svg:')) return 'inline.svg';
    try {
      var u = new URL(url);
      var seg = u.pathname.split('/').filter(Boolean).pop() || '';
      return decodeURIComponent(seg.split('?')[0]) || u.hostname;
    } catch (e) {
      return String(url).slice(0, 80);
    }
  }

  function formatFromUrl(url) {
    if (!url) return 'UNKNOWN';
    if (url.startsWith('inline-svg:')) return 'SVG';
    if (url.startsWith('data:')) {
      var dm = String(url).match(DATA_IMAGE_PATTERN);
      if (!dm) return 'UNKNOWN';
      var token = dm[1].toLowerCase().replace('svg+xml', 'svg').replace('pjpeg', 'jpeg');
      return extMap[token] || token.toUpperCase();
    }
    var ext = (url.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
    return extMap[ext] || 'UNKNOWN';
  }

  function isImageLikeUrl(url) {
    if (!url) return false;
    if (url.startsWith('data:image/')) return true;
    if (url.startsWith('inline-svg:')) return true;
    return IMAGE_EXT_PATTERN.test(url.split('?')[0].split('#')[0]);
  }

  /** Viewport-independent: CSS visibility only (no layout rect). */
  function isVisible(el) {
    if (!el) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    return true;
  }

  function parseAttrPx(el, attr) {
    if (!el) return 0;
    var raw = el.getAttribute(attr);
    if (!raw) return 0;
    var n = parseInt(String(raw).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Declared display size from HTML width/height attributes. */
  function declaredDimensions(el) {
    return {
      displayWidth: parseAttrPx(el, 'width'),
      displayHeight: parseAttrPx(el, 'height'),
    };
  }

  /** Rendered layout box at the current Playwright viewport (0 when not visible). */
  function layoutDimensions(el) {
    if (!el || !isVisible(el)) {
      return { layoutWidth: 0, layoutHeight: 0, layoutVisible: false };
    }
    var rect = el.getBoundingClientRect();
    var w = Math.round(rect.width);
    var h = Math.round(rect.height);
    if (w <= 0 || h <= 0) {
      return { layoutWidth: 0, layoutHeight: 0, layoutVisible: false };
    }
    return { layoutWidth: w, layoutHeight: h, layoutVisible: true };
  }

  function withLayoutDefaults(entry, el) {
    var layout = layoutDimensions(el);
    return Object.assign({}, entry, {
      layoutWidth: layout.layoutWidth,
      layoutHeight: layout.layoutHeight,
      layoutVisible: layout.layoutVisible
    });
  }

  function isBelowFold(el) {
    return (el && el.getAttribute('loading') === 'lazy') || false;
  }

  function extractUrlsFromCssText(text, base) {
    var urls = [];
    if (!text) return urls;
    var re = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
    var match;
    while ((match = re.exec(text)) !== null) {
      var resolved = absUrl(match[1], base);
      if (resolved && isImageLikeUrl(resolved)) urls.push(resolved);
    }
    return urls;
  }

  var pageUrl = location.href;
  var candidates = [];
  var seq = 0;
  var urlIndex = {};

  function pushCandidate(entry) {
    if (!entry.url) return;
    var key = entry.url;
    if (urlIndex[key] != null) {
      var existing = candidates[urlIndex[key]];
      if (!existing.alt && entry.alt) existing.alt = entry.alt;
      if (!existing.loading && entry.loading) existing.loading = entry.loading;
      if (!existing.naturalWidth && entry.naturalWidth) {
        existing.naturalWidth = entry.naturalWidth;
        existing.naturalHeight = entry.naturalHeight;
        existing.displayWidth = entry.displayWidth;
        existing.displayHeight = entry.displayHeight;
      }
      if (entry.layoutVisible && !existing.layoutVisible) {
        existing.layoutWidth = entry.layoutWidth;
        existing.layoutHeight = entry.layoutHeight;
        existing.layoutVisible = entry.layoutVisible;
      }
      if (!existing.currentSrc && entry.currentSrc) existing.currentSrc = entry.currentSrc;
      if (entry.discoveredVia) {
        existing.discoveredVia = (existing.discoveredVia || '') + ';' + entry.discoveredVia;
      }
      return;
    }
    urlIndex[key] = candidates.length;
    candidates.push(Object.assign({ id: 'img-' + (++seq) }, entry));
  }

  function addUrl(url, meta) {
    var resolved = absUrl(url, pageUrl);
    if (!resolved || !isImageLikeUrl(resolved)) return;
    pushCandidate(Object.assign({
      sourceType: 'html',
      tag: 'source-scan',
      selector: '',
      pageUrl: pageUrl,
      url: resolved,
      filename: filenameFromUrl(resolved),
      format: formatFromUrl(resolved),
      alt: null,
      ariaLabel: '',
      role: '',
      loading: '',
      hasSrcset: false,
      hasSizes: false,
      srcsetUrls: [],
      naturalWidth: 0,
      naturalHeight: 0,
      displayWidth: 0,
      displayHeight: 0,
      layoutWidth: 0,
      layoutHeight: 0,
      layoutVisible: false,
      currentSrc: '',
      complete: false,
      domBroken: false,
      visible: false,
      belowFold: false,
      discoveredVia: 'source'
    }, meta || {}));
  }

  function collectAttributeUrls(el, attrs, meta) {
    attrs.forEach(function (attr) {
      var val = el.getAttribute(attr);
      if (!val) return;
      if (attr === 'srcset' || attr === 'data-srcset') {
        parseSrcset(val, pageUrl).forEach(function (u) {
          addUrl(u, Object.assign({}, meta, { hasSrcset: true, discoveredVia: attr }));
        });
        return;
      }
      addUrl(val, Object.assign({}, meta, { discoveredVia: attr }));
    });
  }

  Array.from(document.querySelectorAll('img')).forEach(function (img, idx) {
    var declared = declaredDimensions(img);
    var attrs = ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-srcset', 'srcset'];
    var activeSrc = img.currentSrc || img.getAttribute('src') || '';
    var primary = activeSrc || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
    var resolved = absUrl(primary, pageUrl);
    var hasActiveSrc = Boolean(activeSrc);
    if (resolved && isImageLikeUrl(resolved)) {
      pushCandidate(withLayoutDefaults({
        sourceType: 'html',
        tag: 'img',
        selector: img.id ? '#' + img.id : 'img:nth-of-type(' + (idx + 1) + ')',
        pageUrl: pageUrl,
        url: resolved,
        filename: filenameFromUrl(resolved),
        format: formatFromUrl(resolved),
        alt: img.getAttribute('alt'),
        ariaLabel: img.getAttribute('aria-label') || img.getAttribute('aria-labelledby') || '',
        role: img.getAttribute('role') || '',
        loading: img.getAttribute('loading') || '',
        hasSrcset: Boolean(img.srcset || img.getAttribute('data-srcset')),
        hasSizes: Boolean(img.getAttribute('sizes')),
        srcsetUrls: parseSrcset(img.srcset || img.getAttribute('data-srcset'), pageUrl),
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        displayWidth: declared.displayWidth,
        displayHeight: declared.displayHeight,
        currentSrc: img.currentSrc || resolved,
        complete: img.complete,
        domBroken: hasActiveSrc && img.complete && img.naturalWidth === 0 && !String(resolved).startsWith('data:'),
        visible: isVisible(img),
        belowFold: isBelowFold(img),
        discoveredVia: 'img'
      }, img));
    }
    collectAttributeUrls(img, attrs, {
      sourceType: 'html', tag: 'img', selector: img.id ? '#' + img.id : 'img',
      alt: img.getAttribute('alt'), loading: img.getAttribute('loading') || ''
    });
  });

  Array.from(document.querySelectorAll('noscript')).forEach(function (ns) {
    var html = ns.textContent || ns.innerHTML || '';
    var imgSrcRe = /<img[^>]+src=["']([^"']+)["']/gi;
    var m;
    while ((m = imgSrcRe.exec(html)) !== null) {
      addUrl(m[1], { tag: 'noscript', discoveredVia: 'noscript-img' });
    }
  });

  Array.from(document.querySelectorAll('picture source, picture img')).forEach(function (node) {
    collectAttributeUrls(node, ['src', 'srcset'], { tag: 'picture', discoveredVia: 'picture' });
  });

  Array.from(document.querySelectorAll('svg image, svg use')).forEach(function (node) {
    var href = node.getAttribute('href') || node.getAttribute('xlink:href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
    addUrl(href, { tag: 'svg-ref', discoveredVia: 'svg-href' });
  });

  Array.from(document.querySelectorAll('svg')).forEach(function (svg, i) {
    var svgId = svg.id || ('inline-' + (i + 1));
    var inlineKey = 'inline-svg:' + pageUrl + '#' + svgId;
    var declared = declaredDimensions(svg);
    pushCandidate(withLayoutDefaults({
      sourceType: 'html',
      tag: 'svg-inline',
      selector: svg.id ? 'svg#' + svg.id : 'svg:nth-of-type(' + (i + 1) + ')',
      pageUrl: pageUrl,
      url: inlineKey,
      filename: 'inline.svg',
      format: 'SVG',
      alt: svg.getAttribute('aria-label') || (svg.querySelector('title') && svg.querySelector('title').textContent) || null,
      ariaLabel: svg.getAttribute('aria-label') || '',
      role: svg.getAttribute('role') || '',
      loading: '',
      hasSrcset: false,
      hasSizes: false,
      srcsetUrls: [],
      naturalWidth: 0,
      naturalHeight: 0,
      displayWidth: declared.displayWidth,
      displayHeight: declared.displayHeight,
      currentSrc: '',
      complete: true,
      domBroken: false,
      visible: isVisible(svg),
      belowFold: false,
      discoveredVia: 'inline-svg'
    }, svg));
  });

  Array.from(document.querySelectorAll('link[href]')).forEach(function (link) {
    var rel = (link.getAttribute('rel') || '').toLowerCase();
    var as = (link.getAttribute('as') || '').toLowerCase();
    if (as === 'image' || /icon|apple-touch|preload|image_src|mask-icon/.test(rel)) {
      addUrl(link.getAttribute('href'), { tag: 'link', discoveredVia: 'link-' + rel });
    }
  });

  Array.from(document.querySelectorAll('video[poster]')).forEach(function (video) {
    addUrl(video.getAttribute('poster'), { tag: 'video', discoveredVia: 'poster' });
  });

  Array.from(document.querySelectorAll('object[data], embed[src]')).forEach(function (el) {
    addUrl(el.getAttribute('data') || el.getAttribute('src'), { tag: el.tagName.toLowerCase(), discoveredVia: 'embed' });
  });

  Array.from(document.querySelectorAll('[style]')).forEach(function (el) {
    extractUrlsFromCssText(el.getAttribute('style'), pageUrl).forEach(function (u) {
      addUrl(u, { sourceType: 'css', tag: 'style-attr', discoveredVia: 'inline-style' });
    });
  });

  Array.from(document.querySelectorAll('style')).forEach(function (styleEl) {
    extractUrlsFromCssText(styleEl.textContent, pageUrl).forEach(function (u) {
      addUrl(u, { sourceType: 'css', tag: 'style-block', discoveredVia: 'style-tag' });
    });
  });

  Array.from(document.querySelectorAll('*')).forEach(function (el) {
    var style = window.getComputedStyle(el);
    var bg = style.backgroundImage || '';
    if (!bg || bg === 'none') return;
    extractUrlsFromCssText(bg, pageUrl).forEach(function (u) {
      var layout = layoutDimensions(el);
      addUrl(u, {
        sourceType: 'css',
        tag: 'background',
        selector: el.id ? '#' + el.id : el.tagName.toLowerCase(),
        visible: isVisible(el),
        layoutWidth: layout.layoutWidth,
        layoutHeight: layout.layoutHeight,
        layoutVisible: layout.layoutVisible,
        discoveredVia: 'computed-bg'
      });
    });
  });

  var ogImage = document.querySelector('meta[property="og:image"], meta[property="og:image:url"]');
  var twitterImage = document.querySelector('meta[name="twitter:image"], meta[name="twitter:image:src"]');
  var structuredScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map(function (s) { return s.textContent || ''; })
    .filter(Boolean);

  return {
    pageUrl: pageUrl,
    pageTitle: document.title || '',
    candidates: candidates,
    pageSeo: {
      ogImage: ogImage ? ogImage.getAttribute('content') || '' : '',
      twitterImage: twitterImage ? twitterImage.getAttribute('content') || '' : '',
      structuredDataScripts: structuredScripts
    }
  };
}

module.exports = { discoverImagesInPage };