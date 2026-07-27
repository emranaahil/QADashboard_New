/**
 * Visual Twin — extract page fingerprints and compare reference vs candidate.
 *
 * Compares: title, H1–H6, paragraphs, header/footer/nav text, images (count/src/size),
 * basic layout signals. Optional contact-hyperlink scan on candidate.
 *
 * Logs are written to stdout so they appear in View Log for the job.
 */

const path = require('path');
const fs = require('fs-extra');

/** Professional step logger — visible in job View Log */
function vtLog(phase, message, detail) {
  const ts = new Date().toISOString().slice(11, 23);
  const p = String(phase || 'INFO').padEnd(18);
  if (detail != null && detail !== '') {
    console.log(`[Visual Twin] ${ts}  ${p}  ${message}  ·  ${detail}`);
  } else {
    console.log(`[Visual Twin] ${ts}  ${p}  ${message}`);
  }
}

function vtSection(title) {
  console.log(`[Visual Twin] ──────── ${title} ────────`);
}

function normalizeText(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size && !setB.size) return 1;
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter += 1;
  return inter / (setA.size + setB.size - inter);
}

function tokenSet(text) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/**
 * Prepare a long page for full capture: lazy-load by scrolling, expand height clamps.
 * Many marketing sites use height:100vh / overflow:hidden which breaks Playwright fullPage.
 */
async function preparePageForFullScreenshot(page) {
  try {
    // Scroll through the page so lazy images / sections load
    await page.evaluate(async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const height = () =>
        Math.max(
          document.body ? document.body.scrollHeight : 0,
          document.documentElement ? document.documentElement.scrollHeight : 0
        );
      let y = 0;
      let guard = 0;
      const step = Math.max(400, Math.floor(window.innerHeight * 0.85));
      while (y < height() && guard < 80) {
        window.scrollTo(0, y);
        await delay(120);
        y += step;
        guard += 1;
      }
      window.scrollTo(0, height());
      await delay(200);
      window.scrollTo(0, 0);
      await delay(150);
    });
  } catch (_) {
    /* non-fatal */
  }

  try {
    await page.evaluate(() => {
      // Relax common full-viewport clamps that make fullPage = viewport only
      const style = document.createElement('style');
      style.setAttribute('data-visual-twin-shot', '1');
      style.textContent = `
        html, body {
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
          overflow-x: hidden !important;
        }
      `;
      document.documentElement.appendChild(style);
      if (document.body) {
        document.body.style.height = 'auto';
        document.body.style.maxHeight = 'none';
        document.body.style.overflow = 'visible';
      }
      document.documentElement.style.height = 'auto';
      document.documentElement.style.maxHeight = 'none';
      document.documentElement.style.overflow = 'visible';
    });
  } catch (_) {
    /* non-fatal */
  }
}

/**
 * Capture full document screenshot with fallbacks when fullPage fails or is too short.
 */
async function captureFullPageScreenshot(page, filePath, label) {
  await preparePageForFullScreenshot(page);

  const metrics = await page
    .evaluate(() => ({
      scrollHeight: Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0
      ),
      clientHeight: document.documentElement ? document.documentElement.clientHeight : 0,
      innerHeight: window.innerHeight
    }))
    .catch(() => ({ scrollHeight: 0, clientHeight: 0, innerHeight: 0 }));

  vtLog(
    'SCREENSHOT',
    `${label} page metrics`,
    `scrollHeight=${metrics.scrollHeight} · viewport=${metrics.innerHeight || metrics.clientHeight}`
  );

  // Cap extreme pages to avoid huge PNGs / Playwright timeouts (still multi-viewport)
  const MAX_FULL_HEIGHT = 16000;
  let used = 'fullPage';

  try {
    if (metrics.scrollHeight > 0 && metrics.scrollHeight <= MAX_FULL_HEIGHT) {
      await page.screenshot({
        path: filePath,
        fullPage: true,
        animations: 'disabled',
        caret: 'hide'
      });
    } else if (metrics.scrollHeight > MAX_FULL_HEIGHT) {
      // Clip to a tall but bounded region from top
      used = 'clip-tall';
      const vp = page.viewportSize() || { width: 1440, height: 900 };
      await page.screenshot({
        path: filePath,
        clip: {
          x: 0,
          y: 0,
          width: vp.width,
          height: Math.min(MAX_FULL_HEIGHT, metrics.scrollHeight)
        },
        animations: 'disabled',
        caret: 'hide'
      });
    } else {
      await page.screenshot({ path: filePath, fullPage: true, animations: 'disabled' });
    }
  } catch (err) {
    vtLog('SCREENSHOT', `${label} fullPage failed, trying body element`, err?.message || err);
    used = 'body-element';
    try {
      const body = await page.$('body');
      if (body) {
        await body.screenshot({ path: filePath, animations: 'disabled' });
      } else {
        await page.screenshot({ path: filePath, fullPage: false, animations: 'disabled' });
        used = 'viewport-fallback';
      }
    } catch (err2) {
      await page.screenshot({ path: filePath, fullPage: false, animations: 'disabled' });
      used = 'viewport-fallback';
      vtLog('SCREENSHOT', `${label} viewport fallback`, err2?.message || err2);
    }
  }

  try {
    const stat = await fs.stat(filePath);
    vtLog(
      'SCREENSHOT',
      `${label} saved`,
      `${path.basename(filePath)} · ${Math.round(stat.size / 1024)} KB · mode=${used}`
    );
  } catch (_) {
    vtLog('SCREENSHOT', `${label} saved`, `${path.basename(filePath)} · mode=${used}`);
  }

  return used;
}

async function extractPageSnapshot(page) {
  return page.evaluate(() => {
    function visible(el) {
      if (!el) return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.05) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    function texts(sel, max) {
      return Array.from(document.querySelectorAll(sel))
        .filter(visible)
        .map((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t.length > 0)
        .slice(0, max || 50);
    }

    const title = (document.title || '').trim();
    const headings = {
      h1: texts('h1', 20),
      h2: texts('h2', 40),
      h3: texts('h3', 40),
      h4: texts('h4', 30),
      h5: texts('h5', 20),
      h6: texts('h6', 20)
    };
    const paragraphs = texts('p', 80).filter((t) => t.length >= 20);

    const headerEl = document.querySelector('header') || document.querySelector('[role="banner"]');
    const footerEl = document.querySelector('footer') || document.querySelector('[role="contentinfo"]');
    const navEl = document.querySelector('nav') || document.querySelector('[role="navigation"]');

    const images = Array.from(document.querySelectorAll('img'))
      .filter(visible)
      .map((img) => {
        const src = img.currentSrc || img.src || img.getAttribute('src') || '';
        let pathOnly = src;
        try {
          const u = new URL(src, location.href);
          pathOnly = u.pathname;
        } catch (_) {}
        return {
          srcPath: pathOnly,
          alt: (img.getAttribute('alt') || '').trim(),
          width: Math.round(img.getBoundingClientRect().width),
          height: Math.round(img.getBoundingClientRect().height),
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0
        };
      })
      .filter((i) => i.srcPath)
      .slice(0, 120);

    return {
      title,
      headings,
      paragraphs,
      headerText: headerEl ? (headerEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2000) : '',
      footerText: footerEl ? (footerEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2000) : '',
      navText: navEl ? (navEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1500) : '',
      hasHeader: Boolean(headerEl),
      hasFooter: Boolean(footerEl),
      hasNav: Boolean(navEl),
      images,
      bodyTextLength: (document.body && document.body.innerText ? document.body.innerText : '').trim().length,
      scrollWidth: document.documentElement.scrollWidth || 0,
      clientWidth: document.documentElement.clientWidth || 0
    };
  });
}

function compareHeadingLevel(refList, candList, level) {
  const diffs = [];
  const refN = (refList || []).map(normalizeText).filter(Boolean);
  const candN = (candList || []).map(normalizeText).filter(Boolean);
  const score = jaccard(refN, candN);

  for (const h of refN) {
    if (!candN.includes(h)) {
      diffs.push({ kind: 'missing_on_candidate', level, text: h.slice(0, 200) });
    }
  }
  for (const h of candN) {
    if (!refN.includes(h)) {
      diffs.push({ kind: 'extra_on_candidate', level, text: h.slice(0, 200) });
    }
  }

  return {
    level,
    refCount: refN.length,
    candidateCount: candN.length,
    score: Math.round(score * 100),
    diffs: diffs.slice(0, 12)
  };
}

function compareSnapshots(ref, cand) {
  const issues = [];
  const parts = [];

  vtSection('Compare content fingerprints');

  // Title
  vtLog('CHECK', 'Title', 'comparing document titles');
  const titleSame = normalizeText(ref.title) === normalizeText(cand.title);
  const titleScore = titleSame ? 100 : jaccard(tokenSet(ref.title), tokenSet(cand.title)) * 100;
  parts.push({ key: 'title', weight: 0.08, score: titleScore });
  vtLog('CHECK', 'Title result', `${Math.round(titleScore)}% · ref="${(ref.title || '').slice(0, 60)}" cand="${(cand.title || '').slice(0, 60)}"`);
  if (!titleSame) {
    issues.push({
      type: 'Title mismatch',
      severity: 'major',
      details: `Reference: "${(ref.title || '').slice(0, 80)}" | Candidate: "${(cand.title || '').slice(0, 80)}"`
    });
    vtLog('ISSUE', 'Title mismatch', 'titles differ');
  }

  // Headings H1–H6
  vtLog('CHECK', 'Headings H1–H6', 'comparing heading text lists per level');
  const headingLevels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const headingReports = [];
  let headingScoreSum = 0;
  for (const lvl of headingLevels) {
    const rep = compareHeadingLevel(ref.headings?.[lvl], cand.headings?.[lvl], lvl);
    headingReports.push(rep);
    headingScoreSum += rep.score;
    vtLog(
      'CHECK',
      `${lvl.toUpperCase()} headings`,
      `score=${rep.score}% · ref=${rep.refCount} · cand=${rep.candidateCount} · diffs=${rep.diffs.length}`
    );
    for (const d of rep.diffs.slice(0, 4)) {
      issues.push({
        type: d.kind === 'missing_on_candidate' ? `${lvl.toUpperCase()} missing on candidate` : `${lvl.toUpperCase()} extra on candidate`,
        severity: lvl === 'h1' ? 'critical' : lvl === 'h2' ? 'major' : 'minor',
        details: d.text
      });
      vtLog(
        'ISSUE',
        d.kind === 'missing_on_candidate' ? `${lvl.toUpperCase()} missing on candidate` : `${lvl.toUpperCase()} extra on candidate`,
        d.text.slice(0, 100)
      );
    }
  }
  const headingScore = headingScoreSum / headingLevels.length;
  parts.push({ key: 'headings', weight: 0.28, score: headingScore });
  vtLog('CHECK', 'Headings overall', `${Math.round(headingScore)}%`);

  // Paragraphs
  vtLog('CHECK', 'Paragraphs', 'comparing paragraph text sets');
  const refP = (ref.paragraphs || []).map(normalizeText);
  const candP = (cand.paragraphs || []).map(normalizeText);
  const paraScore = jaccard(refP, candP) * 100;
  parts.push({ key: 'paragraphs', weight: 0.22, score: paraScore });
  vtLog('CHECK', 'Paragraphs result', `${Math.round(paraScore)}% · ref=${refP.length} · cand=${candP.length}`);
  if (paraScore < 85) {
    const missing = refP.filter((p) => !candP.includes(p)).slice(0, 5);
    if (missing.length) {
      issues.push({
        type: 'Paragraph content differs',
        severity: paraScore < 50 ? 'major' : 'minor',
        details: `${missing.length}+ paragraph(s) from reference not matched on candidate (sample: "${missing[0].slice(0, 120)}…")`
      });
      vtLog('ISSUE', 'Paragraph content differs', `${missing.length} unmatched sample(s)`);
    }
  }

  // Header / footer / nav
  vtLog('CHECK', 'Header / Footer / Nav', 'comparing chrome regions');
  const headerScore = jaccard(tokenSet(ref.headerText), tokenSet(cand.headerText)) * 100;
  const footerScore = jaccard(tokenSet(ref.footerText), tokenSet(cand.footerText)) * 100;
  const navScore = jaccard(tokenSet(ref.navText), tokenSet(cand.navText)) * 100;
  parts.push({ key: 'header', weight: 0.1, score: ref.hasHeader || cand.hasHeader ? headerScore : 100 });
  parts.push({ key: 'footer', weight: 0.08, score: ref.hasFooter || cand.hasFooter ? footerScore : 100 });
  parts.push({ key: 'nav', weight: 0.08, score: ref.hasNav || cand.hasNav ? navScore : 100 });
  vtLog(
    'CHECK',
    'Chrome scores',
    `header=${Math.round(headerScore)}% footer=${Math.round(footerScore)}% nav=${Math.round(navScore)}% · presence H/F/N ref=${ref.hasHeader}/${ref.hasFooter}/${ref.hasNav} cand=${cand.hasHeader}/${cand.hasFooter}/${cand.hasNav}`
  );

  if (ref.hasHeader !== cand.hasHeader) {
    issues.push({
      type: 'Header presence mismatch',
      severity: 'major',
      details: `Reference hasHeader=${ref.hasHeader}, candidate hasHeader=${cand.hasHeader}`
    });
    vtLog('ISSUE', 'Header presence mismatch', `ref=${ref.hasHeader} cand=${cand.hasHeader}`);
  }
  if (ref.hasFooter !== cand.hasFooter) {
    issues.push({
      type: 'Footer presence mismatch',
      severity: 'major',
      details: `Reference hasFooter=${ref.hasFooter}, candidate hasFooter=${cand.hasFooter}`
    });
    vtLog('ISSUE', 'Footer presence mismatch', `ref=${ref.hasFooter} cand=${cand.hasFooter}`);
  }
  if (headerScore < 70 && (ref.hasHeader || cand.hasHeader)) {
    issues.push({
      type: 'Header content differs',
      severity: 'minor',
      details: `Header text similarity ${Math.round(headerScore)}%`
    });
    vtLog('ISSUE', 'Header content differs', `${Math.round(headerScore)}%`);
  }
  if (footerScore < 70 && (ref.hasFooter || cand.hasFooter)) {
    issues.push({
      type: 'Footer content differs',
      severity: 'minor',
      details: `Footer text similarity ${Math.round(footerScore)}%`
    });
    vtLog('ISSUE', 'Footer content differs', `${Math.round(footerScore)}%`);
  }

  // Images — by path basename + count
  vtLog('CHECK', 'Images', 'comparing image counts and file names');
  const refImgs = ref.images || [];
  const candImgs = cand.images || [];
  const refPaths = refImgs.map((i) => i.srcPath.split('/').pop() || i.srcPath);
  const candPaths = candImgs.map((i) => i.srcPath.split('/').pop() || i.srcPath);
  const imgPathScore = jaccard(refPaths, candPaths) * 100;
  const countRatio =
    !refImgs.length && !candImgs.length
      ? 1
      : Math.min(refImgs.length, candImgs.length) / Math.max(refImgs.length, candImgs.length || 1);
  const imgScore = imgPathScore * 0.7 + countRatio * 100 * 0.3;
  parts.push({ key: 'images', weight: 0.12, score: imgScore });
  vtLog(
    'CHECK',
    'Images result',
    `${Math.round(imgScore)}% · ref=${refImgs.length} · cand=${candImgs.length} · path overlap=${Math.round(imgPathScore)}%`
  );

  if (Math.abs(refImgs.length - candImgs.length) >= 2) {
    issues.push({
      type: 'Image count differs',
      severity: 'major',
      details: `Reference images=${refImgs.length}, candidate images=${candImgs.length}`
    });
    vtLog('ISSUE', 'Image count differs', `ref=${refImgs.length} cand=${candImgs.length}`);
  }
  const missingImgs = refPaths.filter((p) => !candPaths.includes(p)).slice(0, 8);
  if (missingImgs.length) {
    issues.push({
      type: 'Images missing on candidate',
      severity: 'major',
      details: missingImgs.join(', ').slice(0, 300)
    });
    vtLog('ISSUE', 'Images missing on candidate', missingImgs.slice(0, 5).join(', '));
  }

  // Layout: horizontal scroll mismatch
  vtLog('CHECK', 'Layout', 'horizontal scroll / width signals');
  const refHScroll = (ref.scrollWidth || 0) > (ref.clientWidth || 0) + 15;
  const candHScroll = (cand.scrollWidth || 0) > (cand.clientWidth || 0) + 15;
  if (refHScroll !== candHScroll) {
    issues.push({
      type: 'Horizontal scroll mismatch',
      severity: 'minor',
      details: `Reference scroll=${refHScroll}, candidate scroll=${candHScroll}`
    });
    parts.push({ key: 'layout', weight: 0.04, score: 40 });
    vtLog('ISSUE', 'Horizontal scroll mismatch', `ref=${refHScroll} cand=${candHScroll}`);
  } else {
    parts.push({ key: 'layout', weight: 0.04, score: 100 });
    vtLog('CHECK', 'Layout result', 'OK (scroll signals match)');
  }

  // Weighted match score
  let totalW = 0;
  let acc = 0;
  for (const p of parts) {
    totalW += p.weight;
    acc += p.weight * p.score;
  }
  const matchScore = Math.round(acc / (totalW || 1));
  vtLog('SCORE', 'Pair match score', `${matchScore}% · issues=${issues.length}`);

  return {
    matchScore,
    scores: Object.fromEntries(parts.map((p) => [p.key, Math.round(p.score)])),
    headingReports,
    issues,
    refStats: {
      title: ref.title,
      headingCounts: Object.fromEntries(headingLevels.map((l) => [l, (ref.headings?.[l] || []).length])),
      paragraphCount: refP.length,
      imageCount: refImgs.length,
      bodyTextLength: ref.bodyTextLength
    },
    candidateStats: {
      title: cand.title,
      headingCounts: Object.fromEntries(headingLevels.map((l) => [l, (cand.headings?.[l] || []).length])),
      paragraphCount: candP.length,
      imageCount: candImgs.length,
      bodyTextLength: cand.bodyTextLength
    }
  };
}

async function comparePagePair({
  browser,
  referenceUrl,
  candidateUrl,
  viewport,
  browserType,
  screenshotDir,
  pairIndex,
  checkContactHyperlinks,
  phoneDigitLength
}) {
  const {
    buildContextOptions,
    getNavigationTimeout
  } = require('../shared/services/browserService');
  const navTimeout = getNavigationTimeout(45000, browserType || 'chrome');
  const vp = viewport || { width: 1440, height: 900, label: 'Desktop' };

  vtSection(`Pair #${pairIndex} · ${vp.label || 'Desktop'}`);
  vtLog('PAIR', 'Reference', referenceUrl);
  vtLog('PAIR', 'Candidate', candidateUrl);
  vtLog('PAIR', 'Viewport', `${vp.width}×${vp.height} (${vp.label || 'Desktop'}) · browser=${browserType || 'chrome'}`);

  const context = await browser.newContext(
    buildContextOptions(browserType || 'chrome', { width: vp.width, height: vp.height })
  );
  const refPage = await context.newPage();
  const candPage = await context.newPage();
  vtLog('BROWSER', 'Contexts ready', 'two pages opened (reference + candidate)');

  const result = {
    referenceUrl,
    candidateUrl,
    device: vp.label || 'Desktop',
    matchScore: 0,
    scores: {},
    issues: [],
    screenshots: {},
    error: null
  };

  try {
    vtLog('NAVIGATE', 'Loading both URLs', 'waitUntil=domcontentloaded');
    const [refResp, candResp] = await Promise.all([
      refPage.goto(referenceUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout }),
      candPage.goto(candidateUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout })
    ]);

    const refStatus = refResp ? refResp.status() : 0;
    const candStatus = candResp ? candResp.status() : 0;
    result.referenceStatus = refStatus;
    result.candidateStatus = candStatus;
    vtLog('NAVIGATE', 'HTTP status', `reference=${refStatus} · candidate=${candStatus}`);

    if (refStatus >= 400 || candStatus >= 400) {
      result.issues.push({
        type: 'HTTP status problem',
        severity: 'critical',
        details: `Reference HTTP ${refStatus}, candidate HTTP ${candStatus}`
      });
      vtLog('ISSUE', 'HTTP status problem', `ref=${refStatus} cand=${candStatus}`);
    }

    vtLog('SETTLE', 'Waiting for page settle', '1200ms');
    await Promise.all([
      refPage.waitForTimeout(1200).catch(() => {}),
      candPage.waitForTimeout(1200).catch(() => {})
    ]);

    vtLog('EXTRACT', 'Capturing page fingerprints', 'title, H1–H6, paragraphs, header/footer/nav, images');
    const [refSnap, candSnap] = await Promise.all([
      extractPageSnapshot(refPage),
      extractPageSnapshot(candPage)
    ]);
    vtLog(
      'EXTRACT',
      'Reference snapshot',
      `title="${(refSnap.title || '').slice(0, 50)}" · imgs=${(refSnap.images || []).length} · bodyChars=${refSnap.bodyTextLength || 0}`
    );
    vtLog(
      'EXTRACT',
      'Candidate snapshot',
      `title="${(candSnap.title || '').slice(0, 50)}" · imgs=${(candSnap.images || []).length} · bodyChars=${candSnap.bodyTextLength || 0}`
    );

    const comparison = compareSnapshots(refSnap, candSnap);
    result.matchScore = comparison.matchScore;
    result.scores = comparison.scores;
    result.headingReports = comparison.headingReports;
    result.issues = [...result.issues, ...comparison.issues];
    result.refStats = comparison.refStats;
    result.candidateStats = comparison.candidateStats;

    // Screenshots — full document (scroll + expand height), not viewport-only
    if (screenshotDir) {
      vtLog('SCREENSHOT', 'Capturing FULL PAGE screenshots', 'scroll + fullPage + fallbacks');
      await fs.ensureDir(screenshotDir);
      const refShot = `pair-${pairIndex}-ref.png`;
      const candShot = `pair-${pairIndex}-cand.png`;
      try {
        await captureFullPageScreenshot(
          refPage,
          path.join(screenshotDir, refShot),
          'Reference'
        );
        result.screenshots.reference = refShot;
      } catch (shotErr) {
        vtLog('SCREENSHOT', 'Reference failed', shotErr?.message || shotErr);
      }
      try {
        await captureFullPageScreenshot(
          candPage,
          path.join(screenshotDir, candShot),
          'Candidate'
        );
        result.screenshots.candidate = candShot;
      } catch (shotErr) {
        vtLog('SCREENSHOT', 'Candidate failed', shotErr?.message || shotErr);
      }
    }

    // Optional contact hyperlinks on candidate (reuse UI Testing helper)
    if (checkContactHyperlinks) {
      vtLog('CONTACT', 'Contact hyperlink check', `candidate page · phoneDigits=${phoneDigitLength || 10}`);
      try {
        process.env.QA_CHECK_CONTACT_HYPERLINKS = '1';
        process.env.QA_PHONE_DIGIT_LENGTH = String(phoneDigitLength || 10);
        const {
          runContactHyperlinkCheck,
          contactFindingsToIssues
        } = require('../ui-check/contactHyperlinkCheck');
        const contact = await runContactHyperlinkCheck(candPage);
        const cIssues = contactFindingsToIssues(contact);
        vtLog(
          'CONTACT',
          'Contact result',
          `unlinked emails=${(contact.unlinkedEmails || []).length} · phones=${(contact.unlinkedPhones || []).length}`
        );
        for (const ci of cIssues) {
          result.issues.push({
            ...ci,
            details: `${ci.details} (on candidate)`
          });
          vtLog('ISSUE', ci.type, ci.details);
        }
      } catch (err) {
        vtLog('CONTACT', 'Contact check skipped', err?.message || err);
      }
    } else {
      vtLog('CONTACT', 'Contact hyperlink check', 'skipped (toggle off)');
    }

    vtLog(
      'PAIR DONE',
      `Match ${result.matchScore}%`,
      `issues=${result.issues.length} · scores=${JSON.stringify(result.scores || {})}`
    );
  } catch (err) {
    result.error = err.message || String(err);
    result.issues.push({
      type: 'Compare failed',
      severity: 'critical',
      details: result.error
    });
    result.matchScore = 0;
    vtLog('ERROR', 'Pair comparison failed', result.error);
  } finally {
    await refPage.close().catch(() => {});
    await candPage.close().catch(() => {});
    await context.close().catch(() => {});
    vtLog('BROWSER', 'Pair contexts closed', `pair #${pairIndex}`);
  }

  return result;
}

function mapReferencePathToCandidate(referenceUrl, candidateBase) {
  const ref = new URL(referenceUrl);
  const base = new URL(candidateBase);
  base.pathname = ref.pathname;
  base.search = ref.search;
  base.hash = '';
  return base.href;
}

async function discoverReferenceUrls(browser, startUrl, maxPages, browserType) {
  const {
    buildContextOptions,
    getNavigationTimeout
  } = require('../shared/services/browserService');
  const navTimeout = getNavigationTimeout(30000, browserType || 'chrome');
  const origin = new URL(startUrl).origin;
  const seen = new Set();
  const queue = [startUrl];
  const urls = [];

  vtSection('Discover reference URLs');
  vtLog('CRAWL', 'Start URL', startUrl);
  vtLog('CRAWL', 'Limits', `maxPages=${maxPages} · origin=${origin}`);

  const context = await browser.newContext(
    buildContextOptions(browserType || 'chrome', { width: 1280, height: 800 })
  );
  const page = await context.newPage();

  try {
    while (queue.length && urls.length < maxPages) {
      const url = queue.shift();
      const key = url.split('#')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(key);
      vtLog('CRAWL', `Page ${urls.length}/${maxPages}`, key);

      try {
        await page.goto(key, { waitUntil: 'domcontentloaded', timeout: navTimeout });
        const hrefs = await page.evaluate((originHost) => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map((a) => a.href)
            .filter((h) => {
              try {
                const u = new URL(h);
                return u.origin === originHost && !h.includes('mailto:') && !h.includes('tel:');
              } catch {
                return false;
              }
            });
        }, origin);

        let added = 0;
        for (const h of hrefs) {
          const clean = h.split('#')[0];
          if (!seen.has(clean) && !queue.includes(clean)) {
            queue.push(clean);
            added += 1;
          }
        }
        vtLog('CRAWL', 'Links discovered', `+${added} queued · queue size=${queue.length}`);
      } catch (crawlErr) {
        vtLog('CRAWL', 'Navigation warning', crawlErr?.message || crawlErr);
      }
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }

  vtLog('CRAWL', 'Discovery complete', `${urls.length} URL(s)`);
  return urls.slice(0, maxPages);
}

module.exports = {
  extractPageSnapshot,
  compareSnapshots,
  comparePagePair,
  mapReferencePathToCandidate,
  discoverReferenceUrls,
  captureFullPageScreenshot,
  preparePageForFullScreenshot,
  normalizeText,
  jaccard,
  vtLog,
  vtSection
};
