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

/**
 * Stronger normalize for headings — clones often keep the same visible text with
 * different tags (H2 vs H5) or minor unicode/punctuation differences.
 */
function normalizeHeadingText(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Content normalize for paragraphs / CTAs / body — site-agnostic, reduces clone noise
 * (punctuation, entities, volatile dates/prices soft-stripped for matching only).
 */
function normalizeContentText(s) {
  let t = normalizeHeadingText(s);
  t = t
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/[^\w\s%-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

/** Drop highly volatile tokens so year/price-only drift does not fail whole strings */
function contentTokens(s) {
  return normalizeContentText(s)
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .filter((t) => !/^\d{4}$/.test(t)) // years
    .filter((t) => !/^\$?\d+([.,]\d+)?%?$/.test(t)); // pure prices / percents
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
 * Similarity 0..1 between two strings (exact / containment / token Jaccard).
 * Tuned for marketing clone sites across any domain.
 */
function textSimilarity(a, b) {
  const na = normalizeContentText(a);
  const nb = normalizeContentText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length >= 12 && nb.length >= 12) {
    if (na.includes(nb) || nb.includes(na)) {
      const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
      if (ratio >= 0.7) return 0.92 + 0.08 * ratio;
    }
  }
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (!ta.length && !tb.length) return 1;
  return jaccard(ta, tb);
}

/**
 * Fuzzy match two lists of { text, ... }. Returns score 0–100 and unmatched ref items.
 * @param {number} threshold 0..1 minimum similarity to count as match
 */
function fuzzyMatchItemLists(refItems, candItems, threshold = 0.88) {
  const ref = (refItems || []).filter((i) => i && String(i.text || '').trim());
  const cand = (candItems || []).filter((i) => i && String(i.text || '').trim());
  if (!ref.length && !cand.length) {
    return { score: 100, unmatchedRef: [], unmatchedCand: [], matched: 0 };
  }
  const usedCand = new Set();
  let matched = 0;
  const unmatchedRef = [];

  for (const r of ref) {
    let best = -1;
    let bestSim = 0;
    for (let j = 0; j < cand.length; j++) {
      if (usedCand.has(j)) continue;
      const sim = textSimilarity(r.text, cand[j].text);
      if (sim > bestSim) {
        bestSim = sim;
        best = j;
      }
    }
    if (best >= 0 && bestSim >= threshold) {
      usedCand.add(best);
      matched += 1;
    } else {
      unmatchedRef.push(r);
    }
  }

  const unmatchedCand = cand.filter((_, j) => !usedCand.has(j));
  const denom = Math.max(ref.length, cand.length, 1);
  const score = Math.round((matched / denom) * 100);
  return { score, unmatchedRef, unmatchedCand, matched };
}

/** Noise CTAs that appear on many sites and cause false "missing" issues */
const CTA_NOISE_EXACT = new Set([
  '×',
  'x',
  'close',
  'dismiss',
  'accept',
  'accept all',
  'reject',
  'reject all',
  'cookie settings',
  'manage cookies',
  'privacy',
  'ok',
  'got it',
  'allow',
  'deny',
  'skip',
  'next',
  'prev',
  'previous',
  'play',
  'pause',
  'mute',
  'unmute',
  'share',
  'copy link'
]);

function isNoiseCtaLabel(text) {
  const n = normalizeContentText(text);
  if (!n || n.length < 2) return true;
  if (n.length > 60) return true;
  if (CTA_NOISE_EXACT.has(n)) return true;
  if (/^cookie|cookies |consent|gdpr|newsletter|subscribe to our/i.test(n)) return true;
  if (/^aria-|^icon$|^\d+$/.test(n)) return true;
  // pure punctuation / emoji-ish
  if (!/[a-z0-9]/.test(n)) return true;
  return false;
}

function filterCtaItems(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const text = String(item.text || '').trim();
    if (isNoiseCtaLabel(text)) continue;
    const key = normalizeContentText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Icon pixel bounds used across extract + match (CSS rendered size).
 * Below min → noise/trackers; above max → illustration/image, not an icon.
 */
const ICON_MIN_PX = 16;
const ICON_MAX_PX = 96;

/** Prefer leaf/natural pixel size for matching (not expanded section highlight box). */
function assetMatchSize(img) {
  const w = img.leafWidth || img.naturalWidth || img.width || 0;
  const h = img.leafHeight || img.naturalHeight || img.height || 0;
  return { w, h };
}

/** True when both width and height fall in the icon band (16–96px). */
function isIconPixelSize(w, h) {
  return w >= ICON_MIN_PX && h >= ICON_MIN_PX && w <= ICON_MAX_PX && h <= ICON_MAX_PX;
}

/** Leaf document position for matching (section box Y falsely pairs different assets). */
function assetMatchPos(img) {
  const x = typeof img.leafX === 'number' ? img.leafX : typeof img.x === 'number' ? img.x : null;
  const y = typeof img.leafY === 'number' ? img.leafY : typeof img.y === 'number' ? img.y : null;
  return { x, y };
}

/** Tight highlight box for a single image/icon on the reference screenshot. */
function assetHighlightBox(img) {
  const s = assetMatchSize(img);
  const p = assetMatchPos(img);
  const x = p.x != null ? p.x : img.x || 0;
  const y = p.y != null ? p.y : img.y || 0;
  const w = Math.max(ICON_MIN_PX, s.w || img.width || 40);
  const h = Math.max(ICON_MIN_PX, s.h || img.height || 40);
  return { x, y, width: w, height: h, pageWidth: img.pageWidth };
}

/** True for assets in the icon band (16–96px), optionally named as logo/icon. */
function isIconLikeAsset(img) {
  const s = assetMatchSize(img);
  return isIconPixelSize(s.w, s.h);
}

/** Tiny unnamed glyphs / dots / star bits — high FP rate for missing+extra. */
function isNoiseTinyAsset(img) {
  const s = assetMatchSize(img);
  if (!s.w || !s.h) return false;
  const base = typeof basenameKey === 'function' ? basenameKey(img) : '';
  const alt = String(img.alt || img.parentText || '').trim();
  const name = `${base} ${alt}`;
  // Keep small logos / badges with a real name
  if (/logo|brand|badge|seal|warranty|favicon/i.test(name) && (base.length >= 3 || alt.length >= 3)) {
    return false;
  }
  if (s.w <= 32 && s.h <= 32) {
    if (base.length >= 6 && !/^(img|image)/i.test(base)) return false;
    if (alt.length >= 6 && !/^(icon|image|img|photo)$/i.test(alt)) return false;
    return true;
  }
  if (s.w <= 40 && s.h <= 40) {
    if (base.length >= 6 || alt.length >= 6) return false;
    return true;
  }
  return false;
}

function isGenericIconLabel(text) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return true;
  return /^(icon|svg|image|img|button|link|menu|close|search|arrow|chevron|•|·|\*)$/i.test(t);
}

/** Keep data: / inline assets when they are logo/icon sized (common on marketing sites). */
function isComparableImage(img) {
  if (!img) return false;
  const isData = img.isData || String(img.srcPath || '').startsWith('data:');
  if (!isData) return true;
  const s = assetMatchSize(img);
  // Data-URI content: only compare when in icon band (or slightly larger logo mark ≤120)
  if (isIconPixelSize(s.w, s.h)) return true;
  if (s.w >= ICON_MIN_PX && s.h >= ICON_MIN_PX && s.w <= 120 && s.h <= 120) {
    const name = `${img.alt || ''} ${img.basename || ''}`;
    if (/logo|brand|badge|seal|icon/i.test(name)) return true;
  }
  return false;
}

/**
 * Drop global page-reflow noise from "misaligned" lists.
 * Staging vs live often shifts ALL content by ~100–1300px — that is one layout issue,
 * not N separate logo/icon bugs.
 */
function filterLocalMisalignments(list) {
  const raw = (list || []).filter((m) => m && m.ref && m.cand);
  if (!raw.length) return { local: [], globalOffsetY: 0, reflow: false };

  const signed = [];
  for (const m of raw) {
    const rp = assetMatchPos(m.ref);
    const cp = assetMatchPos(m.cand);
    if (rp.y == null || cp.y == null) continue;
    signed.push(cp.y - rp.y);
  }
  signed.sort((a, b) => a - b);
  const median = signed.length ? signed[Math.floor(signed.length / 2)] : 0;
  const reflow = signed.length >= 3 && Math.abs(median) >= 70;

  const local = [];
  for (const m of raw) {
    const rp = assetMatchPos(m.ref);
    const cp = assetMatchPos(m.cand);
    if (rp.y == null || cp.y == null) continue;
    const dyRaw = cp.y - rp.y;
    const residualY = Math.abs(dyRaw - (reflow ? median : 0));
    const dx = rp.x != null && cp.x != null ? Math.abs(rp.x - cp.x) : 0;
    const s = assetMatchSize(m.ref);
    const icon = isIconLikeAsset(m.ref) || isIconPixelSize(s.w, s.h);
    const yTol = icon ? 72 : s.w >= 280 ? 160 : 100;
    const xTol = icon ? 56 : s.w >= 280 ? 140 : 80;

    // Absolute huge shift without shared reflow = wrong pair, not a real "misalign" highlight
    if (!reflow && Math.abs(dyRaw) > 400) continue;

    if (reflow) {
      // After global reflow, pure vertical residual (dx≈0) is almost always a second
      // reflow band (hero vs footer) — NOT a real local icon mis-placement.
      // Only keep when there is a meaningful horizontal shift (true local bug).
      if (dx > xTol) {
        local.push({
          ...m,
          dx,
          dy: Math.round(residualY),
          rawDy: Math.round(Math.abs(dyRaw)),
          reflowOffset: Math.round(median)
        });
      }
    } else if (dx > xTol || (Math.abs(dyRaw) > yTol && Math.abs(dyRaw) < 280)) {
      // No global reflow: only moderate local shifts (not full-page drift)
      if (Math.abs(dyRaw) > 350 && dx <= xTol) continue;
      local.push({
        ...m,
        dx,
        dy: Math.round(Math.abs(dyRaw)),
        rawDy: Math.round(Math.abs(dyRaw)),
        reflowOffset: 0
      });
    }
  }

  return { local, globalOffsetY: Math.round(median), reflow };
}

/** Pick unused pool item with same key, preferring closest leaf Y (then X). */
function findClosestByKey(pool, used, pred, refItem) {
  const rp = assetMatchPos(refItem);
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < pool.length; i++) {
    if (used.has(i) || !pred(pool[i], i)) continue;
    const cp = assetMatchPos(pool[i]);
    const dy = rp.y != null && cp.y != null ? Math.abs(rp.y - cp.y) : 8000;
    const dx = rp.x != null && cp.x != null ? Math.abs(rp.x - cp.x) : 0;
    const sc = dy + dx * 0.3;
    if (sc < bestScore) {
      bestScore = sc;
      best = i;
    }
  }
  return best;
}

/**
 * Multi-key image matching: basename → alt → strict leaf size+position.
 * Returns missing-on-candidate, extra-on-candidate, and misaligned identity matches.
 */
function matchImages(refImgs, candImgs) {
  const ref = (refImgs || []).filter(isComparableImage);
  const cand = (candImgs || []).filter(isComparableImage);
  if (!ref.length && !cand.length) {
    return {
      score: 100,
      missing: [],
      extra: [],
      misaligned: [],
      reflowY: 0,
      pathScore: 100,
      countRatio: 1,
      matched: 0,
      refCount: 0,
      candCount: 0
    };
  }

  const usedCand = new Set();
  const usedRef = new Set();
  let matched = 0;
  const missing = [];
  const extra = [];
  const alignPairs = [];

  function sizeClose(a, b) {
    const as = assetMatchSize(a);
    const bs = assetMatchSize(b);
    if (!as.w || !as.h || !bs.w || !bs.h) return false;
    // Tight tolerance — loose matching caused wrong "found" hits on different assets
    return (
      Math.abs(as.w - bs.w) / Math.max(as.w, bs.w) <= 0.12 &&
      Math.abs(as.h - bs.h) / Math.max(as.h, bs.h) <= 0.12
    );
  }

  function noteAlignment(r, c, how) {
    alignPairs.push({
      ref: r,
      cand: c,
      how,
      label:
        basenameKey(r) ||
        (r.alt && r.alt.trim()) ||
        `image ${assetMatchSize(r).w}x${assetMatchSize(r).h}`
    });
  }

  function tryMatch(r, pool, used) {
    const rBase = basenameKey(r);
    const rStem = stemBasenameKey(r);
    const rAlt = normalizeContentText(r.alt || '');
    let found = -1;
    let how = '';
    // 1) exact basename — closest Y wins
    if (rBase) {
      found = findClosestByKey(pool, used, (c) => basenameKey(c) === rBase, r);
      if (found >= 0) how = 'basename';
    }
    // 1b) stem basename (CDN hash stripped) + size confirm
    // e.g. dr.5073929….webp ↔ dr.a1b2c3….webp on the other environment
    if (found < 0 && rStem) {
      found = findClosestByKey(
        pool,
        used,
        (c) => {
          if (stemBasenameKey(c) !== rStem) return false;
          return sizeClose(r, c);
        },
        r
      );
      if (found >= 0) how = 'stem';
    }
    // 2) meaningful alt (not generic)
    if (found < 0 && rAlt.length >= 4 && !/^(image|img|photo|logo|icon|banner)$/i.test(rAlt)) {
      found = findClosestByKey(
        pool,
        used,
        (c) => normalizeContentText(c.alt || '') === rAlt,
        r
      );
      if (found >= 0) how = 'alt';
    }
    // 3) layout slot for weak IDs (generic names OR content-hashed CDN names)
    if (found < 0) {
      const hasStrongId =
        isStrongImageBasename(r) ||
        (rAlt.length >= 4 && !/^(image|img|photo|logo|icon|banner)$/i.test(rAlt));
      if (!hasStrongId) {
        const rs = assetMatchSize(r);
        const rp = assetMatchPos(r);
        if (rs.w >= 40 && rs.h >= 40 && rp.y != null) {
          found = pool.findIndex((c, i) => {
            if (used.has(i)) return false;
            if (!sizeClose(r, c)) return false;
            const cp = assetMatchPos(c);
            if (cp.y == null) return false;
            const yTol = rs.w >= 280 || rs.h >= 280 ? 420 : 220;
            if (Math.abs(rp.y - cp.y) > yTol) return false;
            if (rp.x != null && cp.x != null) {
              if (Math.abs(rp.x - cp.x) > 180 && rs.w < 280) return false;
            }
            // Cand with a *stable* different basename is a different asset
            if (isStrongImageBasename(c) && stemBasenameKey(c) !== rStem) return false;
            const cAlt = normalizeContentText(c.alt || '');
            if (
              cAlt.length >= 4 &&
              !/^(image|img|photo|logo|icon|banner)$/i.test(cAlt) &&
              rAlt &&
              cAlt !== rAlt
            ) {
              return false;
            }
            return true;
          });
          if (found >= 0) how = 'layout';
        }
      }
    }
    return { found, how };
  }

  // Ref → cand (missing on candidate)
  for (let ri = 0; ri < ref.length; ri++) {
    const r = ref[ri];
    const { found, how } = tryMatch(r, cand, usedCand);
    if (found >= 0) {
      usedCand.add(found);
      usedRef.add(ri);
      matched += 1;
      if (how === 'basename' || how === 'stem' || how === 'alt') {
        noteAlignment(r, cand[found], how);
      }
    } else {
      missing.push(r);
    }
  }

  // Cand not used → extra on candidate (present on cand, not on ref)
  for (let ci = 0; ci < cand.length; ci++) {
    if (usedCand.has(ci)) continue;
    // Second chance: match remaining cand against unused ref with slightly looser Y
    const c = cand[ci];
    let foundRef = -1;
    let how = '';
    const cBase = basenameKey(c);
    const cStem = stemBasenameKey(c);
    if (cBase && cBase !== 'img' && cBase !== 'image') {
      foundRef = ref.findIndex((r, i) => !usedRef.has(i) && basenameKey(r) === cBase);
      if (foundRef >= 0) how = 'basename';
    }
    if (foundRef < 0 && cStem) {
      foundRef = ref.findIndex(
        (r, i) => !usedRef.has(i) && stemBasenameKey(r) === cStem && sizeClose(c, r)
      );
      if (foundRef >= 0) how = 'stem';
    }
    if (foundRef < 0) {
      const cHasStrong =
        isStrongImageBasename(c) ||
        (() => {
          const a = normalizeContentText(c.alt || '');
          return a.length >= 4 && !/^(image|img|photo|logo|icon|banner)$/i.test(a);
        })();
      if (!cHasStrong) {
        const cs = assetMatchSize(c);
        const cp = assetMatchPos(c);
        if (cs.w >= 48 && cs.h >= 48 && cp.y != null) {
          foundRef = ref.findIndex((r, i) => {
            if (usedRef.has(i)) return false;
            if (isStrongImageBasename(r) && stemBasenameKey(r) !== cStem) return false;
            if (!sizeClose(c, r)) return false;
            const rp = assetMatchPos(r);
            if (rp.y == null) return false;
            return Math.abs(rp.y - cp.y) < 360;
          });
          if (foundRef >= 0) how = 'layout';
        }
      }
    }
    if (foundRef >= 0) {
      usedRef.add(foundRef);
      usedCand.add(ci);
      matched += 1;
      if (how === 'basename' || how === 'stem') noteAlignment(ref[foundRef], c, how);
    } else {
      extra.push(c);
    }
  }

  /**
   * Same layout slot on both pages (generic filenames like "img") often becomes
   * both "missing" and "extra". Only reconcile when NEITHER side has a conflicting
   * strong basename/alt — never erase a real missing named logo/product.
   */
  function sameLayoutSlot(a, b) {
    const aBase = basenameKey(a);
    const bBase = basenameKey(b);
    if (aBase && bBase && aBase !== bBase) return false;
    if (aBase && !bBase) return false;
    if (bBase && !aBase) return false;
    const aAlt = normalizeContentText(a.alt || '');
    const bAlt = normalizeContentText(b.alt || '');
    const aAltStrong = aAlt.length >= 4 && !/^(image|img|photo|logo|icon|banner)$/i.test(aAlt);
    const bAltStrong = bAlt.length >= 4 && !/^(image|img|photo|logo|icon|banner)$/i.test(bAlt);
    if (aAltStrong && bAltStrong && aAlt !== bAlt) return false;

    const as = assetMatchSize(a);
    const bs = assetMatchSize(b);
    if (!as.w || !as.h || !bs.w || !bs.h) return false;
    const sizeOk =
      Math.abs(as.w - bs.w) / Math.max(as.w, bs.w) <= 0.2 &&
      Math.abs(as.h - bs.h) / Math.max(as.h, bs.h) <= 0.2;
    if (!sizeOk) return false;
    const ap = assetMatchPos(a);
    const bp = assetMatchPos(b);
    if (ap.y == null || bp.y == null) return false;
    // Logos / header marks: allow more Y drift near top
    const topLogo = as.h <= 90 && bs.h <= 90 && ap.y < 220 && bp.y < 220;
    const yTol = topLogo ? 120 : as.w >= 280 || as.h >= 280 ? 260 : 160;
    if (Math.abs(ap.y - bp.y) > yTol) return false;
    if (ap.x != null && bp.x != null) {
      if (Math.abs(ap.x - bp.x) > 160 && !(as.w >= 280 && bs.w >= 280) && !topLogo) return false;
    }
    return true;
  }

  const reconciledMissing = [];
  const reconciledExtra = extra.slice();
  for (const m of missing) {
    const ei = reconciledExtra.findIndex((e) => sameLayoutSlot(m, e));
    if (ei >= 0) {
      const e = reconciledExtra[ei];
      reconciledExtra.splice(ei, 1);
      matched += 1;
      // Generic slot match still records big shifts as misaligned icons/logos
      if (isIconLikeAsset(m) && !isNoiseTinyAsset(m)) noteAlignment(m, e, 'layout');
    } else {
      reconciledMissing.push(m);
    }
  }

  /**
   * Reflow-tolerant second pass: same leaf size + same column, Y drifted by banner/chrome.
   * Kills false missing+extra pairs like 25×26 @ y4436 vs y4871 (issue #9/#24).
   */
  function reflowTolerantPair(a, b) {
    if (isNoiseTinyAsset(a) && isNoiseTinyAsset(b)) {
      /* always try to pair noise with noise */
    } else if (isNoiseTinyAsset(a) || isNoiseTinyAsset(b)) {
      return false;
    }
    // Different stable filenames = different assets (do not pair by size alone)
    const aStem = stemBasenameKey(a);
    const bStem = stemBasenameKey(b);
    if (
      isStrongImageBasename(a) &&
      isStrongImageBasename(b) &&
      aStem &&
      bStem &&
      aStem !== bStem
    ) {
      return false;
    }
    const as = assetMatchSize(a);
    const bs = assetMatchSize(b);
    if (!as.w || !as.h || !bs.w || !bs.h) return false;
    const ap = assetMatchPos(a);
    const bp = assetMatchPos(b);
    if (ap.y == null || bp.y == null) return false;
    const dy = Math.abs(ap.y - bp.y);
    const aAlt = normalizeContentText(a.alt || a.parentText || '');
    const bAlt = normalizeContentText(b.alt || b.parentText || '');
    const sameAlt =
      aAlt.length >= 4 &&
      bAlt.length >= 4 &&
      (aAlt === bAlt || textSimilarity(aAlt, bAlt) >= 0.9);
    // Brand/logo alt match (e.g. "Telehealth Med") — allow big footer reflow
    if (sameAlt && Math.abs(as.w - bs.w) <= Math.max(12, as.w * 0.25)) {
      if (ap.x != null && bp.x != null && Math.abs(ap.x - bp.x) > 120) return false;
      return dy <= 1800;
    }
    // Same stem after hash strip (CDN re-hash between environments)
    if (aStem && bStem && aStem === bStem && sizeClose(a, b)) {
      if (ap.x != null && bp.x != null && Math.abs(ap.x - bp.x) > 160) return false;
      return dy <= 800;
    }
    if (Math.abs(as.w - bs.w) > 4 || Math.abs(as.h - bs.h) > 4) return false;
    if (ap.x == null || bp.x == null) return false;
    if (Math.abs(ap.x - bp.x) > 48) return false;
    // Only weak/hashed names may pair by layout alone
    if (isStrongImageBasename(a) || isStrongImageBasename(b)) return false;
    // Small assets: allow large Y drift (page reflow). Larger assets: moderate.
    const yTol = as.w <= 48 && as.h <= 48 ? 1200 : as.w <= 120 ? 700 : 280;
    return dy <= yTol;
  }

  const finalMissing = [];
  for (const m of reconciledMissing) {
    const ei = reconciledExtra.findIndex((e) => reflowTolerantPair(m, e));
    if (ei >= 0) {
      reconciledExtra.splice(ei, 1);
      matched += 1;
    } else if (!isNoiseTinyAsset(m)) {
      finalMissing.push(m);
    } else {
      // Drop unpaired noise tinies from missing list entirely
      matched += 1;
    }
  }
  // Drop unpaired noise tinies from extra too
  const finalExtra = reconciledExtra.filter((e) => {
    if (isNoiseTinyAsset(e)) {
      matched += 1;
      return false;
    }
    return true;
  });

  const countRatio =
    !ref.length && !cand.length
      ? 1
      : Math.min(ref.length, cand.length) / Math.max(ref.length, cand.length || 1);
  const pathScore = Math.round((matched / Math.max(Math.max(ref.length, cand.length), 1)) * 100);
  const score = Math.round(pathScore * 0.75 + countRatio * 100 * 0.25);
  const alignFilter = filterLocalMisalignments(alignPairs);
  return {
    score,
    missing: finalMissing,
    extra: finalExtra,
    misaligned: alignFilter.local,
    reflowY: alignFilter.globalOffsetY,
    pageReflow: alignFilter.reflow,
    pathScore,
    countRatio,
    matched,
    refCount: ref.length,
    candCount: cand.length
  };
}

/**
 * Group extra/missing images that form a vertical column, horizontal row,
 * or same-size cluster at the same Y (carousel/grid of N images).
 */
function groupImagesIntoStacks(imgs, { minCount = 3, maxGap = 140 } = {}) {
  const list = (imgs || [])
    .filter((i) => typeof i.y === 'number')
    .slice()
    .sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
  if (list.length < minCount) return [];

  const stacks = [];
  const pushStack = (items, axis) => {
    if (!items || items.length < minCount) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxR = 0;
    let maxB = 0;
    for (const it of items) {
      const x = it.x || 0;
      const y = it.y || 0;
      const w = it.leafWidth || it.width || 40;
      const h = it.leafHeight || it.height || 40;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxR = Math.max(maxR, x + w);
      maxB = Math.max(maxB, y + h);
    }
    stacks.push({
      axis,
      count: items.length,
      items: items.slice(),
      x: minX,
      y: minY,
      width: Math.max(40, maxR - minX),
      height: Math.max(40, maxB - minY),
      isSectionBox: true
    });
  };

  // Same size + same Y band (horizontal strip / grid row of N identical thumbs)
  const sizeYGroups = new Map();
  for (const img of list) {
    const s = assetMatchSize(img);
    if (s.w < 40 && s.h < 40) continue;
    const yBand = Math.round((img.y || 0) / 30) * 30;
    const key = `${Math.round(s.w / 8) * 8}x${Math.round(s.h / 8) * 8}@${yBand}`;
    if (!sizeYGroups.has(key)) sizeYGroups.set(key, []);
    sizeYGroups.get(key).push(img);
  }
  for (const items of sizeYGroups.values()) {
    if (items.length >= minCount) pushStack(items, 'horizontal');
  }

  // Vertical stacks (same x-ish, increasing y)
  let curV = null;
  for (const img of list) {
    const s = assetMatchSize(img);
    if (s.w < 40 && s.h < 40) continue;
    if (!curV) {
      curV = [img];
      continue;
    }
    const prev = curV[curV.length - 1];
    const xClose = Math.abs((img.x || 0) - (prev.x || 0)) < 120;
    const wClose =
      Math.abs(assetMatchSize(img).w - assetMatchSize(prev).w) <=
      Math.max(30, assetMatchSize(prev).w * 0.25);
    const gap = (img.y || 0) - ((prev.y || 0) + (prev.leafHeight || prev.height || assetMatchSize(prev).h || 0));
    if (xClose && wClose && gap >= -40 && gap <= maxGap + 80) {
      curV.push(img);
    } else {
      pushStack(curV, 'vertical');
      curV = [img];
    }
  }
  if (curV) pushStack(curV, 'vertical');

  // Horizontal rows by x progression
  const byX = list.slice().sort((a, b) => (a.x || 0) - (b.x || 0) || (a.y || 0) - (b.y || 0));
  let curH = null;
  for (const img of byX) {
    const s = assetMatchSize(img);
    if (s.w < 40 && s.h < 40) continue;
    if (!curH) {
      curH = [img];
      continue;
    }
    const prev = curH[curH.length - 1];
    const yClose = Math.abs((img.y || 0) - (prev.y || 0)) < 60;
    const hClose =
      Math.abs(assetMatchSize(img).h - assetMatchSize(prev).h) <=
      Math.max(28, assetMatchSize(prev).h * 0.25);
    const gap = (img.x || 0) - ((prev.x || 0) + (prev.leafWidth || prev.width || assetMatchSize(prev).w || 0));
    if (yClose && hClose && gap >= -50 && gap <= maxGap + 120) {
      curH.push(img);
    } else {
      pushStack(curH, 'horizontal');
      curH = [img];
    }
  }
  if (curH) pushStack(curH, 'horizontal');

  // Dedupe overlapping stacks (prefer larger count / same Y band)
  stacks.sort((a, b) => b.count - a.count || a.y - b.y);
  const out = [];
  for (const st of stacks) {
    const overlaps = out.some(
      (o) =>
        Math.abs(o.y - st.y) < 80 &&
        (Math.abs(o.x - st.x) < 120 ||
          (st.x >= o.x && st.x + st.width <= o.x + o.width + 40) ||
          (o.x >= st.x && o.x + o.width <= st.x + st.width + 40))
    );
    if (!overlaps) out.push(st);
  }
  return out;
}

/**
 * Match inline SVG / icon assets (often used for feature icon rows — missed by <img>-only compare).
 * Uses leaf position + fingerprint; reports missing and misaligned icons for screenshot outlines.
 */
function matchIcons(refIcons, candIcons) {
  const ref = refIcons || [];
  const cand = candIcons || [];
  if (!ref.length && !cand.length) {
    return {
      score: 100,
      missing: [],
      extra: [],
      misaligned: [],
      reflowY: 0,
      pageReflow: false,
      matched: 0,
      refCount: 0,
      candCount: 0
    };
  }
  if (!ref.length) {
    return {
      score: 80,
      missing: [],
      extra: cand.slice(),
      misaligned: [],
      reflowY: 0,
      pageReflow: false,
      matched: 0,
      refCount: 0,
      candCount: cand.length
    };
  }

  const used = new Set();
  let matched = 0;
  const missing = [];
  const alignPairs = [];
  /**
   * Content-row icons: same glyph far down the page is a different section.
   * Footer/chrome icons often reflow 800–1500px when page height drifts — allow more.
   */
  function maxFingerprintY(r, c) {
    const rp = assetMatchPos(r);
    const cp = assetMatchPos(c);
    const ry = rp.y;
    const cy = cp.y;
    if (ry == null || cy == null) return 480;
    // Both in bottom ~20% of a long page → footer chrome (social / brand marks)
    const refBottom = typeof r.pageHeight === 'number' ? r.pageHeight : null;
    const candBottom = typeof c.pageHeight === 'number' ? c.pageHeight : null;
    const ph = Math.max(refBottom || 0, candBottom || 0, Math.max(ry, cy) + 200);
    const bothFooter = ry >= ph * 0.78 && cy >= ph * 0.78;
    if (bothFooter) return 1600;
    // Same relative band of the page (within 10%) even if absolute Y drifted
    const rRel = ry / ph;
    const cRel = cy / ph;
    if (Math.abs(rRel - cRel) <= 0.1) return 1400;
    return 480;
  }

  function isNoiseIcon(r) {
    const rw = r.leafWidth || r.width || 0;
    const rh = r.leafHeight || r.height || 0;
    const parent = String(r.parentText || r.alt || '');
    // Outside icon band should not appear; if they do, ignore
    if (rw > 0 && rh > 0 && !isIconPixelSize(rw, rh)) return true;
    return (
      (rw > 0 && rh > 0 && (rw < ICON_MIN_PX || rh < ICON_MIN_PX)) ||
      (rw <= 28 && rh <= 28 && /^[★☆✦✧*·•\s]+$/.test(parent)) ||
      (rw <= 24 && rh <= 24 && /rating|star/i.test(parent) && parent.length < 40) ||
      // Bare "icon" chrome (social/chevron wrappers) — never useful as content issues
      isGenericIconLabel(parent)
    );
  }

  for (const r of ref) {
    const rw = r.leafWidth || r.width || 0;
    const rh = r.leafHeight || r.height || 0;
    if (isNoiseIcon(r)) {
      matched += 1; // treat as noise match
      continue;
    }
    const rp = assetMatchPos(r);
    let found = -1;
    let how = '';
    // fingerprint (path geometry) — closest Y, with footer-aware Y tolerance
    if (r.fingerprint) {
      found = findClosestByKey(
        cand,
        used,
        (c) => c.fingerprint && c.fingerprint === r.fingerprint,
        r
      );
      if (found >= 0) {
        const cp = assetMatchPos(cand[found]);
        const yTol = maxFingerprintY(r, cand[found]);
        if (rp.y != null && cp.y != null && Math.abs(rp.y - cp.y) > yTol) {
          found = -1; // same glyph, different content section
        } else {
          how = 'fingerprint';
        }
      }
    }
    // same leaf size + similar parent label + nearby Y
    if (found < 0) {
      found = cand.findIndex((c, i) => {
        if (used.has(i)) return false;
        if (isNoiseIcon(c)) return false;
        const sw = Math.abs((c.leafWidth || c.width || 0) - rw) <= 6;
        const sh = Math.abs((c.leafHeight || c.height || 0) - rh) <= 6;
        if (!sw || !sh) return false;
        const cp = assetMatchPos(c);
        const yTol = maxFingerprintY(r, c);
        if (rp.y != null && cp.y != null && Math.abs(rp.y - cp.y) > Math.max(320, yTol)) {
          return false;
        }
        if (r.parentText && c.parentText && r.parentText.length >= 3 && c.parentText.length >= 3) {
          return textSimilarity(r.parentText, c.parentText) >= 0.72;
        }
        if (rw >= 28 && rh >= 28 && rp.y != null && cp.y != null) {
          return Math.abs(rp.y - cp.y) <= 80 && (rp.x == null || cp.x == null || Math.abs(rp.x - cp.x) <= 100);
        }
        return false;
      });
      if (found >= 0) how = 'slot';
    }
    if (found >= 0) {
      used.add(found);
      matched += 1;
      if (how === 'fingerprint' || how === 'slot') {
        alignPairs.push({
          ref: r,
          cand: cand[found],
          how,
          label: (r.parentText || 'icon').slice(0, 60)
        });
      }
    } else {
      missing.push(r);
    }
  }

  // Candidate icons never claimed → extra on candidate
  let extra = [];
  for (let i = 0; i < cand.length; i++) {
    if (used.has(i)) continue;
    if (isNoiseIcon(cand[i])) continue;
    extra.push(cand[i]);
  }

  /**
   * Second pass: reflow pairs — same fingerprint/size/x, large Y only
   * (footer social icons: missing@7478 + extra@6397 for same glyph).
   */
  const stillMissing = [];
  for (const m of missing) {
    const mi = extra.findIndex((e) => {
      if (m.fingerprint && e.fingerprint && m.fingerprint === e.fingerprint) {
        const mp = assetMatchPos(m);
        const ep = assetMatchPos(e);
        if (mp.x != null && ep.x != null && Math.abs(mp.x - ep.x) > 80) return false;
        return true;
      }
      const ms = assetMatchSize(m);
      const es = assetMatchSize(e);
      if (Math.abs(ms.w - es.w) > 4 || Math.abs(ms.h - es.h) > 4) return false;
      const mp = assetMatchPos(m);
      const ep = assetMatchPos(e);
      if (mp.x != null && ep.x != null && Math.abs(mp.x - ep.x) > 48) return false;
      const mt = normalizeContentText(m.parentText || m.alt || '');
      const et = normalizeContentText(e.parentText || e.alt || '');
      if (mt.length >= 4 && et.length >= 4 && textSimilarity(mt, et) >= 0.85) return true;
      // Same column small chrome
      return ms.w <= 56 && ms.h <= 56 && mp.x != null && ep.x != null && Math.abs(mp.x - ep.x) <= 24;
    });
    if (mi >= 0) {
      extra.splice(mi, 1);
      matched += 1;
    } else {
      stillMissing.push(m);
    }
  }

  const score = Math.round((matched / Math.max(ref.length, 1)) * 100);
  const alignFilter = filterLocalMisalignments(alignPairs);
  return {
    score,
    missing: stillMissing,
    extra,
    misaligned: alignFilter.local,
    reflowY: alignFilter.globalOffsetY,
    pageReflow: alignFilter.reflow,
    matched,
    refCount: ref.length,
    candCount: cand.length
  };
}

/**
 * Detect icon/feature rows: containers with several small SVG/icon-like children.
 * Used to flag whole missing icon sections (not only individual glyphs).
 */
function matchIconSections(refSections, candSections) {
  const ref = refSections || [];
  const cand = candSections || [];
  if (!ref.length) {
    return {
      score: cand.length ? 70 : 100,
      missing: [],
      extra: cand.slice(),
      refCount: 0,
      candCount: cand.length,
      missingItems: [],
      reduced: []
    };
  }
  const used = new Set();
  const missing = [];
  const missingItems = [];
  const reduced = []; // same section exists but many fewer icons (e.g. dual product → single)
  let matched = 0;

  for (const r of ref) {
    const label = normalizeContentText(r.label || r.title || '');
    const rItems = r.items || [];
    let found = -1;

    // Prefer match by shared item labels (handles data-URI icon rows with captions)
    if (rItems.length >= 3) {
      let bestIdx = -1;
      let bestHits = 0;
      for (let i = 0; i < cand.length; i++) {
        if (used.has(i)) continue;
        const cItems = cand[i].items || [];
        if (!cItems.length && !cand[i].label) continue;
        let hits = 0;
        for (const ri of rItems) {
          const rt = normalizeContentText(ri.text || '');
          if (rt.length < 3) continue;
          if (
            cItems.some((ci) => textSimilarity(rt, ci.text || '') >= 0.82) ||
            textSimilarity(rt, cand[i].label || '') >= 0.85
          ) {
            hits += 1;
          }
        }
        if (hits > bestHits) {
          bestHits = hits;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestHits >= Math.min(2, rItems.length)) {
        found = bestIdx;
        // Item-level gaps inside a matched row (e.g. Free Rush Delivery missing)
        const cItems = cand[bestIdx].items || [];
        for (const ri of rItems) {
          const rt = normalizeContentText(ri.text || '');
          if (rt.length < 3) continue;
          const ok = cItems.some((ci) => textSimilarity(rt, ci.text || '') >= 0.82);
          if (!ok) {
            missingItems.push({
              text: ri.text,
              x: ri.x,
              y: ri.y,
              width: ri.width,
              height: ri.height,
              pageWidth: ri.pageWidth || r.pageWidth,
              isSectionBox: true,
              rowLabel: r.label
            });
          }
        }
      }
    }

    if (found < 0 && label.length >= 4) {
      found = cand.findIndex(
        (c, i) => !used.has(i) && textSimilarity(label, c.label || c.title || '') >= 0.75
      );
    }
    if (found < 0) {
      found = cand.findIndex((c, i) => {
        if (used.has(i)) return false;
        const iconClose = Math.abs((c.iconCount || 0) - (r.iconCount || 0)) <= 1;
        const yClose =
          typeof r.y === 'number' && typeof c.y === 'number'
            ? Math.abs(r.y - c.y) < 600
            : true;
        const hClose = Math.abs((c.height || 0) - (r.height || 0)) < 120;
        return iconClose && yClose && hClose && (c.iconCount || 0) >= 3;
      });
    }
    if (found >= 0) {
      used.add(found);
      matched += 1;
      const c = cand[found];
      // Same section title but many icons gone (e.g. product grid lost half the cards)
      const rc = r.iconCount || 0;
      const cc = c.iconCount || 0;
      if (rc >= 6 && cc <= rc - 3 && cc < rc * 0.7) {
        reduced.push({
          ...r,
          candIconCount: cc,
          label:
            (r.label || r.title || 'Icon section') +
            ` (icons ${rc} on reference → ${cc} on candidate)`
        });
      }
    } else {
      missing.push(r);
    }
  }

  const extra = [];
  for (let i = 0; i < cand.length; i++) {
    if (!used.has(i)) extra.push(cand[i]);
  }

  const score = Math.round((matched / Math.max(ref.length, 1)) * 100);
  return {
    score,
    missing,
    missingItems,
    reduced,
    extra,
    matched,
    refCount: ref.length,
    candCount: cand.length
  };
}

/**
 * Wait for images (and a soft network quiet period) so screenshots are not blank placeholders.
 */
async function waitForPageAssets(page, label = 'page') {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  } catch (_) {
    /* ignore */
  }

  // Soft network idle — many SPAs never fully idle, so short timeout is fine
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
    vtLog('SETTLE', `${label} networkidle`, 'ok');
  } catch (_) {
    vtLog('SETTLE', `${label} networkidle`, 'timeout (continuing)');
  }

  // Explicit image wait: decode + natural size (skip tiny trackers / data URIs after decode attempt)
  try {
    const imgStats = await page.evaluate(async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const imgs = Array.from(document.images || []);
      let ready = 0;
      let failed = 0;
      await Promise.all(
        imgs.map(async (img) => {
          try {
            if (img.complete && img.naturalWidth > 0) {
              ready += 1;
              return;
            }
            if (typeof img.decode === 'function') {
              await Promise.race([
                img.decode().catch(() => {}),
                delay(4000)
              ]);
            } else {
              await Promise.race([
                new Promise((res) => {
                  img.addEventListener('load', res, { once: true });
                  img.addEventListener('error', res, { once: true });
                }),
                delay(4000)
              ]);
            }
            if (img.naturalWidth > 0) ready += 1;
            else failed += 1;
          } catch {
            failed += 1;
          }
        })
      );
      return { total: imgs.length, ready, failed };
    });
    vtLog(
      'SETTLE',
      `${label} images`,
      `${imgStats.ready}/${imgStats.total} ready · failed/empty=${imgStats.failed}`
    );
  } catch (err) {
    vtLog('SETTLE', `${label} image wait skipped`, err?.message || err);
  }

  // Extra paint settle for late lazy-loaders
  await page.waitForTimeout(600).catch(() => {});
}

/**
 * Prepare a long page for full capture: lazy-load by scrolling, expand height clamps.
 * Many marketing sites use height:100vh / overflow:hidden which breaks Playwright fullPage.
 */
async function preparePageForFullScreenshot(page, label = 'page') {
  try {
    // Scroll through the page so lazy images / sections load (slower so assets can paint)
    await page.evaluate(async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const height = () =>
        Math.max(
          document.body ? document.body.scrollHeight : 0,
          document.documentElement ? document.documentElement.scrollHeight : 0
        );
      let y = 0;
      let guard = 0;
      const step = Math.max(350, Math.floor(window.innerHeight * 0.75));
      while (y < height() && guard < 100) {
        window.scrollTo(0, y);
        await delay(180);
        y += step;
        guard += 1;
      }
      window.scrollTo(0, height());
      await delay(350);
      window.scrollTo(0, 0);
      await delay(250);
    });
  } catch (_) {
    /* non-fatal */
  }

  await waitForPageAssets(page, label);

  try {
    await page.evaluate(() => {
      // Relax common full-viewport clamps that make fullPage = viewport only
      if (!document.querySelector('style[data-visual-twin-shot]')) {
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
      }
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

  // Second short scroll pass after images may have expanded layout
  try {
    await page.evaluate(async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const height = () =>
        Math.max(
          document.body ? document.body.scrollHeight : 0,
          document.documentElement ? document.documentElement.scrollHeight : 0
        );
      let y = 0;
      let guard = 0;
      const step = Math.max(500, Math.floor(window.innerHeight * 0.9));
      while (y < height() && guard < 40) {
        window.scrollTo(0, y);
        await delay(100);
        y += step;
        guard += 1;
      }
      window.scrollTo(0, 0);
      await delay(200);
    });
  } catch (_) {
    /* non-fatal */
  }
}

/**
 * Read PNG IHDR width/height without extra deps (big-endian).
 */
function readPngSize(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch (_) {
    return null;
  }
}

/**
 * Capture full document screenshot with fallbacks when fullPage fails or is too short.
 *
 * IMPORTANT: Playwright `clip` without `fullPage: true` is viewport-relative — a tall clip
 * collapses to ~viewport height. Never use clip alone for "full page". Prefer fullPage.
 */
async function captureFullPageScreenshot(page, filePath, label) {
  await preparePageForFullScreenshot(page, label);
  // Final image settle right before capture
  await waitForPageAssets(page, `${label} pre-shot`);

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

  const viewportH = metrics.innerHeight || metrics.clientHeight || 900;
  vtLog(
    'SCREENSHOT',
    `${label} page metrics`,
    `scrollHeight=${metrics.scrollHeight} · viewport=${viewportH}`
  );

  // Tall marketing pages (e.g. ~16k) must still use fullPage — old 16k cap forced a broken path
  const MAX_FULL_HEIGHT = 28000;
  let used = 'fullPage';

  try {
    if (metrics.scrollHeight > MAX_FULL_HEIGHT) {
      // Still try fullPage first (Playwright handles large docs); on failure fall through
      vtLog(
        'SCREENSHOT',
        `${label} very tall page`,
        `scrollHeight=${metrics.scrollHeight} > ${MAX_FULL_HEIGHT} — trying fullPage anyway`
      );
    }
    await page.screenshot({
      path: filePath,
      fullPage: true,
      animations: 'disabled',
      caret: 'hide'
    });
    used = 'fullPage';
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

  // If we only got ~viewport height but page is much taller, retry fullPage after re-prepare
  try {
    const png = readPngSize(filePath);
    if (png && metrics.scrollHeight > viewportH * 1.5 && png.height <= viewportH + 40) {
      vtLog(
        'SCREENSHOT',
        `${label} short PNG detected`,
        `${png.width}x${png.height} vs scrollHeight=${metrics.scrollHeight} — re-prepare + fullPage`
      );
      await preparePageForFullScreenshot(page, `${label} retry`);
      await page.evaluate(() => {
        // Force layout expand on common SPA shells
        const fix = (el) => {
          if (!el || !el.style) return;
          el.style.setProperty('height', 'auto', 'important');
          el.style.setProperty('max-height', 'none', 'important');
          el.style.setProperty('overflow', 'visible', 'important');
        };
        fix(document.documentElement);
        fix(document.body);
        document.querySelectorAll('main, #__next, #root, .app, [data-reactroot]').forEach(fix);
      });
      await page.screenshot({
        path: filePath,
        fullPage: true,
        animations: 'disabled',
        caret: 'hide'
      });
      used = 'fullPage-retry';
    }
  } catch (retryErr) {
    vtLog('SCREENSHOT', `${label} short-PNG retry skipped`, retryErr?.message || retryErr);
  }

  try {
    const stat = await fs.stat(filePath);
    const png = readPngSize(filePath);
    const dim = png ? `${png.width}x${png.height}` : '?';
    vtLog(
      'SCREENSHOT',
      `${label} saved`,
      `${path.basename(filePath)} · ${Math.round(stat.size / 1024)} KB · ${dim} · mode=${used}`
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

    const pageW = Math.max(
      document.documentElement ? document.documentElement.clientWidth : 0,
      document.documentElement ? document.documentElement.scrollWidth : 0,
      window.innerWidth || 0,
      1
    );

    /** Document-space box for precise screenshot outlines */
    function boxOf(el) {
      const r = el.getBoundingClientRect();
      const sx = window.scrollX || window.pageXOffset || 0;
      const sy = window.scrollY || window.pageYOffset || 0;
      return {
        x: Math.max(0, Math.round(r.left + sx)),
        y: Math.max(0, Math.round(r.top + sy)),
        width: Math.max(8, Math.round(r.width)),
        height: Math.max(16, Math.round(r.height)),
        pageWidth: pageW
      };
    }

    /** Search/drawer/modals often look "missing" on the other site — not product content. */
    function isUiChromeContext(el) {
      let p = el;
      for (let i = 0; i < 10 && p; i++) {
        const cls = String(p.className || p.id || '');
        if (/modal|drawer|dialog|overlay|popup|popover|search-panel|sheet/i.test(cls)) {
          return true;
        }
        try {
          const s = getComputedStyle(p);
          if (s.position === 'fixed') return true;
        } catch (_) {}
        p = p.parentElement;
      }
      return false;
    }

    /**
     * Climb to product card / section container so missing products get a full
     * section highlight (not a 1-line heading box). Skip search UI chrome.
     */
    function sectionBoxOf(el) {
      if (!el || !el.getBoundingClientRect) return boxOf(el);
      const leaf = boxOf(el);
      // Never expand tiny UI labels / fixed search panels into huge "section" boxes
      if (isUiChromeContext(el)) {
        return { ...leaf, isSection: false, uiChrome: true };
      }
      const elR = el.getBoundingClientRect();
      const pageH = Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0,
        1
      );

      const sel =
        el.closest(
          [
            '[class*="product"]',
            '[class*="Product"]',
            '[data-product]',
            '[class*="card"]',
            '[class*="Card"]',
            'article',
            'section',
            'li.product',
            '[class*="tile"]',
            '[class*="item-card"]',
            '[class*="grid"] > div',
            '[class*="grid"] > article'
          ].join(',')
        ) || null;

      let best = sel && visible(sel) ? sel : null;
      if (best) {
        const br = best.getBoundingClientRect();
        // Reject near full-page wrappers and fixed chrome
        if (br.height > pageH * 0.45 || br.width > pageW * 0.98 || isUiChromeContext(best)) {
          best = null;
        }
      }

      if (!best) {
        let p = el.parentElement;
        let guard = 0;
        while (p && p !== document.body && p !== document.documentElement && guard++ < 10) {
          if (!visible(p) || isUiChromeContext(p)) {
            p = p.parentElement;
            continue;
          }
          const r = p.getBoundingClientRect();
          if (
            r.height >= Math.max(140, elR.height * 2.5) &&
            r.height < Math.min(1200, pageH * 0.4) &&
            r.width >= Math.max(160, elR.width * 0.85) &&
            r.width <= pageW * 0.95
          ) {
            best = p;
            break;
          }
          p = p.parentElement;
        }
      }

      const box = boxOf(best || el);
      // Prefer section when it is meaningfully larger than the leaf element
      if (box.height >= leaf.height * 1.8 && box.height >= 120 && box.height <= 1100) {
        return { ...box, isSection: true };
      }
      return { ...leaf, isSection: false };
    }

    function pageY(el) {
      return boxOf(el).y;
    }

    /** Search-UI / chrome labels — not product content (common false "missing H3") */
    function isSearchChromeText(text) {
      const t = String(text || '').toLowerCase();
      return /popular search|recent search|suggested search|search result|trending search|quick link/.test(
        t
      );
    }

    /**
     * Collect visible elements with leaf + optional section boxes for highlights.
     * @param {string} sel
     * @param {number} max
     * @param {{ leafOnly?: boolean }} [opts] leafOnly=true → never expand to product card
     *   (paragraphs must outline only the <p> text, not the whole section).
     */
    function textItems(sel, max, opts = {}) {
      const leafOnly = !!opts.leafOnly;
      return Array.from(document.querySelectorAll(sel))
        .filter(visible)
        .map((el) => {
          const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          const leaf = boxOf(el);
          const sec = leafOnly ? null : sectionBoxOf(el);
          const uiChrome = !!(sec && sec.uiChrome) || isUiChromeContext(el) || isSearchChromeText(text);
          // Headings may expand to product cards; paragraphs stay on the leaf <p> only
          const useSec = !leafOnly && !!sec && !!sec.isSection && !uiChrome;
          return {
            text,
            x: useSec ? sec.x : leaf.x,
            y: useSec ? sec.y : leaf.y,
            width: useSec ? sec.width : leaf.width,
            height: useSec ? sec.height : leaf.height,
            pageWidth: leaf.pageWidth,
            isSectionBox: useSec,
            uiChrome,
            leafX: leaf.x,
            leafY: leaf.y,
            leafWidth: leaf.width,
            leafHeight: leaf.height
          };
        })
        .filter((t) => t.text.length > 0)
        .filter((t) => !t.uiChrome) // do not compare search-panel / fixed-drawer chrome
        .slice(0, max || 50);
    }

    const title = (document.title || '').trim();
    const headings = {
      h1: textItems('h1', 80),
      h2: textItems('h2', 120),
      h3: textItems('h3', 120),
      h4: textItems('h4', 80),
      h5: textItems('h5', 60),
      h6: textItems('h6', 40)
    };
    // Paragraphs: leaf geometry only so “Paragraph missing” draws on the text block alone
    const paragraphs = textItems('p', 200, { leafOnly: true }).filter((t) => t.text.length >= 12);
    const listItems = textItems('li', 150).filter((t) => t.text.length >= 8);

    // Semantic header/footer OR common class/id patterns (clones often omit <header>)
    // IMPORTANT: never take the first DOM match — mid-page [class*="Header"] blocks
    // (brand strips) cause false "Header position differs" (ref y=1200+ vs cand y=96).
    function pickRegion(selectors, preferTop) {
      const pageHLocal = Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0,
        1
      );
      const matched = [];
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (el && visible(el)) matched.push(el);
        }
      }
      if (matched.length) {
        if (preferTop) {
          let best = null;
          let bestScore = -Infinity;
          for (const el of matched) {
            const b = boxOf(el);
            const r = el.getBoundingClientRect();
            let pos = 'static';
            try {
              pos = getComputedStyle(el).position || 'static';
            } catch (_) {}
            const sticky = pos === 'fixed' || pos === 'sticky';
            // Reject deep mid-page "headers" (false positives for position compare)
            if (!sticky && b.y > Math.max(320, pageHLocal * 0.12)) continue;
            if (b.height > 320 && !sticky) continue;
            // Prefer sticky/fixed near viewport top, else lowest document Y
            let sc = 0;
            if (sticky && r.top >= -20 && r.top < 160) sc += 500 - r.top;
            sc += 400 - Math.min(400, b.y);
            sc += Math.min(100, (el.querySelectorAll('a').length || 0) * 5);
            if (sc > bestScore) {
              bestScore = sc;
              best = el;
            }
          }
          if (best) return best;
          // No plausible top header among selectors — fall through to heuristic
        } else {
          // Footer: bottom-most match
          let best = null;
          let bestY = -1;
          for (const el of matched) {
            const b = boxOf(el);
            if (b.y > bestY) {
              bestY = b.y;
              best = el;
            }
          }
          if (best) return best;
        }
      }
      // Heuristic: tall top/bottom bar with links
      const candidates = Array.from(
        document.querySelectorAll('div, section, aside')
      ).filter(visible);
      let best = null;
      let bestScore = 0;
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width < pageW * 0.5) continue;
        const links = el.querySelectorAll('a').length;
        if (links < 2) continue;
        if (preferTop) {
          if (r.top > 200 || r.height > 280 || r.height < 32) continue;
          const docY = r.top + (window.scrollY || 0);
          if (docY > Math.max(280, pageHLocal * 0.1)) continue;
          const sc = links * 2 + r.width / 100;
          if (sc > bestScore) {
            bestScore = sc;
            best = el;
          }
        } else {
          const y = r.top + (window.scrollY || 0);
          if (y < pageHLocal * 0.55 || r.height < 40) continue;
          const sc = links + r.height / 50;
          if (sc > bestScore) {
            bestScore = sc;
            best = el;
          }
        }
      }
      return best;
    }

    const headerEl =
      pickRegion(
        [
          'header',
          '[role="banner"]',
          '#header',
          '.header',
          '.site-header',
          '.main-header',
          '[class*="Header"]',
          '[class*="navbar"]',
          'nav.navbar'
        ],
        true
      ) || null;
    const footerEl =
      pickRegion(
        [
          'footer',
          '[role="contentinfo"]',
          '#footer',
          '.footer',
          '.site-footer',
          '[class*="Footer"]'
        ],
        false
      ) || null;
    const navEls = Array.from(
      document.querySelectorAll('nav, [role="navigation"]')
    ).filter(visible);
    const navText = navEls
      .map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' | ')
      .slice(0, 3000);
    // Top-of-page chrome text even without <nav> (menus in divs)
    const topChromeText = (() => {
      if (headerEl) return (headerEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
      const topLinks = Array.from(document.querySelectorAll('a'))
        .filter(visible)
        .filter((a) => {
          const r = a.getBoundingClientRect();
          return r.top >= 0 && r.top < 160 && r.width > 0;
        })
        .map((a) => (a.innerText || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t.length >= 2 && t.length <= 40)
        .slice(0, 40);
      return topLinks.join(' ');
    })();

    const headerBox = headerEl ? boxOf(headerEl) : null;
    const footerBox = footerEl ? boxOf(footerEl) : null;
    const navBox = navEls[0] ? boxOf(navEls[0]) : null;
    const headerY = headerBox ? headerBox.y : null;
    const headerH = headerBox ? headerBox.height : null;
    const footerY = footerBox ? footerBox.y : null;
    const footerH = footerBox ? footerBox.height : null;
    const navY = navBox ? navBox.y : null;
    const navH = navBox ? navBox.height : null;

    const noiseCta = /^(×|x|close|dismiss|accept|accept all|reject|ok|got it|cookie|privacy|skip|next|prev|previous|play|pause|share|cancel|open search)$/i;
    const ctas = Array.from(
      document.querySelectorAll(
        'a, button, [role="button"], input[type="submit"], input[type="button"]'
      )
    )
      .filter(visible)
      .filter((el) => !isUiChromeContext(el)) // skip fixed search drawer / modal chips
      .map((el) => {
        const b = boxOf(el);
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim();
        return {
          text,
          x: b.x,
          y: b.y,
          width: b.width,
          height: Math.max(16, b.height),
          pageWidth: b.pageWidth,
          isSectionBox: false
        };
      })
      .filter((t) => t.text.length >= 2 && t.text.length <= 60)
      .filter((t) => !noiseCta.test(t.text))
      .filter((t) => !/cookie|consent|newsletter/i.test(t.text))
      .slice(0, 120);

    const images = Array.from(document.querySelectorAll('img'))
      .filter(visible)
      .map((img) => {
        const src = img.currentSrc || img.src || img.getAttribute('src') || '';
        let pathOnly = src;
        try {
          if (src.startsWith('data:')) {
            // Keep a short stable key for data URIs (many icon/logo tiles use data:)
            pathOnly = 'data:' + (src.slice(0, 80).split(';')[0] || 'image') + (src.length > 80 ? `:${src.length}` : '');
          } else {
            const u = new URL(src, location.href);
            pathOnly = u.pathname;
          }
        } catch (_) {}
        const leaf = boxOf(img);
        const sec = sectionBoxOf(img);
        return {
          srcPath: pathOnly,
          basename: pathOnly.split('/').pop() || pathOnly,
          alt: (img.getAttribute('alt') || '').trim(),
          // Section box kept for product-card context; matching always uses leaf*
          width: sec.width,
          height: sec.height,
          x: sec.x,
          y: sec.y,
          pageWidth: sec.pageWidth,
          isSectionBox: !!sec.isSection,
          leafX: leaf.x,
          leafY: leaf.y,
          leafWidth: leaf.width,
          leafHeight: leaf.height,
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
          isData: src.startsWith('data:')
        };
      })
      .filter((i) => i.srcPath)
      .slice(0, 250);

    // Inline SVG icons only (16–96px). Smaller = noise; larger = illustration/hero SVG.
    const ICON_MIN = 16;
    const ICON_MAX = 96;
    const icons = Array.from(document.querySelectorAll('svg'))
      .filter(visible)
      .map((svg) => {
        const leaf = boxOf(svg);
        if (leaf.width < ICON_MIN || leaf.height < ICON_MIN) return null;
        if (leaf.width > ICON_MAX || leaf.height > ICON_MAX) return null;
        const paths = Array.from(svg.querySelectorAll('path'))
          .slice(0, 6)
          .map((p) => (p.getAttribute('d') || '').slice(0, 64))
          .join('|');
        const fingerprint =
          paths ||
          `${svg.getAttribute('viewBox') || ''}:${leaf.width}x${leaf.height}`;
        const parentText = (svg.closest('a,button,li,div,span')?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60);
        return {
          kind: 'svg',
          fingerprint: fingerprint.slice(0, 280),
          parentText,
          // Always leaf geometry so missing icons get a tight red box on the screenshot
          x: leaf.x,
          y: leaf.y,
          width: leaf.width,
          height: leaf.height,
          pageWidth: leaf.pageWidth,
          leafX: leaf.x,
          leafY: leaf.y,
          leafWidth: leaf.width,
          leafHeight: leaf.height,
          isSectionBox: false
        };
      })
      .filter(Boolean)
      .slice(0, 200);

    // Data-URI icon/logo tiles in the same 16–96px band
    for (const img of images) {
      if (!img.isData) continue;
      const s = { w: img.leafWidth || 0, h: img.leafHeight || 0 };
      if (s.w < ICON_MIN || s.h < ICON_MIN || s.w > ICON_MAX || s.h > ICON_MAX) continue;
      icons.push({
        kind: 'img-icon',
        fingerprint: `dataimg:${img.basename || ''}:${s.w}x${s.h}:${img.alt || ''}`.slice(0, 200),
        parentText: (img.alt || 'icon').slice(0, 60),
        x: img.leafX,
        y: img.leafY,
        width: s.w,
        height: s.h,
        pageWidth: img.pageWidth,
        leafX: img.leafX,
        leafY: img.leafY,
        leafWidth: s.w,
        leafHeight: s.h,
        isSectionBox: false,
        basename: img.basename,
        alt: img.alt,
        isData: true
      });
    }

    // Icon-sized <img> for feature rows (same 16–96px band)
    function isIconSizedImg(img) {
      if (!visible(img)) return false;
      const br = img.getBoundingClientRect();
      return (
        br.width >= ICON_MIN &&
        br.width <= ICON_MAX &&
        br.height >= ICON_MIN &&
        br.height <= ICON_MAX
      );
    }

    /**
     * Feature icon rows: 3–8 sibling cells each with icon (svg/img/data-uri) + caption.
     * Example: Prescription Medication | Free Rush Delivery | U.S. Doctors | Improved Energy
     */
    const iconSections = [];
    const rowCandidates = Array.from(
      document.querySelectorAll('section, article, div, ul, ol')
    ).filter(visible);
    for (const el of rowCandidates) {
      if (isUiChromeContext(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 280 || r.height < 50 || r.height > 900) continue;

      const kids = Array.from(el.children);
      if (kids.length >= 3 && kids.length <= 8) {
        const items = [];
        let ok = true;
        for (const ch of kids) {
          if (!visible(ch)) {
            ok = false;
            break;
          }
          const cr = ch.getBoundingClientRect();
          if (cr.width < 60 || cr.height < 40 || cr.height > 360) {
            ok = false;
            break;
          }
          const hasIcon =
            !!ch.querySelector('svg') ||
            Array.from(ch.querySelectorAll('img')).some(isIconSizedImg);
          if (!hasIcon) {
            ok = false;
            break;
          }
          const text = (ch.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          if (!text || text.length < 3) {
            ok = false;
            break;
          }
          const cb = boxOf(ch);
          // Prefer tight icon leaf for red box; fall back to cell
          const iconEl =
            ch.querySelector('svg') ||
            Array.from(ch.querySelectorAll('img')).find(isIconSizedImg) ||
            null;
          const leaf = iconEl ? boxOf(iconEl) : cb;
          let imgBase = '';
          let imgAlt = '';
          if (iconEl && iconEl.tagName === 'IMG') {
            imgAlt = (iconEl.getAttribute('alt') || '').trim();
            try {
              const src = iconEl.currentSrc || iconEl.src || '';
              if (src && !src.startsWith('data:')) {
                imgBase = new URL(src, location.href).pathname.split('/').pop() || '';
              }
            } catch (_) {}
          }
          items.push({
            text,
            x: leaf.x,
            y: leaf.y,
            width: leaf.width,
            height: leaf.height,
            pageWidth: leaf.pageWidth,
            cellX: cb.x,
            cellY: cb.y,
            cellWidth: cb.width,
            cellHeight: cb.height,
            basename: imgBase,
            alt: imgAlt,
            kind: iconEl && iconEl.tagName === 'IMG' ? 'img' : 'svg'
          });
        }
        if (ok && items.length >= 3) {
          const b = boxOf(el);
          iconSections.push({
            kind: 'feature-row',
            label: items.map((i) => i.text).join(' · ').slice(0, 140),
            title: '',
            items,
            iconCount: items.length,
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            pageWidth: b.pageWidth,
            isSectionBox: true
          });
          continue;
        }
      }

      // Fallback: container with several small icons (inline SVG or icon-sized imgs incl. data:)
      const smallSvg = Array.from(el.querySelectorAll('svg')).filter((svg) => {
        if (!visible(svg)) return false;
        const br = svg.getBoundingClientRect();
        return (
          br.width >= ICON_MIN &&
          br.width <= ICON_MAX &&
          br.height >= ICON_MIN &&
          br.height <= ICON_MAX
        );
      });
      const smallImg = Array.from(el.querySelectorAll('img')).filter(isIconSizedImg);
      const iconCount = smallSvg.length + smallImg.length;
      if (iconCount < 3) continue;
      const titleEl = el.querySelector('h1,h2,h3,h4,h5');
      const label = (
        (titleEl && (titleEl.innerText || '')) ||
        el.getAttribute('aria-label') ||
        Array.from(el.querySelectorAll('p,span,a,h6'))
          .map((t) => (t.innerText || '').replace(/\s+/g, ' ').trim())
          .filter((t) => t.length > 2 && t.length < 48)
          .slice(0, 8)
          .join(' · ')
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      // Per-icon leaf boxes so extra sections can highlight each glyph/image on candidate
      const blockItems = [];
      for (const svg of smallSvg.slice(0, 24)) {
        const lb = boxOf(svg);
        const parentText = (svg.closest('a,button,li,div,span')?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60);
        blockItems.push({
          text: parentText || 'icon',
          x: lb.x,
          y: lb.y,
          width: lb.width,
          height: lb.height,
          pageWidth: lb.pageWidth,
          kind: 'svg'
        });
      }
      for (const im of smallImg.slice(0, 24)) {
        const lb = boxOf(im);
        const alt = (im.getAttribute('alt') || '').trim();
        const src = im.currentSrc || im.src || '';
        let base = '';
        try {
          base = src.startsWith('data:') ? '' : new URL(src, location.href).pathname.split('/').pop() || '';
        } catch (_) {}
        blockItems.push({
          text: alt || base || 'image',
          x: lb.x,
          y: lb.y,
          width: lb.width,
          height: lb.height,
          pageWidth: lb.pageWidth,
          kind: 'img',
          basename: base,
          alt
        });
      }
      const b = boxOf(el);
      iconSections.push({
        kind: 'icon-block',
        label: label || `icon-row@${b.y}`,
        title: titleEl ? (titleEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) : '',
        items: blockItems,
        iconCount,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        pageWidth: b.pageWidth,
        isSectionBox: true
      });
    }
    // Dedupe overlapping icon sections (prefer feature-rows with labels, then denser)
    iconSections.sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      const ap = a.kind === 'feature-row' ? 1 : 0;
      const bp = b.kind === 'feature-row' ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return b.iconCount - a.iconCount;
    });
    const dedupedIconSections = [];
    for (const s of iconSections) {
      const prev = dedupedIconSections[dedupedIconSections.length - 1];
      if (prev && Math.abs(prev.y - s.y) < 70) {
        const prevScore =
          (prev.kind === 'feature-row' ? 100 : 0) + (prev.items?.length || 0) * 10 + prev.iconCount;
        const sScore =
          (s.kind === 'feature-row' ? 100 : 0) + (s.items?.length || 0) * 10 + s.iconCount;
        if (sScore > prevScore) dedupedIconSections[dedupedIconSections.length - 1] = s;
      } else {
        dedupedIconSections.push(s);
      }
    }

    return {
      title,
      headings,
      paragraphs,
      listItems,
      ctas,
      headerText: headerEl
        ? (headerEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2000)
        : topChromeText,
      footerText: footerEl ? (footerEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2000) : '',
      navText: navText || topChromeText,
      topChromeText,
      headerY,
      headerH,
      headerX: headerBox ? headerBox.x : null,
      headerW: headerBox ? headerBox.width : null,
      footerY,
      footerH,
      footerX: footerBox ? footerBox.x : null,
      footerW: footerBox ? footerBox.width : null,
      navY,
      navH,
      navX: navBox ? navBox.x : null,
      navW: navBox ? navBox.width : null,
      // True semantic tag OR heuristic region — used for soft presence checks
      hasHeader: Boolean(headerEl) || Boolean(topChromeText && topChromeText.length > 20),
      hasFooter: Boolean(footerEl),
      hasNav: navEls.length > 0 || Boolean(topChromeText && topChromeText.length > 15),
      hasSemanticHeader: Boolean(
        document.querySelector('header, [role="banner"]')
      ),
      hasSemanticFooter: Boolean(
        document.querySelector('footer, [role="contentinfo"]')
      ),
      images,
      icons,
      iconSections: dedupedIconSections.slice(0, 40),
      bodyTextLength: (document.body && document.body.innerText ? document.body.innerText : '').trim().length,
      scrollWidth: document.documentElement.scrollWidth || 0,
      clientWidth: document.documentElement.clientWidth || 0,
      pageWidth: pageW,
      scrollHeight: Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0
      )
    };
  });
}

/** Normalize heading/paragraph/cta lists to { text, x, y, width, height } (supports legacy strings). */
function toItems(list) {
  return (list || [])
    .map((item) => {
      if (item == null) return null;
      if (typeof item === 'string') {
        return {
          text: item,
          x: null,
          y: null,
          width: null,
          height: 36,
          pageWidth: null,
          isSectionBox: false
        };
      }
      const text = String(item.text || item.alt || item.details || '').trim();
      if (!text && !item.srcPath) return null;
      const leafX = typeof item.leafX === 'number' ? item.leafX : null;
      const leafY = typeof item.leafY === 'number' ? item.leafY : null;
      const leafW = typeof item.leafWidth === 'number' ? item.leafWidth : null;
      const leafH = typeof item.leafHeight === 'number' ? item.leafHeight : null;
      return {
        text: text || (typeof basenameKey === 'function' ? basenameKey(item) : '') || 'item',
        x: typeof item.x === 'number' ? item.x : null,
        y: typeof item.y === 'number' ? item.y : null,
        width: typeof item.width === 'number' ? item.width : null,
        height: typeof item.height === 'number' ? item.height : 36,
        pageWidth: typeof item.pageWidth === 'number' ? item.pageWidth : null,
        isSectionBox: !!item.isSectionBox,
        leafX,
        leafY,
        leafWidth: leafW,
        leafHeight: leafH
      };
    })
    .filter(Boolean);
}

function compareHeadingLevel(refList, candList, level) {
  // Legacy per-level compare (text-only within level). Prefer compareHeadingsCrossLevel.
  const diffs = [];
  const refItems = toItems(refList);
  const candItems = toItems(candList);
  const refN = refItems.map((i) => normalizeHeadingText(i.text)).filter(Boolean);
  const candN = candItems.map((i) => normalizeHeadingText(i.text)).filter(Boolean);
  const score = jaccard(refN, candN);

  for (const item of refItems) {
    const n = normalizeHeadingText(item.text);
    if (n && !candN.includes(n)) {
      diffs.push({
        kind: 'missing_on_candidate',
        level,
        text: item.text.slice(0, 200),
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        pageWidth: item.pageWidth,
        side: 'reference'
      });
    }
  }
  for (const item of candItems) {
    const n = normalizeHeadingText(item.text);
    if (n && !refN.includes(n)) {
      diffs.push({
        kind: 'extra_on_candidate',
        level,
        text: item.text.slice(0, 200),
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        pageWidth: item.pageWidth,
        side: 'candidate'
      });
    }
  }

  return {
    level,
    refCount: refN.length,
    candidateCount: candN.length,
    score: Math.round(score * 100),
    diffs: diffs.slice(0, 40)
  };
}

/**
 * Match headings by visible text across H1–H6.
 * Same words with a different tag (e.g. H2 on ref, H5 on cand) is NOT "missing" —
 * it's a level remap (common on clones) and is not reported as a content issue.
 */
function compareHeadingsCrossLevel(refHeadings, candHeadings) {
  const levels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const flatten = (headings) => {
    const out = [];
    for (const level of levels) {
      for (const item of toItems(headings?.[level])) {
        const norm = normalizeHeadingText(item.text);
        if (!norm) continue;
        out.push({ ...item, level, norm });
      }
    }
    return out;
  };

  const refItems = flatten(refHeadings);
  const candItems = flatten(candHeadings);
  const usedCand = new Set();
  const usedRef = new Set();
  const levelRemaps = [];
  const diffs = [];

  // Pass 1 — same text + same level
  for (let i = 0; i < refItems.length; i++) {
    const r = refItems[i];
    const j = candItems.findIndex(
      (c, idx) => !usedCand.has(idx) && c.norm === r.norm && c.level === r.level
    );
    if (j >= 0) {
      usedCand.add(j);
      usedRef.add(i);
    }
  }

  // Pass 2 — same text, any level (visual twin still has the heading)
  for (let i = 0; i < refItems.length; i++) {
    if (usedRef.has(i)) continue;
    const r = refItems[i];
    const j = candItems.findIndex((c, idx) => !usedCand.has(idx) && c.norm === r.norm);
    if (j >= 0) {
      usedCand.add(j);
      usedRef.add(i);
      levelRemaps.push({
        text: r.text.slice(0, 200),
        refLevel: r.level,
        candLevel: candItems[j].level
      });
    }
  }

  // Pass 2b — near-duplicate text any level (punctuation / tiny CMS drift)
  for (let i = 0; i < refItems.length; i++) {
    if (usedRef.has(i)) continue;
    const r = refItems[i];
    let best = -1;
    let bestSim = 0;
    for (let j = 0; j < candItems.length; j++) {
      if (usedCand.has(j)) continue;
      const sim = textSimilarity(r.text, candItems[j].text);
      if (sim > bestSim) {
        bestSim = sim;
        best = j;
      }
    }
    if (best >= 0 && bestSim >= 0.92) {
      usedCand.add(best);
      usedRef.add(i);
      if (candItems[best].level !== r.level) {
        levelRemaps.push({
          text: r.text.slice(0, 200),
          refLevel: r.level,
          candLevel: candItems[best].level
        });
      }
    }
  }

  // Pass 3 — truly missing on candidate
  for (let i = 0; i < refItems.length; i++) {
    if (usedRef.has(i)) continue;
    const r = refItems[i];
    diffs.push({
      kind: 'missing_on_candidate',
      level: r.level,
      text: r.text.slice(0, 200),
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      pageWidth: r.pageWidth,
      isSectionBox: !!r.isSectionBox,
      side: 'reference'
    });
  }

  // Pass 4 — truly extra on candidate (not a remap of a ref heading)
  for (let j = 0; j < candItems.length; j++) {
    if (usedCand.has(j)) continue;
    const c = candItems[j];
    diffs.push({
      kind: 'extra_on_candidate',
      level: c.level,
      text: c.text.slice(0, 200),
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
      pageWidth: c.pageWidth,
      isSectionBox: !!c.isSectionBox,
      side: 'candidate'
    });
  }

  const matched = usedRef.size;
  const denom = Math.max(refItems.length, candItems.length, 1);
  const score = Math.round((matched / denom) * 100);

  const headingReports = levels.map((level) => {
    const refCount = refItems.filter((i) => i.level === level).length;
    const candidateCount = candItems.filter((i) => i.level === level).length;
    const levelDiffs = diffs.filter((d) => d.level === level).slice(0, 40);
    // Per-level score: text presence regardless of tag (cross-level)
    const refNorms = refItems.filter((i) => i.level === level).map((i) => i.norm);
    let hit = 0;
    for (const n of refNorms) {
      if (candItems.some((c) => c.norm === n)) hit += 1;
    }
    const levelScore =
      !refNorms.length && !candidateCount
        ? 100
        : !refNorms.length
          ? candidateCount
            ? 50
            : 100
          : Math.round((hit / refNorms.length) * 100);
    return {
      level,
      refCount,
      candidateCount,
      score: levelScore,
      diffs: levelDiffs
    };
  });

  return {
    score,
    diffs: diffs.slice(0, 40),
    levelRemaps,
    headingReports,
    refCount: refItems.length,
    candCount: candItems.length
  };
}

function findItemByText(list, text) {
  const n = normalizeHeadingText(text);
  return toItems(list).find((i) => normalizeHeadingText(i.text) === n) || null;
}

function basenameKey(img) {
  if (!img) return '';
  if (img.isData || String(img.srcPath || '').startsWith('data:')) return '';
  let b = img.basename || (img.srcPath || '').split('/').pop() || '';
  b = String(b).split('?')[0].split('#')[0];
  try {
    b = decodeURIComponent(b).toLowerCase();
  } catch {
    b = String(b).toLowerCase();
  }
  // Generic CMS names are useless for identity (caused missing+extra doubles)
  if (!b || /^(img|image|photo|file|asset|untitled|media|download)$/i.test(b)) return '';
  return b;
}

/**
 * CDN / Vite / Webpack often bake content hashes into filenames:
 *   dr.5073929cd381e947af7c.webp  →  dr.webp
 *   men-bag.039d5fb33d5f7c7a8fe7.webp → men-bag.webp
 * Exact basename match then falsely reports "missing" when the same photo was re-hashed.
 */
function stripContentHashFromFilename(name) {
  let b = String(name || '').toLowerCase();
  // name.HASH.ext
  b = b.replace(/\.([a-f0-9]{8,24})\.(webp|png|jpe?g|gif|avif|svg)$/i, '.$2');
  // name-HASH.ext or name_HASH.ext
  b = b.replace(/[-_]([a-f0-9]{8,24})(?=\.(webp|png|jpe?g|gif|avif|svg)$)/i, '');
  return b;
}

function isContentHashedFilename(name) {
  const b = String(name || '').toLowerCase();
  return (
    /\.[a-f0-9]{8,24}\.(webp|png|jpe?g|gif|avif|svg)$/i.test(b) ||
    /[-_][a-f0-9]{8,24}\.(webp|png|jpe?g|gif|avif|svg)$/i.test(b)
  );
}

/** Stable stem for matching across deploys (hash stripped). Empty if too weak. */
function stemBasenameKey(img) {
  const raw = basenameKey(img);
  if (!raw) return '';
  const stem = stripContentHashFromFilename(raw);
  if (!stem || stem === raw && isContentHashedFilename(raw)) return '';
  const noExt = stem.replace(/\.[a-z0-9]+$/i, '');
  // Too short stems ("dr", "img2") collide across different photos
  if (!noExt || noExt.length < 3) return '';
  if (/^(img|image|photo|file|asset|media|pic|thumb)$/i.test(noExt)) return '';
  return stem;
}

/**
 * True when filename is a stable identity we can trust alone.
 * Hashed CDN names are NOT strong — same image often changes hash between environments.
 */
function isStrongImageBasename(img) {
  const base = basenameKey(img);
  if (!base) return false;
  if (isContentHashedFilename(base)) return false;
  const stem = stemBasenameKey(img);
  if (!stem) return false;
  const noExt = stem.replace(/\.[a-z0-9]+$/i, '');
  return noExt.length >= 4;
}

/**
 * Collapse near-duplicate raw issues (same side + same media noise family + same Y band).
 * NEVER drops named missing images/icons/logos — those must stay highlighted on the screenshot.
 */
function dedupeRawIssues(issues) {
  const list = (issues || []).slice();
  const drop = new Set();

  function yBand(iss) {
    return typeof iss.y === 'number' ? Math.round(iss.y / 120) * 120 : null;
  }

  /** Pinpoint asset issues that must never be swallowed by section incomplete flags */
  function isProtectedAsset(iss) {
    const t = String(iss.type || '');
    return /^(image missing|image extra|logo|icon missing|icon extra|icon misaligned|logo misaligned|feature icon missing)/i.test(
      t
    );
  }

  /** Low-value media noise (aggregates / generic clusters only) */
  function isMediaNoise(iss) {
    if (isProtectedAsset(iss)) return false;
    const t = String(iss.type || '');
    const d = String(iss.details || '');
    if (/^images missing on candidate$|^images extra on candidate$/i.test(t)) return true;
    if (/icon \/ image section missing/i.test(t) && /icons missing near|near [“"]icons/i.test(d)) {
      return true;
    }
    if (/icon cluster/i.test(t)) return true;
    return false;
  }

  function isSectionLevel(iss) {
    const t = String(iss.type || '');
    return /product \/ section|icon \/ image section incomplete|icon \/ image section missing|image section (extra|missing)|h[1-6] missing|h[1-6] extra/i.test(
      t
    );
  }

  const priority = (iss) => {
    const t = String(iss.type || '');
    if (/product \/ section|h1 missing|h2 missing/i.test(t)) return 100;
    if (/icon \/ image section incomplete/i.test(t)) return 90;
    if (/icon \/ image section missing/i.test(t) && !/icons missing near/i.test(iss.details || '')) {
      return 85;
    }
    if (/feature icon missing|icon missing|logo/i.test(t)) return 80;
    if (/image section extra|image section missing/i.test(t)) return 70;
    if (/image missing|image extra|misaligned/i.test(t)) return 65;
    if (/icons missing near|icon cluster/i.test(t) || /near [“"]icons/i.test(iss.details || '')) {
      return 20;
    }
    return 50;
  };

  for (let i = 0; i < list.length; i++) {
    if (drop.has(i)) continue;
    const a = list[i];
    const ya = yBand(a);
    if (ya == null) continue;
    for (let j = i + 1; j < list.length; j++) {
      if (drop.has(j)) continue;
      const b = list[j];
      const yb = yBand(b);
      if (yb == null || Math.abs(ya - yb) > 140) continue;

      const sa = a.side || '';
      const sb = b.side || '';
      if (sa && sb && sa !== sb) continue;

      // Always keep individual asset outlines
      if (isProtectedAsset(a) || isProtectedAsset(b)) {
        // Only collapse exact same type+details
        if (String(a.type) === String(b.type) && String(a.details || '') === String(b.details || '')) {
          drop.add(j);
        }
        continue;
      }

      const aSec = isSectionLevel(a);
      const bSec = isSectionLevel(b);
      const aNoise = isMediaNoise(a);
      const bNoise = isMediaNoise(b);
      if (aSec && bSec && !aNoise && !bNoise) {
        if (String(a.type) !== String(b.type)) continue;
      } else if (!(aNoise || bNoise)) {
        continue;
      }

      if (aSec && bNoise && !bSec) {
        drop.add(j);
        continue;
      }
      if (bSec && aNoise && !aSec) {
        drop.add(i);
        continue;
      }

      const pa = priority(a);
      const pb = priority(b);
      if (pa === pb) {
        if (String(a.details || '').length >= String(b.details || '').length) drop.add(j);
        else drop.add(i);
      } else if (pa > pb) drop.add(j);
      else drop.add(i);
    }
  }

  return list.filter((_, idx) => !drop.has(idx));
}

function compareSnapshots(ref, cand) {
  const issues = [];
  const parts = [];
  const refPageH = Math.max(1, ref.scrollHeight || 0);
  const candPageH = Math.max(1, cand.scrollHeight || 0);

  /** Attach highlight coords for report overlay (y as % of full-page screenshot). */
  const refPageW = Math.max(1, ref.pageWidth || ref.clientWidth || 1440);
  const candPageW = Math.max(1, cand.pageWidth || cand.clientWidth || 1440);

  function mark(issue, { side, x, y, width, height, pageHeight, pageWidth, isSectionBox } = {}) {
    const out = { ...issue };
    if (side) out.side = side;
    if (isSectionBox || issue.isSectionBox) out.isSectionBox = true;
    const ph = Math.max(1, pageHeight || (side === 'candidate' ? candPageH : refPageH));
    const pw = Math.max(1, pageWidth || (side === 'candidate' ? candPageW : refPageW));
    if (typeof y === 'number' && y >= 0) {
      out.y = Math.round(y);
      out.pageHeight = ph;
      out.topPct = Math.min(99.5, Math.max(0, (y / ph) * 100));
      let h = Math.max(16, height || 40);
      if (out.isSectionBox) h = Math.min(h, Math.round(ph * 0.35));
      out.height = h;
      const minPct = out.isSectionBox ? 1.2 : 0.15;
      out.heightPct = Math.min(35, Math.max(minPct, (h / ph) * 100));
    }
    if (typeof x === 'number' && x >= 0) {
      out.x = Math.round(x);
      out.pageWidth = pw;
      out.leftPct = Math.min(98, Math.max(0, (x / pw) * 100));
      let w = Math.max(12, width || 40);
      if (out.isSectionBox) w = Math.min(w, Math.round(pw * 0.98));
      out.width = w;
      out.widthPct = Math.min(100, Math.max(0.5, (w / pw) * 100));
    }
    return out;
  }

  vtSection('Compare content fingerprints');

  // Title — fuzzy (sites often differ by brand suffix only)
  vtLog('CHECK', 'Title', 'fuzzy document titles');
  const titleSim = textSimilarity(ref.title, cand.title);
  const titleScore = Math.round(titleSim * 100);
  parts.push({ key: 'title', weight: 0.06, score: titleScore });
  vtLog(
    'CHECK',
    'Title result',
    `${titleScore}% · ref="${(ref.title || '').slice(0, 60)}" cand="${(cand.title || '').slice(0, 60)}"`
  );
  if (titleSim < 0.82) {
    issues.push(
      mark(
        {
          type: 'Title mismatch',
          severity: titleSim < 0.5 ? 'major' : 'minor',
          details: `Reference: "${(ref.title || '').slice(0, 80)}" | Candidate: "${(cand.title || '').slice(0, 80)}"`
        },
        { side: 'reference', y: 0, height: 48, pageHeight: refPageH }
      )
    );
    vtLog('ISSUE', 'Title mismatch', `sim=${titleScore}%`);
  }

  // Headings H1–H6 — match by visible text across levels (H2 vs H5 same text ≠ missing)
  vtLog('CHECK', 'Headings H1–H6', 'cross-level text match (tag remap is not a content issue)');
  const headingLevels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const headingCmp = compareHeadingsCrossLevel(ref.headings, cand.headings);
  const headingReports = headingCmp.headingReports;
  // Tag remaps (same text, H1→H2 etc.) are minor hierarchy notes only — soft score touch
  const levelRemaps = headingCmp.levelRemaps || [];
  let headingScore = headingCmp.score;
  if (levelRemaps.length) {
    headingScore = Math.min(headingScore, Math.max(88, headingScore - 2 * levelRemaps.length));
  }
  parts.push({ key: 'headings', weight: 0.24, score: headingScore });

  for (const rep of headingReports) {
    vtLog(
      'CHECK',
      `${rep.level.toUpperCase()} headings`,
      `score=${rep.score}% · ref=${rep.refCount} · cand=${rep.candidateCount} · trueDiffs=${rep.diffs.length}`
    );
  }
  for (const remap of levelRemaps.slice(0, 12)) {
    vtLog(
      'CHECK',
      'Heading tag remap',
      `${remap.refLevel.toUpperCase()}→${remap.candLevel.toUpperCase()} · "${remap.text.slice(0, 80)}"`
    );
  }
  if (levelRemaps.length) {
    vtLog(
      'CHECK',
      'Heading remaps total',
      `${levelRemaps.length} same-text heading(s) with different H-level (minor hierarchy only)`
    );
  }

  // Same wording, different H-level (e.g. H1 on ref → H2 on cand) = minor + yellow highlight
  for (const remap of levelRemaps.slice(0, 16)) {
    if (remap.refLevel === remap.candLevel) continue;
    const refItem =
      findItemByText(ref.headings?.[remap.refLevel], remap.text) ||
      findItemByText(ref.headings?.h1, remap.text) ||
      findItemByText(ref.headings?.h2, remap.text);
    const refLvl = String(remap.refLevel || '').toUpperCase();
    const candLvl = String(remap.candLevel || '').toUpperCase();
    issues.push(
      mark(
        {
          type: 'Heading hierarchy differs',
          severity: 'minor',
          highlight: 'yellow',
          details: `Reference uses ${refLvl} for “${String(remap.text || '').slice(
            0,
            100
          )}” · candidate uses ${candLvl}`
        },
        {
          side: 'reference',
          x: refItem?.x,
          y: refItem?.y ?? 0,
          width: refItem?.width || Math.min(640, refPageW),
          height: refItem?.height || 48,
          pageHeight: refPageH,
          pageWidth: refItem?.pageWidth || refPageW,
          isSectionBox: !!refItem?.isSectionBox
        }
      )
    );
    vtLog('ISSUE', 'Heading hierarchy differs (minor)', `${refLvl}→${candLvl}`);
  }

  for (const d of headingCmp.diffs.slice(0, 24)) {
    const lvl = d.level || 'h2';
    const side = d.side || (d.kind === 'missing_on_candidate' ? 'reference' : 'candidate');
    const pageHeight = side === 'candidate' ? candPageH : refPageH;
    const pageWidth = side === 'candidate' ? candPageW : refPageW;
    const type =
      d.kind === 'missing_on_candidate'
        ? `${lvl.toUpperCase()} missing on candidate`
        : `${lvl.toUpperCase()} extra on candidate`;
    issues.push(
      mark(
        {
          type,
          severity: lvl === 'h1' ? 'critical' : lvl === 'h2' ? 'major' : 'minor',
          details: d.text
        },
        {
          side,
          x: d.x,
          y: d.y,
          width: d.width,
          height: d.height,
          pageHeight,
          pageWidth: d.pageWidth || pageWidth,
          isSectionBox: !!d.isSectionBox
        }
      )
    );
    vtLog('ISSUE', type, d.text.slice(0, 100));
  }
  vtLog(
    'CHECK',
    'Headings overall',
    `${Math.round(headingScore)}% · ref=${headingCmp.refCount} · cand=${headingCmp.candCount} · remaps=${headingCmp.levelRemaps.length} · trueDiffs=${headingCmp.diffs.length}`
  );

  // Paragraphs — fuzzy match (works across CMS/punctuation noise on any site)
  vtLog('CHECK', 'Paragraphs', 'fuzzy text match (threshold 0.88)');
  const refParaItems = toItems(ref.paragraphs);
  const candParaItems = toItems(cand.paragraphs);
  const paraMatch = fuzzyMatchItemLists(refParaItems, candParaItems, 0.88);
  const paraScore = paraMatch.score;
  parts.push({ key: 'paragraphs', weight: 0.18, score: paraScore });
  vtLog(
    'CHECK',
    'Paragraphs result',
    `${paraScore}% · ref=${refParaItems.length} · cand=${candParaItems.length} · unmatched=${paraMatch.unmatchedRef.length}`
  );
  if (paraScore < 88 && paraMatch.unmatchedRef.length) {
    const missing = paraMatch.unmatchedRef.slice(0, 12);
    // Only raise issues when enough real content is unmatched (avoid noise on 1 tiny p)
    const meaningful = missing.filter((m) => String(m.text || '').length >= 24);
    if (meaningful.length >= 1 && paraScore < 85) {
      issues.push({
        type: 'Paragraph content differs',
        severity: paraScore < 50 ? 'major' : 'minor',
        details: `${meaningful.length} paragraph(s) from reference not matched on candidate (sample: "${meaningful[0].text.slice(0, 140)}")`
      });
      vtLog('ISSUE', 'Paragraph content differs', `${meaningful.length} unmatched`);
      for (const m of meaningful.slice(0, 8)) {
        // Always outline the paragraph leaf only (not product/section parent)
        const px = typeof m.leafX === 'number' ? m.leafX : m.x;
        const py = typeof m.leafY === 'number' ? m.leafY : m.y;
        const pw = typeof m.leafWidth === 'number' ? m.leafWidth : m.width;
        const ph = typeof m.leafHeight === 'number' ? m.leafHeight : m.height;
        issues.push(
          mark(
            {
              type: 'Paragraph missing on candidate',
              severity: 'minor',
              details: m.text.slice(0, 180)
            },
            {
              side: 'reference',
              x: px,
              y: py,
              width: pw,
              height: ph,
              pageHeight: refPageH,
              pageWidth: m.pageWidth || refPageW,
              isSectionBox: false
            }
          )
        );
      }
    }
  }

  // CTAs / buttons — filter noise, then fuzzy match
  vtLog('CHECK', 'CTAs / buttons', 'noise-filtered fuzzy label match');
  const refCtaItems = filterCtaItems(toItems(ref.ctas));
  const candCtaItems = filterCtaItems(toItems(cand.ctas));
  const ctaMatch = fuzzyMatchItemLists(refCtaItems, candCtaItems, 0.9);
  const ctaScore = ctaMatch.score;
  parts.push({ key: 'ctas', weight: 0.1, score: ctaScore });
  vtLog(
    'CHECK',
    'CTAs result',
    `${ctaScore}% · ref=${refCtaItems.length} · cand=${candCtaItems.length} · unmatched=${ctaMatch.unmatchedRef.length}`
  );
  const missingCtaItems = ctaMatch.unmatchedRef.filter((i) => String(i.text || '').length >= 3);
  // Stricter CTA flagging — reduce modal/widget false positives ("Cancel", etc.)
  const ctaNoiseSoft = /^(cancel|close|ok|back|menu|search|open search)$/i;
  const meaningfulMissingCtas = missingCtaItems.filter((i) => !ctaNoiseSoft.test(String(i.text || '').trim()));
  if (meaningfulMissingCtas.length >= 3 && ctaScore < 80) {
    issues.push({
      type: 'CTA / button labels missing on candidate',
      severity: ctaScore < 50 ? 'major' : 'minor',
      details: meaningfulMissingCtas
        .map((i) => i.text)
        .slice(0, 12)
        .join(' · ')
        .slice(0, 400)
    });
    vtLog('ISSUE', 'CTA labels missing', meaningfulMissingCtas.slice(0, 6).map((i) => i.text).join(', '));
    for (const item of meaningfulMissingCtas.slice(0, 8)) {
      issues.push(
        mark(
          {
            type: 'CTA missing on candidate',
            severity: ctaScore < 50 ? 'major' : 'minor',
            details: item.text.slice(0, 120)
          },
          {
            side: 'reference',
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            pageHeight: refPageH,
            pageWidth: item.pageWidth || refPageW
          }
        )
      );
    }
  } else if (meaningfulMissingCtas.length > 0) {
    vtLog(
      'CHECK',
      'CTA diffs soft-skipped',
      `unmatched=${meaningfulMissingCtas.length} score=${ctaScore}% (need ≥3 and score<80)`
    );
  }

  // Header / footer / nav — content-first; tag-only presence is soft (clones often drop <header>)
  vtLog('CHECK', 'Header / Footer / Nav', 'content-first chrome compare (tag-only is soft)');
  const refHeaderBlob = [ref.headerText, ref.navText, ref.topChromeText].filter(Boolean).join(' ');
  const candHeaderBlob = [cand.headerText, cand.navText, cand.topChromeText].filter(Boolean).join(' ');
  const headerScore =
    textSimilarity(refHeaderBlob, candHeaderBlob) * 100 ||
    jaccard(tokenSet(ref.headerText), tokenSet(cand.headerText)) * 100;
  const footerScore =
    textSimilarity(ref.footerText, cand.footerText) * 100 ||
    jaccard(tokenSet(ref.footerText), tokenSet(cand.footerText)) * 100;
  const navScore =
    textSimilarity(ref.navText || ref.topChromeText, cand.navText || cand.topChromeText) * 100 ||
    jaccard(tokenSet(ref.navText), tokenSet(cand.navText)) * 100;

  // If content matches well, treat chrome as OK even when semantic <header> missing
  const headerEffective =
    headerScore >= 55 || navScore >= 55
      ? Math.max(headerScore, navScore, 75)
      : ref.hasHeader || cand.hasHeader || refHeaderBlob || candHeaderBlob
        ? Math.max(headerScore, 40)
        : 100;
  const footerEffective =
    footerScore >= 50
      ? Math.max(footerScore, 70)
      : ref.hasFooter || cand.hasFooter
        ? footerScore
        : 100;
  const navEffective =
    navScore >= 50 || headerScore >= 55
      ? Math.max(navScore, headerScore * 0.9, 70)
      : ref.hasNav || cand.hasNav
        ? navScore
        : 100;

  parts.push({ key: 'header', weight: 0.08, score: headerEffective });
  parts.push({ key: 'footer', weight: 0.06, score: footerEffective });
  parts.push({ key: 'nav', weight: 0.06, score: navEffective });
  vtLog(
    'CHECK',
    'Chrome scores',
    `header=${Math.round(headerScore)}%→${Math.round(headerEffective)}% footer=${Math.round(footerScore)}%→${Math.round(footerEffective)}% nav=${Math.round(navScore)}%→${Math.round(navEffective)}% · H/F/N ref=${ref.hasHeader}/${ref.hasFooter}/${ref.hasNav} cand=${cand.hasHeader}/${cand.hasFooter}/${cand.hasNav}`
  );

  // Tag-only presence: log + minor only when content also fails
  if (ref.hasSemanticHeader !== cand.hasSemanticHeader && headerScore < 50 && navScore < 50) {
    issues.push(
      mark(
        {
          type: 'Header region content weak',
          severity: 'minor',
          details: `Top chrome text similarity ${Math.round(Math.max(headerScore, navScore))}%. Semantic <header> ref=${!!ref.hasSemanticHeader} cand=${!!cand.hasSemanticHeader}`
        },
        {
          side: 'reference',
          x: ref.headerX ?? 0,
          y: ref.headerY ?? 0,
          width: ref.headerW || refPageW,
          height: ref.headerH || 80,
          pageHeight: refPageH,
          pageWidth: refPageW
        }
      )
    );
    vtLog('ISSUE', 'Header region content weak', `sim=${Math.round(headerScore)}%`);
  } else if (ref.hasSemanticHeader !== cand.hasSemanticHeader) {
    vtLog(
      'CHECK',
      'Header tag differs (OK)',
      `semantic header ref=${!!ref.hasSemanticHeader} cand=${!!cand.hasSemanticHeader} · content sim=${Math.round(headerScore)}% — not flagged`
    );
  }

  if (ref.hasSemanticFooter !== cand.hasSemanticFooter && footerScore < 45) {
    issues.push(
      mark(
        {
          type: 'Footer region content weak',
          severity: 'minor',
          details: `Footer text similarity ${Math.round(footerScore)}%. Semantic <footer> ref=${!!ref.hasSemanticFooter} cand=${!!cand.hasSemanticFooter}`
        },
        {
          side: 'reference',
          x: ref.footerX ?? 0,
          y: ref.footerY,
          width: ref.footerW || refPageW,
          height: ref.footerH || 120,
          pageHeight: refPageH,
          pageWidth: refPageW
        }
      )
    );
  } else if (ref.hasSemanticFooter !== cand.hasSemanticFooter) {
    vtLog(
      'CHECK',
      'Footer tag differs (OK)',
      `content sim=${Math.round(footerScore)}% — not flagged`
    );
  }

  if (headerScore < 45 && (refHeaderBlob || candHeaderBlob) && headerEffective < 60) {
    issues.push(
      mark(
        {
          type: 'Header content differs',
          severity: 'minor',
          details: `Header/top-chrome text similarity ${Math.round(headerScore)}%`
        },
        {
          side: 'reference',
          x: ref.headerX ?? 0,
          y: ref.headerY ?? 0,
          width: ref.headerW || refPageW,
          height: ref.headerH || 80,
          pageHeight: refPageH,
          pageWidth: refPageW
        }
      )
    );
    vtLog('ISSUE', 'Header content differs', `${Math.round(headerScore)}%`);
  }
  if (footerScore < 45 && (ref.footerText || cand.footerText) && footerEffective < 60) {
    issues.push(
      mark(
        {
          type: 'Footer content differs',
          severity: 'minor',
          details: `Footer text similarity ${Math.round(footerScore)}%`
        },
        {
          side: 'reference',
          x: ref.footerX ?? 0,
          y: ref.footerY,
          width: ref.footerW || refPageW,
          height: ref.footerH || 120,
          pageHeight: refPageH,
          pageWidth: refPageW
        }
      )
    );
    vtLog('ISSUE', 'Footer content differs', `${Math.round(footerScore)}%`);
  }
  if (navScore < 40 && navEffective < 55 && (ref.navText || cand.navText || ref.topChromeText)) {
    issues.push(
      mark(
        {
          type: 'Nav content differs',
          severity: 'minor',
          details: `Nav/top-link text similarity ${Math.round(navScore)}%`
        },
        {
          side: 'reference',
          x: ref.navX ?? 0,
          y: ref.navY ?? 0,
          width: ref.navW || refPageW,
          height: ref.navH || 60,
          pageHeight: refPageH,
          pageWidth: refPageW
        }
      )
    );
  }

  // Images — multi-key match (basename → alt → strict leaf size+Y)
  vtLog('CHECK', 'Images', 'multi-key match (basename → alt → leaf size+Y)');
  const imgMatch = matchImages(ref.images, cand.images);
  const imgScore = imgMatch.score;
  vtLog(
    'CHECK',
    'Images result',
    `${imgScore}% · ref=${imgMatch.refCount} · cand=${imgMatch.candCount} · matched=${imgMatch.matched} · missing=${imgMatch.missing.length}`
  );

  if (Math.abs((imgMatch.refCount || 0) - (imgMatch.candCount || 0)) >= 5) {
    issues.push({
      type: 'Image count differs',
      severity: Math.abs(imgMatch.refCount - imgMatch.candCount) >= 10 ? 'major' : 'minor',
      details: `Reference images=${imgMatch.refCount}, candidate images=${imgMatch.candCount}`
    });
    vtLog('ISSUE', 'Image count differs', `ref=${imgMatch.refCount} cand=${imgMatch.candCount}`);
  }

  // Report missing images on candidate (stacks first, then unique singles with LEAF boxes)
  if (imgMatch.missing.length) {
    const contentMissing = imgMatch.missing.filter((i) => {
      if (isNoiseTinyAsset(i)) return false;
      const s = assetMatchSize(i);
      if (s.w > 0 && s.h > 0 && s.w < 16 && s.h < 16) return false;
      // Unnamed sub-36px assets are chrome noise (issue #9 style)
      if (s.w < 36 && s.h < 36 && !basenameKey(i) && String(i.alt || '').trim().length < 4) {
        return false;
      }
      return s.w >= 24 || s.h >= 24 || isIconLikeAsset(i);
    });
    // Stacks use leaf positions for grouping
    const forStacks = contentMissing.map((i) => {
      const b = assetHighlightBox(i);
      return { ...i, x: b.x, y: b.y, width: b.width, height: b.height };
    });
    const missStacks = groupImagesIntoStacks(forStacks, { minCount: 3, maxGap: 160 });
    const missCoveredKeys = new Set();
    for (const st of missStacks.slice(0, 5)) {
      for (const it of st.items) {
        missCoveredKeys.add(`${it.x}|${it.y}|${it.width}|${it.height}`);
      }
      const axisLabel = st.axis === 'horizontal' ? 'horizontal row' : 'vertical stack';
      issues.push(
        mark(
          {
            type: 'Image section missing on candidate',
            severity: 'major',
            details: `${st.count} images in a ${axisLabel} on reference only (${st.width}×${st.height}px @ y=${st.y})`
          },
          {
            side: 'reference',
            x: st.x,
            y: st.y,
            width: st.width,
            height: st.height,
            pageHeight: refPageH,
            pageWidth: st.items[0]?.pageWidth || refPageW,
            isSectionBox: true
          }
        )
      );
      vtLog('ISSUE', 'Image section missing on candidate', `${st.count} ${axisLabel} y=${st.y}`);
    }
    const seenBase = new Set();
    const uniqueMissing = [];
    for (const img of contentMissing) {
      const box = assetHighlightBox(img);
      if (missCoveredKeys.has(`${box.x}|${box.y}|${box.width}|${box.height}`)) continue;
      const b =
        basenameKey(img) ||
        (img.alt && img.alt.trim()) ||
        `${box.width}x${box.height}@${box.y}`;
      if (seenBase.has(b)) continue;
      seenBase.add(b);
      uniqueMissing.push(img);
    }
    const missLabels = uniqueMissing
      .map((i) => basenameKey(i) || (i.alt || '').slice(0, 40) || 'image')
      .slice(0, 12);
    if (uniqueMissing.length) {
      issues.push({
        type: 'Images missing on candidate',
        severity: uniqueMissing.length >= 3 || imgScore < 70 ? 'major' : 'minor',
        details: missLabels.join(', ').slice(0, 400)
      });
      vtLog('ISSUE', 'Images missing on candidate', missLabels.slice(0, 6).join(', '));
      for (const img of uniqueMissing.slice(0, 12)) {
        const box = assetHighlightBox(img);
        const label =
          basenameKey(img) ||
          (img.alt && img.alt.trim()) ||
          `image ${box.width}x${box.height} @y=${box.y}`;
        const isLogo = isIconLikeAsset(img) || /logo|brand|icon|badge|warranty/i.test(String(label));
        issues.push(
          mark(
            {
              type: isLogo ? 'Logo / icon missing on candidate' : 'Image missing on candidate',
              severity:
                isLogo || uniqueMissing.length >= 3 || imgScore < 70 ? 'major' : 'minor',
              details: String(label).slice(0, 100)
            },
            {
              side: 'reference',
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              pageHeight: refPageH,
              pageWidth: img.pageWidth || refPageW,
              isSectionBox: false
            }
          )
        );
        vtLog('ISSUE', isLogo ? 'Logo/icon missing' : 'Image missing', String(label).slice(0, 60));
      }
    }
  }

  // Global page reflow (many assets share the same ΔY) — one real layout issue, not N FPs
  let reportedPageReflow = false;
  if (imgMatch.pageReflow && Math.abs(imgMatch.reflowY || 0) >= 70) {
    reportedPageReflow = true;
    issues.push(
      mark(
        {
          type: 'Page layout reflow',
          severity: Math.abs(imgMatch.reflowY) >= 400 ? 'major' : 'minor',
          details: `Content vertical offset ~${Math.abs(imgMatch.reflowY)}px between reference and candidate (shared by many assets — not individual logo bugs)`
        },
        {
          side: 'reference',
          x: 0,
          y: Math.max(0, ref.headerY ?? 0),
          width: refPageW,
          height: Math.min(200, Math.round(refPageH * 0.08)),
          pageHeight: refPageH,
          pageWidth: refPageW,
          isSectionBox: true
        }
      )
    );
    vtLog('ISSUE', 'Page layout reflow', `ΔY≈${imgMatch.reflowY}px`);
  }

  // Misaligned logos/images — local residuals only (need horizontal drift, not pure reflow ΔY)
  if ((imgMatch.misaligned || []).length) {
    const seenM = new Set();
    for (const m of imgMatch.misaligned.slice(0, 8)) {
      if ((m.dx || 0) < 40) continue;
      if (isNoiseTinyAsset(m.ref)) continue;
      const key = String(m.label || '').toLowerCase();
      if (!key || seenM.has(key)) continue;
      seenM.add(key);
      const box = assetHighlightBox(m.ref);
      const isLogo = isIconLikeAsset(m.ref);
      issues.push(
        mark(
          {
            type: isLogo ? 'Logo / icon misaligned' : 'Image misaligned',
            severity: 'minor',
            details: `${m.label} (local Δx=${m.dx}px Δy=${m.dy}px vs candidate)`
          },
          {
            side: 'reference',
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            pageHeight: refPageH,
            pageWidth: m.ref.pageWidth || refPageW,
            isSectionBox: false
          }
        )
      );
      vtLog('ISSUE', isLogo ? 'Logo misaligned' : 'Image misaligned', String(m.label).slice(0, 50));
    }
  }

  // Extra images on candidate (present on cand, not matched on ref) — e.g. 5-image strip only on clone
  if ((imgMatch.extra || []).length) {
    const contentExtra = (imgMatch.extra || []).filter((i) => {
      if (isNoiseTinyAsset(i)) return false;
      const s = assetMatchSize(i);
      if (s.w > 0 && s.h > 0 && s.w < 16 && s.h < 16) return false;
      if (s.w < 36 && s.h < 36 && !basenameKey(i) && String(i.alt || '').trim().length < 4) {
        return false;
      }
      return s.w >= 24 || s.h >= 24 || isIconLikeAsset(i);
    });
    const forStacksE = contentExtra.map((i) => {
      const b = assetHighlightBox(i);
      return { ...i, x: b.x, y: b.y, width: b.width, height: b.height };
    });
    const stacks = groupImagesIntoStacks(forStacksE, { minCount: 3, maxGap: 160 });
    const covered = new Set();
    for (const st of stacks.slice(0, 5)) {
      for (const it of st.items) covered.add(it);
      const axisLabel = st.axis === 'horizontal' ? 'horizontal row' : 'vertical stack';
      issues.push(
        mark(
          {
            type: 'Image section extra on candidate',
            severity: 'major',
            details: `${st.count} images in a ${axisLabel} on candidate only (${st.width}×${st.height}px @ y=${st.y})`
          },
          {
            side: 'candidate',
            x: st.x,
            y: st.y,
            width: st.width,
            height: st.height,
            pageHeight: candPageH,
            pageWidth: st.items[0]?.pageWidth || candPageW,
            isSectionBox: true
          }
        )
      );
      vtLog(
        'ISSUE',
        'Image section extra on candidate',
        `${st.count} ${axisLabel} y=${st.y}`
      );
    }
    const singles = contentExtra.filter((i) => {
      const p = assetMatchPos(i);
      return ![...covered].some(
        (c) => (c.leafX ?? c.x) === p.x && (c.leafY ?? c.y) === p.y
      );
    });
    const seenE = new Set();
    const uniqueExtra = [];
    for (const img of singles) {
      const b =
        basenameKey(img) ||
        `${assetMatchSize(img).w}x${assetMatchSize(img).h}@${Math.round((assetMatchPos(img).y || 0) / 50)}`;
      if (seenE.has(b)) continue;
      seenE.add(b);
      uniqueExtra.push(img);
    }
    // Always outline each extra image (real unmatched assets must not be list-only)
    const singleLimit = 16;
    for (const img of uniqueExtra.slice(0, singleLimit)) {
      const box = assetHighlightBox(img);
      const label =
        basenameKey(img) ||
        (img.alt && img.alt.trim()) ||
        `image ${box.width}x${box.height} @y=${box.y}`;
      issues.push(
        mark(
          {
            type: isIconLikeAsset(img) ? 'Logo / icon extra on candidate' : 'Image extra on candidate',
            severity: uniqueExtra.length >= 3 || stacks.length ? 'major' : 'minor',
            details: String(label).slice(0, 100)
          },
          {
            side: 'candidate',
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            pageHeight: candPageH,
            pageWidth: img.pageWidth || candPageW,
            isSectionBox: false
          }
        )
      );
      vtLog('ISSUE', 'Image extra on candidate', String(label).slice(0, 60));
    }
  }

  // SVG icons + icon/feature sections (previously invisible to the engine)
  vtLog('CHECK', 'Icons / SVG', 'inline SVG fingerprint match');
  const iconMatch = matchIcons(ref.icons, cand.icons);
  vtLog(
    'CHECK',
    'Icons result',
    `${iconMatch.score}% · ref=${iconMatch.refCount} · cand=${iconMatch.candCount} · missing=${iconMatch.missing.length} · misaligned=${(iconMatch.misaligned || []).length}`
  );

  vtLog('CHECK', 'Icon sections', 'feature/icon row containers');
  const iconSecMatch = matchIconSections(ref.iconSections, cand.iconSections);
  vtLog(
    'CHECK',
    'Icon sections result',
    `${iconSecMatch.score}% · ref=${iconSecMatch.refCount} · cand=${iconSecMatch.candCount} · missing=${iconSecMatch.missing.length}`
  );

  const visualScore = Math.round(
    imgScore * 0.7 +
      (iconMatch.refCount ? iconMatch.score : 100) * 0.15 +
      (iconSecMatch.refCount ? iconSecMatch.score : 100) * 0.15
  );
  parts.push({ key: 'images', weight: 0.12, score: visualScore });
  parts.push({ key: 'icons', weight: 0.06, score: iconMatch.refCount ? iconMatch.score : 100 });

  // Whole feature/icon rows missing on candidate
  if (iconSecMatch.missing.length) {
    for (const sec of iconSecMatch.missing.slice(0, 6)) {
      issues.push(
        mark(
          {
            type: 'Icon / image section missing on candidate',
            severity: 'major',
            details: `${sec.label || sec.title || 'icon section'} (${sec.iconCount || 0} icons)`
          },
          {
            side: 'reference',
            x: sec.x,
            y: sec.y,
            width: sec.width,
            height: sec.height,
            pageHeight: refPageH,
            pageWidth: sec.pageWidth || refPageW,
            isSectionBox: true
          }
        )
      );
      vtLog('ISSUE', 'Icon section missing', (sec.label || sec.title || '').slice(0, 80));
    }
  }

  // Individual feature icons missing inside a still-present row (e.g. Free Rush Delivery)
  if ((iconSecMatch.missingItems || []).length) {
    const seenItem = new Set();
    for (const item of iconSecMatch.missingItems.slice(0, 12)) {
      const key = normalizeContentText(item.text || '');
      if (!key || seenItem.has(key)) continue;
      seenItem.add(key);
      issues.push(
        mark(
          {
            type: 'Feature icon missing on candidate',
            severity: 'major',
            details: item.text
          },
          {
            side: 'reference',
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            pageHeight: refPageH,
            pageWidth: item.pageWidth || refPageW,
            isSectionBox: false
          }
        )
      );
      vtLog('ISSUE', 'Feature icon missing', String(item.text || '').slice(0, 60));
    }
  }

  // Same section still present but many icons removed (partial product/icon block)
  if ((iconSecMatch.reduced || []).length) {
    for (const sec of iconSecMatch.reduced.slice(0, 4)) {
      issues.push(
        mark(
          {
            type: 'Icon / image section incomplete on candidate',
            severity: 'major',
            details: sec.label || `icons ${sec.iconCount}→${sec.candIconCount}`
          },
          {
            side: 'reference',
            x: sec.x,
            y: sec.y,
            width: sec.width,
            height: sec.height,
            pageHeight: refPageH,
            pageWidth: sec.pageWidth || refPageW,
            isSectionBox: true
          }
        )
      );
      vtLog('ISSUE', 'Icon section incomplete', (sec.label || '').slice(0, 90));
    }
  }

  // Individual missing SVG / data-URI icons — skip generic chrome “icon” labels (#2 FP)
  if ((iconMatch.missing || []).length) {
    const contentIcons = iconMatch.missing.filter((ic) => {
      const w = ic.leafWidth || ic.width || 0;
      const h = ic.leafHeight || ic.height || 0;
      if (!isIconPixelSize(w, h)) return false;
      if (isNoiseTinyAsset(ic)) return false;
      const label = String(ic.parentText || ic.alt || '').trim();
      // Never flag bare chrome labels (social/footer SVGs extract as "icon")
      if (isGenericIconLabel(label)) return false;
      // Footer-band brand marks already present via image match — skip SVG twin
      const y = ic.y || ic.leafY || 0;
      if (y > refPageH * 0.75 && isIconPixelSize(w, h)) {
        const brand = normalizeContentText(label);
        if (brand.length >= 3) {
          const onCandImg = (cand.images || []).some(
            (im) =>
              textSimilarity(normalizeContentText(im.alt || ''), brand) >= 0.85 ||
              textSimilarity(normalizeContentText(im.basename || ''), brand) >= 0.7
          );
          const onCandIcon = (cand.icons || []).some(
            (ci) => textSimilarity(normalizeContentText(ci.parentText || ci.alt || ''), brand) >= 0.85
          );
          if (onCandImg || onCandIcon) return false;
        }
      }
      return true;
    });
    // Group dense clusters for one box when many, else one box per icon
    const sorted = contentIcons
      .filter((i) => typeof i.y === 'number')
      .slice()
      .sort((a, b) => a.y - b.y || (a.x || 0) - (b.x || 0));
    const bands = [];
    let band = null;
    for (const ic of sorted) {
      if (!band || ic.y > band.maxY + 100) {
        band = {
          minY: ic.y,
          maxY: ic.y + (ic.height || ic.leafHeight || 24),
          minX: ic.x || 0,
          maxX: (ic.x || 0) + (ic.width || ic.leafWidth || 24),
          items: [ic]
        };
        bands.push(band);
      } else {
        band.items.push(ic);
        band.maxY = Math.max(band.maxY, ic.y + (ic.height || ic.leafHeight || 24));
        band.minX = Math.min(band.minX, ic.x || 0);
        band.maxX = Math.max(band.maxX, (ic.x || 0) + (ic.width || ic.leafWidth || 24));
      }
    }
    for (const b of bands.slice(0, 8)) {
      if (b.items.length >= 3) {
        const sample = b.items[0].parentText || 'icons';
        issues.push(
          mark(
            {
              type: 'Icon / image section missing on candidate',
              severity: 'major',
              details: `${b.items.length} icons missing near “${String(sample).slice(0, 60)}”`
            },
            {
              side: 'reference',
              x: b.minX,
              y: b.minY,
              width: Math.max(80, b.maxX - b.minX),
              height: Math.max(48, b.maxY - b.minY),
              pageHeight: refPageH,
              pageWidth: refPageW,
              isSectionBox: true
            }
          )
        );
        vtLog('ISSUE', 'Icon cluster missing', `n=${b.items.length} y=${b.minY}`);
      } else {
        for (const ic of b.items.slice(0, 6)) {
          const box = assetHighlightBox(ic);
          const label = (ic.parentText || ic.alt || ic.basename || 'icon').slice(0, 60);
          if (isGenericIconLabel(label)) continue;
          issues.push(
            mark(
              {
                type: 'Icon missing on candidate',
                severity: 'major',
                details: label
              },
              {
                side: 'reference',
                x: box.x,
                y: box.y,
                width: Math.max(20, box.width),
                height: Math.max(20, box.height),
                pageHeight: refPageH,
                pageWidth: ic.pageWidth || refPageW,
                isSectionBox: false
              }
            )
          );
          vtLog('ISSUE', 'Icon missing', label.slice(0, 50));
        }
      }
    }
  }

  // Icon-only reflow if images didn't already report it
  if (
    !reportedPageReflow &&
    iconMatch.pageReflow &&
    Math.abs(iconMatch.reflowY || 0) >= 70
  ) {
    reportedPageReflow = true;
    issues.push(
      mark(
        {
          type: 'Page layout reflow',
          severity: Math.abs(iconMatch.reflowY) >= 400 ? 'major' : 'minor',
          details: `Content vertical offset ~${Math.abs(iconMatch.reflowY)}px between reference and candidate (shared by many icons)`
        },
        {
          side: 'reference',
          x: 0,
          y: Math.max(0, ref.headerY ?? 0),
          width: refPageW,
          height: Math.min(200, Math.round(refPageH * 0.08)),
          pageHeight: refPageH,
          pageWidth: refPageW,
          isSectionBox: true
        }
      )
    );
    vtLog('ISSUE', 'Page layout reflow (icons)', `ΔY≈${iconMatch.reflowY}px`);
  }

  // Local residual misalignment only — require real horizontal drift (see filterLocalMisalignments)
  if ((iconMatch.misaligned || []).length) {
    const seenA = new Set();
    for (const m of iconMatch.misaligned.slice(0, 6)) {
      if ((m.dx || 0) < 40) continue; // pure ΔY after reflow = false (#8)
      const label = String(m.label || 'icon').slice(0, 60);
      if (isGenericIconLabel(label)) continue;
      if (seenA.has(label)) continue;
      seenA.add(label);
      const box = assetHighlightBox(m.ref);
      issues.push(
        mark(
          {
            type: 'Icon misaligned',
            severity: 'minor',
            details: `${label} (local Δx=${m.dx}px Δy=${m.dy}px vs candidate)`
          },
          {
            side: 'reference',
            x: box.x,
            y: box.y,
            width: Math.max(20, box.width),
            height: Math.max(20, box.height),
            pageHeight: refPageH,
            pageWidth: m.ref.pageWidth || refPageW,
            isSectionBox: false
          }
        )
      );
      vtLog('ISSUE', 'Icon misaligned', label.slice(0, 50));
    }
  }

  // Extra icon/feature rows only on candidate — section box + EVERY item/image inside
  if ((iconSecMatch.extra || []).length) {
    const coveredExtraImgKeys = new Set();
    for (const sec of iconSecMatch.extra.slice(0, 4)) {
      issues.push(
        mark(
          {
            type: 'Icon / image section extra on candidate',
            severity: 'major',
            details: `${sec.label || sec.title || 'icon section'} (${sec.iconCount || (sec.items || []).length || 0} icons)`
          },
          {
            side: 'candidate',
            x: sec.x,
            y: sec.y,
            width: sec.width,
            height: sec.height,
            pageHeight: candPageH,
            pageWidth: sec.pageWidth || candPageW,
            isSectionBox: true
          }
        )
      );
      vtLog('ISSUE', 'Icon section extra', (sec.label || sec.title || '').slice(0, 80));

      // Individual tiles/icons inside the extra section (user needs each red box)
      const items = sec.items || [];
      const seenItem = new Set();
      for (const it of items.slice(0, 16)) {
        const key = normalizeContentText(it.text || it.basename || it.alt || '') || `${it.x},${it.y}`;
        if (seenItem.has(key)) continue;
        seenItem.add(key);
        const label = String(it.text || it.alt || it.basename || 'icon').slice(0, 80);
        issues.push(
          mark(
            {
              type: it.kind === 'img' ? 'Image extra on candidate' : 'Icon extra on candidate',
              severity: 'major',
              details: label
            },
            {
              side: 'candidate',
              x: it.x,
              y: it.y,
              width: Math.max(24, it.width || 40),
              height: Math.max(24, it.height || 40),
              pageHeight: candPageH,
              pageWidth: it.pageWidth || candPageW,
              isSectionBox: false
            }
          )
        );
        coveredExtraImgKeys.add(`${Math.round(it.x || 0)}|${Math.round(it.y || 0)}`);
        vtLog('ISSUE', 'Icon/image extra in section', label.slice(0, 50));
      }

      // Any unmatched cand images that sit inside this section band but weren't in items[]
      const secTop = sec.y || 0;
      const secBot = secTop + (sec.height || 0);
      const secLeft = sec.x || 0;
      const secRight = secLeft + (sec.width || 0);
      for (const img of imgMatch.extra || []) {
        if (isNoiseTinyAsset(img)) continue;
        const p = assetMatchPos(img);
        const s = assetMatchSize(img);
        if (p.y == null || p.x == null) continue;
        if (p.y < secTop - 20 || p.y > secBot + 20) continue;
        if (p.x < secLeft - 20 || p.x > secRight + 20) continue;
        const k = `${Math.round(p.x)}|${Math.round(p.y)}`;
        if (coveredExtraImgKeys.has(k)) continue;
        coveredExtraImgKeys.add(k);
        const label =
          basenameKey(img) ||
          (img.alt && img.alt.trim()) ||
          `image ${s.w}x${s.h} @y=${p.y}`;
        issues.push(
          mark(
            {
              type: 'Image extra on candidate',
              severity: 'major',
              details: String(label).slice(0, 100)
            },
            {
              side: 'candidate',
              x: p.x,
              y: p.y,
              width: Math.max(24, s.w),
              height: Math.max(24, s.h),
              pageHeight: candPageH,
              pageWidth: img.pageWidth || candPageW,
              isSectionBox: false
            }
          )
        );
        vtLog('ISSUE', 'Image extra in section band', String(label).slice(0, 50));
      }
    }
  }

  // Extra standalone icons on candidate (not already covered by a section item)
  if ((iconMatch.extra || []).length) {
    const seenEx = new Set();
    // Prefer grouping into clusters for dense rows, else per-icon
    const extras = (iconMatch.extra || []).filter((ic) => {
      const w = ic.leafWidth || ic.width || 0;
      const h = ic.leafHeight || ic.height || 0;
      if (!isIconPixelSize(w, h)) return false;
      if (isNoiseTinyAsset(ic)) return false;
      const label = String(ic.parentText || ic.alt || '').trim();
      if (isGenericIconLabel(label)) return false;
      return true;
    });
    // Skip icons already inside a reported extra section (same Y band)
    const extraSecBands = (iconSecMatch.extra || []).map((s) => ({
      y0: (s.y || 0) - 40,
      y1: (s.y || 0) + (s.height || 0) + 40
    }));
    const freeExtras = extras.filter((ic) => {
      const y = assetMatchPos(ic).y;
      if (y == null) return true;
      return !extraSecBands.some((b) => y >= b.y0 && y <= b.y1);
    });
    const sortedE = freeExtras
      .filter((i) => typeof (i.y ?? i.leafY) === 'number')
      .slice()
      .sort((a, b) => (a.y ?? a.leafY) - (b.y ?? b.leafY));
    // Cluster nearby extras into one section box + still list items if few
    if (sortedE.length >= 3) {
      const bands = [];
      let band = null;
      for (const ic of sortedE) {
        const y = ic.y ?? ic.leafY;
        const h = ic.height || ic.leafHeight || 24;
        if (!band || y > band.maxY + 120) {
          band = {
            minY: y,
            maxY: y + h,
            minX: ic.x || ic.leafX || 0,
            maxX: (ic.x || ic.leafX || 0) + (ic.width || ic.leafWidth || 24),
            items: [ic]
          };
          bands.push(band);
        } else {
          band.items.push(ic);
          band.maxY = Math.max(band.maxY, y + h);
          band.minX = Math.min(band.minX, ic.x || ic.leafX || 0);
          band.maxX = Math.max(
            band.maxX,
            (ic.x || ic.leafX || 0) + (ic.width || ic.leafWidth || 24)
          );
        }
      }
      for (const b of bands.filter((x) => x.items.length >= 3).slice(0, 5)) {
        issues.push(
          mark(
            {
              type: 'Icon / image section extra on candidate',
              severity: 'major',
              details: `${b.items.length} icons extra near “${String(
                b.items[0].parentText || 'icons'
              ).slice(0, 50)}”`
            },
            {
              side: 'candidate',
              x: b.minX,
              y: b.minY,
              width: Math.max(80, b.maxX - b.minX),
              height: Math.max(48, b.maxY - b.minY),
              pageHeight: candPageH,
              pageWidth: candPageW,
              isSectionBox: true
            }
          )
        );
        for (const ic of b.items.slice(0, 12)) {
          const box = assetHighlightBox(ic);
          const label = String(ic.parentText || ic.alt || 'icon').slice(0, 60);
          if (isGenericIconLabel(label) && box.width < 44) continue;
          const k = `${box.x}|${box.y}|${label}`;
          if (seenEx.has(k)) continue;
          seenEx.add(k);
          issues.push(
            mark(
              {
                type: 'Icon extra on candidate',
                severity: 'major',
                details: label
              },
              {
                side: 'candidate',
                x: box.x,
                y: box.y,
                width: Math.max(20, box.width),
                height: Math.max(20, box.height),
                pageHeight: candPageH,
                pageWidth: ic.pageWidth || candPageW,
                isSectionBox: false
              }
            )
          );
        }
        vtLog('ISSUE', 'Icon cluster extra', `n=${b.items.length} y=${b.minY}`);
      }
      // leftover singles not in large bands
      const inBand = new Set(
        bands.filter((x) => x.items.length >= 3).flatMap((x) => x.items)
      );
      for (const ic of freeExtras) {
        if (inBand.has(ic)) continue;
        const box = assetHighlightBox(ic);
        const label = String(ic.parentText || ic.alt || 'icon').slice(0, 60);
        if (isGenericIconLabel(label) && box.width < 44) continue;
        const k = `${box.x}|${box.y}|${label}`;
        if (seenEx.has(k)) continue;
        seenEx.add(k);
        issues.push(
          mark(
            {
              type: 'Icon extra on candidate',
              severity: 'minor',
              details: label
            },
            {
              side: 'candidate',
              x: box.x,
              y: box.y,
              width: Math.max(20, box.width),
              height: Math.max(20, box.height),
              pageHeight: candPageH,
              pageWidth: ic.pageWidth || candPageW,
              isSectionBox: false
            }
          )
        );
      }
    } else {
      for (const ic of freeExtras.slice(0, 10)) {
        const box = assetHighlightBox(ic);
        const label = String(ic.parentText || ic.alt || 'icon').slice(0, 60);
        issues.push(
          mark(
            {
              type: 'Icon extra on candidate',
              severity: 'minor',
              details: label
            },
            {
              side: 'candidate',
              x: box.x,
              y: box.y,
              width: Math.max(20, box.width),
              height: Math.max(20, box.height),
              pageHeight: candPageH,
              pageWidth: ic.pageWidth || candPageW,
              isSectionBox: false
            }
          )
        );
      }
    }
  }

  // Header position: only when BOTH detections look like a real TOP header.
  // Mid-page brand blocks (e.g. y=1239 vs y=96) are false positives from bad selectors.
  function isPlausibleTopHeaderY(y, pageH) {
    if (typeof y !== 'number' || y < 0) return false;
    const limit = Math.max(280, Math.min(420, (pageH || 2000) * 0.08));
    return y <= limit;
  }
  if (
    typeof ref.headerY === 'number' &&
    typeof cand.headerY === 'number' &&
    Math.abs(ref.headerY - cand.headerY) >= 200
  ) {
    const refOk = isPlausibleTopHeaderY(ref.headerY, refPageH);
    const candOk = isPlausibleTopHeaderY(cand.headerY, candPageH);
    const headerContentOk = headerScore >= 55 || headerEffective >= 70;
    if (!refOk || !candOk) {
      // One side measured a non-top "header" — skip (do not flag FP)
      vtLog(
        'CHECK',
        'Header position skipped (detection)',
        `refY=${ref.headerY} (ok=${refOk}) candY=${cand.headerY} (ok=${candOk}) · contentSim=${Math.round(headerScore)}%`
      );
    } else if (headerContentOk && Math.abs(ref.headerY - cand.headerY) < 500) {
      // Both top, content matches, moderate shift → soft reflow only (already covered elsewhere)
      vtLog(
        'CHECK',
        'Header position soft-skipped',
        `Δ${Math.abs(ref.headerY - cand.headerY)}px but header content matches (${Math.round(headerScore)}%)`
      );
    } else {
      issues.push(
        mark(
          {
            type: 'Header position differs',
            severity: headerContentOk ? 'minor' : 'major',
            details: `Reference header y=${ref.headerY}px · candidate header y=${cand.headerY}px (Δ${Math.abs(
              ref.headerY - cand.headerY
            )}px)`
          },
          {
            side: 'reference',
            x: ref.headerX ?? 0,
            y: ref.headerY,
            width: ref.headerW || refPageW,
            height: ref.headerH || 80,
            pageHeight: refPageH,
            pageWidth: refPageW,
            isSectionBox: true
          }
        )
      );
      vtLog(
        'ISSUE',
        'Header position differs',
        `refY=${ref.headerY} candY=${cand.headerY}`
      );
    }
  }

  // Layout: horizontal scroll + vertical structure (height / header band)
  vtLog('CHECK', 'Layout', 'scroll / page-height / header position');
  const refHScroll = (ref.scrollWidth || 0) > (ref.clientWidth || 0) + 15;
  const candHScroll = (cand.scrollWidth || 0) > (cand.clientWidth || 0) + 15;
  let layoutScore = 100;
  if (refHScroll !== candHScroll) {
    issues.push({
      type: 'Horizontal scroll mismatch',
      severity: 'minor',
      details: `Reference scroll=${refHScroll}, candidate scroll=${candHScroll}`
    });
    layoutScore = Math.min(layoutScore, 40);
    vtLog('ISSUE', 'Horizontal scroll mismatch', `ref=${refHScroll} cand=${candHScroll}`);
  }
  const refH = ref.scrollHeight || 0;
  const candH = cand.scrollHeight || 0;
  if (refH > 800 && candH > 800) {
    const hRatio = Math.min(refH, candH) / Math.max(refH, candH);
    if (hRatio < 0.92) {
      layoutScore = Math.min(layoutScore, Math.round(hRatio * 100));
      issues.push({
        type: 'Page height differs',
        severity: hRatio < 0.8 ? 'major' : 'minor',
        details: `Reference scrollHeight=${refH}px · candidate scrollHeight=${candH}px (${Math.round(
          hRatio * 100
        )}% ratio)`
      });
      vtLog('ISSUE', 'Page height differs', `ref=${refH} cand=${candH}`);
    }
  }
  if (reportedPageReflow) {
    layoutScore = Math.min(layoutScore, 70);
  }
  // Only penalize layout when both headers are plausible top bars and still far apart
  if (
    typeof ref.headerY === 'number' &&
    typeof cand.headerY === 'number' &&
    Math.abs(ref.headerY - cand.headerY) >= 200 &&
    isPlausibleTopHeaderY(ref.headerY, refPageH) &&
    isPlausibleTopHeaderY(cand.headerY, candPageH)
  ) {
    layoutScore = Math.min(layoutScore, 70);
  }
  parts.push({ key: 'layout', weight: 0.04, score: layoutScore });
  vtLog('CHECK', 'Layout result', `score=${layoutScore}%`);

  // Body length — only flag large structural gaps (not minor CMS length drift)
  const refLen = ref.bodyTextLength || 0;
  const candLen = cand.bodyTextLength || 0;
  if (refLen > 800 && candLen > 0) {
    const ratio = Math.min(refLen, candLen) / Math.max(refLen, candLen);
    if (ratio < 0.7) {
      issues.push({
        type: 'Body text length differs',
        severity: ratio < 0.45 ? 'major' : 'minor',
        details: `Reference bodyChars=${refLen}, candidate bodyChars=${candLen} (${Math.round(ratio * 100)}% ratio)`
      });
      vtLog('ISSUE', 'Body text length differs', `ref=${refLen} cand=${candLen}`);
    } else {
      vtLog('CHECK', 'Body length', `OK ratio=${Math.round(ratio * 100)}%`);
    }
  }

  // Drop mirror media noise / near-duplicate image+icon flags before section grouping
  const cleanedIssues = dedupeRawIssues(issues);
  if (cleanedIssues.length !== issues.length) {
    vtLog(
      'CHECK',
      'Issue dedupe',
      `raw=${issues.length} → cleaned=${cleanedIssues.length} (dropped ${issues.length - cleanedIssues.length})`
    );
  }

  // Group nearby / same-zone pinpoint issues into SECTION bands (one highlight per section)
  const sectionIssues = groupIssuesIntoSections(cleanedIssues, ref, cand);
  const markerN = sectionIssues.filter((s) => s.marker != null).length;

  // Weighted match score (still based on fine-grained signals above)
  let totalW = 0;
  let acc = 0;
  for (const p of parts) {
    totalW += p.weight;
    acc += p.weight * p.score;
  }
  const matchScore = Math.round(acc / (totalW || 1));
  vtLog(
    'SCORE',
    'Pair match score',
    `${matchScore}% · rawIssues=${issues.length} · cleaned=${cleanedIssues.length} · sectionIssues=${sectionIssues.length} · sectionMarkers=${markerN}`
  );

  return {
    matchScore,
    scores: Object.fromEntries(parts.map((p) => [p.key, Math.round(p.score)])),
    headingReports,
    /** Section-level issues for report (grouped highlights + children detail) */
    issues: sectionIssues,
    /** Fine-grained list kept for debugging / advanced consumers */
    rawIssues: cleanedIssues,
    refStats: {
      title: ref.title,
      headingCounts: Object.fromEntries(headingLevels.map((l) => [l, (ref.headings?.[l] || []).length])),
      paragraphCount: refParaItems.length,
      imageCount: imgMatch.refCount || 0,
      bodyTextLength: ref.bodyTextLength,
      scrollHeight: ref.scrollHeight,
      ctaCount: refCtaItems.length,
      headerY: ref.headerY,
      headerH: ref.headerH,
      footerY: ref.footerY,
      footerH: ref.footerH
    },
    candidateStats: {
      title: cand.title,
      headingCounts: Object.fromEntries(headingLevels.map((l) => [l, (cand.headings?.[l] || []).length])),
      paragraphCount: candParaItems.length,
      imageCount: imgMatch.candCount || 0,
      bodyTextLength: cand.bodyTextLength,
      scrollHeight: cand.scrollHeight,
      ctaCount: candCtaItems.length,
      headerY: cand.headerY,
      headerH: cand.headerH,
      footerY: cand.footerY,
      footerH: cand.footerH
    }
  };
}

function severityRank(sev) {
  const s = String(sev || 'minor').toLowerCase();
  if (s === 'critical') return 3;
  if (s === 'major') return 2;
  return 1;
}

function worstSeverity(items) {
  let best = 'minor';
  for (const it of items || []) {
    if (severityRank(it.severity) > severityRank(best)) best = it.severity || 'minor';
  }
  return best;
}

/**
 * Group nearby element issues into sections for the report LIST,
 * but keep each child's real x/y/width/height for tight red outline boxes on the screenshot.
 */
function groupIssuesIntoSections(rawIssues, ref, cand) {
  const AGGREGATE_TYPES = new Set([
    'CTA / button labels missing on candidate',
    'Images missing on candidate',
    'Paragraph content differs',
    'Image count differs'
  ]);

  const pinpoint = [];
  const loose = [];
  for (const iss of rawIssues || []) {
    if (typeof iss.y === 'number' && iss.y >= 0) {
      pinpoint.push(iss);
    } else if (!AGGREGATE_TYPES.has(iss.type)) {
      loose.push({
        ...iss,
        isSection: false,
        marker: null,
        children: [],
        onScreenshot: false,
        note: 'No element position — listed only, not drawn on screenshot'
      });
    }
  }

  const bySide = { reference: [], candidate: [] };
  for (const iss of pinpoint) {
    const side = iss.side === 'candidate' ? 'candidate' : 'reference';
    bySide[side].push(iss);
  }

  const sections = [];
  /** Flat sequential issue numbers for report + screenshot: 1, 2, 3… (never 1.1 / 2.1) */
  let issueNum = 0;
  // Cluster only for list grouping (nearby in Y). Boxes stay per-element.
  const GAP_PX = 280;

  for (const side of ['reference', 'candidate']) {
    const meta = side === 'candidate' ? cand : ref;
    const pageH = Math.max(1, meta.scrollHeight || issPageH(bySide[side]) || 1);
    const pageW = Math.max(1, meta.pageWidth || meta.clientWidth || 1440);
    const list = bySide[side].slice().sort((a, b) => (a.y || 0) - (b.y || 0));
    if (!list.length) continue;

    const clusters = [];
    let cur = null;
    for (const iss of list) {
      const top = iss.y;
      const bot = iss.y + Math.max(16, iss.height || 40);
      if (!cur) {
        cur = { items: [iss], minY: top, maxBot: bot, side };
        continue;
      }
      if (top <= cur.maxBot + GAP_PX) {
        cur.items.push(iss);
        cur.minY = Math.min(cur.minY, top);
        cur.maxBot = Math.max(cur.maxBot, bot);
      } else {
        clusters.push(cur);
        cur = { items: [iss], minY: top, maxBot: bot, side };
      }
    }
    if (cur) clusters.push(cur);

    const headerBottom =
      (typeof meta.headerY === 'number' ? meta.headerY : 0) +
      (typeof meta.headerH === 'number' ? meta.headerH : 140) +
      48;

    for (const c of clusters) {
      const mid = (c.minY + c.maxBot) / 2;
      let zone = 'content';
      let label = 'Content section';

      if (c.minY <= Math.max(300, headerBottom) && mid <= Math.max(480, headerBottom + 120)) {
        zone = 'header';
        label = 'Header / top navigation';
      } else if (typeof meta.footerY === 'number' && c.minY >= meta.footerY - 120) {
        zone = 'footer';
        label = 'Footer';
      } else {
        const sample =
          (c.items.find((i) => /heading|h[1-6]|paragraph/i.test(i.type)) || c.items[0])?.details ||
          c.items[0]?.type ||
          'area';
        label = `Content section · “${String(sample).replace(/\s+/g, ' ').slice(0, 42)}${
          String(sample).length > 42 ? '…' : ''
        }”`;
      }

      const seen = new Set();
      const rawChildren = [];
      for (const it of c.items) {
        const key = `${it.type}|${it.details || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rawChildren.push(it);
      }

      /**
       * Merge issues that share the same product/section box into ONE highlight
       * (e.g. missing H2 + CTAs in a product card → one full-card outline).
       * Never merge leaf paragraph / logo / icon / image outlines — each keeps its own box.
       */
      const isLeafAssetIssue = (it) =>
        /^(logo|icon missing|icon extra|icon misaligned|image missing|image misaligned|image extra|logo \/ icon|feature icon missing|paragraph missing)/i.test(
          String(it.type || '')
        );

      const merged = [];
      const usedRaw = new Set();
      for (let i = 0; i < rawChildren.length; i++) {
        if (usedRaw.has(i)) continue;
        const a = rawChildren[i];
        const group = [a];
        usedRaw.add(i);
        if (a.isSectionBox && !isLeafAssetIssue(a) && typeof a.y === 'number') {
          for (let j = i + 1; j < rawChildren.length; j++) {
            if (usedRaw.has(j)) continue;
            const b = rawChildren[j];
            if (!b.isSectionBox || isLeafAssetIssue(b) || typeof b.y !== 'number') continue;
            // Same section slot (overlapping Y + similar height/position)
            const yClose = Math.abs((b.y || 0) - (a.y || 0)) < 80;
            const sameBand =
              yClose ||
              (b.y >= a.y - 20 && b.y + (b.height || 0) <= a.y + (a.height || 0) + 40);
            if (sameBand && Math.abs((b.x || 0) - (a.x || 0)) < 120) {
              group.push(b);
              usedRaw.add(j);
            }
          }
        }

        // Union box of the group
        let minX = Infinity;
        let minY = Infinity;
        let maxR = 0;
        let maxB = 0;
        for (const g of group) {
          if (typeof g.x === 'number' && typeof g.y === 'number') {
            minX = Math.min(minX, g.x);
            minY = Math.min(minY, g.y);
            maxR = Math.max(maxR, g.x + (g.width || 40));
            maxB = Math.max(maxB, g.y + (g.height || 40));
          }
        }
        const hasBox = Number.isFinite(minX) && Number.isFinite(minY);
        const detailsParts = group.map((g) => {
          const d = (g.details || g.text || '').slice(0, 100);
          return d ? `${g.type}: ${d}` : g.type;
        });
        const primary = group.find((g) => /heading|h[1-6]|product|image/i.test(g.type)) || group[0];
        const groupSeverity = worstSeverity(group);
        // Yellow only when every item in the group is a hierarchy note (not mixed with red issues)
        const allYellow =
          group.length > 0 &&
          group.every(
            (g) =>
              g.highlight === 'yellow' ||
              /heading hierarchy differs/i.test(String(g.type || ''))
          );
        merged.push({
          type:
            group.length > 1 && (primary.isSectionBox || group.some((g) => g.isSectionBox))
              ? 'Product / section differs'
              : primary.type,
          severity: groupSeverity,
          highlight: allYellow ? 'yellow' : primary.highlight || null,
          details:
            group.length > 1
              ? detailsParts.join(' · ').slice(0, 400)
              : primary.details || primary.text || '',
          side,
          isSectionBox: group.some((g) => g.isSectionBox),
          x: hasBox ? minX : primary.x,
          y: hasBox ? minY : primary.y,
          width: hasBox ? Math.max(40, maxR - minX) : primary.width,
          height: hasBox ? Math.max(40, maxB - minY) : primary.height,
          pageHeight: primary.pageHeight || pageH,
          pageWidth: primary.pageWidth || pageW
        });
      }

      const children = [];
      for (const it of merged) {
        issueNum += 1;
        const ph = Math.max(1, it.pageHeight || pageH);
        const pw = Math.max(1, it.pageWidth || pageW);
        const y = typeof it.y === 'number' ? it.y : null;
        const x = typeof it.x === 'number' ? it.x : null;
        // Cap section highlights so one box doesn't swallow half the page
        let h = Math.max(16, it.height || 28);
        let w = typeof it.width === 'number' ? Math.max(12, it.width) : null;
        if (it.isSectionBox) {
          h = Math.min(h, Math.round(ph * 0.35));
          if (w != null) w = Math.min(w, Math.round(pw * 0.98));
        }
        const useYellow =
          it.highlight === 'yellow' ||
          /heading hierarchy differs/i.test(String(it.type || ''));
        const child = {
          type: it.type,
          severity: it.severity || 'minor',
          highlight: useYellow ? 'yellow' : it.highlight || null,
          details: it.details || '',
          side,
          boxId: String(issueNum),
          marker: issueNum,
          onScreenshot: y != null,
          isSectionBox: !!it.isSectionBox
        };
        if (y != null) {
          child.y = Math.round(y);
          child.height = Math.round(h);
          child.pageHeight = ph;
          child.topPct = Math.min(99.5, Math.max(0, (y / ph) * 100));
          // Section boxes need a visible height % (min ~1.2% of page for product cards)
          const minPct = it.isSectionBox ? 1.2 : 0.12;
          child.heightPct = Math.min(35, Math.max(minPct, (h / ph) * 100));
        }
        if (x != null && w != null) {
          child.x = Math.round(x);
          child.width = Math.round(w);
          child.pageWidth = pw;
          child.leftPct = Math.min(98, Math.max(0, (x / pw) * 100));
          child.widthPct = Math.min(100, Math.max(0.4, (w / pw) * 100));
        } else if (y != null) {
          child.leftPct = 2;
          child.widthPct = 96;
        }
        children.push(child);
      }

      // Section jump target = first child box; section label is not a numbered issue
      const first = children.find((ch) => ch.onScreenshot) || children[0];
      sections.push({
        type: `${label} — differences`,
        severity: worstSeverity(children),
        details: `${children.length} difference${children.length === 1 ? '' : 's'} in this section`,
        side,
        marker: first?.marker ?? null,
        zone,
        isSection: true,
        onScreenshot: children.some((ch) => ch.onScreenshot),
        y: first?.y,
        x: first?.x,
        width: first?.width,
        height: first?.height,
        pageHeight: first?.pageHeight || pageH,
        pageWidth: first?.pageWidth || pageW,
        topPct: first?.topPct,
        leftPct: first?.leftPct,
        widthPct: first?.widthPct,
        heightPct: first?.heightPct,
        children
      });
    }
  }

  for (const iss of loose) {
    issueNum += 1;
    sections.push({
      ...iss,
      marker: issueNum,
      boxId: String(issueNum)
    });
  }

  // Keep document order of discovery (ref then cand clusters); children already 1..N
  return sections;
}

function issPageH(list) {
  let m = 0;
  for (const i of list || []) {
    if (typeof i.pageHeight === 'number' && i.pageHeight > m) m = i.pageHeight;
  }
  return m;
}

/**
 * Pad the shorter full-page PNG so ref + cand share the same pixel height.
 * Content is unchanged (dark padding only at the bottom). Markers use the shared height.
 */
async function equalizeScreenshotHeights(browser, refPath, candPath) {
  if (!browser || !refPath || !candPath) return null;
  if (!fs.existsSync(refPath) || !fs.existsSync(candPath)) return null;

  const r = readPngSize(refPath);
  const c = readPngSize(candPath);
  if (!r || !c) return null;

  const targetH = Math.max(r.height, c.height);
  if (r.height === c.height) {
    vtLog('SCREENSHOT', 'Height equalize', `already matched ${r.width}x${r.height}`);
    return { width: Math.max(r.width, c.width), height: targetH };
  }

  async function padOne(filePath, size) {
    if (size.height >= targetH) return;
    const pad = targetH - size.height;
    vtLog(
      'SCREENSHOT',
      'Padding shorter shot',
      `${path.basename(filePath)} ${size.width}x${size.height} +${pad}px → ${targetH}`
    );
    const b64 = fs.readFileSync(filePath).toString('base64');
    const context = await browser.newContext({
      viewport: { width: size.width, height: 900 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();
    try {
      await page.setContent(
        `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
          html,body{margin:0;padding:0;background:#0b1220;}
          img{display:block;width:${size.width}px;height:${size.height}px;max-width:none;}
          .pad{width:${size.width}px;height:${pad}px;background:#0b1220;}
        </style></head><body>
          <img src="data:image/png;base64,${b64}" width="${size.width}" height="${size.height}" alt="" />
          <div class="pad"></div>
        </body></html>`,
        { waitUntil: 'load', timeout: 60000 }
      );
      await page.screenshot({
        path: filePath,
        fullPage: true,
        type: 'png',
        animations: 'disabled'
      });
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  await padOne(refPath, r);
  await padOne(candPath, c);

  const r2 = readPngSize(refPath);
  const c2 = readPngSize(candPath);
  vtLog(
    'SCREENSHOT',
    'Heights after equalize',
    `ref=${r2 ? r2.width + 'x' + r2.height : '?'} · cand=${c2 ? c2.width + 'x' + c2.height : '?'}`
  );
  return {
    width: Math.max(r2?.width || 0, c2?.width || 0),
    height: Math.max(r2?.height || 0, c2?.height || 0)
  };
}

/** Re-scale marker % using shared screenshot height (padding shorter shot). */
function rescaleMarkersToHeight(issues, sharedHeight) {
  if (!sharedHeight || sharedHeight < 1) return;
  function scaleOne(box) {
    if (!box || typeof box.y !== 'number') return;
    box.pageHeight = sharedHeight;
    box.topPct = Math.min(99.5, Math.max(0, (box.y / sharedHeight) * 100));
    const h = Math.max(16, box.height || 28);
    box.heightPct = Math.min(40, Math.max(0.12, (h / sharedHeight) * 100));
  }
  for (const iss of issues || []) {
    scaleOne(iss);
    for (const ch of iss.children || []) scaleOne(ch);
  }
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

    // Scroll + lazy-load BEFORE fingerprint so mid/footer content is present
    vtLog('PREPARE', 'Full-page scroll + image wait', 'both pages (before extract)');
    await Promise.all([
      preparePageForFullScreenshot(refPage, 'Reference extract'),
      preparePageForFullScreenshot(candPage, 'Candidate extract')
    ]);

    vtLog(
      'EXTRACT',
      'Capturing page fingerprints',
      'title, H1–H6, paragraphs, CTAs, header/footer/nav, images (post-scroll)'
    );
    const [refSnap, candSnap] = await Promise.all([
      extractPageSnapshot(refPage),
      extractPageSnapshot(candPage)
    ]);
    const headingSummary = (s) =>
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
        .map((l) => `${l}=${(s.headings?.[l] || []).length}`)
        .join(' ');
    vtLog(
      'EXTRACT',
      'Reference snapshot',
      `title="${(refSnap.title || '').slice(0, 50)}" · ${headingSummary(refSnap)} · imgs=${(refSnap.images || []).length} · ctas=${(refSnap.ctas || []).length} · bodyChars=${refSnap.bodyTextLength || 0} · scrollH=${refSnap.scrollHeight || 0}`
    );
    vtLog(
      'EXTRACT',
      'Candidate snapshot',
      `title="${(candSnap.title || '').slice(0, 50)}" · ${headingSummary(candSnap)} · imgs=${(candSnap.images || []).length} · ctas=${(candSnap.ctas || []).length} · bodyChars=${candSnap.bodyTextLength || 0} · scrollH=${candSnap.scrollHeight || 0}`
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

      // Same pixel height for side-by-side (pad shorter only — content unchanged)
      if (result.screenshots.reference && result.screenshots.candidate) {
        const refShotPath = path.join(screenshotDir, result.screenshots.reference);
        const candShotPath = path.join(screenshotDir, result.screenshots.candidate);
        try {
          const eq = await equalizeScreenshotHeights(browser, refShotPath, candShotPath);
          if (eq?.height) {
            result.equalizedScreenshotHeight = eq.height;
            rescaleMarkersToHeight(result.issues, eq.height);
          }
        } catch (eqErr) {
          vtLog('SCREENSHOT', 'Height equalize skipped', eqErr?.message || eqErr);
        }
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
  waitForPageAssets,
  equalizeScreenshotHeights,
  groupIssuesIntoSections,
  normalizeText,
  normalizeHeadingText,
  normalizeContentText,
  textSimilarity,
  fuzzyMatchItemLists,
  matchImages,
  matchIcons,
  matchIconSections,
  basenameKey,
  stemBasenameKey,
  stripContentHashFromFilename,
  isContentHashedFilename,
  isStrongImageBasename,
  jaccard,
  isIconLikeAsset,
  isIconPixelSize,
  ICON_MIN_PX,
  ICON_MAX_PX,
  vtLog,
  vtSection
};
