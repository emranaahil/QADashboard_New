console.log("✅ UI CHECKS RUNNING — Visual Defect Detection");

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════════
// NODE-LEVEL UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function safeReadReport(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function safeWriteReport(filePath, report) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const tmpFile = `${filePath}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(report, null, 2));
    fs.renameSync(tmpFile, filePath);

  } catch (err) {
    console.error('⚠️ Failed to write report:', err.message);
  }
}


function ensureDirSync(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BROWSER-LEVEL UTILITIES (injected via page.evaluate)
// ═══════════════════════════════════════════════════════════════════════════════

const BROWSER_UTILS = `
  /* Visibility: only considers elements actually rendered on screen */
  window.__qa_isVisible = function(el, opts) {
    opts = opts || {};
    var minW = opts.minWidth || 0;
    var minH = opts.minHeight || 0;
    try {
      var r = el.getBoundingClientRect();
      var s = window.getComputedStyle(el);
      return (
      r.width > minW &&
      r.height > minH &&
      r.right > 0 &&
      r.left < window.innerWidth &&
      r.bottom > 0 &&
      r.top < window.innerHeight &&
      s.display !== 'none' &&
      s.visibility !== 'hidden' &&
      parseFloat(s.opacity) > 0
    ); } catch(e) {
    return false;
  }
  };

  /* Highlight an element on the page for screenshots */
  window.__qa_highlight = function(rect, color) {
    try {
      var div = document.createElement('div');
      div.setAttribute('data-qa-highlight', 'true');
      div.style.cssText =
        'position:fixed;pointer-events:none;z-index:999999;box-sizing:border-box;' +
        'left:' + rect.left + 'px;top:' + rect.top + 'px;' +
        'width:' + rect.width + 'px;height:' + rect.height + 'px;' +
        'border:3px solid ' + (color || 'red') + ';' +
        'background:' + (color || 'red') + '11;';
      document.body.appendChild(div);
    } catch(e) {}
  };

  /* Clear all QA highlight overlays */
  window.__qa_clearHighlights = function() {
    try {
      var els = document.querySelectorAll('[data-qa-highlight="true"]');
      for (var i = 0; i < els.length; i++) {
        if (els[i] && els[i].parentNode) {
          els[i].parentNode.removeChild(els[i]);
        }
      }
    } catch (e) {}
  };


  /* Detect carousel/slider containers */
  window.__qa_isCarousel = function(el) {
    var cls = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();
    return /carousel|slider|swiper|slick|owl|flickity|splide/.test(cls);
  };

  /* WCAG contrast ratio helpers */
  window.__qa_parseColor = function(str) {
    if (!str || str === 'transparent') return null;
    var m = str.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (!m) return null;
    var a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a < 0.01) return null;
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  };

  window.__qa_luminance = function(r, g, b) {
    var lin = function(c) {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };

  window.__qa_contrastRatio = function(rgb1, rgb2) {
    var l1 = window.__qa_luminance(rgb1[0], rgb1[1], rgb1[2]);
    var l2 = window.__qa_luminance(rgb2[0], rgb2[1], rgb2[2]);
    var lighter = Math.max(l1, l2);
    var darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  };

  window.__qa_getEffectiveBg = function(el) {
    var current = el;
    while (current && current !== document.documentElement) {
      var bg = window.getComputedStyle(current).backgroundColor;
      var rgb = window.__qa_parseColor(bg);
      if (rgb) return rgb;
      current = current.parentElement;
    }
    return [255, 255, 255];
  };
`;

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE-LEVEL STATE
// ═══════════════════════════════════════════════════════════════════════════════

const referenceUrl = process.env.REFERENCE_URL || null;
const testUrl = process.env.TEST_URL || null;
const isCompareMode = !!(referenceUrl && testUrl);

let _issueId = 0;
function nextIssueId() { return 'QA-' + String(++_issueId).padStart(4, '0'); }

const REPORTS_DIR = path.join(__dirname, 'reports');

// Clear old report (once per process)
if (!global.__qaReportCleared) {
  try {
    ensureDirSync(REPORTS_DIR);
    fs.writeFileSync(path.join(REPORTS_DIR, 'qaReport.json'), JSON.stringify([], null, 2));
    console.log('🧹 Cleared old QA logs');
  } catch { /* ignore */ }
  global.__qaReportCleared = true;
} else {
  ensureDirSync(REPORTS_DIR);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS (Node-level)
// ═══════════════════════════════════════════════════════════════════════════════

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {

      let lastHeight = 0;
      let stableCount = 0;

      const timer = setInterval(() => {
        window.scrollBy(0, 500);

        const currentHeight =
          document.documentElement.scrollHeight;

        if (currentHeight === lastHeight) {
          stableCount++;
        } else {
          stableCount = 0;
        }

        lastHeight = currentHeight;

        if (stableCount >= 5) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 500);
    });
  });
}

async function waitForImages(page) {
  try {
    await Promise.race([
      page.evaluate(async function() {
        var imgs = Array.from(document.images);
        await Promise.all(imgs.map(function(img) {
          if (img.complete) return Promise.resolve();
          return new Promise(function(r) {
            var t = setTimeout(r, 3000);
            img.onload = img.onerror = function() { clearTimeout(t); r(); };
          });
        }));
      }),
      page.waitForTimeout(3000)
    ]);
  } catch { /* skip */ }
}

function addIssue(type, opts = {}) {
  const key = `${type}:${opts.details || ''}`;

  if (issueCache.has(key)) {
    return;
  }

  issueCache.add(key);

  issues.push({
    id: nextIssueId(),
    type,
    count: opts.count || 0,
    screenshot: opts.screenshot || null,
    severity: opts.severity || 'info',
    details: opts.details || null,
    timestamp: new Date().toISOString()
  });
}




// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = async (page, config) => {
  config = config || {};

  // ── Configuration ────────────────────────────────────────────────────────
  var runFolder     = config.runFolder || 'reports';
  var screenshotDir = config.screenshotDir || path.join(runFolder, 'screenshots');
  var reportFile    = path.join(runFolder, 'qaReport.json');

  ensureDirSync(screenshotDir);

  var scenario = config.scenario || {
    label: config.pageName || (typeof page !== 'undefined' && typeof page.url === 'function' ? page.url() : 'Page'),
    url:   config.url     || (typeof page !== 'undefined' && typeof page.url === 'function' ? page.url() : null)
  };
  var viewport = config.viewport || { label: config.device || 'Desktop' };

  console.log('\n==============================');
  console.log('🚀 QA START:', scenario.label, '|', viewport.label);
  console.log('==============================\n');

  var issues = [];
  var screenshotsTaken = {};

  function addIssue(type, opts) {
    opts = opts || {};
    issues.push({
      id: nextIssueId(),
      type: type,
      count: opts.count || 0,
      screenshot: opts.screenshot || null,
      severity: opts.severity || 'info',
      details: opts.details || null,
      timestamp: new Date().toISOString()
    });
     console.log('ADD ISSUE:', type);
  console.log('CURRENT ISSUE COUNT:', issues.length);
  }
  console.log('ISSUES NOW:', issues.length);

  async function clearHighlights() {
    try {
      await page.evaluate(function() {
        if (window.__qa_clearHighlights) {
          window.__qa_clearHighlights();
        } else {
          var els = document.querySelectorAll('[data-qa-highlight="true"]');
          for (var i = 0; i < els.length; i++) {
            if (els[i] && els[i].parentNode) els[i].parentNode.removeChild(els[i]);
          }
        }
      });
    } catch { /* ignore */ }
  }

  async function safeShot(fileName) {
     console.log('Saving screenshot:', path.join(screenshotDir, fileName));
    if (screenshotsTaken[fileName]) return { ok: false, fileName: fileName };
    screenshotsTaken[fileName] = true;
    try {
      await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
      return { ok: true, fileName: fileName };
    } catch (err) {
      console.warn('⚠️ Screenshot failed:', fileName, err.message);
      return { ok: false, fileName: fileName };
    }
  }

 

  // ── Setup ────────────────────────────────────────────────────────────────
  try {
    await page.addInitScript(function() {
      Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } });
    });
  } catch { /* ignore */ }

  // Register event listeners (once per page, prevents memory leaks)
  try {
    if (!page.__qaListenersAdded) {
      page.on('pageerror', function(err) {
        try { addIssue('JS Error', { details: err.message, severity: 'major' }); } catch { /* ignore */ }
      });
      page.on('requestfailed', function(req) {
        try {
          var url = req.url();
          if (/facebook|instagram|cptn|analytics|legitscript|googletagmanager|doubleclick|google-analytics/.test(url)) return;
          addIssue('Failed Request', { details: url, severity: 'minor' });
        } catch { /* ignore */ }
      });
      page.on('console', function(msg) {
        try {
          if (msg.type() === 'error' && !msg.text().includes('CORS')) {
            addIssue('Console Error', { details: msg.text().slice(0, 300), severity: 'minor' });
          }
        } catch { /* ignore */ }
      });
      page.__qaListenersAdded = true;
    }
  } catch { /* ignore */ }

  // Wait for initial visible content
  try {
    await page.waitForSelector('img, p, div, h1, h2, h3, section, nav', { timeout: 15000 }).catch(function() {});
  } catch { /* ignore */ }

  // Inject browser utilities
  try { await page.addScriptTag({ content: BROWSER_UTILS }); } catch { /* ignore */ }

  // ── Stabilize page ───────────────────────────────────────────────────────
  try {
    console.log('🔧 Stabilizing...');
    await page.evaluate(function() {
      document.querySelectorAll('.ads,.popup,.modal,.cookie-banner,[class*="cookie-consent"],.ad-wrapper').forEach(function(el) { el.remove(); });
      document.body.style.minHeight = 'auto';
      document.body.style.height = 'auto';
      document.documentElement.style.height = 'auto';
      var s = document.createElement('style');
      s.textContent = '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;}';
      document.head.appendChild(s);
    });
    await page.evaluate(function() { window.scrollTo(0, 0); });
    await page.waitForTimeout(1500);
  } catch { /* ignore */ }

  // ── Start CLS observation (accumulates during checks) ────────────────────
  try {
    await page.evaluate(function() {
      window.__qa_clsValue = 0;
      window.__qa_clsActive = false;
      try {
        var obs = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].entryType === 'layout-shift' && !entries[i].hadRecentInput) {
              window.__qa_clsValue += entries[i].value;
            }
          }
        });
        obs.observe({ type: 'layout-shift', buffered: true });
        window.__qa_clsActive = true;
        window.__qa_clsObs = obs;
      } catch { /* not supported */ }
    });
  } catch { /* ignore */ }

  // ── Auto-scroll to trigger lazy loading ──────────────────────────────────
  try {
    console.log('📜 Scrolling...');
    await autoScroll(page);
  } catch { /* ignore */ }

  // ── Wait for images ──────────────────────────────────────────────────────
  try {
    console.log('🖼️ Waiting for images...');
    await waitForImages(page);
  } catch { /* ignore */ }

  // ── Buffer for JS-heavy sites ────────────────────────────────────────────
  try { await page.waitForTimeout(2000); } catch { /* ignore */ }

  // Re-inject utilities (page may have re-rendered)
  try { await page.addScriptTag({ content: BROWSER_UTILS });} catch { /* ignore */ }

  console.log('🔍 Running visual defect checks...\n');

  console.log('🚀 Calling popup detector...');
  try {
await detectAndClosePopups(page, issues);
  // ═════════════════════════════════════════════════════════════════════════
  //   UNIVERSAL POPUP DETECTOR + CLOSER v3 Production Ready
   //========================================================== */

async function detectAndClosePopups(page, issues = []) {

  console.log("\n🔍 [POPUP] Starting popup scan...");

  try {

    await page.waitForTimeout(1500);

    // =====================================================
    // DETECT POPUPS
    // =====================================================

    const popupInfo = await page.evaluate(() => {

      const popupSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '.modal',
        '.popup',
        '.overlay',
        '.lightbox',
        '.cookie-banner',
        '.cookie-consent',
        '[class*="modal"]',
        '[class*="popup"]',
        '[class*="overlay"]',
        '[id*="modal"]',
        '[id*="popup"]'
      ];

      const found = [];

      document.querySelectorAll(popupSelectors.join(','))
        .forEach(el => {

          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);

          const visible =
            rect.width > 150 &&
            rect.height > 100 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            parseFloat(style.opacity || '1') > 0;

          const popupLike =
            style.position === 'fixed' ||
            style.position === 'sticky' ||
            Number(style.zIndex || 0) > 500;

          if (visible && popupLike) {
            found.push({
              tag: el.tagName,
              cls: el.className || '',
              id: el.id || '',
              z: style.zIndex || '0'
            });
          }

        });

      return found;

    });

    if (!popupInfo.length) {
      console.log("✅ [POPUP] No popup detected");
      return false;
    }

    console.log(`⚠️ [POPUP] ${popupInfo.length} popup(s) detected`);

    

    // =====================================================
    // SCREENSHOT BEFORE CLOSE
    // =====================================================

    try {
      const popupShot = `popup_${Date.now()}.png`;
      await safeShot(popupShot);

      console.log(`📸 [POPUP] Screenshot captured: ${popupShot}`);

      addIssue('Popup/Overlay Visible', {
        severity: 'minor',
        screenshot: popupShot,
        count: popupInfo.length,
        details: popupInfo.map(p =>
          `${p.tag}#${p.id}.${p.cls}`
        ).join('; ')
      });

    } catch (e) {
      console.log("⚠️ [POPUP] Screenshot failed");
    }

    // =====================================================
    // ESCAPE KEY
    // =====================================================

    try {
      await page.keyboard.press('Escape');
      console.log("⌨️ [POPUP] Escape key sent");
      await page.waitForTimeout(800);
    } catch {}

    // =====================================================
// CLICK COMMON CLOSE BUTTONS
// =====================================================

const closeSelectors = [
  '.close',
  '.close-btn',
  '.modal-close',
  '.popup-close',
  '.dismiss',
  '.btn-close',
  '[aria-label="close"]',
  '[aria-label="Close"]',
  '[aria-label*="close" i]',
  '[title*="close" i]',
  '[class*="close"]',
  '[class*="dismiss"]',
  'button[aria-label*="close" i]'
];

for (const selector of closeSelectors) {
  try {
    const buttons = page.locator(selector);
    const count = await buttons.count();

    console.log(`[POPUP] ${selector} => ${count}`);

    for (let i = 0; i < count; i++) {
      try {
        await buttons.nth(i).click({
          force: true,
          timeout: 1000
        });

        console.log(`🖱️ Clicked: ${selector}`);

        await page.waitForTimeout(500);
      } catch {}
    }
  } catch {}
}

    // =====================================================
    // HANDLE IFRAMES
    // =====================================================

    for (const frame of page.frames()) {

      try {

        await frame.evaluate(() => {

          const selectors = [
            '.close',
            '.close-btn',
            '[class*="close"]',
            '[aria-label*="close" i]'
          ];

          selectors.forEach(sel => {

            document.querySelectorAll(sel)
              .forEach(btn => {
                try {
                  btn.click();
                } catch {}
              });

          });

        });

      } catch {}

    }

    // =====================================================
    // LAST RESORT REMOVAL
    // =====================================================

    await page.evaluate(() => {

      const candidates = document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], div, section'
      );

      candidates.forEach(el => {

        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);

        const visible =
          rect.width > 150 &&
          rect.height > 100;

        const popupLike =
          style.position === 'fixed' ||
          Number(style.zIndex || 0) > 500;

        if (!visible || !popupLike) return;

        const text =
          (
            (el.className || '') +
            ' ' +
            (el.id || '')
          ).toLowerCase();

        if (
          text.includes('popup') ||
          text.includes('modal') ||
          text.includes('overlay') ||
          text.includes('cookie') ||
          text.includes('consent') ||
          text.includes('newsletter')
        ) {
          el.remove();
        }

      });

      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';

    });

    // =====================================================
    // VERIFY POPUP REALLY CLOSED
    // =====================================================

    await page.waitForTimeout(1000);

    const stillExists = await page.evaluate(() => {
  const elements = document.querySelectorAll('*');

  return [...elements].some(el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);

    const visible =
      r.width > 150 &&
      r.height > 100 &&
      s.display !== 'none' &&
      s.visibility !== 'hidden' &&
      parseFloat(s.opacity || '1') > 0;

    const popupLike =
      s.position === 'fixed' ||
      Number(s.zIndex || 0) > 500;

    return visible && popupLike;
        

      });

    });

    if (stillExists) {
      console.log("⚠️ [POPUP] Popup still exists after cleanup");
    } else {
      console.log("✅ [POPUP] Popup successfully closed");
    }

    return true;

  } catch (err) {

    console.log(
      `❌ [POPUP] Error: ${err.message}`
    );

    return false;
  }
}
} catch (err) {
  console.log("❌ [POPUP] Failed:", err.message);
}
  // ═════════════════════════════════════════════════════════════════════════
  // 2. BROKEN IMAGES — visible images that failed to load
  // ═════════════════════════════════════════════════════════════════════════
  try {
    await clearHighlights();
    var brokenCount = await page.evaluate(function() {
      //var isVis = window.__qa_isVisible;
      return new Promise(function(resolve) {
        var imgs = Array.from(document.querySelectorAll('img'));

        // Filter: only visible images, exclude SVGs, tracking pixels, tiny data URIs
       var candidates = imgs.filter(function(img) {

  var src = img.src || '';

  if (src.startsWith('data:image/svg')) return false;

  if (
    img.width <= 2 &&
    img.height <= 2
  ) {
    return false;
  }

  if (
    img.naturalWidth <= 2 &&
    img.naturalHeight <= 2 &&
    src.startsWith('data:')
  ) {
    return false;
  }

  const rect = img.getBoundingClientRect();
  const style = getComputedStyle(img);

  if (rect.width < 5 || rect.height < 5) {
    return false;
  }

  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    parseFloat(style.opacity) === 0
  ) {
    return false;
  }

  return true;
});
console.log('TOTAL IMAGES:', imgs.length);
console.log('CANDIDATES:', candidates.length);
        var waits = candidates.map(function(img) {
         if (img.complete) {
  return Promise.resolve();
}
          return new Promise(function(r) {
            var t = setTimeout(r, 3000);
           img.addEventListener('load', function done() {
  clearTimeout(t);
  r();
}, { once: true });

img.addEventListener('error', function done() {
  clearTimeout(t);
  r();
}, { once: true });
  });
});
        Promise.all(waits).then(function() {
          var count = 0;
          candidates.forEach(function(img) {
            var src = img.src || '';
           var broken =
  img.complete &&
  (
    img.naturalWidth === 0 ||
    img.naturalHeight === 0
  );
            if (broken) {
              count++;
              try { window.__qa_highlight(img.getBoundingClientRect(), 'red'); } catch { /* ignore */ }
            }
          });
          resolve(count);
        });
      });
    });

    if (brokenCount > 0) {
      var brokenShot = 'broken-images-' + Date.now() + '.png';
      await safeShot(brokenShot);
      addIssue('Broken Images', { count: brokenCount, screenshot: brokenShot, severity: 'major' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 3. HORIZONTAL SCROLL — layout causes unwanted horizontal scrolling
  // ═════════════════════════════════════════════════════════════════════════
  try {
    await clearHighlights();
    var hasHorizontalScroll = await page.evaluate(function() {

      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 5;
    });

    if (hasHorizontalScroll) {
      var hScrollShot = 'horizontal-scroll-' + Date.now() + '.png';
      await safeShot(hScrollShot);
      addIssue('Horizontal Scroll Detected', { screenshot: hScrollShot, severity: 'major', details: 'Page content causes horizontal scrolling' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 4. CONTENT OVERFLOW — elements bleeding outside visible containers
  // ═════════════════════════════════════════════════════════════════════════
  try {
    await clearHighlights();
    var overflowCount = await page.evaluate(function() {
      var isVis = window.__qa_isVisible;
      var isCarousel = window.__qa_isCarousel;
      var count = 0;

      document.body.querySelectorAll('*').forEach(function(el) {
        if (!isVis(el)) return;
        var r = el.getBoundingClientRect();
        var s = getComputedStyle(el);

        // Skip elements that intentionally scroll or hide overflow
        if (s.position === 'fixed' || s.position === 'sticky') return;
        if (s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflow === 'hidden') return;
        if (isCarousel(el)) return;
        if (s.transform && s.transform !== 'none') return;

        if (r.right > window.innerWidth + 20 && r.width > 120 && r.height > 40) {
          count++;
          try { window.__qa_highlight(r, 'orange'); } catch { /* ignore */ }
        }
      });
      return count;
    });

    if (overflowCount > 0) {
      var overflowShot = 'overflow-' + Date.now() + '.png';
      await safeShot(overflowShot);
      addIssue('Content Overflow', { count: overflowCount, screenshot: overflowShot, severity: 'major' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 5. VISIBLE ELEMENT OVERLAP — content overlapping on screen
  // ═════════════════════════════════════════════════════════════════════════
  try {
    await clearHighlights();
    var overlapCount = await page.evaluate(function() {
      var isVis = window.__qa_isVisible;
      var count = 0;
      var checked = {};

      document.querySelectorAll('button,a,img,input,p,h1,h2,h3,span,[class*=card]').forEach(function(el) {
        var r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) return;
        if (!isVis(el)) return;
        var s = getComputedStyle(el);
        if (s.position === 'fixed' || s.position === 'sticky') return;
        // Skip nav/header/footer (they commonly overlay)
        if (el.closest('nav, header, footer, [class*=navbar], [class*=header], [class*=footer]')) return;

        var cx = Math.round(r.left + r.width / 2);
        var cy = Math.round(r.top + r.height / 2);
        var key = cx + ',' + cy;
        if (checked[key]) return;
        checked[key] = true;

        var topEl = document.elementFromPoint(cx, cy);
        if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
          count++;
          try { window.__qa_highlight(r, 'purple'); } catch { /* ignore */ }
        }
      });
      return count;
    });

    if (overlapCount > 0) {
      var overlapShot = 'overlaps-' + Date.now() + '.png';
      await safeShot(overlapShot);
      addIssue('Visible Element Overlap', { count: overlapCount, screenshot: overlapShot, severity: 'major' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 6. CLIPPED / TRUNCATED TEXT — text hidden by overflow
  // ═════════════════════════════════════════════════════════════════════════
  try {
    await clearHighlights();
    var clippedCount = await page.evaluate(function() {
      var isVis = window.__qa_isVisible;
      var bad = 0;

      document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,span,button,a,label,li,td,th').forEach(function(el) {
        if (!isVis(el, { minWidth: 30, minHeight: 10 })) return;
        var r = el.getBoundingClientRect();
        if (r.width < 50 || r.height < 10) return;
        var s = getComputedStyle(el);

        // Horizontal clipping: text wider than container
        if (el.scrollWidth > el.clientWidth + 10 && s.overflowX !== 'auto' && s.overflowX !== 'scroll') {
          bad++;
          try { window.__qa_highlight(r, 'red'); } catch { /* ignore */ }
          return;
        }
        // Multiline clipping with ellipsis
        if (el.scrollHeight > el.clientHeight + 5 && s.overflowY === 'hidden' && s.textOverflow === 'ellipsis') {
          bad++;
          try { window.__qa_highlight(r, 'red'); } catch { /* ignore */ }
          return;
        }
        // Hidden overflow cutting off content (skip flex/grid which manage layout differently)
        if (el.scrollHeight > el.clientHeight + 10 && s.overflow === 'hidden' && s.display !== 'flex' && s.display !== 'grid') {
          bad++;
          try { window.__qa_highlight(r, 'red'); } catch { /* ignore */ }
        }
      });
      return bad;
    });

    if (clippedCount > 0) {
      var clippedShot = 'clipped-text-' + Date.now() + '.png';
      await safeShot(clippedShot);
      addIssue('Clipped / Truncated Text', { count: clippedCount, screenshot: clippedShot, severity: 'major' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 7. IMAGE DISTORTION — images visibly stretched or squished
  // ═════════════════════════════════════════════════════════════════════════
  try {
    await clearHighlights();
    var distortedCount = await page.evaluate(function() {
      var isVis = window.__qa_isVisible;
      var bad = 0;
      document.querySelectorAll('img').forEach(function(img) {
        if (!isVis(img, { minWidth: 10, minHeight: 10 })) return;
        if (img.naturalWidth && img.naturalHeight && img.clientWidth && img.clientHeight) {
          var nat = img.naturalWidth / img.naturalHeight;
          var ren = img.clientWidth / img.clientHeight;
          if (Math.abs(nat - ren) > 0.4) {
            bad++;
            try { window.__qa_highlight(img.getBoundingClientRect(), 'red'); } catch { /* ignore */ }
          }
        }
      });
      return bad;
    });

    if (distortedCount > 0) {
      var distortedShot = 'distorted-images-' + Date.now() + '.png';
      await safeShot(distortedShot);
      addIssue('Distorted Images', { count: distortedCount, screenshot: distortedShot, severity: 'minor' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 8. SMALL TOUCH TARGETS — buttons too small to interact with visually
  // ═════════════════════════════════════════════════════════════════════════
  try {
    await clearHighlights();
    var smallBtnCount = await page.evaluate(function() {
      var isVis = window.__qa_isVisible;
      var bad = 0;
      var isMobile = window.innerWidth < 768;
      var minTarget = isMobile ? 44 : 32;

      document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]').forEach(function(btn) {
        var r = btn.getBoundingClientRect();
        if (!isVis(btn, { minWidth: 10, minHeight: 10 })) return;
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        if (r.width < minTarget || r.height < minTarget) {
          bad++;
          try { window.__qa_highlight(r, 'orange'); } catch { /* ignore */ }
        }
      });
      return bad;
    });

    if (smallBtnCount > 0) {
      var smallBtnShot = 'small-buttons-' + Date.now() + '.png';
      await safeShot(smallBtnShot);
      addIssue('Small Touch Targets', { count: smallBtnCount, screenshot: smallBtnShot, severity: 'minor' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 9. COVERED INTERACTIVE ELEMENTS — buttons/links hidden behind overlays
  // ═════════════════════════════════════════════════════════════════════════
  try {
    await clearHighlights();
    var coveredCount = await page.evaluate(function() {
      var isVis = window.__qa_isVisible;
      var bad = 0;

      document.querySelectorAll('button,a,input[type="submit"],input[type="button"]').forEach(function(el) {
        var r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) return;
        if (!isVis(el)) return;
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        var s = getComputedStyle(el);
        if (s.position === 'fixed' || s.position === 'sticky') return;
        if (el.closest('nav, header, footer')) return;

        var cx = Math.round(r.left + r.width / 2);
        var cy = Math.round(r.top + r.height / 2);
        var topEl = document.elementFromPoint(cx, cy);
        if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
          bad++;
          try { window.__qa_highlight(r, 'red'); } catch { /* ignore */ }
        }
      });
      return bad;
    });

    if (coveredCount > 0) {
      var coveredShot = 'covered-elements-' + Date.now() + '.png';
      await safeShot(coveredShot);
      addIssue('Covered Interactive Elements', { count: coveredCount, screenshot: coveredShot, severity: 'major' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 10. MISALIGNED LAYOUT — elements visually off from expected alignment
  // ═════════════════════════════════════════════════════════════════════════
  try {
    await clearHighlights();
    var misalignedCount = await page.evaluate(function() {
      var isVis = window.__qa_isVisible;
      var count = 0;
      var centerX = window.innerWidth / 2;

      document.querySelectorAll('section,h1,h2,h3,.container,[class*=container]').forEach(function(el) {
        var r = el.getBoundingClientRect();
        var s = getComputedStyle(el);
        if (!isVis(el, { minWidth: 100, minHeight: 30 })) return;
        if (s.textAlign === 'center') {
          var elCenter = r.left + r.width / 2;
          if (Math.abs(elCenter - centerX) > 30 && r.width > 200) {
            count++;
            try { window.__qa_highlight(r, 'blue'); } catch { /* ignore */ }
          }
        }
      });
      return count;
    });

    if (misalignedCount > 0) {
      var misalignedShot = 'misaligned-' + Date.now() + '.png';
      await safeShot(misalignedShot);
      addIssue('Misaligned Layout', { count: misalignedCount, screenshot: misalignedShot, severity: 'minor' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 11. COLLAPSED / EXCESSIVE SPACING — visible gaps that look wrong
  // ═════════════════════════════════════════════════════════════════════════
  try {
    var spacingResult = await page.evaluate(function() {
      var collapsed = 0;
      var excessive = 0;

      document.querySelectorAll('section,[class*=card],[class*=block]').forEach(function(parent) {
        var kids = Array.from(parent.children).filter(function(k) {
          var r = k.getBoundingClientRect();
          var s = getComputedStyle(k);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        });
        if (kids.length < 2) return;

        for (var i = 1; i < kids.length; i++) {
          var a = kids[i - 1].getBoundingClientRect();
          var b = kids[i].getBoundingClientRect();
          var gap = b.top - a.bottom;

          // Collapsed: elements overlapping when they shouldn't
          if (gap < -5) { collapsed++; continue; }

          // Excessive: large gap between similar-width siblings
          if (gap > 200 && Math.abs(a.width - b.width) < 100) {
            excessive++;
          }
        }
      });

      return { collapsed: collapsed, excessive: excessive };
    });

    if (spacingResult.collapsed > 0) {
      addIssue('Collapsed Spacing', { count: spacingResult.collapsed, severity: 'major' });
    }
    if (spacingResult.excessive > 0) {
      addIssue('Excessive Spacing', { count: spacingResult.excessive, severity: 'minor' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 12. COLOR CONTRAST — text hard to read against background
  // ═════════════════════════════════════════════════════════════════════════
  try {
    await clearHighlights();
    var contrastIssues = await page.evaluate(function() {
      var isVis = window.__qa_isVisible;
      var lowContrast = 0;

      document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,a,button,label,span,td,th,li').forEach(function(el) {
        if (!isVis(el, { minWidth: 20, minHeight: 10 })) return;
        var s = getComputedStyle(el);
        var fontSize = parseFloat(s.fontSize);
        var fontWeight = parseInt(s.fontWeight) || 400;

        var fg = window.__qa_parseColor(s.color);
        var bg = window.__qa_getEffectiveBg(el);
        if (!fg || !bg) return;

        var cr = window.__qa_contrastRatio(fg, bg);
        var isLargeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        var threshold = isLargeText ? 3.0 : 4.5;

        if (cr < threshold) {
          lowContrast++;
          try {
            window.__qa_highlight(el.getBoundingClientRect(), 'yellow');
          } catch (e) { /* ignore */ }
        }

      });

      return lowContrast;
    });

    if (contrastIssues > 0) {
      var contrastShot = 'low-contrast-' + Date.now() + '.png';
      await safeShot(contrastShot);
      addIssue('Low Color Contrast', { count: contrastIssues, screenshot: contrastShot, severity: 'minor' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 13. CLS (Layout Shift) — noticeable shifts during page load
  // ═════════════════════════════════════════════════════════════════════════
  try {
    var clsScore = await page.evaluate(function() {
      // Fallback if PerformanceObserver didn't start
      if (!window.__qa_clsActive) {
        try {
          var entries = performance.getEntriesByType('layout-shift');
          var sum = 0;
          for (var i = 0; i < entries.length; i++) {
            if (!entries[i].hadRecentInput) sum += entries[i].value;
          }
          window.__qa_clsValue = sum;
        } catch { /* not supported */ }
      }
      try { if (window.__qa_clsObs) window.__qa_clsObs.disconnect(); } catch { /* ignore */ }
      return window.__qa_clsValue || 0;
    });

    if (clsScore > 0.1) {
      addIssue('Layout Shift (CLS)', {
        severity: clsScore > 0.25 ? 'major' : 'minor',
        details: 'CLS Score: ' + clsScore.toFixed(4)
      });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 14. BLANK PAGE — no visible content
  // ═════════════════════════════════════════════════════════════════════════
  try {
    var bodyText = await page.evaluate(function() { return document.body.innerText; });
    if (!bodyText || bodyText.trim().length === 0) {
      addIssue('Blank Page', { severity: 'critical', details: 'Page appears blank or failed to load content' });
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // 15. CONTENT COMPARISON (COMPARE MODE) — missing visible content
  // ═════════════════════════════════════════════════════════════════════════
  try {
    if (isCompareMode) {
      console.log('🔍 Running content comparison...');
      var refPage = await page.context().newPage();
      try {
        await refPage.goto(referenceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        var refData = await refPage.evaluate(function() {
          var clean = function(t) { return t.replace(/\s+/g, ' ').trim(); };
          var getText = function(sel) {
            return Array.from(document.querySelectorAll(sel))
              .map(function(el) { return clean(el.innerText); })
              .filter(function(t) { return t.length > 20; });
          };
          return { headings: getText('h1,h2,h3'), paragraphs: getText('p') };
        });

        var currentData = await page.evaluate(function() {
          document.querySelectorAll('.ads,.ad,.banner,.popup,.modal,.cookie,.overlay,[id*=ad]').forEach(function(el) { el.remove(); });
          var clean = function(t) { return t.replace(/\s+/g, ' ').trim(); };
          var getText = function(sel) {
            return Array.from(document.querySelectorAll(sel))
              .map(function(el) { return clean(el.innerText); })
              .filter(function(t) { return t.length > 20; });
          };
          return { headings: getText('h1,h2,h3'), paragraphs: getText('p') };
        });

        // Fuzzy heading match (Jaccard word similarity > 0.8)
        var missingHeadings = refData.headings.filter(function(rh) {
          return !currentData.headings.some(function(ch) {
            var na = rh.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
            var nb = ch.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
            if (na === nb) return true;
            if (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return true;
            var wordsA = {};
            na.split(/\s+/).forEach(function(w) { wordsA[w] = true; });
            var wordsB = {};
            nb.split(/\s+/).forEach(function(w) { wordsB[w] = true; });
            var inter = 0;
            var union = 0;
            for (var w in wordsA) { union++; if (wordsB[w]) inter++; }
            for (var w2 in wordsB) { if (!wordsA[w2]) union++; }
            return union > 0 && (inter / union) > 0.8;
          });
        });

        // Paragraph similarity (Jaccard > 0.6)
        var missingParagraphs = refData.paragraphs.filter(function(rp) {
          if (rp.length < 50) return false;
          return !currentData.paragraphs.some(function(cp) {
            var wordsA = {};
            rp.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).forEach(function(w) { wordsA[w] = true; });
            var wordsB = {};
            cp.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).forEach(function(w) { wordsB[w] = true; });
            var inter = 0;
            var union = 0;
            for (var w in wordsA) { union++; if (wordsB[w]) inter++; }
            for (var w2 in wordsB) { if (!wordsA[w2]) union++; }
            return union > 0 && (inter / union) > 0.6;
          });
        });

        if (missingHeadings.length > 0) {
          addIssue('Missing Headings (Compare)', { count: missingHeadings.length, severity: 'major', details: missingHeadings.slice(0, 5).join('; ') });
        }
        if (missingParagraphs.length > 0) {
          addIssue('Missing Content (Compare)', { count: missingParagraphs.length, severity: 'major', details: missingParagraphs.length + ' paragraphs may be missing' });
        }
      } catch (err) {
        addIssue('Compare Mode Error', { severity: 'minor', details: err.message });
      } finally {
        await refPage.close().catch(function() {});
      }
    }
  } catch { /* ignore */ }

  // ═════════════════════════════════════════════════════════════════════════
  // FINAL SCREENSHOT (only when issues found)
  // ═════════════════════════════════════════════════════════════════════════
  var finalScreenshot = null;
  if (issues.length > 0) {
    try {
      await clearHighlights();
      var shotFile = 'final-' + Date.now() + '.png';
      var result = await safeShot(shotFile);
      if (result.ok) finalScreenshot = shotFile;
    } catch { /* ignore */ }
  }


  // ═════════════════════════════════════════════════════════════════════════
  // REPORT WRITE
  // ═════════════════════════════════════════════════════════════════════════
  try {
    var pageName = (scenario && scenario.label) || 'unknown';
    var deviceName = (viewport && viewport.label) || 'desktop';
    var report = safeReadReport(reportFile);

    const reportEntry = {
  page: pageName,
  url: scenario ? scenario.url : null,
  device: deviceName,
  issues: [...issues],   // important
  screenshot: finalScreenshot,
  timestamp: new Date().toISOString()
};

console.log(
  'ENTRY BEING SAVED:',
  JSON.stringify(reportEntry, null, 2)
);
console.log(
  'ISSUES BEFORE PUSH:',
  JSON.stringify(issues, null, 2)
);
report.push(reportEntry);

console.log("WRITING REPORT:", reportFile);
    safeWriteReport(reportFile, report);
    console.log('📝 Report written: ' + issues.length + ' issue(s)');
  } catch (err) {
    console.error('⚠️ Report write failed:', err.message);
  }
  console.log(
  'LAST REPORT ENTRY:',
  JSON.stringify(report[report.length - 1], null, 2)
);

  console.log('✅ QA COMPLETE: ' + issues.length + ' visual defect(s) found\n');

  return {
    url: scenario ? scenario.url : null,
    status: 'completed',
    checks: [],
    issues: JSON.parse(JSON.stringify(issues)),
    screenshots: Object.keys(screenshotsTaken)
  };
};