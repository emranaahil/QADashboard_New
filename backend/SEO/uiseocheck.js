#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('../shared/loadEnv');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  // Repo root typically doesn't have playwright installed.
  // Your existing Playwright install is under ./backend.
  ({ chromium } = require('../../node_modules/playwright'));
}

const {
  discoverSiteUrlsByCrawl,
  DEFAULT_MAX_URLS: CRAWL_MAX_URLS
} = require('../shared/services/siteUrlCrawler');
const {
  assertHttpSecurityHeaders,
  HEADER_CHECK_COUNT
} = require('../shared/httpSecurityHeaders');
const {
  buildSeoReportExportPayload,
  buildSeoScannedUrlsList
} = require('../shared/seoReportCsv');
const {
  fetchPageSpeedInsightsBoth,
  normalizePageSpeedBundle,
  computePageSpeedAveragePercent,
  computeStrategyAveragePercent
} = require('../shared/services/pageSpeedInsights');
const {
  buildRichResultsTestUrl,
  captureRichResultsTest
} = require('../shared/services/richResultsTest');

const SEO_CSV_CLIENT_SCRIPT = fs.readFileSync(
  path.join(__dirname, '../shared/seoReportCsvClient.js'),
  'utf8'
);
const SEO_DETAIL_CLIENT_SCRIPT = fs.readFileSync(
  path.join(__dirname, '../shared/seoReportDetailClient.js'),
  'utf8'
);

const PAGE_DETAIL_LAZY_THRESHOLD = 80;

function log(...args) {
  process.stdout.write(args.join(' ') + '\n');
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeBaseUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') throw new Error('mainUrl is required');
  let url = inputUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/$/, '');
  return url;
}

function extractHostDomain(inputUrl) {
  try {
    return new URL(normalizeBaseUrl(inputUrl)).host;
  } catch {
    return String(inputUrl || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .split('/')[0];
  }
}

function stripHashAndQuery(u) {
  try {
    const urlObj = new URL(u);
    urlObj.hash = '';
    urlObj.search = '';
    return urlObj.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveDomSettleTuning(timeoutMs) {
  const quietMs = parseInt(process.env.QA_SEO_DOM_QUIET_MS || '', 10);
  const maxWaitMs = parseInt(process.env.QA_SEO_DOM_SETTLE_MS || '', 10);
  const pollMs = parseInt(process.env.QA_SEO_DOM_POLL_MS || '', 10);
  return {
    quietMs: Number.isFinite(quietMs) && quietMs > 0 ? quietMs : 600,
    maxWaitMs: Number.isFinite(maxWaitMs) && maxWaitMs > 0
      ? maxWaitMs
      : Math.min(12000, Math.max(4000, Math.floor(timeoutMs * 0.35))),
    pollMs: Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 200
  };
}

async function scrollPageForLazyContent(page) {
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        const distance = 500;
        let total = 0;
        const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          total += distance;
          if (total >= maxScroll) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 80);
      });
    });
  } catch {
    // ignore scroll errors
  }
}

async function waitForDomStability(page, { quietMs, maxWaitMs, pollMs }) {
  const deadline = Date.now() + maxWaitMs;
  let lastSignature = null;
  let stableSince = null;

  while (Date.now() < deadline) {
    const signature = await page.evaluate(() => ({
      nodes: document.querySelectorAll('*').length,
      htmlLen: document.documentElement.innerHTML.length,
      anchors: document.querySelectorAll('a[href]').length,
      ready: document.readyState
    })).catch(() => null);

    if (!signature) break;

    const key = `${signature.nodes}|${signature.htmlLen}|${signature.anchors}|${signature.ready}`;
    if (key === lastSignature && signature.ready === 'complete') {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= quietMs) return;
    } else {
      lastSignature = key;
      stableSince = null;
    }
    await sleep(pollMs);
  }
}

async function preparePageForAudit(page, timeoutMs) {
  const loadBudget = Math.min(8000, Math.max(2000, Math.floor(timeoutMs * 0.25)));
  await page.waitForLoadState('load', { timeout: loadBudget }).catch(() => {});
  await sleep(300);

  const tuning = resolveDomSettleTuning(timeoutMs);
  await scrollPageForLazyContent(page);
  await waitForDomStability(page, tuning);

  // Some themes inject nav drawers / localization lists after the first settle pass.
  await scrollPageForLazyContent(page);
  await waitForDomStability(page, {
    ...tuning,
    maxWaitMs: Math.min(tuning.maxWaitMs, 5000)
  });
}

function resolveScanTuning(mode, urlCount) {
  const envConcurrency = parseInt(process.env.QA_SEO_CONCURRENCY || '', 10);
  const envTimeout = parseInt(process.env.QA_SEO_TIMEOUT_MS || '', 10);
  const envRetry = parseInt(process.env.QA_SEO_RETRY_COUNT || '', 10);
  const envBatch = parseInt(process.env.QA_SEO_BATCH_SIZE || '', 10);
  const envBatchDelay = parseInt(process.env.QA_SEO_BATCH_DELAY_MS || '', 10);

  if (mode === 'full') {
    return {
      concurrency: Number.isFinite(envConcurrency) && envConcurrency > 0 ? envConcurrency : 3,
      timeoutMs: Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 45000,
      retryCount: Number.isFinite(envRetry) && envRetry >= 0 ? envRetry : 3,
      batchSize: Number.isFinite(envBatch) && envBatch > 0 ? envBatch : (parseInt(process.argv[3], 10) || 50),
      delayBetweenBatches: Number.isFinite(envBatchDelay) && envBatchDelay >= 0
        ? envBatchDelay
        : (parseInt(process.argv[2], 10) || 1000),
      retryDelayMs: 2500
    };
  }

  let concurrency = 3;
  if (urlCount > 100) concurrency = 1;
  else if (urlCount > 40) concurrency = 2;

  let timeoutMs = 15000;
  if (urlCount > 100) timeoutMs = 45000;
  else if (urlCount > 50) timeoutMs = 35000;
  else if (urlCount > 20) timeoutMs = 25000;

  let retryCount = urlCount > 20 ? 3 : 3;

  if (Number.isFinite(envConcurrency) && envConcurrency > 0) concurrency = envConcurrency;
  if (Number.isFinite(envTimeout) && envTimeout > 0) timeoutMs = envTimeout;
  if (Number.isFinite(envRetry) && envRetry >= 0) retryCount = envRetry;

  return {
    concurrency,
    timeoutMs,
    retryCount,
    batchSize: Number.isFinite(envBatch) && envBatch > 0 ? envBatch : (parseInt(process.argv[3], 10) || 50),
    delayBetweenBatches: Number.isFinite(envBatchDelay) && envBatchDelay >= 0
      ? envBatchDelay
      : (urlCount > 80 ? 2000 : (parseInt(process.argv[2], 10) || 1000)),
    retryDelayMs: 2500
  };
}

const TRANSIENT_SCAN_ERROR_RE =
  /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_FAILED|ERR_ABORTED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i;

function isTransientScanError(err) {
  const msg = String(err?.message || err || '');
  return (
    TRANSIENT_SCAN_ERROR_RE.test(msg) ||
    /timeout/i.test(msg) ||
    /target (page|context|browser).*(closed|crashed)/i.test(msg) ||
    /navigation.*(failed|interrupted|aborted)/i.test(msg)
  );
}

function computeRetryDelayMs(attempt, baseMs, err) {
  if (attempt <= 0) return 0;
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const transientBonus = isTransientScanError(err) ? 2500 : 0;
  const jitter = Math.floor(Math.random() * 600);
  return Math.min(45000, exponential + transientBonus + jitter);
}

function formatScanFailure(err, { attempts = 1 } = {}) {
  const raw = String(err?.message || err || 'unknown error');
  const firstLine = raw
    .split('\n')[0]
    .replace(/\u001b\[[0-9;]*m/g, '')
    .trim();
  const attemptLabel = attempts > 1 ? ` after ${attempts} attempts` : '';
  if (/timeout/i.test(firstLine)) {
    return `Page scan failed${attemptLabel} (navigation timeout: ${firstLine})`;
  }
  if (TRANSIENT_SCAN_ERROR_RE.test(firstLine)) {
    return `Page scan failed${attemptLabel} (transient network error: ${firstLine})`;
  }
  return `Page scan failed${attemptLabel} (${firstLine})`;
}

async function navigatePageWithRetry(page, url, timeoutMs) {
  const strategies = [
    { waitUntil: 'domcontentloaded', timeout: timeoutMs },
    { waitUntil: 'commit', timeout: Math.min(timeoutMs, 25000) },
    { waitUntil: 'load', timeout: timeoutMs }
  ];
  const maxPasses = 2;
  let lastErr;

  for (let pass = 0; pass <= maxPasses; pass++) {
    if (pass > 0) {
      await sleep(1000 * pass);
    }
    for (const strategy of strategies) {
      try {
        const response = await page.goto(url, strategy);
        return response;
      } catch (e) {
        lastErr = e;
        if (!isTransientScanError(e)) {
          throw e;
        }
      }
    }
  }

  throw lastErr || new Error(`Navigation failed for ${url}`);
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'seo-audit-playwright/1.0 (+node)' }
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(id);
  }
}

function concurrencyMapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let active = 0;

  return new Promise((resolve) => {
    const launch = () => {
      while (active < limit && nextIndex < items.length) {
        const idx = nextIndex++;
        active++;
        Promise.resolve(worker(items[idx], idx))
          .then((r) => {
            results[idx] = r;
          })
          .catch((e) => {
            results[idx] = { error: true, message: e?.message || String(e) };
          })
          .finally(() => {
            active--;
            if (nextIndex >= items.length && active === 0) resolve(results);
            else launch();
          });
      }
    };
    launch();
  });
}

function parseCommentBlocks(html) {
  if (!html) return [];
  const re = /<!--([\s\S]*?)-->/g;
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m[1] || '');
  return blocks;
}

function countOccurrencesFromPattern(pattern, text) {
  if (!text) return 0;
  const re = new RegExp(pattern, 'gi');
  const m = text.match(re);
  return m ? m.length : 0;
}

function isEmptyValue(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * Heading hierarchy rules:
 * - First visible heading in DOM order must be H1
 * - Valid step: curr <= prev OR curr === prev + 1
 * - Invalid step: curr > prev + 1 (skipped level)
 * - Empty or hidden h1-h6 = fail
 */
function computeHierarchyStatusFromHeadings(headings) {
  if (!headings || !headings.length) {
    return { ok: false, reason: 'No h1-h6 headings found in DOM' };
  }

  for (const h of headings) {
    if (h.empty) {
      return { ok: false, reason: `Empty h${h.level} heading` };
    }
    if (h.hidden) {
      return { ok: false, reason: `Hidden h${h.level} heading` };
    }
  }

  const levels = headings.map((h) => h.level);

  if (levels[0] !== 1) {
    return { ok: false, reason: `First heading is h${levels[0]} (expected h1)` };
  }

  let prev = levels[0];
  for (let i = 1; i < levels.length; i++) {
    const curr = levels[i];
    if (curr > prev + 1) {
      return { ok: false, reason: `h${prev} -> h${curr} (skipped level)` };
    }
    prev = curr;
  }

  return { ok: true, reason: 'Valid heading hierarchy' };
}

const VAGUE_HEADING_RE =
  /^(welcome( to)?|home|about( us)?|contact( us)?|faq|blog|news|products?|services?|overview|introduction|summary|section|untitled|default|title|heading|content|information|details?|read more|learn more|click here|get started|subscribe|sign up|log ?in|register|our story|what we do|features?|benefits?)$/i;

function normalizeContentText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForSimilarity(text) {
  const norm = normalizeContentText(text);
  if (!norm) return new Set();
  return new Set(norm.split(' ').filter((w) => w.length > 2));
}

function jaccardSimilarity(setA, setB) {
  if (!setA.size && !setB.size) return 1;
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union ? inter / union : 0;
}

function isNonDescriptiveHeading(text, level) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.length <= 2) return true;
  if (/^[^a-zA-Z0-9]+$/.test(t)) return true;
  if (VAGUE_HEADING_RE.test(t)) return true;
  if (t.length > 120) return true;
  if (level <= 2 && t.split(/\s+/).length < 2 && t.length < 8) return true;
  return false;
}

function auditDescriptiveHeadings(headings, addIssue) {
  const vague = [];
  for (const h of headings || []) {
    if (h.empty || h.hidden) continue;
    if (isNonDescriptiveHeading(h.text, h.level)) {
      vague.push(`h${h.level}: "${String(h.text).slice(0, 60)}${h.text.length > 60 ? '…' : ''}"`);
    }
  }
  if (vague.length) {
    addIssue(
      'minor',
      'Non-descriptive headings',
      `Some H1–H6 labels look too generic, too short, too long, or unclear for users and search engines (e.g. "Welcome", "Home", "Learn more"). Prefer specific, topic-focused wording. Flagged: ${vague.slice(0, 8).join('; ')}${vague.length > 8 ? '…' : ''}`
    );
  }
}

function countDuplicateParagraphsOnPage(paragraphs) {
  const normToCount = new Map();
  for (const p of paragraphs || []) {
    const norm = normalizeContentText(p);
    if (norm.length < 50) continue;
    normToCount.set(norm, (normToCount.get(norm) || 0) + 1);
  }
  return [...normToCount.values()].filter((c) => c >= 2).length;
}

function auditDuplicateNonH1Headings(headings, addIssue) {
  const seen = new Map();
  const dupes = [];
  for (const h of headings || []) {
    if (h.empty || h.hidden || h.level === 1) continue;
    const key = normalizeContentText(h.text);
    if (!key || key.length < 3) continue;
    if (seen.has(key)) dupes.push(`h${h.level}: "${String(h.text).slice(0, 50)}${h.text.length > 50 ? '…' : ''}"`);
    else seen.set(key, true);
  }
  if (dupes.length) {
    addIssue(
      'minor',
      'Duplicate heading text on page',
      `Repeated heading text detected: ${dupes.slice(0, 6).join('; ')}${dupes.length > 6 ? '…' : ''}`
    );
  }
}

const META_DESC_MIN_LEN = 50;
const META_DESC_MAX_LEN = 160;

function countMetaTagsInSource(domHtml, name) {
  const safe = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return countOccurrencesFromPattern(`<\\s*meta\\b[^>]*\\bname\\s*=\\s*["']${safe}["'][^>]*>`, domHtml);
}

function extractMetaContentFromSourceHtml(domHtml, name) {
  const safe = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta\\b[^>]*\\bname\\s*=\\s*["']${safe}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\bname\\s*=\\s*["']${safe}["']`, 'i')
  ];
  for (const re of patterns) {
    const match = String(domHtml || '').match(re);
    if (match) return (match[1] || '').trim();
  }
  return '';
}

function auditDescriptionAndKeywordsMinor(domHtml, domExtract, addIssue) {
  const description = String(domExtract.description || '').trim();
  const keywords = String(domExtract.keywords || '').trim();
  const metaDescCount = countMetaTagsInSource(domHtml, 'description');
  const metaKeywordsCount = countMetaTagsInSource(domHtml, 'keywords');

  // P2: only emit description issues when something is actually wrong (not when healthy).
  if (metaDescCount === 0) {
    addIssue(
      'minor',
      'Page meta description',
      'Not set — no meta[name="description"] tag found in source.'
    );
  } else if (isEmptyValue(description)) {
    addIssue(
      'minor',
      'Page meta description',
      'Empty — meta[name="description"] tag exists but content is blank.'
    );
  } else {
    const notes = [];
    if (description.length < META_DESC_MIN_LEN) {
      notes.push(`short (${description.length} chars, recommended ≥ ${META_DESC_MIN_LEN})`);
    }
    if (description.length > META_DESC_MAX_LEN) {
      notes.push(`long (${description.length} chars, recommended ≤ ${META_DESC_MAX_LEN})`);
    }
    if (notes.length) {
      addIssue(
        'minor',
        'Page meta description',
        `${description} — ${notes.join('; ')}`
      );
    }
  }

  if (metaDescCount > 1) {
    addIssue(
      'minor',
      `meta description tags (${metaDescCount} found, expected 1)`,
      'Each page should have one meta[name="description"] tag.'
    );
  }

  // Keywords are optional for modern SEO — only flag empty present tag or duplicates.
  if (metaKeywordsCount > 0 && isEmptyValue(keywords)) {
    addIssue(
      'minor',
      'Page meta keywords',
      'Empty — meta[name="keywords"] tag exists but content is blank.'
    );
  }

  if (metaKeywordsCount > 1) {
    addIssue(
      'minor',
      `meta keywords tags (${metaKeywordsCount} found, expected 1)`,
      'Each page should have at most one meta[name="keywords"] tag.'
    );
  }
}

/** Count empty content only on SEO-relevant meta tags (reduces noise from trackers). */
function countEmptySeoMetaContent(html) {
  const re = /<\s*meta\b[^>]*>/gi;
  let count = 0;
  let m;
  while ((m = re.exec(html || '')) !== null) {
    const tag = m[0];
    const isSeoName =
      /\bname\s*=\s*["'](description|keywords|robots|viewport|author|googlebot|robots)["']/i.test(tag);
    const isSeoProp = /\bproperty\s*=\s*["'](?:og|twitter):[^"']+["']/i.test(tag);
    if (!isSeoName && !isSeoProp) continue;
    if (/\bcontent\s*=\s*["']\s*["']/i.test(tag)) count += 1;
  }
  return count;
}

function sortMinorIssuesForDisplay(issues) {
  const list = [...(issues || [])];
  const priority = (line) => {
    const text = String(line || '');
    if (text.startsWith('Page meta description:')) return 0;
    if (text.startsWith('Page meta keywords:')) return 1;
    return 2;
  };
  return list.sort((a, b) => priority(a) - priority(b));
}

function applyCrossPageContentDuplicates(pages, { exactThreshold = 0.95, nearThreshold = 0.85 } = {}) {
  const profiles = pages
    .map((p) => ({
      url: p.url,
      tokens: tokenizeForSimilarity(p.contentBodyText || '')
    }))
    .filter((p) => p.tokens.size >= 20);

  const matchesByUrl = new Map();

  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const sim = jaccardSimilarity(profiles[i].tokens, profiles[j].tokens);
      if (sim < nearThreshold) continue;

      const entryA = { other: profiles[j].url, sim };
      const entryB = { other: profiles[i].url, sim };
      if (!matchesByUrl.has(profiles[i].url)) matchesByUrl.set(profiles[i].url, []);
      if (!matchesByUrl.has(profiles[j].url)) matchesByUrl.set(profiles[j].url, []);
      matchesByUrl.get(profiles[i].url).push(entryA);
      matchesByUrl.get(profiles[j].url).push(entryB);
    }
  }

  for (const p of pages) {
    const matches = (matchesByUrl.get(p.url) || []).sort((a, b) => b.sim - a.sim);
    if (!matches.length) continue;

    const exact = matches.filter((m) => m.sim >= exactThreshold);
    const near = matches.filter((m) => m.sim >= nearThreshold && m.sim < exactThreshold);

    if (exact.length) {
      const others = exact
        .slice(0, 3)
        .map((m) => `${m.other} (${Math.round(m.sim * 100)}%)`)
        .join(', ');
      p.issues.minor.push(
        `Duplicate body content across pages: highly similar to ${others}${exact.length > 3 ? '…' : ''}`
      );
    }
    if (near.length) {
      const others = near
        .slice(0, 3)
        .map((m) => `${m.other} (${Math.round(m.sim * 100)}%)`)
        .join(', ');
      p.issues.minor.push(
        `Near-duplicate body content across pages: similar to ${others}${near.length > 3 ? '…' : ''}`
      );
    }
  }
}

function buildSeoScore({ criticalCount, minorCount }) {
  const score = 100 - criticalCount * 10 - minorCount * 3;
  return clamp(score, 0, 100);
}

function averageSeoScore(pages) {
  if (!pages.length) return 0;
  const total = pages.reduce((sum, page) => sum + (page.seoScore || 0), 0);
  return Math.round(total / pages.length);
}

function computeBadLinkCounts(html) {
  const hrefHash = (html.match(/href\s*=\s*(['"])#\1/gi) || []).length;
  const jsVoid = (html.match(/javascript\s*:\s*void\s*\(\s*0\s*\)/gi) || []).length;
  return { hrefHash, jsVoid };
}

function isPresentationRoleMarkup(tag) {
  return /role\s*=\s*["'](?:presentation|none)["']/i.test(tag || '');
}

function resolveAbsoluteUrl(pageUrl, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, pageUrl).href;
  } catch {
    return raw;
  }
}

function getSrcFromImgMarkup(tag) {
  const quoted = tag.match(/\bsrc\s*=\s*(["'])([\s\S]*?)\1/i);
  if (quoted) return quoted[2];
  const unquoted = tag.match(/\bsrc\s*=\s*([^\s>]+)/i);
  return unquoted ? unquoted[1] : '';
}

function collectMissingAltElements(html, pageUrl) {
  const elements = [];
  const tagPatterns = [/<img\b[\s\S]*?>/gi, /<input\b[^>]*\btype\s*=\s*["']image["'][^>]*>/gi];

  for (const tagRe of tagPatterns) {
    let match;
    while ((match = tagRe.exec(html)) !== null) {
      const tag = match[0];
      if (isPresentationRoleMarkup(tag)) continue;
      const altValue = getAltValueFromImgMarkup(tag);
      if (altValue === null) {
        elements.push({
          issueCode: 'missing-alt',
          elementType: 'img',
          elementUrl: resolveAbsoluteUrl(pageUrl, getSrcFromImgMarkup(tag)),
          elementText: '',
          detail: 'missing alt attribute'
        });
      } else if (altValue.trim() === '') {
        elements.push({
          issueCode: 'missing-alt',
          elementType: 'img',
          elementUrl: resolveAbsoluteUrl(pageUrl, getSrcFromImgMarkup(tag)),
          elementText: '',
          detail: 'empty alt=""'
        });
      }
    }
  }

  return elements;
}

function buildIssueElements(domHtml, domExtract, pageUrl) {
  const elements = collectMissingAltElements(domHtml, pageUrl);

  for (const item of domExtract.svgMissingAccessibleName || []) {
    elements.push({
      issueCode: 'missing-alt',
      elementType: 'svg',
      elementUrl: '',
      elementText: item.accessibleName || '',
      detail: 'SVG role=img without accessible name'
    });
  }

  for (const link of domExtract.hrefHashLinks || []) {
    elements.push({
      issueCode: 'bad-href-hash',
      elementType: 'a',
      elementUrl: link.href || '#',
      elementText: link.text || '',
      detail: 'href="#" placeholder link'
    });
  }

  for (const link of domExtract.jsVoidLinks || []) {
    elements.push({
      issueCode: 'bad-js-void',
      elementType: 'a',
      elementUrl: link.href || '',
      elementText: link.text || '',
      detail: 'javascript:void(0) link'
    });
  }

  const h1Headings = (domExtract.headingSequence || []).filter((h) => h.level === 1);
  if (h1Headings.length === 0) {
    elements.push({
      issueCode: 'missing-h1',
      elementType: 'heading',
      elementUrl: '',
      elementText: '',
      detail: 'No h1 tag found in DOM'
    });
  }
  if (h1Headings.length > 1) {
    for (const h of h1Headings) {
      elements.push({
        issueCode: 'multiple-h1',
        elementType: 'heading',
        elementUrl: '',
        elementText: h.text || '',
        detail: h.hidden ? 'hidden h1 tag' : 'visible h1 tag'
      });
    }
  }

  const h1TextCounts = {};
  for (const h of h1Headings) {
    const key = String(h.text || '').trim().toLowerCase();
    if (!key) continue;
    h1TextCounts[key] = (h1TextCounts[key] || 0) + 1;
  }
  for (const [text, count] of Object.entries(h1TextCounts)) {
    if (count < 2) continue;
    const original = h1Headings.find((h) => String(h.text || '').trim().toLowerCase() === text);
    elements.push({
      issueCode: 'duplicate-h1',
      elementType: 'heading',
      elementUrl: '',
      elementText: original?.text || text,
      detail: `duplicate h1 text (${count} occurrences)`
    });
  }

  const hierarchyStatus = computeHierarchyStatusFromHeadings(domExtract.headingSequence || []);
  if (!hierarchyStatus.ok) {
    const sequence = (domExtract.headingSequence || [])
      .filter((h) => !h.hidden)
      .map((h) => `H${h.level}${h.text ? `: ${h.text.slice(0, 40)}` : ''}`)
      .join(' → ');
    elements.push({
      issueCode: 'broken-hierarchy',
      elementType: 'heading',
      elementUrl: '',
      elementText: sequence,
      detail: hierarchyStatus.reason
    });
  }

  const description = String(domExtract.description || '').trim();
  elements.push({
    issueCode: 'meta-description',
    elementType: 'meta',
    elementUrl: '',
    elementText: description,
    detail: description ? 'meta description value' : 'meta description missing or empty'
  });

  const keywords = String(domExtract.keywords || '').trim();
  elements.push({
    issueCode: 'meta-keywords',
    elementType: 'meta',
    elementUrl: '',
    elementText: keywords,
    detail: keywords ? 'meta keywords value' : 'meta keywords missing or empty'
  });

  return elements;
}

function getAltValueFromImgMarkup(tag) {
  if (/\balt\b(?=\s*(?:>|\/))/i.test(tag) && !/\balt\s*=/i.test(tag)) {
    return '';
  }
  const altM = tag.match(/\balt\s*=\s*(["'])([\s\S]*?)\1/i);
  if (altM) return altM[2];
  const unquoted = tag.match(/\balt\s*=\s*([^\s>]+)/i);
  if (unquoted) return unquoted[1];
  return null;
}

/** Single source of truth for image alt counts from rendered page HTML. */
function computeAltCounts(html) {
  const tags = [];
  const imgTagRe = /<img\b[\s\S]*?>/gi;
  const inputImgRe = /<input\b[^>]*\btype\s*=\s*["']image["'][^>]*>/gi;
  let match;
  while ((match = imgTagRe.exec(html)) !== null) tags.push(match[0]);
  while ((match = inputImgRe.exec(html)) !== null) tags.push(match[0]);

  let missingAltAttr = 0;
  let emptyAlt = 0;

  for (const tag of tags) {
    const altValue = getAltValueFromImgMarkup(tag);
    if (altValue === null) {
      if (isPresentationRoleMarkup(tag)) continue;
      missingAltAttr += 1;
    } else if (altValue.trim() === '') {
      emptyAlt += 1;
    }
  }

  return {
    missingAltAttr,
    emptyAlt,
    missingAlt: missingAltAttr + emptyAlt
  };
}

function countMissingOpenGraphTags(domHtml, domValues) {
  let missing = 0;
  for (const tag of OPEN_GRAPH_META) {
    const present = countOccurrencesFromPattern(metaTagPattern(tag.attr, tag.value), domHtml) > 0;
    const domValue = domValues[tag.label];
    if (!present || isEmptyValue(domValue)) missing += 1;
  }
  return missing;
}

/** Open Graph meta tags (Critical when missing or empty). */
const OPEN_GRAPH_META = [
  { label: 'og:title', attr: 'property', value: 'og:title' },
  { label: 'og:description', attr: 'property', value: 'og:description' },
  { label: 'og:image', attr: 'property', value: 'og:image' },
  { label: 'og:image:alt', attr: 'property', value: 'og:image:alt' },
  { label: 'og:url', attr: 'property', value: 'og:url' },
  { label: 'og:type', attr: 'property', value: 'og:type' },
  { label: 'og:site_name', attr: 'property', value: 'og:site_name' },
  { label: 'og:locale', attr: 'property', value: 'og:locale' }
];

/** Twitter Card tags (Minor when missing or empty). */
const TWITTER_CARD_META = [
  { label: 'twitter:card', attr: 'name', value: 'twitter:card' },
  { label: 'twitter:title', attr: 'name', value: 'twitter:title' },
  { label: 'twitter:description', attr: 'name', value: 'twitter:description' },
  { label: 'twitter:image', attr: 'name', value: 'twitter:image' }
];

function metaTagPattern(attr, value) {
  const safe = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `<\\s*meta[^>]+${attr}\\s*=\\s*["']${safe}["']`;
}

function auditMetaTagSet(domHtml, domValues, tags, severity, missingLabel, addIssue) {
  const missing = [];
  const empty = [];

  for (const tag of tags) {
    const present = countOccurrencesFromPattern(metaTagPattern(tag.attr, tag.value), domHtml) > 0;
    const domValue = domValues[tag.label];
    if (!present) missing.push(tag.label);
    else if (isEmptyValue(domValue)) empty.push(tag.label);
  }

  if (missing.length) {
    addIssue(severity, missingLabel, `Missing: ${missing.join(', ')}`);
  }
  for (const label of empty) {
    addIssue(severity, `Empty ${label}`, `${label} tag exists but content is empty`);
  }
}

function auditOpenGraphTags(domHtml, domValues, addIssue) {
  auditMetaTagSet(domHtml, domValues, OPEN_GRAPH_META, 'critical', 'Missing Open Graph tags', addIssue);
  auditMetaTagSet(domHtml, domValues, TWITTER_CARD_META, 'minor', 'Missing Twitter Card tags', addIssue);
}

const SCHEMA_TYPE_REQUIRED = {
  Organization: ['name'],
  WebSite: ['name'],
  FAQPage: ['mainEntity'],
  Article: ['headline'],
  BlogPosting: ['headline'],
  NewsArticle: ['headline'],
  Product: ['name'],
  BreadcrumbList: ['itemListElement'],
  LocalBusiness: ['name'],
  Person: ['name']
};

const PLACEHOLDER_CONTENT_RE =
  /\b(lorem ipsum|placeholder text|your text here|insert text|sample text|todo:|tbd|coming soon|under construction)\b/i;

const FAQ_URL_RE = /\/(faq|faqs|help|support|questions?)(\/|$|\?|#)/i;

/**
 * Parse <meta name="robots" content="..."> directives as whole tokens.
 * Avoids false positives like treating "noindex" as both noindex and index
 * (substring "index" inside "noindex").
 */
function extractRobotsMetaContents(html) {
  const contents = [];
  const re = /<\s*meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html || '')) !== null) {
    const tag = m[0];
    if (!/\bname\s*=\s*["']robots["']/i.test(tag)) continue;
    const cm = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (cm) contents.push(String(cm[1] || '').trim());
  }
  return contents;
}

function tokenizeRobotsDirectives(content) {
  const tokens = new Set();
  for (const part of String(content || '').split(/[,;\s]+/)) {
    const t = part.trim().toLowerCase();
    if (t) tokens.add(t);
  }
  // Google: "none" ≡ noindex,nofollow; "all" ≡ index,follow
  if (tokens.has('none')) {
    tokens.add('noindex');
    tokens.add('nofollow');
  }
  if (tokens.has('all')) {
    tokens.add('index');
    tokens.add('follow');
  }
  return tokens;
}

function analyzeRobotsMetaConflicts(html) {
  const contents = extractRobotsMetaContents(html);
  const tokens = new Set();
  for (const c of contents) {
    for (const t of tokenizeRobotsDirectives(c)) tokens.add(t);
  }
  return {
    contents,
    tokens,
    hasNoindex: tokens.has('noindex'),
    hasIndex: tokens.has('index'),
    hasNofollow: tokens.has('nofollow'),
    hasFollow: tokens.has('follow'),
    /** True only when both opposing index directives appear as whole tokens */
    indexConflict: tokens.has('noindex') && tokens.has('index'),
    /** True only when both opposing follow directives appear as whole tokens */
    followConflict: tokens.has('nofollow') && tokens.has('follow')
  };
}

function formatGeoIssue(name, detail) {
  return `${name}: ${detail}`;
}

/**
 * GEO issue severity tags (same place in GEO card; different badges).
 * Critical = real structured-data failures
 * Minor = quality / structure gaps
 * Warning = common / noisy / advanced location signals
 */
function inferGeoSeverityFromText(text) {
  const t = String(text || '');
  if (/^No Schema\.org structured data/i.test(t)) return 'critical';
  if (/^Invalid Schema\.org structured data/i.test(t)) return 'critical';
  if (/^Invalid GeoJSON/i.test(t)) return 'critical';
  if (/^Map present without GeoJSON/i.test(t)) return 'warning';
  if (/^Placeholder content detected/i.test(t)) return 'warning';
  if (/^Outdated copyright year/i.test(t)) return 'warning';
  if (/^Invalid Microdata/i.test(t)) return 'minor';
  if (/^Invalid RDFa/i.test(t)) return 'minor';
  if (/^Missing FAQ section/i.test(t)) return 'minor';
  if (/^Semantic HTML issue/i.test(t)) return 'minor';
  if (/^Outdated content date/i.test(t)) return 'minor';
  return 'critical';
}

function geoIssueText(entry) {
  if (entry == null) return '';
  if (typeof entry === 'string') return entry;
  if (entry.text) return String(entry.text);
  if (entry.name != null) return formatGeoIssue(entry.name, entry.detail);
  return String(entry);
}

function geoIssueSeverity(entry) {
  if (entry && typeof entry === 'object' && entry.severity) {
    return entry.severity;
  }
  return inferGeoSeverityFromText(geoIssueText(entry));
}

function splitGeoIssuesBySeverity(geoIssues) {
  const critical = [];
  const minor = [];
  const warning = [];
  for (const entry of geoIssues || []) {
    const text = geoIssueText(entry);
    if (!text) continue;
    const sev = geoIssueSeverity(entry);
    if (sev === 'warning') warning.push(text);
    else if (sev === 'minor') minor.push(text);
    else critical.push(text);
  }
  return { critical, minor, warning };
}

function countGeoForSeoScore(geoIssues) {
  const split = splitGeoIssuesBySeverity(geoIssues);
  return {
    critical: split.critical.length,
    minor: split.minor.length,
    warning: split.warning.length
  };
}

function countCriticalIssues(issues) {
  const geo = countGeoForSeoScore(issues.geo);
  return (issues.critical?.length || 0) + geo.critical;
}

function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html || '')) !== null) {
    const raw = (match[1] || '').trim();
    if (raw) blocks.push(raw);
  }
  return blocks;
}

function flattenSchemaNodes(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const item of node) flattenSchemaNodes(item, acc);
    return acc;
  }
  acc.push(node);
  if (Array.isArray(node['@graph'])) flattenSchemaNodes(node['@graph'], acc);
  return acc;
}

function schemaTypeName(typeValue) {
  if (!typeValue) return '';
  if (Array.isArray(typeValue)) return typeValue.map((t) => String(t)).join(', ');
  return String(typeValue);
}

function hasSchemaOrgContext(node) {
  const ctx = node['@context'];
  if (!ctx) return false;
  const values = Array.isArray(ctx) ? ctx : [ctx];
  return values.some((v) => /schema\.org/i.test(String(v)));
}

function validateSchemaOrgBlocks(blocks, { requirePresent = true } = {}) {
  const errors = [];
  const typesFound = new Set();

  if (!blocks.length) {
    if (requirePresent) {
      errors.push('No Schema.org JSON-LD found on page');
    }
    return { errors, typesFound: [] };
  }

  for (let i = 0; i < blocks.length; i++) {
    let parsed;
    try {
      parsed = JSON.parse(blocks[i]);
    } catch (e) {
      errors.push(`JSON-LD block ${i + 1} is invalid JSON (${e.message})`);
      continue;
    }

    const nodes = flattenSchemaNodes(parsed);
    if (!nodes.length) {
      errors.push(`JSON-LD block ${i + 1} contains no schema nodes`);
      continue;
    }

    for (const node of nodes) {
      if (!hasSchemaOrgContext(node)) {
        errors.push('Schema node missing valid @context (schema.org)');
        continue;
      }

      const typeName = schemaTypeName(node['@type']);
      if (!typeName) {
        errors.push('Schema node missing @type');
        continue;
      }

      typesFound.add(typeName);

      for (const [ruleType, requiredFields] of Object.entries(SCHEMA_TYPE_REQUIRED)) {
        if (!typeName.includes(ruleType)) continue;
        for (const field of requiredFields) {
          const value = node[field];
          if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
            errors.push(`${ruleType} schema missing required field "${field}"`);
          }
        }
      }

      if (typeName.includes('FAQPage')) {
        const entities = Array.isArray(node.mainEntity) ? node.mainEntity : node.mainEntity ? [node.mainEntity] : [];
        if (!entities.length) {
          errors.push('FAQPage schema has empty mainEntity');
        } else {
          for (const entity of entities) {
            const entityType = schemaTypeName(entity['@type']);
            if (!entityType.includes('Question')) continue;
            if (!entity.name || !String(entity.name).trim()) {
              errors.push('FAQPage Question missing name');
            }
            const answer = entity.acceptedAnswer;
            const answerText = answer?.text || answer?.name;
            if (!answerText || !String(answerText).trim()) {
              errors.push('FAQPage Question missing acceptedAnswer text');
            }
          }
        }
      }
    }
  }

  return { errors, typesFound: [...typesFound] };
}

function isFaqAppropriatePage(url, title, headingSequence) {
  if (FAQ_URL_RE.test(String(url || ''))) return true;
  const headingText = (headingSequence || []).map((h) => h.text).join(' ');
  const combined = `${title || ''} ${headingText}`.toLowerCase();
  return /\bfaq\b|frequently asked/.test(combined);
}

function hasFaqSectionPresent(domExtract, schemaTypes) {
  const faq = domExtract.faq || {};
  if ((schemaTypes || []).some((t) => t.includes('FAQPage'))) return true;
  if (faq.faqRegion) return true;
  if ((faq.detailsCount || 0) >= 2) return true;
  if ((faq.questionHeadings || 0) >= 3) return true;
  return false;
}

function parseIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthsBetween(fromDate, toDate) {
  return (toDate.getFullYear() - fromDate.getFullYear()) * 12 + (toDate.getMonth() - fromDate.getMonth());
}

function auditFaqSection(url, domExtract, schemaTypes, addGeoIssue) {
  if (!isFaqAppropriatePage(url, domExtract.title, domExtract.headingSequence)) return;
  if (hasFaqSectionPresent(domExtract, schemaTypes)) return;
  addGeoIssue(
    'Missing FAQ section',
    'Page appears FAQ-related but no FAQPage schema, FAQ region, accordion, or question headings were found'
  );
}

function auditContentFreshness(domExtract, domHtml, addGeoIssue) {
  const bodyText = String(domExtract.bodyText || '');
  if (PLACEHOLDER_CONTENT_RE.test(bodyText)) {
    addGeoIssue('Placeholder content detected', 'Page body contains placeholder or unfinished copy');
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const staleMonths = 24;
  const dateCandidates = [];

  for (const raw of domExtract.freshness?.timeElements || []) {
    const d = parseIsoDate(raw);
    if (d) dateCandidates.push(d);
  }
  const modifiedMeta = domExtract.freshness?.modifiedMeta;
  const modifiedDate = parseIsoDate(modifiedMeta);
  if (modifiedDate) dateCandidates.push(modifiedDate);

  const blocks = extractJsonLdBlocks(domHtml);
  for (const raw of blocks) {
    try {
      const nodes = flattenSchemaNodes(JSON.parse(raw));
      for (const node of nodes) {
        for (const field of ['dateModified', 'datePublished', 'uploadDate']) {
          const d = parseIsoDate(node[field]);
          if (d) dateCandidates.push(d);
        }
      }
    } catch {
      // handled in schema audit
    }
  }

  const staleDates = dateCandidates.filter((d) => monthsBetween(d, now) > staleMonths);
  if (staleDates.length) {
    const oldest = staleDates.sort((a, b) => a - b)[0];
    addGeoIssue(
      'Outdated content date',
      `Latest content date ${oldest.toISOString().slice(0, 10)} is older than ${staleMonths} months`
    );
  }

  const copyrightMatch = bodyText.match(/\b(?:©|copyright)\s*(20\d{2})\b/i);
  if (copyrightMatch) {
    const year = parseInt(copyrightMatch[1], 10);
    if (year < currentYear - 1) {
      addGeoIssue('Outdated copyright year', `Copyright shows ${year}; expected ${currentYear - 1} or ${currentYear}`);
    }
  }
}

function auditSemanticHtml(domExtract, addGeoIssue) {
  const sem = domExtract.semantic || {};
  const problems = [];

  if (!sem.main) problems.push('missing <main> landmark');
  else if (sem.main > 1) problems.push(`multiple <main> elements (${sem.main})`);
  if (!sem.header) problems.push('missing <header> landmark');
  if (!sem.footer) problems.push('missing <footer> landmark');
  if ((sem.linkCount || 0) > 8 && !sem.nav) {
    problems.push('missing <nav> or role="navigation" landmark despite multiple links on page');
  }
  if (sem.main && !sem.h1InMain) problems.push('<h1> is not inside <main>');
  if ((sem.h2Count || 0) >= 2 && !sem.section) problems.push('multiple H2 sections without <section> elements');

  if (problems.length) {
    addGeoIssue('Semantic HTML issue', problems.join('; '));
  }
}

/** Microdata: itemscope + itemtype (Schema.org). */
function extractMicrodataSchema(html) {
  const types = [];
  const snippets = [];
  const re = /itemscope[^>]*itemtype\s*=\s*["']([^"']+)["']/gi;
  const re2 = /itemtype\s*=\s*["']([^"']+)["'][^>]*itemscope/gi;
  for (const regex of [re, re2]) {
    let m;
    while ((m = regex.exec(html || '')) !== null) {
      const typeUrl = (m[1] || '').trim();
      if (!typeUrl) continue;
      types.push(typeUrl);
      const start = Math.max(0, m.index - 40);
      snippets.push(String(html || '').slice(start, m.index + m[0].length + 80).replace(/\s+/g, ' ').trim());
    }
  }
  const schemaTypes = types.filter((t) => /schema\.org/i.test(t));
  return {
    count: types.length,
    schemaTypes: [...new Set(schemaTypes)],
    snippets: snippets.slice(0, 5)
  };
}

/** RDFa: vocab / typeof / property (Schema.org). */
function extractRdfaSchema(html) {
  const types = [];
  const snippets = [];
  const typeofRe = /\btypeof\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = typeofRe.exec(html || '')) !== null) {
    types.push((m[1] || '').trim());
    const start = Math.max(0, m.index - 40);
    snippets.push(String(html || '').slice(start, m.index + m[0].length + 80).replace(/\s+/g, ' ').trim());
  }
  const hasVocab = /\bvocab\s*=\s*["'][^"']*schema\.org/i.test(html || '');
  const hasProperty = /\bproperty\s*=\s*["'][^"']+["']/i.test(html || '');
  const schemaTypes = types.filter((t) => /schema\.org|schema:/i.test(t) || (hasVocab && t));
  return {
    count: types.length,
    hasVocab,
    hasProperty,
    schemaTypes: [...new Set(schemaTypes.length ? schemaTypes : hasVocab && hasProperty ? ['schema.org (vocab)'] : [])],
    snippets: snippets.slice(0, 5)
  };
}

/** GeoJSON payloads, .geojson links, coordinates geometry. */
function detectGeoJsonSignals(html) {
  const src = String(html || '');
  const snippets = [];
  let geoJsonScriptCount = 0;
  const scriptRe = /<script[^>]+type\s*=\s*["']application\/geo\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRe.exec(src)) !== null) {
    geoJsonScriptCount += 1;
    const body = (m[1] || '').trim().slice(0, 200);
    snippets.push(body || m[0].slice(0, 160));
  }

  const geoJsonLinks = [];
  const linkRe = /(?:href|src|data-url|data-src)\s*=\s*["']([^"']+\.geojson(?:\?[^"']*)?)["']/gi;
  while ((m = linkRe.exec(src)) !== null) {
    geoJsonLinks.push(m[1]);
    snippets.push(m[0].slice(0, 160));
  }

  const hasFeatureCollection = /"type"\s*:\s*"FeatureCollection"/i.test(src);
  const hasFeature = /"type"\s*:\s*"Feature"/i.test(src);
  const hasCoordinates = /"coordinates"\s*:\s*\[/i.test(src);
  if (hasFeatureCollection || hasFeature || hasCoordinates) {
    const idx = src.search(/"type"\s*:\s*"Feature|"coordinates"\s*:\s*\[/i);
    if (idx >= 0) snippets.push(src.slice(idx, idx + 180).replace(/\s+/g, ' '));
  }

  // Validate geo+json script bodies when present
  const invalid = [];
  const validateRe = /<script[^>]+type\s*=\s*["']application\/geo\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let vi = 0;
  while ((m = validateRe.exec(src)) !== null) {
    vi += 1;
    try {
      const parsed = JSON.parse((m[1] || '').trim());
      const t = parsed && parsed.type;
      if (!t || !/^(FeatureCollection|Feature|Point|Polygon|LineString|MultiPoint|MultiPolygon|MultiLineString|GeometryCollection)$/i.test(String(t))) {
        invalid.push(`GeoJSON script ${vi} missing valid GeoJSON type`);
      }
    } catch (e) {
      invalid.push(`GeoJSON script ${vi} is invalid JSON (${e.message})`);
    }
  }

  return {
    geoJsonScriptCount,
    geoJsonLinks: [...new Set(geoJsonLinks)].slice(0, 10),
    hasFeatureCollection,
    hasFeature,
    hasCoordinates,
    hasAny: geoJsonScriptCount > 0 || geoJsonLinks.length > 0 || hasFeatureCollection || hasFeature,
    invalid,
    snippets: snippets.slice(0, 5)
  };
}

/** OpenStreetMap / map tiles / map libs / lat-lng attributes. */
function detectMapSignals(html) {
  const src = String(html || '');
  const snippets = [];
  const flags = {
    openStreetMap: /openstreetmap\.org|tile\.openstreetmap|osm\.org/i.test(src),
    leaflet: /\bleaflet\b|L\.map\s*\(/i.test(src),
    mapbox: /mapbox\.com|mapboxgl|mapbox-gl/i.test(src),
    googleMaps: /maps\.googleapis\.com|maps\.google\.|google\.com\/maps|@googlemaps/i.test(src),
    mapIframes: 0,
    latLngAttrs: 0
  };

  const iframeRe = /<iframe[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = iframeRe.exec(src)) !== null) {
    if (/map|openstreetmap|google\.com\/maps|mapbox/i.test(m[1] || '')) {
      flags.mapIframes += 1;
      snippets.push(m[0].slice(0, 180));
    }
  }

  const latLngRe =
    /\b(?:data-lat|data-lng|data-latitude|data-longitude|data-coords|data-center)\s*=\s*["'][^"']+["']/gi;
  while ((m = latLngRe.exec(src)) !== null) {
    flags.latLngAttrs += 1;
    if (snippets.length < 5) snippets.push(m[0]);
  }

  // Inline lat/lng pairs in scripts (e.g. { lat: 12.3, lng: 45.6 })
  const inlineLatLng = /\b(?:lat|latitude)\s*[:=]\s*-?\d+(\.\d+)?\s*[,}][\s\S]{0,40}\b(?:lng|lon|longitude)\s*[:=]\s*-?\d+(\.\d+)?/i.test(
    src
  );

  const hasMap =
    flags.openStreetMap ||
    flags.leaflet ||
    flags.mapbox ||
    flags.googleMaps ||
    flags.mapIframes > 0;

  const hasCoordinates = flags.latLngAttrs > 0 || inlineLatLng;

  if (flags.openStreetMap) snippets.push('OpenStreetMap reference detected');
  if (flags.leaflet) snippets.push('Leaflet map library detected');
  if (flags.mapbox) snippets.push('Mapbox reference detected');
  if (flags.googleMaps) snippets.push('Google Maps reference detected');

  return {
    ...flags,
    inlineLatLng,
    hasMap,
    hasCoordinates,
    snippets: snippets.slice(0, 6)
  };
}

function auditMicrodataAndRdfa(domHtml, addGeoIssue) {
  const micro = extractMicrodataSchema(domHtml);
  const rdfa = extractRdfaSchema(domHtml);

  if (micro.count > 0 && !micro.schemaTypes.length) {
    addGeoIssue(
      'Invalid Microdata',
      `Found ${micro.count} itemscope/itemtype block(s) but none use schema.org types. Snippet: ${(micro.snippets[0] || '').slice(0, 160)}`
    );
  }

  if ((rdfa.count > 0 || rdfa.hasProperty) && !rdfa.schemaTypes.length && !rdfa.hasVocab) {
    addGeoIssue(
      'Invalid RDFa',
      `Found RDFa typeof/property markup without schema.org vocab. Snippet: ${(rdfa.snippets[0] || '').slice(0, 160)}`
    );
  }

  return { micro, rdfa };
}

function auditGeoJsonAndMaps(domHtml, addGeoIssue) {
  const geo = detectGeoJsonSignals(domHtml);
  const maps = detectMapSignals(domHtml);

  for (const err of geo.invalid) {
    addGeoIssue('Invalid GeoJSON', `${err}. Snippet: ${(geo.snippets[0] || '').slice(0, 160)}`);
  }

  // Map UI without any location payload / coordinates
  if (maps.hasMap && !geo.hasAny && !maps.hasCoordinates && !geo.hasCoordinates) {
    const mapKinds = [
      maps.openStreetMap && 'OpenStreetMap',
      maps.leaflet && 'Leaflet',
      maps.mapbox && 'Mapbox',
      maps.googleMaps && 'Google Maps',
      maps.mapIframes > 0 && 'map iframe'
    ]
      .filter(Boolean)
      .join(', ');
    addGeoIssue(
      'Map present without GeoJSON or coordinates',
      `Detected map embed/library (${mapKinds || 'map'}) but no GeoJSON payload, .geojson link, or lat/lng coordinate data was found. Snippet: ${(maps.snippets[0] || '').slice(0, 160)}`
    );
  }
}

function auditGeoPage({ url, domHtml, domExtract, addGeoIssue }) {
  const jsonLdBlocks = extractJsonLdBlocks(domHtml);
  const { errors, typesFound } = validateSchemaOrgBlocks(jsonLdBlocks, { requirePresent: false });
  const { micro, rdfa } = auditMicrodataAndRdfa(domHtml, addGeoIssue);

  const hasJsonLdSchema = typesFound.length > 0;
  const hasMicroSchema = (micro.schemaTypes || []).length > 0;
  const hasRdfaSchema = (rdfa.schemaTypes || []).length > 0;
  const hasAnyStructuredData = hasJsonLdSchema || hasMicroSchema || hasRdfaSchema || jsonLdBlocks.length > 0;

  if (!hasAnyStructuredData && !micro.count && !rdfa.count && !rdfa.hasProperty) {
    addGeoIssue(
      'No Schema.org structured data',
      'No JSON-LD (application/ld+json), Microdata (itemscope/itemtype), or RDFa (typeof/vocab) Schema.org markup found on page'
    );
  }

  auditFaqSection(url, domExtract, typesFound, addGeoIssue);
  for (const err of errors) {
    addGeoIssue('Invalid Schema.org structured data', err);
  }
  auditGeoJsonAndMaps(domHtml, addGeoIssue);
  auditContentFreshness(domExtract, domHtml, addGeoIssue);
  auditSemanticHtml(domExtract, addGeoIssue);
}

// IndexNow — disabled for now (re-enable when key file is hosted on scanned domains)
/*
const INDEXNOW_SUBMIT_URL = 'https://indexnow.org';
const INDEXNOW_MAX_URLS_PER_REQUEST = 10000;

async function submitToIndexNow(targetUrls, hostDomain, indexNowKey) {
  const key = String(indexNowKey || '').trim();
  const host = String(hostDomain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0];

  const urlList = (Array.isArray(targetUrls) ? targetUrls : [])
    .map((u) => String(u || '').trim())
    .filter(Boolean);

  if (!urlList.length || !host || !key) {
    log('⚠️ IndexNow submission skipped: missing urlList, host, or key');
    return { ok: false, skipped: true, reason: 'missing urlList, host, or key' };
  }

  const keyLocation = `https://${host}/${key}.txt`;
  const body = JSON.stringify({ host, key, keyLocation, urlList });

  try {
    const res = await fetch(INDEXNOW_SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body
    });

    if (res.status === 200 || res.status === 202) {
      log(`✅ IndexNow submission successful (HTTP ${res.status}) — ${urlList.length} URL(s) submitted to ${host}`);
      return { ok: true, status: res.status, submitted: urlList.length, host, keyLocation };
    }

    log(`❌ IndexNow submission failed with status ${res.status}`);
    return { ok: false, status: res.status, submitted: 0, host, keyLocation };
  } catch (e) {
    const message = e?.message || String(e);
    log(`❌ IndexNow submission error: ${message}`);
    return { ok: false, error: message, submitted: 0, host, keyLocation };
  }
}

async function submitScannedUrlsToIndexNow(pages, baseUrl, indexNowKey) {
  const key = String(indexNowKey || '').trim();
  if (!key) {
    log('ℹ️ IndexNow submission skipped: INDEXNOWKEY is not configured');
    return { ok: false, skipped: true, reason: 'INDEXNOWKEY not configured', batches: [] };
  }

  const targetUrls = (pages || []).map((p) => p.url).filter(Boolean);
  if (!targetUrls.length) {
    log('ℹ️ IndexNow submission skipped: no scanned URLs');
    return { ok: false, skipped: true, reason: 'no scanned URLs', batches: [] };
  }

  const hostDomain = extractHostDomain(baseUrl);
  const batches = [];

  for (let i = 0; i < targetUrls.length; i += INDEXNOW_MAX_URLS_PER_REQUEST) {
    const chunk = targetUrls.slice(i, i + INDEXNOW_MAX_URLS_PER_REQUEST);
    const result = await submitToIndexNow(chunk, hostDomain, key);
    batches.push(result);
    if (!result.ok && !result.skipped) break;
  }

  const ok = batches.length > 0 && batches.every((b) => b.ok);
  const submitted = batches.reduce((sum, b) => sum + (b.submitted || 0), 0);
  return { ok, skipped: false, submitted, batches };
}

async function checkIndexNow(baseUrl, apiKey, timeoutMs = 8000) {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!apiKey || !String(apiKey).trim()) {
    return {
      ok: false,
      skipped: true,
      url: null,
      reason: 'INDEXNOWKEY is not configured in environment'
    };
  }

  const key = String(apiKey).trim();
  const keyUrl = `${normalizedBase}/${key}.txt`;
  try {
    const result = await fetchTextWithTimeout(keyUrl, timeoutMs);
    if (!result || !result.ok) {
      return {
        ok: false,
        url: keyUrl,
        reason: `key file not reachable (HTTP ${result?.status || 'error'}) — host a plain text file at this exact URL with body equal to INDEXNOWKEY`
      };
    }
    if (result.text.trim() !== key) {
      return {
        ok: false,
        url: keyUrl,
        reason: 'key file content does not match INDEXNOWKEY'
      };
    }
    return { ok: true, url: keyUrl };
  } catch (e) {
    return { ok: false, url: keyUrl, reason: e?.message || 'request failed' };
  }
}

function applySiteGeoIssues(pages, siteGeoIssues, baseUrl) {
  if (!siteGeoIssues.length || !pages.length) return;

  const normalizedBase = normalizeBaseUrl(baseUrl);
  const target =
    pages.find((p) => normalizeBaseUrl(p.url) === normalizedBase) ||
    pages.find((p) => stripHashAndQuery(p.url) === normalizedBase) ||
    pages[0];

  if (!target.issues.geo) target.issues.geo = [];

  for (const detail of siteGeoIssues) {
    const line = detail.startsWith('IndexNow:') ? detail : `IndexNow: ${detail}`;
    if (!target.issues.geo.includes(line)) {
      target.issues.geo.unshift(line);
    }
  }

  target.counts = target.counts || {};
  target.counts.missingGeo = target.issues.geo.length;
  const criticalCount = countCriticalIssues(target.issues);
  const minorCount = target.issues.minor?.length || 0;
  target.seoScore = buildSeoScore({ criticalCount, minorCount });
}
*/

async function fetchResponseHeaders(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'seo-audit-playwright/1.0 (+node)' }
    });
    const headers = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { ok: res.ok, status: res.status, headers };
  } catch (e) {
    return { ok: false, status: 0, headers: {}, error: e?.message || 'request failed' };
  } finally {
    clearTimeout(id);
  }
}

async function checkHttpSecurityHeaders(baseUrl, timeoutMs = 8000) {
  const targetUrl = normalizeBaseUrl(baseUrl);
  const fetched = await fetchResponseHeaders(targetUrl, timeoutMs);
  if (!fetched.ok) {
    return {
      ok: false,
      passed: 0,
      total: HEADER_CHECK_COUNT,
      label: `0/${HEADER_CHECK_COUNT}`,
      results: [],
      failures: [`Could not fetch headers (HTTP ${fetched.status || 'error'})`],
      warnings: [],
      fetchError: fetched.error || null
    };
  }
  return assertHttpSecurityHeaders(fetched.headers, { url: targetUrl });
}

function applySecurityHeaderIssues(issues, securityCheck, addIssue) {
  if (!securityCheck) return;
  for (const failure of securityCheck.failures || []) {
    addIssue('critical', 'HTTP Security Header', failure);
  }
  for (const minor of securityCheck.minors || []) {
    addIssue('minor', 'HTTP Security Header', minor);
  }
  // Warnings stay in security results UI; also surface as minor for SEO list/CSV (tagged Warning via results)
  for (const warning of securityCheck.warnings || []) {
    addIssue('minor', 'HTTP Security Header', warning);
  }
}

async function checkRobotsTxt(baseUrl, timeoutMs = 8000) {
  const robotsUrl = `${normalizeBaseUrl(baseUrl)}/robots.txt`;
  try {
    const result = await fetchTextWithTimeout(robotsUrl, timeoutMs);
    if (!result || !result.ok) {
      return {
        ok: false,
        url: robotsUrl,
        reason: `not reachable (HTTP ${result?.status || 'error'})`
      };
    }
    const body = (result.text || '').trim();
    if (!body) {
      return { ok: false, url: robotsUrl, reason: 'file is empty' };
    }
    return { ok: true, url: robotsUrl };
  } catch (e) {
    return { ok: false, url: robotsUrl, reason: e?.message || 'request failed' };
  }
}

function applySiteCriticalIssues(pages, siteCriticalIssues, baseUrl) {
  if (!siteCriticalIssues.length || !pages.length) return;

  const normalizedBase = normalizeBaseUrl(baseUrl);
  const target =
    pages.find((p) => normalizeBaseUrl(p.url) === normalizedBase) ||
    pages.find((p) => stripHashAndQuery(p.url) === normalizedBase) ||
    pages[0];

  for (const detail of siteCriticalIssues) {
    const line =
      detail.startsWith('robots.txt') ||
      detail.startsWith('HTTP Security Header')
        ? detail
        : `Site check: ${detail}`;
    if (!target.issues.critical.includes(line)) {
      target.issues.critical.unshift(line);
    }
  }

  const geoScoreParts = countGeoForSeoScore(target.issues.geo);
  const criticalCount = countCriticalIssues(target.issues);
  const minorCount = (target.issues.minor?.length || 0) + geoScoreParts.minor;
  target.seoScore = buildSeoScore({ criticalCount, minorCount });
}

async function scanPage({
  browser,
  context: sharedContext,
  url,
  timeoutMs = 15000,
  includePageSpeed = false,
  includeSeo = true,
  includeGeo = true,
  includeSecurityHeaders = true,
  isolated = false
}) {
  const ownsContext = isolated || !sharedContext;
  const context =
    isolated || !sharedContext
      ? await browser.newContext({
          userAgent: 'seo-audit-playwright/1.0 (+node)',
          ignoreHTTPSErrors: true
        })
      : sharedContext;
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
  const started = Date.now();

  try {
    const response = await navigatePageWithRetry(page, url, timeoutMs);
    const responseHeaders = response ? response.headers() : {};
    const securityHeaders = includeSecurityHeaders
      ? assertHttpSecurityHeaders(responseHeaders, { url })
      : null;
    // Wait for load + DOM stability (node/html/anchor counts) so JS-injected links are captured
    // consistently across repeat scans — works site-agnostically without hard-coded selectors.
    try {
      await preparePageForAudit(page, timeoutMs);
    } catch (prepErr) {
      if (!isTransientScanError(prepErr)) throw prepErr;
      log(`⚠️ DOM settle issue for ${url}, continuing with loaded content: ${prepErr?.message || prepErr}`);
    }

    const domHtml = await page.content();
    if (!domHtml || domHtml.length < 80) {
      throw new Error(`Page content empty or too small after navigation (${domHtml?.length || 0} bytes)`);
    }

    let domExtract = await page.evaluate(() => {
      const getMetaContentByName = (name) => {
        const target = String(name || '').trim().toLowerCase();
        for (const el of document.querySelectorAll('meta[name]')) {
          const attr = (el.getAttribute('name') || '').trim().toLowerCase();
          if (attr === target) return (el.getAttribute('content') || '').trim();
        }
        return '';
      };
      const titleEl = document.querySelector('title');
      const title = titleEl ? (titleEl.textContent || '').trim() : '';
      const description = getMetaContentByName('description');
      const keywords = getMetaContentByName('keywords');

      const getMetaByAttr = (attr, value) => {
        const el = document.querySelector(`meta[${attr}="${value}"]`);
        return el ? (el.getAttribute('content') || '').trim() : '';
      };

      const openGraph = {
        'og:title': getMetaByAttr('property', 'og:title'),
        'og:description': getMetaByAttr('property', 'og:description'),
        'og:image': getMetaByAttr('property', 'og:image'),
        'og:image:alt': getMetaByAttr('property', 'og:image:alt'),
        'og:url': getMetaByAttr('property', 'og:url'),
        'og:type': getMetaByAttr('property', 'og:type'),
        'og:site_name': getMetaByAttr('property', 'og:site_name'),
        'og:locale': getMetaByAttr('property', 'og:locale'),
        'twitter:card': getMetaByAttr('name', 'twitter:card'),
        'twitter:title': getMetaByAttr('name', 'twitter:title'),
        'twitter:description': getMetaByAttr('name', 'twitter:description'),
        'twitter:image': getMetaByAttr('name', 'twitter:image')
      };

      const hiddenHeuristic = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0' ||
          rect.width === 0 ||
          rect.height === 0
        );
      };

      const countVisibleByTag = (tag) => {
        const nodes = Array.from(document.querySelectorAll(tag));
        return nodes.filter((n) => !hiddenHeuristic(n)).length;
      };

      const h1Visible = countVisibleByTag('h1');
      const h2Visible = countVisibleByTag('h2');
      const h3Visible = countVisibleByTag('h3');
      const h4Visible = countVisibleByTag('h4');
      const h5Visible = countVisibleByTag('h5');
      const h6Visible = countVisibleByTag('h6');

      const headingNodes = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const headingSequence = headingNodes.map((el) => {
        const tag = el.tagName.toLowerCase();
        const level = parseInt(tag.charAt(1), 10);
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        const ariaHidden = el.getAttribute('aria-hidden') === 'true';
        return {
          level,
          text,
          empty: text.length === 0,
          hidden: ariaHidden || hiddenHeuristic(el)
        };
      });

      const paragraphs = Array.from(document.querySelectorAll('p'))
        .filter((el) => !hiddenHeuristic(el))
        .map((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t.length >= 20);

      const bodyRoot = document.querySelector('main') || document.querySelector('article') || document.body;
      const bodyText = bodyRoot
        ? (bodyRoot.innerText || bodyRoot.textContent || '').replace(/\s+/g, ' ').trim()
        : '';

      const semantic = {
        main: document.querySelectorAll('main').length,
        nav: document.querySelectorAll('nav, [role="navigation"]').length,
        header: document.querySelectorAll('header').length,
        footer: document.querySelectorAll('footer').length,
        article: document.querySelectorAll('article').length,
        section: document.querySelectorAll('section').length,
        h1InMain: Boolean(document.querySelector('main h1')),
        linkCount: document.querySelectorAll('a[href]').length,
        h2Count: countVisibleByTag('h2')
      };

      const faq = {
        detailsCount: document.querySelectorAll('details').length,
        questionHeadings: Array.from(document.querySelectorAll('h2,h3,h4,h5'))
          .filter((el) => !hiddenHeuristic(el))
          .filter((el) => /\?\s*$/.test((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()))
          .length,
        faqRegion: Boolean(
          document.querySelector(
            '[class*="faq" i], [id*="faq" i], [itemtype*="FAQPage" i], [itemtype*="Question" i]'
          )
        )
      };

      const freshness = {
        timeElements: Array.from(document.querySelectorAll('time[datetime]'))
          .map((el) => el.getAttribute('datetime'))
          .filter(Boolean),
        modifiedMeta:
          getMetaByAttr('property', 'article:modified_time') ||
          getMetaByAttr('property', 'og:updated_time') ||
          getMetaContentByName('last-modified')
      };

      let missingSvgAccessibleName = 0;
      const svgMissingAccessibleName = [];
      const svgNodes = Array.from(document.querySelectorAll('svg'));
      for (const svg of svgNodes) {
        if (hiddenHeuristic(svg)) continue;
        const role = (svg.getAttribute('role') || '').toLowerCase();
        if (role !== 'img') continue;
        const ariaLabel = (svg.getAttribute('aria-label') || '').trim();
        const labelledBy = (svg.getAttribute('aria-labelledby') || '').trim();
        const titleText = svg.querySelector('title')
          ? (svg.querySelector('title').textContent || '').trim()
          : '';
        if (!ariaLabel && !labelledBy && !titleText) {
          missingSvgAccessibleName += 1;
          svgMissingAccessibleName.push({
            accessibleName: ariaLabel || titleText || ''
          });
        }
      }

      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const linkText = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const hrefHashLinks = anchors
        .filter((a) => (a.getAttribute('href') || '') === '#')
        .map((a) => ({ href: '#', text: linkText(a) }));
      const jsVoidLinks = anchors
        .filter((a) => /^javascript\s*:\s*void\s*\(\s*0\s*\)/i.test((a.getAttribute('href') || '').trim()))
        .map((a) => ({ href: (a.getAttribute('href') || '').trim(), text: linkText(a) }));
      const hrefHash = hrefHashLinks.length;
      const jsVoid = jsVoidLinks.length;

      return {
        title,
        description,
        keywords,
        openGraph,
        h1Visible,
        h2Visible,
        h3Visible,
        h4Visible,
        h5Visible,
        h6Visible,
        headingSequence,
        paragraphs,
        bodyText,
        semantic,
        faq,
        freshness,
        missingSvgAccessibleName,
        svgMissingAccessibleName,
        hrefHash,
        jsVoid,
        hrefHashLinks,
        jsVoidLinks
      };
    });

    if (!String(domExtract.description || '').trim()) {
      domExtract.description = extractMetaContentFromSourceHtml(domHtml, 'description');
    }
    if (!String(domExtract.keywords || '').trim()) {
      domExtract.keywords = extractMetaContentFromSourceHtml(domHtml, 'keywords');
    }

    const commentBlocks = parseCommentBlocks(domHtml);

    // SOURCE-based strict counts (visible + hidden + commented are approximated by parsing raw HTML)
    const h1CountAll = countOccurrencesFromPattern('<\\s*h1\\b', domHtml);
    const h2CountAll = countOccurrencesFromPattern('<\\s*h2\\b', domHtml);
    const h3CountAll = countOccurrencesFromPattern('<\\s*h3\\b', domHtml);
    const h4CountAll = countOccurrencesFromPattern('<\\s*h4\\b', domHtml);

    const titleCountAll = countOccurrencesFromPattern('<\\s*title\\b', domHtml);
    const titleEmptyCount = countOccurrencesFromPattern('<\\s*title\\b[^>]*>\\s*<\\s*\/\\s*title\\s*>', domHtml);

    const commentedH1Count = commentBlocks.reduce((acc, b) => acc + countOccurrencesFromPattern('<\\s*h1\\b', b), 0);
    const commentedTitleCount = commentBlocks.reduce((acc, b) => acc + countOccurrencesFromPattern('<\\s*title\\b', b), 0);

    const emptyH1Count = countOccurrencesFromPattern('<\\s*h1\\b[^>]*>\\s*<\\s*\/\\s*h1\\s*>', domHtml);

    // Duplicate H1 text from source inner text
    const h1TextMatches = [];
    const h1Re = /<\\s*h1\\b[^>]*>([\\s\\S]*?)<\\s*\/\\s*h1\\s*>/gi;
    let hm;
    while ((hm = h1Re.exec(domHtml)) !== null) {
      const raw = (hm[1] || '').replace(/<!--([\\s\\S]*?)-->/g, '$1');
      const txt = raw.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
      if (txt) h1TextMatches.push(txt);
    }
    const h1Dupes = (() => {
      const counts = {};
      for (const t of h1TextMatches.map((x) => x.toLowerCase())) counts[t] = (counts[t] || 0) + 1;
      return Object.entries(counts).filter(([, c]) => c >= 2).map(([t]) => t);
    })();

    const hierarchyStatus = computeHierarchyStatusFromHeadings(domExtract.headingSequence || []);

    const badFromHtml = computeBadLinkCounts(domHtml);
    const bad = {
      hrefHash: Math.max(badFromHtml.hrefHash, domExtract.hrefHash || 0),
      jsVoid: Math.max(badFromHtml.jsVoid, domExtract.jsVoid || 0)
    };
    const altCounts = computeAltCounts(domHtml);
    const missingSvgAccessibleName = domExtract.missingSvgAccessibleName || 0;
    const missingAltAttr = altCounts.missingAltAttr;
    const emptyAlt = altCounts.emptyAlt;
    const missingAlt = altCounts.missingAlt + missingSvgAccessibleName;
    const missingOpenGraph = countMissingOpenGraphTags(domHtml, domExtract.openGraph || {});

    const issues = { critical: [], geo: [], minor: [], hidden: [] };
    const addIssue = (severity, name, detail) => issues[severity].push({ name, detail });
    const addGeoIssue = (name, detail, severity) => {
      const text = formatGeoIssue(name, detail);
      issues.geo.push({
        name,
        detail,
        text,
        severity: severity || inferGeoSeverityFromText(text)
      });
    };

    if (includeSeo) {
      // Critical rules
      if (h1CountAll === 0) addIssue('critical', 'Missing <h1>', 'No h1 tag found in source (visible/hidden/commented).');
      if (h1CountAll > 1) {
        addIssue(
          'critical',
          `h1 tags (${h1CountAll} found, expected 1)`,
          'Each page should have one main H1. Count includes visible, hidden, and commented tags in source.'
        );
      }
      if (emptyH1Count > 0) addIssue('critical', 'Empty <h1> tag', `Found ${emptyH1Count} empty h1 tags in source.`);
      if (h1Dupes.length > 0) addIssue('critical', 'Duplicate <h1> text', `Duplicate H1 text detected: ${h1Dupes.slice(0, 5).join(' | ')}${h1Dupes.length > 5 ? '…' : ''}`);

      if (titleCountAll === 0) addIssue('critical', 'Missing <title>', 'No <title> tag found in source.');
      else if (titleEmptyCount > 0) addIssue('critical', 'Empty <title>', `Found ${titleEmptyCount} empty title tag(s) in source.`);
      if (titleCountAll > 1) {
        addIssue(
          'critical',
          `title tags (${titleCountAll} found, expected 1)`,
          'Each page should have one title tag for browser tabs and search results.'
        );
      }

      if (isEmptyValue(domExtract.title)) addIssue('critical', 'Empty/invalid title (DOM)', 'title text is empty in DOM.');

      auditOpenGraphTags(domHtml, domExtract.openGraph || {}, addIssue);

      if (bad.hrefHash > 0) addIssue('critical', 'Bad links — href="#"', `Found ${bad.hrefHash} link(s).`);
      if (bad.jsVoid > 0) addIssue('critical', 'Bad links — javascript:void(0)', `Found ${bad.jsVoid} link(s).`);

      if (missingAlt > 0) {
        const altParts = [];
        if (missingAltAttr > 0) {
          altParts.push(`${missingAltAttr} missing alt attribute`);
        }
        if (emptyAlt > 0) {
          altParts.push(`${emptyAlt} empty alt=""`);
        }
        if (missingSvgAccessibleName > 0) {
          altParts.push(`${missingSvgAccessibleName} SVG role=img without accessible name`);
        }
        addIssue('critical', 'Images without ALT', altParts.join('; '));
      }

      // Hierarchy
      if (!hierarchyStatus.ok) addIssue('critical', 'Broken heading hierarchy', hierarchyStatus.reason);

      auditDescriptiveHeadings(domExtract.headingSequence || [], addIssue);
      auditDuplicateNonH1Headings(domExtract.headingSequence || [], addIssue);

      const duplicateParagraphCount = countDuplicateParagraphsOnPage(domExtract.paragraphs || []);
      if (duplicateParagraphCount > 0) {
        addIssue(
          'minor',
          'Duplicate paragraph text on page',
          `Found ${duplicateParagraphCount} paragraph block(s) repeated on the same page.`
        );
      }

      // Minor
      auditDescriptionAndKeywordsMinor(domHtml, domExtract, addIssue);

      const hasCanonical = /<\s*link[^>]+rel\s*=\s*["']canonical["'][^>]*>/i.test(domHtml);
      if (!hasCanonical) addIssue('minor', 'Missing canonical', 'No canonical link tag found in source.');

      const hasHtmlLang = /<\s*html[^>]*\slang\s*=\s*["'][^"']+["']/i.test(domHtml);
      if (!hasHtmlLang) addIssue('minor', 'Missing <html lang>', 'html element missing lang attribute.');

      const hasViewport = /<\s*meta[^>]+name\s*=\s*["']viewport["'][^>]*>/i.test(domHtml);
      if (!hasViewport) addIssue('minor', 'Missing viewport meta', 'meta[name="viewport"] missing.');

      // Whole-token robots directives only (noindex ≠ substring match of "index")
      const robotsMeta = analyzeRobotsMetaConflicts(domHtml);
      if (robotsMeta.indexConflict) {
        addIssue(
          'minor',
          'Robots meta conflict',
          'robots meta contains both index and noindex (opposing directives).'
        );
      }
      if (robotsMeta.followConflict) {
        addIssue(
          'minor',
          'Robots meta conflict',
          'robots meta contains both follow and nofollow (opposing directives).'
        );
      }

      // P3: only SEO-relevant empty metas (not every tracker/pixel empty content)
      const emptyMetaContentCount = countEmptySeoMetaContent(domHtml);
      if (emptyMetaContentCount > 0) {
        addIssue(
          'minor',
          'Empty SEO meta content',
          `Found ${emptyMetaContentCount} SEO-related meta tag(s) (description/keywords/robots/viewport/OG/Twitter) with empty content.`
        );
      }

      // Commented markup — surfaced as critical (not a separate hidden bucket)
      if (commentedH1Count > 0) {
        addIssue('critical', 'Commented h1 tags', `Found h1 tags inside HTML comments: ${commentedH1Count} occurrence(s).`);
      }
      if (commentedTitleCount > 0) {
        addIssue('critical', 'Commented title tags', `Found title tags inside HTML comments: ${commentedTitleCount} occurrence(s).`);
      }
    }

    if (includeSecurityHeaders) {
      applySecurityHeaderIssues(issues, securityHeaders, addIssue);
    }

    if (includeGeo) {
      auditGeoPage({ url, domHtml, domExtract, addGeoIssue });
    }

    const geoScoreParts = countGeoForSeoScore(issues.geo);
    const criticalCount = issues.critical.length + geoScoreParts.critical;
    const minorCount = issues.minor.length + geoScoreParts.minor;
    // GEO warnings are shown in the GEO card but do not reduce SEO score
    const seoScore = buildSeoScore({ criticalCount, minorCount });
    const issueElements = buildIssueElements(domHtml, domExtract, url);

    let pageSpeed = null;
    if (includePageSpeed) {
      try {
        log(`📊 Fetching Google PageSpeed (mobile + desktop) for: ${url}`);
        pageSpeed = await fetchPageSpeedInsightsBoth(url, {
          onRetry: (info) => {
            if (info.recovered) {
              log(`✅ PageSpeed ${info.strategy} recovered on attempt ${info.attempt}`);
              return;
            }
            log(
              `🔁 PageSpeed ${info.strategy} retry ${info.attempt}/${info.totalAttempts} in ${info.delayMs}ms (timeout ${info.timeoutMs}ms) — ${info.lastError || 'error'}`
            );
          }
        });
        if (pageSpeed?.skipped) {
          log(`⚠️ PageSpeed skipped for ${url}: ${pageSpeed.reason || 'not configured'}`);
        } else {
          const mobile = pageSpeed.mobile || {};
          const desktop = pageSpeed.desktop || {};
          if (mobile.error) log(`⚠️ PageSpeed mobile failed for ${url}: ${mobile.error}`);
          if (desktop.error) log(`⚠️ PageSpeed desktop failed for ${url}: ${desktop.error}`);
          if (!mobile.error && !mobile.skipped) {
            log(`✅ PageSpeed mobile ${mobile.performance ?? '—'} / ${mobile.accessibility ?? '—'} / ${mobile.seo ?? '—'}`);
          }
          if (!desktop.error && !desktop.skipped) {
            log(`✅ PageSpeed desktop ${desktop.performance ?? '—'} / ${desktop.accessibility ?? '—'} / ${desktop.seo ?? '—'}`);
          }
        }
      } catch (psiErr) {
        const psiMessage = psiErr?.message || String(psiErr);
        log(`⚠️ PageSpeed fetch failed for ${url}: ${psiMessage}`);
        pageSpeed = {
          mobile: { error: psiMessage, strategy: 'MOBILE' },
          desktop: { error: psiMessage, strategy: 'DESKTOP' }
        };
      }
    }

    return {
      url,
      title: domExtract.title,
      description: domExtract.description,
      keywords: domExtract.keywords,
      h1Count: h1CountAll,
      h2Count: h2CountAll,
      h3Count: h3CountAll,
      hierarchyStatus: hierarchyStatus.ok ? 'YES (valid hierarchy)' : `NO (${hierarchyStatus.reason})`,
      counts: {
        hrefHash: bad.hrefHash,
        jsVoid: bad.jsVoid,
        missingAlt,
        missingAltAttr,
        emptyAlt,
        missingSvgAccessibleName,
        missingOpenGraph,
        missingGeo: issues.geo.length
      },
      issueElements,
      issues: {
        critical: issues.critical.map((x) => formatGeoIssue(x.name, x.detail)),
        // Keep string entries for backward compatibility; severity inferred by prefix
        geo: issues.geo.map((x) => x.text || formatGeoIssue(x.name, x.detail)),
        minor: issues.minor.map((x) => formatGeoIssue(x.name, x.detail)),
        hidden: issues.hidden.map((x) => formatGeoIssue(x.name, x.detail))
      },
      geoIssueSeverities: issues.geo.map((x) => ({
        text: x.text || formatGeoIssue(x.name, x.detail),
        severity: x.severity || inferGeoSeverityFromText(x.text || formatGeoIssue(x.name, x.detail))
      })),
      seoScore,
      securityHeaders: securityHeaders
        ? {
            ok: securityHeaders.ok,
            passed: securityHeaders.passed,
            total: securityHeaders.total,
            label: securityHeaders.label,
            results: securityHeaders.results,
            warnings: securityHeaders.warnings || [],
            categories: securityHeaders.categories || {}
          }
        : null,
      pageSpeed,
      auditModules: {
        seo: includeSeo,
        geo: includeGeo,
        securityHeaders: includeSecurityHeaders,
        pageSpeed: includePageSpeed
      },
      contentBodyText: includeSeo ? String(domExtract.bodyText || '').slice(0, 25000) : '',
      _debug: { durationMs: Date.now() - started }
    };
  } finally {
    try {
      await page.close();
    } catch {}
    if (ownsContext) {
      try {
        await context.close();
      } catch {}
    }
  }
}

function isSecurityHeaderIssueLine(text) {
  return String(text || '').startsWith('HTTP Security Header:');
}

function formatSecurityHeaderIssueLine(text) {
  return String(text || '').replace(/^HTTP Security Header:\s*/i, '');
}

const GEO_AUDIT_CHECK_COUNT = 7;

const GEO_AUDIT_CHECKS = [
  { label: 'FAQ section', prefixes: ['Missing FAQ section'] },
  {
    label: 'Schema.org structured data',
    prefixes: ['Invalid Schema.org structured data', 'No Schema.org structured data']
  },
  { label: 'Microdata / RDFa', prefixes: ['Invalid Microdata', 'Invalid RDFa'] },
  {
    label: 'GeoJSON / map location data',
    prefixes: [
      'Invalid GeoJSON',
      'Map present without GeoJSON or coordinates',
      'Map present without GeoJSON'
    ]
  },
  { label: 'Placeholder content', prefixes: ['Placeholder content detected'] },
  { label: 'Content freshness', prefixes: ['Outdated content date', 'Outdated copyright year'] },
  { label: 'Semantic HTML', prefixes: ['Semantic HTML issue'] }
];

function failedSecurityHeaderResults(results) {
  return (results || []).filter((r) => r.applicable !== false && !r.pass);
}

function applicableSecurityHeaderResults(results) {
  return (results || []).filter((r) => r.applicable !== false);
}

function splitSecurityResultsBySeverity(results) {
  const failed = failedSecurityHeaderResults(results);
  const critical = failed.filter((r) => r.severity === 'critical');
  const minor = failed.filter((r) => r.severity === 'minor');
  const warning = failed.filter(
    (r) => r.severity === 'warning' || (r.severity !== 'critical' && r.severity !== 'minor')
  );
  return {
    critical,
    minor,
    warning,
    passed: applicableSecurityHeaderResults(results).filter((r) => r.pass)
  };
}

function countSecurityHeaderIssues(results) {
  return failedSecurityHeaderResults(results).length;
}

function classifyHiddenIssueSeverity(text) {
  const t = String(text || '').toLowerCase();
  if (
    /commented\s*<h1>|commented\s*h1|commented\s*<title>|commented\s*title|hidden\s*h1|missing\s*<h1>|multiple\s*<h1>|title tags/.test(
      t
    )
  ) {
    return 'critical';
  }
  return 'minor';
}

function mergeHiddenIntoIssueLists(critical, minor, hidden) {
  const mergedCritical = [...(critical || [])];
  const mergedMinor = [...(minor || [])];
  for (const item of hidden || []) {
    if (classifyHiddenIssueSeverity(item) === 'critical') mergedCritical.push(item);
    else mergedMinor.push(item);
  }
  return { critical: mergedCritical, minor: mergedMinor };
}

function getDisplayIssueCounts(issues) {
  const merged = mergeHiddenIntoIssueLists(
    issues?.critical,
    issues?.minor,
    issues?.hidden
  );
  return {
    critical: merged.critical.length,
    minor: merged.minor.length
  };
}

function computeSeoPassPercent(criticalCount, minorCount) {
  return buildSeoScore({ criticalCount, minorCount });
}

/**
 * Build pie slices + a reliable center percentage.
 * - Count mode (security/geo): percent = passed / (passed + critical + minor)
 * - Score mode (SEO): percent = SEO score; slices split Pass vs Critical/Minor by weight
 */
function pieSegmentsFromCounts({ critical = 0, minor = 0, passed = 0, percent = 0 }) {
  const crit = Math.max(0, Number(critical) || 0);
  const min = Math.max(0, Number(minor) || 0);
  const passCnt = Math.max(0, Number(passed) || 0);
  let pct = Number(percent);
  if (!Number.isFinite(pct)) pct = 0;
  pct = Math.max(0, Math.min(100, Math.round(pct)));

  const segments = [];
  const issueTotal = crit + min;
  const countTotal = passCnt + issueTotal;

  if (countTotal > 0 && passCnt > 0) {
    // Explicit pass/fail check counts (security headers, GEO checks)
    pct = Math.round((passCnt / countTotal) * 100);
    segments.push({ value: passCnt, color: '#4ade80', label: 'Pass', count: passCnt });
    if (crit > 0) segments.push({ value: crit, color: '#f87171', label: 'Critical', count: crit });
    if (min > 0) segments.push({ value: min, color: '#fbbf24', label: 'Minor', count: min });
  } else if (issueTotal > 0) {
    // SEO-style: use score as Pass share; remaining split by issue counts
    if (pct <= 0) {
      pct = computeSeoPassPercent(crit, min);
    }
    if (pct > 0) {
      segments.push({ value: pct, color: '#4ade80', label: 'Pass', count: null });
    }
    const failShare = Math.max(0, 100 - pct);
    if (failShare > 0) {
      const critShare =
        crit > 0 ? Math.max(1, Math.round(failShare * (crit / issueTotal))) : 0;
      const minShare = min > 0 ? Math.max(1, failShare - critShare) : 0;
      if (crit > 0) {
        segments.push({
          value: critShare || failShare,
          color: '#f87171',
          label: 'Critical',
          count: crit
        });
      }
      if (min > 0) {
        segments.push({
          value: minShare || Math.max(1, failShare - (crit > 0 ? critShare : 0)),
          color: '#fbbf24',
          label: 'Minor',
          count: min
        });
      }
    }
  } else {
    // Clean page / no data
    pct = pct > 0 ? pct : 100;
    segments.push({ value: 100, color: '#4ade80', label: 'Pass', count: 0 });
  }

  const cleaned = segments.filter((s) => s.value > 0);
  return {
    segments: cleaned.length
      ? cleaned
      : [{ value: 100, color: '#4ade80', label: 'Pass', count: 0 }],
    percent: pct
  };
}

function polarToCartesian(cx, cy, radius, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function describeDonutSlice(cx, cy, outerR, innerR, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, outerR, endAngle);
  const end = polarToCartesian(cx, cy, outerR, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
    `L ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    'Z'
  ].join(' ');
}

function renderAuditPieChart({ percent, critical = 0, minor = 0, passed = 0, title = 'Health' }) {
  const built = pieSegmentsFromCounts({ critical, minor, passed, percent });
  const segments = built.segments;
  const pct = built.percent;
  const total = segments.reduce((sum, seg) => sum + seg.value, 0) || 1;
  const cx = 60;
  const cy = 60;
  const outerR = 46;
  const innerR = 30;
  let angle = 0;
  const slices = segments
    .map((seg) => {
      const sweep = (seg.value / total) * 360;
      if (sweep <= 0) return '';
      // Full circle needs a special path; approximate with near-full arc
      const endAngle = angle + Math.min(sweep, 359.99);
      const path = describeDonutSlice(cx, cy, outerR, innerR, angle, endAngle);
      angle += sweep;
      return `<path d="${path}" fill="${seg.color}" stroke="rgba(15,23,42,.55)" stroke-width="1.5" />`;
    })
    .join('');
  const legend = segments
    .map((seg) => {
      const share = Math.round((seg.value / total) * 100);
      const countPart = seg.count == null ? '' : ` · ${seg.count}`;
      return `<div class="audit-pie-legend-item"><span class="audit-pie-swatch" style="background:${seg.color}"></span><span>${seg.label}${countPart} · ${share}%</span></div>`;
    })
    .join('');
  const centerLabel = `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" class="audit-pie-svg-value">${pct}%</text>`;
  return `
      <div class="audit-pie-chart" role="img" aria-label="${escapeHtml(title)}: ${pct}% pass">
        <div class="audit-pie-ring">
          <svg class="audit-pie-svg" viewBox="0 0 120 120" aria-hidden="true">${slices}${centerLabel}</svg>
        </div>
        <div class="audit-pie-legend">${legend}</div>
      </div>`;
}

function renderAuditPieChartGroup({ percent, critical, minor, passed = 0, title = 'Overview' }) {
  const built = pieSegmentsFromCounts({ critical, minor, passed, percent });
  return `
      <div class="audit-issue-group audit-issue-group--chart">
        <div class="audit-issue-group-head">${escapeHtml(title)} · ${built.percent}%</div>
        ${renderAuditPieChart({ percent: built.percent, critical, minor, passed, title })}
      </div>`;
}

function computeGeoPassPercent(geoIssueCount) {
  const issues = Math.max(0, Number(geoIssueCount) || 0);
  if (!issues) return 100;
  const passed = Math.max(0, GEO_AUDIT_CHECK_COUNT - issues);
  return Math.round((passed / GEO_AUDIT_CHECK_COUNT) * 100);
}

function computeSecurityPassPercent(securityHeaders) {
  const total = Number(securityHeaders?.total) || 0;
  const passed = Number(securityHeaders?.passed) || 0;
  if (!total) return 0;
  return Math.round((passed / total) * 100);
}

function passPercentMeta(percent) {
  if (percent >= 80) return { variant: 'good', icon: '✓' };
  if (percent >= 50) return { variant: 'warn', icon: '!' };
  return { variant: 'bad', icon: '✗' };
}

function renderSeoMinorListItems(items) {
  return (items || [])
    .map((x) => {
      const isMetaLine =
        x.startsWith('Page meta description:') || x.startsWith('Page meta keywords:');
      if (isMetaLine) {
        const formatted = formatIssueLineForDisplay(x);
        return `<li class="issue-line minor-meta-line"><span class="issue-line-label">${escapeHtml(formatted.label || '')}</span><span class="issue-line-detail"><code>${escapeHtml(formatted.detail)}</code></span></li>`;
      }
      return renderIssueLineItem(x);
    })
    .join('');
}

function renderIssueSeverityTag(severity) {
  if (severity === 'critical') {
    return '<span class="issue-severity-tag issue-severity-tag--critical">Critical</span>';
  }
  if (severity === 'warning') {
    return '<span class="issue-severity-tag issue-severity-tag--warning">Warning</span>';
  }
  return '<span class="issue-severity-tag issue-severity-tag--minor">Minor</span>';
}

function renderTaggedIssueLineItem(text, severity) {
  const tag = renderIssueSeverityTag(severity);
  const formatted = formatIssueLineForDisplay(text);
  if (formatted.label) {
    return `<li class="issue-line issue-line--tagged"><span class="issue-line-tags">${tag}</span><span class="issue-line-label">${escapeHtml(formatted.label)}</span><span class="issue-line-detail"><code>${escapeHtml(formatted.detail)}</code></span></li>`;
  }
  return `<li class="issue-line issue-line--tagged"><span class="issue-line-tags">${tag}</span><code class="issue-line-code">${escapeHtml(formatted.detail)}</code></li>`;
}

function renderTaggedSeoIssueLineItem(text, severity) {
  const isMetaLine =
    severity === 'minor' &&
    (text.startsWith('Page meta description:') || text.startsWith('Page meta keywords:'));
  if (isMetaLine) {
    const formatted = formatIssueLineForDisplay(text);
    const tag = renderIssueSeverityTag('minor');
    return `<li class="issue-line issue-line--tagged minor-meta-line"><span class="issue-line-tags">${tag}</span><span class="issue-line-label">${escapeHtml(formatted.label || '')}</span><span class="issue-line-detail"><code>${escapeHtml(formatted.detail)}</code></span></li>`;
  }
  return renderTaggedIssueLineItem(text, severity);
}

function renderUnifiedSeoIssueGroup({ critical, minor }) {
  const total = critical.length + minor.length;
  const items = [
    ...critical.map((x) => renderTaggedSeoIssueLineItem(x, 'critical')),
    ...minor.map((x) => renderTaggedSeoIssueLineItem(x, 'minor'))
  ].join('');
  const list = items || '<li>None detected</li>';
  return `
      <div class="audit-issue-group audit-issue-group--unified">
        <div class="audit-issue-group-head">Issues <span class="audit-issue-count">(${total})</span></div>
        <ul>${list}</ul>
      </div>`;
}

function geoIssueMatchesCheck(issueText, check) {
  const t = geoIssueText(issueText);
  return (check.prefixes || []).some((prefix) => t.startsWith(`${prefix}:`) || t.startsWith(prefix));
}

function deriveGeoPassPoints(geoIssues) {
  const issues = (geoIssues || []).map(geoIssueText);
  return GEO_AUDIT_CHECKS.filter(
    (check) => !issues.some((issue) => geoIssueMatchesCheck(issue, check))
  ).map((check) => check.label);
}

function renderPassLineItem(text) {
  return `<li class="audit-pass-item"><span class="audit-pass-status">Pass</span><code>${escapeHtml(text)}</code></li>`;
}

function renderAuditPassGroup({ items, label = 'Pass points' }) {
  const passItems = items || [];
  const list = passItems.length
    ? passItems.map((x) => renderPassLineItem(x)).join('')
    : '<li>None yet</li>';
  return `
      <div class="audit-issue-group audit-issue-group--pass">
        <div class="audit-issue-group-head">${label} <span class="audit-issue-count">(${passItems.length})</span></div>
        <ul>${list}</ul>
      </div>`;
}

function renderUnifiedGeoIssueGroup(geoIssues, geoIssueSeverities = null) {
  const items = geoIssues || [];
  const total = items.length;
  const sevMap = new Map(
    (geoIssueSeverities || []).map((e) => [geoIssueText(e.text || e), e.severity || 'critical'])
  );
  const list = total
    ? items
        .map((x) => {
          const text = geoIssueText(x);
          const sev = sevMap.get(text) || inferGeoSeverityFromText(text);
          return renderTaggedIssueLineItem(text, sev);
        })
        .join('')
    : '<li>None detected</li>';
  return `
      <div class="audit-issue-group audit-issue-group--unified audit-issue-group--geo-issues">
        <div class="audit-issue-group-head">Issues <span class="audit-issue-count">(${total})</span></div>
        <ul>${list}</ul>
      </div>`;
}

function renderUnifiedSecurityIssueGroup(criticalItems, minorItems, warningItems = []) {
  const critical = criticalItems || [];
  const minor = minorItems || [];
  const warning = warningItems || [];
  const total = critical.length + minor.length + warning.length;
  const list = total
    ? [
        ...critical.map((x) => renderTaggedIssueLineItem(x, 'critical')),
        ...minor.map((x) => renderTaggedIssueLineItem(x, 'minor')),
        ...warning.map((x) => renderTaggedIssueLineItem(x, 'warning'))
      ].join('')
    : '<li>None detected</li>';
  return `
      <div class="audit-issue-group audit-issue-group--unified audit-issue-group--security-issues">
        <div class="audit-issue-group-head">Issues <span class="audit-issue-count">(${total})</span></div>
        <ul>${list}</ul>
      </div>`;
}

function renderSecurityPassGroup(passedResults) {
  const items = (passedResults || []).map((r) => {
    // Keep CSP Strictness N/A out of "Pass points" so alignment stays clean.
    if (r.header === 'CSP Strictness' && r.applicable === false) return null;
    return `${r.header}: ${r.message || 'OK'}`;
  }).filter(Boolean);
  return renderAuditPassGroup({ items, label: 'Pass points' });
}

function renderAuditIssueGroup({ label, count, items, modifier, emptyLabel = 'None detected', renderItems }) {
  const list = renderItems
    ? renderItems(items)
    : renderIssueListItems(items, emptyLabel);
  return `
      <div class="audit-issue-group audit-issue-group--${modifier}">
        <div class="audit-issue-group-head">${label} <span class="audit-issue-count">(${count})</span></div>
        <ul>${list}</ul>
      </div>`;
}

function auditCardIcon(modifier) {
  if (modifier === 'seo') {
    return '<svg class="audit-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  }
  if (modifier === 'geo') {
    return '<svg class="audit-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2a7 7 0 0 0-4 12.7V17l4 4 4-4v-2.3A7 7 0 0 0 12 2Z"/><circle cx="12" cy="9" r="2.5"/></svg>';
  }
  if (modifier === 'pagespeed') {
    return '<svg class="audit-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>';
  }
  if (modifier === 'richresults') {
    return '<svg class="audit-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></svg>';
  }
  return '<svg class="audit-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>';
}

function renderRichResultsCategoryCard(richResults) {
  if (!richResults) return '';

  const toolUrl = richResults.toolUrl || buildRichResultsTestUrl(richResults.targetUrl || '');
  const targetUrl = richResults.targetUrl || '';
  const status = richResults.status || (richResults.ok ? 'captured' : 'error');
  const isOk = richResults.ok === true && !!richResults.screenshotBase64;
  const scoreVariant = isOk ? (richResults.ready === false ? 'warn' : 'good') : 'bad';
  const scoreLabel = isOk ? (richResults.ready === false ? 'Partial' : 'Captured') : 'Failed';
  const scoreIcon = isOk ? (richResults.ready === false ? '!' : '✓') : '✗';

  let screenshotHtml = '';
  if (richResults.screenshotBase64) {
    const mime = richResults.screenshotMime || 'image/png';
    const dataUri = `data:${mime};base64,${richResults.screenshotBase64}`;
    const fileHint = richResults.screenshotFile
      ? `<div class="richresults-file mono">Saved file: ${escapeHtml(richResults.screenshotFile)}</div>`
      : '';
    screenshotHtml = `
              <div class="richresults-shot-wrap">
                <div class="richresults-shot-head">
                  <span>Google Rich Results screenshot</span>
                  <a class="richresults-open-img" href="${dataUri}" target="_blank" rel="noopener" download="rich-results-snapshot.png">Open / copy screenshot</a>
                </div>
                <a class="richresults-shot-link" href="${dataUri}" target="_blank" rel="noopener" title="Open full screenshot">
                  <img class="richresults-shot" src="${dataUri}" alt="Google Rich Results Test screenshot for ${escapeHtml(targetUrl)}" />
                </a>
                ${fileHint}
                <p class="richresults-hint">Tip: open the image, then right-click → Copy image / Save as.</p>
              </div>`;
  } else if (richResults.error) {
    screenshotHtml = `
              <div class="richresults-message richresults-message--error">
                Could not capture screenshot: ${escapeHtml(richResults.error)}
              </div>`;
  } else {
    screenshotHtml = `
              <div class="richresults-message">
                No screenshot available. Use the Google tool link below.
              </div>`;
  }

  const metaRows = [
    targetUrl
      ? `<div class="richresults-meta-row"><span class="richresults-meta-label">Target URL</span><a class="richresults-meta-value mono" href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener">${escapeHtml(targetUrl)}</a></div>`
      : '',
    toolUrl
      ? `<div class="richresults-meta-row"><span class="richresults-meta-label">Google tool</span><a class="richresults-meta-value mono" href="${escapeHtml(toolUrl)}" target="_blank" rel="noopener">${escapeHtml(toolUrl)}</a></div>`
      : '',
    richResults.activeUrl
      ? `<div class="richresults-meta-row"><span class="richresults-meta-label">Active tool URL</span><span class="richresults-meta-value mono">${escapeHtml(richResults.activeUrl)}</span></div>`
      : '',
    richResults.pageTitle
      ? `<div class="richresults-meta-row"><span class="richresults-meta-label">Tool page title</span><span class="richresults-meta-value">${escapeHtml(richResults.pageTitle)}</span></div>`
      : '',
    richResults.capturedAt
      ? `<div class="richresults-meta-row"><span class="richresults-meta-label">Captured at</span><span class="richresults-meta-value mono">${escapeHtml(richResults.capturedAt)}</span></div>`
      : '',
    richResults.note
      ? `<div class="richresults-meta-row"><span class="richresults-meta-label">Note</span><span class="richresults-meta-value">${escapeHtml(richResults.note)}</span></div>`
      : ''
  ]
    .filter(Boolean)
    .join('');

  return `
          <article class="audit-card audit-card--richresults">
            <header class="audit-card-head">
              <div class="audit-card-intro">
                <div class="audit-card-title">${auditCardIcon('richresults')}<span>Google Rich Results — Test</span></div>
                <div class="audit-card-subtitle">Structured data eligibility via Google&#39;s Rich Results Test</div>
              </div>
              <div class="audit-card-score audit-card-score--${scoreVariant}" aria-label="${scoreLabel}">
                <span class="audit-card-score-icon" aria-hidden="true">${scoreIcon}</span>
                <span class="audit-card-score-value" style="font-size:.875rem">${scoreLabel}</span>
              </div>
            </header>
            <div class="audit-card-stats">
              <span class="audit-stat audit-stat--critical"><span class="audit-stat-icon" aria-hidden="true">●</span> Status ${escapeHtml(status)}</span>
              <span class="audit-stat audit-stat--minor"><span class="audit-stat-icon" aria-hidden="true">●</span> Main URL only</span>
            </div>
            <div class="audit-card-body audit-card-body--richresults">
              <div class="richresults-meta">
                ${metaRows || '<div class="richresults-message">No metadata</div>'}
                ${
                  toolUrl
                    ? `<a class="richresults-cta" href="${escapeHtml(toolUrl)}" target="_blank" rel="noopener">Open in Google Rich Results Test ↗</a>`
                    : ''
                }
              </div>
              ${screenshotHtml}
            </div>
          </article>`;
}

function pageSpeedScoreTone(score) {
  if (score == null || Number.isNaN(Number(score))) {
    return { variant: 'muted', color: '#64748b', label: '—' };
  }
  const n = Number(score);
  if (n >= 90) return { variant: 'good', color: '#0cce6b', label: String(n) };
  if (n >= 50) return { variant: 'warn', color: '#ffa400', label: String(n) };
  return { variant: 'bad', color: '#ff4e42', label: String(n) };
}

function pageSpeedDeviceIcon(modifier) {
  if (modifier === 'mobile') {
    return '<svg class="pagespeed-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>';
  }
  return '<svg class="pagespeed-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 20h8M12 18v2"/></svg>';
}

function renderPageSpeedRing(score) {
  const tone = pageSpeedScoreTone(score);
  const pct = score == null || Number.isNaN(Number(score)) ? 0 : Math.max(0, Math.min(100, Number(score)));
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  return `
      <div class="pagespeed-ring pagespeed-ring--${tone.variant}" aria-label="${tone.label} out of 100">
        <svg class="pagespeed-ring-svg" viewBox="0 0 64 64" aria-hidden="true">
          <circle class="pagespeed-ring-track" cx="32" cy="32" r="${radius}" fill="none" stroke-width="5"/>
          <circle class="pagespeed-ring-fill" cx="32" cy="32" r="${radius}" fill="none" stroke-width="5"
            stroke="${tone.color}" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
            transform="rotate(-90 32 32)" stroke-linecap="round"/>
        </svg>
        <span class="pagespeed-ring-value">${escapeHtml(tone.label)}</span>
      </div>`;
}

function renderPageSpeedBar(label, score) {
  const tone = pageSpeedScoreTone(score);
  const pct = score == null || Number.isNaN(Number(score)) ? 0 : Math.max(0, Math.min(100, Number(score)));
  return `
      <div class="pagespeed-bar pagespeed-bar--${tone.variant}">
        <div class="pagespeed-bar-meta">
          <span class="pagespeed-bar-label">${escapeHtml(label)}</span>
          <span class="pagespeed-bar-value">${escapeHtml(tone.label)}</span>
        </div>
        <div class="pagespeed-bar-track" aria-hidden="true">
          <span class="pagespeed-bar-fill" style="width:${pct}%;background:${tone.color}"></span>
        </div>
      </div>`;
}

function renderPageSpeedTileIntro(label, subtitle = '') {
  return `
                  <div class="pagespeed-tile-intro">
                    <div class="pagespeed-tile-title">${escapeHtml(label)}</div>
                    ${subtitle ? `<div class="pagespeed-tile-sub">${escapeHtml(subtitle)}</div>` : ''}
                  </div>`;
}

function renderPageSpeedTileHead(label, modifier, { subtitle = '', scoreHtml = '' } = {}) {
  const headClass = scoreHtml
    ? 'pagespeed-tile-head pagespeed-tile-head--compact'
    : 'pagespeed-tile-head pagespeed-tile-head--compact pagespeed-tile-head--no-score';
  return `
              <div class="${headClass}">
                <span class="pagespeed-tile-icon-wrap">${pageSpeedDeviceIcon(modifier)}</span>
                ${renderPageSpeedTileIntro(label, subtitle)}
                ${scoreHtml ? `<div class="pagespeed-tile-score">${scoreHtml}</div>` : ''}
              </div>`;
}

function renderPageSpeedStrategyTile(label, modifier, strategyResult) {
  if (!strategyResult) {
    return `
            <section class="pagespeed-tile pagespeed-tile--${modifier} pagespeed-tile--empty">
              ${renderPageSpeedTileHead(label, modifier)}
              <p class="pagespeed-message">Not available</p>
            </section>`;
  }

  if (strategyResult.skipped) {
    return `
            <section class="pagespeed-tile pagespeed-tile--${modifier} pagespeed-tile--muted">
              ${renderPageSpeedTileHead(label, modifier)}
              <p class="pagespeed-message">Skipped: ${escapeHtml(strategyResult.reason || 'not configured')}</p>
            </section>`;
  }

  if (strategyResult.error) {
    return `
            <section class="pagespeed-tile pagespeed-tile--${modifier} pagespeed-tile--error">
              ${renderPageSpeedTileHead(label, modifier)}
              <p class="pagespeed-message pagespeed-message--error">${escapeHtml(strategyResult.error)}</p>
            </section>`;
  }

  const avgPercent = computeStrategyAveragePercent(strategyResult);
  return `
            <section class="pagespeed-tile pagespeed-tile--${modifier}">
              ${renderPageSpeedTileHead(label, modifier, {
                subtitle: 'Lighthouse',
                scoreHtml: renderPageSpeedRing(avgPercent)
              })}
              <div class="pagespeed-tile-bars">
                ${renderPageSpeedBar('Performance', strategyResult.performance)}
                ${renderPageSpeedBar('Accessibility', strategyResult.accessibility)}
                ${renderPageSpeedBar('SEO', strategyResult.seo)}
              </div>
            </section>`;
}

function renderPageSpeedScoreCell(score) {
  const tone = pageSpeedScoreTone(score);
  return `<span class="pagespeed-matrix-cell pagespeed-matrix-cell--${tone.variant}">${escapeHtml(tone.label)}</span>`;
}

function renderPageSpeedScoreMatrix(mobile, desktop) {
  const rows = [
    { label: 'Performance', m: mobile?.performance, d: desktop?.performance },
    { label: 'Accessibility', m: mobile?.accessibility, d: desktop?.accessibility },
    { label: 'SEO', m: mobile?.seo, d: desktop?.seo }
  ];
  const body = rows
    .map(
      (row) => `
        <div class="pagespeed-matrix-row">
          <span class="pagespeed-matrix-label">${escapeHtml(row.label)}</span>
          ${renderPageSpeedScoreCell(row.m)}
          ${renderPageSpeedScoreCell(row.d)}
        </div>`
    )
    .join('');

  return `
      <div class="pagespeed-aside-card">
        <div class="pagespeed-aside-head">Score comparison</div>
        <div class="pagespeed-matrix">
          <div class="pagespeed-matrix-row pagespeed-matrix-row--head">
            <span class="pagespeed-matrix-label">Category</span>
            <span class="pagespeed-matrix-col">Mobile</span>
            <span class="pagespeed-matrix-col">Desktop</span>
          </div>
          ${body}
        </div>
      </div>`;
}

function renderPageSpeedVitalValue(value) {
  return `<code class="pagespeed-vital-value">${escapeHtml(value || '—')}</code>`;
}

function renderPageSpeedVitalsCompare(mobile, desktop) {
  const mobileMetrics = mobile?.metrics || {};
  const desktopMetrics = desktop?.metrics || {};
  const rows = [
    { label: 'First Contentful Paint', short: 'FCP', m: mobileMetrics.fcp, d: desktopMetrics.fcp },
    { label: 'Largest Contentful Paint', short: 'LCP', m: mobileMetrics.lcp, d: desktopMetrics.lcp },
    { label: 'Cumulative Layout Shift', short: 'CLS', m: mobileMetrics.cls, d: desktopMetrics.cls },
    { label: 'Total Blocking Time', short: 'TBT', m: mobileMetrics.tbt, d: desktopMetrics.tbt }
  ];
  const body = rows
    .map(
      (row) => `
        <div class="pagespeed-vitals-row">
          <div class="pagespeed-vitals-metric">
            <span class="pagespeed-vitals-short">${escapeHtml(row.short)}</span>
            <span class="pagespeed-vitals-name">${escapeHtml(row.label)}</span>
          </div>
          <div class="pagespeed-vitals-values">
            ${renderPageSpeedVitalValue(row.m)}
            ${renderPageSpeedVitalValue(row.d)}
          </div>
        </div>`
    )
    .join('');

  return `
      <div class="pagespeed-aside-card pagespeed-aside-card--vitals">
        <div class="pagespeed-aside-head">Core Web Vitals</div>
        <div class="pagespeed-vitals-legend">
          <span class="pagespeed-vitals-legend-item pagespeed-vitals-legend-item--mobile">Mobile</span>
          <span class="pagespeed-vitals-legend-item pagespeed-vitals-legend-item--desktop">Desktop</span>
        </div>
        <div class="pagespeed-vitals-list">${body}</div>
      </div>`;
}

function renderPageSpeedLegend() {
  return `
      <div class="pagespeed-legend" aria-label="Lighthouse score legend">
        <span class="pagespeed-legend-item"><span class="pagespeed-legend-swatch pagespeed-legend-swatch--good"></span>90–100 Good</span>
        <span class="pagespeed-legend-item"><span class="pagespeed-legend-swatch pagespeed-legend-swatch--warn"></span>50–89 Needs work</span>
        <span class="pagespeed-legend-item"><span class="pagespeed-legend-swatch pagespeed-legend-swatch--bad"></span>0–49 Poor</span>
      </div>`;
}

function renderPageSpeedHealthOverview(mobile, desktop) {
  const mobileAvg = computeStrategyAveragePercent(mobile);
  const desktopAvg = computeStrategyAveragePercent(desktop);
  if (!mobileAvg && !desktopAvg) {
    return `
      <div class="audit-issue-group audit-issue-group--chart pagespeed-health-card">
        <div class="audit-issue-group-head">Health overview</div>
        <p class="pagespeed-message">No Lighthouse scores available</p>
      </div>`;
  }

  return `
      <div class="audit-issue-group audit-issue-group--chart pagespeed-health-card">
        <div class="audit-issue-group-head">Health overview</div>
        <div class="pagespeed-health-charts">
          ${mobileAvg > 0 ? `<div class="pagespeed-mini-chart"><div class="pagespeed-mini-chart-label pagespeed-mini-chart-label--mobile">Mobile</div>${renderAuditPieChart({ title: 'Mobile', percent: mobileAvg, critical: Math.max(0, 100 - mobileAvg), minor: 0, passed: mobileAvg })}</div>` : ''}
          ${desktopAvg > 0 ? `<div class="pagespeed-mini-chart"><div class="pagespeed-mini-chart-label pagespeed-mini-chart-label--desktop">Desktop</div>${renderAuditPieChart({ title: 'Desktop', percent: desktopAvg, critical: Math.max(0, 100 - desktopAvg), minor: 0, passed: desktopAvg })}</div>` : ''}
        </div>
      </div>`;
}

function renderPageSpeedDetailsRow(mobile, desktop) {
  return `
      <div class="pagespeed-details-row">
        ${renderPageSpeedVitalsCompare(mobile, desktop)}
        ${renderPageSpeedScoreMatrix(mobile, desktop)}
      </div>`;
}

function renderPageSpeedCategoryCard(pageSpeed) {
  if (!pageSpeed) return '';

  const bundle = normalizePageSpeedBundle(pageSpeed);
  if (!bundle) return '';

  if (bundle.skipped) {
    return `
          <article class="audit-card audit-card--pagespeed audit-card--pagespeed-muted">
            <header class="audit-card-head">
              <div class="audit-card-intro">
                <div class="audit-card-title">${auditCardIcon('pagespeed')}<span>Page Speed — Google Insights</span></div>
                <div class="audit-card-subtitle">Mobile &amp; Desktop Lighthouse audits</div>
              </div>
            </header>
            <div class="audit-card-body audit-card-body--pagespeed-message">
              <p class="pagespeed-message">PageSpeed skipped: ${escapeHtml(bundle.reason || 'API key not configured')}</p>
            </div>
          </article>`;
  }

  if (bundle.error && !bundle.mobile && !bundle.desktop) {
    return `
          <article class="audit-card audit-card--pagespeed audit-card--pagespeed-error">
            <header class="audit-card-head">
              <div class="audit-card-intro">
                <div class="audit-card-title">${auditCardIcon('pagespeed')}<span>Page Speed — Google Insights</span></div>
                <div class="audit-card-subtitle">Mobile &amp; Desktop Lighthouse audits</div>
              </div>
            </header>
            <div class="audit-card-body audit-card-body--pagespeed-message">
              <p class="pagespeed-message pagespeed-message--error">${escapeHtml(bundle.error)}</p>
            </div>
          </article>`;
  }

  const avgPercent = computePageSpeedAveragePercent(bundle);
  const { variant, icon } = passPercentMeta(avgPercent);

  return `
          <article class="audit-card audit-card--pagespeed">
            <header class="audit-card-head">
              <div class="audit-card-intro">
                <div class="audit-card-title">${auditCardIcon('pagespeed')}<span>Page Speed — Google Insights</span></div>
                <div class="audit-card-subtitle">Mobile &amp; Desktop · Lighthouse categories &amp; Core Web Vitals</div>
              </div>
              <div class="audit-card-score audit-card-score--${variant}" aria-label="${avgPercent}% combined average score">
                <span class="audit-card-score-icon" aria-hidden="true">${icon}</span>
                <span class="audit-card-score-value">${avgPercent}%</span>
              </div>
            </header>
            ${renderPageSpeedLegend()}
            <div class="audit-card-body audit-card-body--pagespeed-pro">
              ${renderPageSpeedStrategyTile('Mobile', 'mobile', bundle.mobile)}
              ${renderPageSpeedStrategyTile('Desktop', 'desktop', bundle.desktop)}
              ${renderPageSpeedHealthOverview(bundle.mobile, bundle.desktop)}
              ${renderPageSpeedDetailsRow(bundle.mobile, bundle.desktop)}
            </div>
          </article>`;
}

function renderAuditCategoryCard({
  modifier,
  title,
  subtitle,
  percent,
  critical,
  minor,
  bodyHtml
}) {
  const { variant, icon } = passPercentMeta(percent);
  return `
          <article class="audit-card audit-card--${modifier}">
            <header class="audit-card-head">
              <div class="audit-card-intro">
                <div class="audit-card-title">${auditCardIcon(modifier)}<span>${title}</span></div>
                ${subtitle ? `<div class="audit-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}
              </div>
              <div class="audit-card-score audit-card-score--${variant}" aria-label="${percent}% pass rate">
                <span class="audit-card-score-icon" aria-hidden="true">${icon}</span>
                <span class="audit-card-score-value">${percent}%</span>
              </div>
            </header>
            <div class="audit-card-stats">
              <span class="audit-stat audit-stat--critical"><span class="audit-stat-icon" aria-hidden="true">●</span> Critical ${critical}</span>
              <span class="audit-stat audit-stat--minor"><span class="audit-stat-icon" aria-hidden="true">●</span> Minor ${minor}</span>
            </div>
            <div class="audit-card-body">${bodyHtml}</div>
          </article>`;
}

function resolvePageAuditModules(p) {
  const m = p?.auditModules;
  if (m && typeof m === 'object') {
    return {
      seo: m.seo !== false,
      geo: m.geo !== false,
      securityHeaders: m.securityHeaders !== false,
      pageSpeed: m.pageSpeed === true || !!p.pageSpeed,
      richResults: m.richResults === true || !!p.richResults
    };
  }
  // Legacy reports (no flags): show core cards when data is present
  return {
    seo: true,
    geo: true,
    securityHeaders: p?.securityHeaders != null,
    pageSpeed: !!p?.pageSpeed,
    richResults: !!p?.richResults
  };
}

function buildPageDetailHtml(p, index, totalPages) {
  const modules = resolvePageAuditModules(p);
  const issues = p.issues || { critical: [], minor: [], geo: [], hidden: [] };
  const geoIssues = issues.geo || [];
  const geoSplit = splitGeoIssuesBySeverity(
    (p.geoIssueSeverities && p.geoIssueSeverities.length
      ? p.geoIssueSeverities
      : geoIssues.map((t) => ({ text: t, severity: inferGeoSeverityFromText(t) })))
  );
  const { security: securityCritical, other: pageCritical } = splitSecurityHeaderIssues(issues.critical);
  const { security: securityMinor, other: pageMinor } = splitSecurityHeaderIssues(issues.minor);
  const seoMerged = mergeHiddenIntoIssueLists(pageCritical, pageMinor, issues.hidden);
  const sortedPageCritical = sortCriticalIssuesForDisplay(seoMerged.critical);
  const sortedPageMinor = sortMinorIssuesForDisplay(seoMerged.minor);
  const allSecurityIssues = [...securityCritical, ...securityMinor];
  const securityResults = p.securityHeaders?.results || [];
  const securitySplit = securityResults.length
    ? splitSecurityResultsBySeverity(securityResults)
    : null;
  const securityCriticalCount = securityResults.length
    ? securitySplit.critical.length
    : securityCritical.length;
  const securityMinorCount = securityResults.length
    ? securitySplit.minor.length
    : securityMinor.length;
  const securityWarningCount = securityResults.length
    ? (securitySplit.warning || []).length
    : 0;
  const securityPassedCount = securityResults.length
    ? securitySplit.passed.length
    : Math.max(0, (p.securityHeaders?.passed || 0));
  const seoCrit = sortedPageCritical.length;
  const seoMin = sortedPageMinor.length;
  const seoPassPercent = computeSeoPassPercent(seoCrit, seoMin);
  const geoPassPoints = deriveGeoPassPoints(geoIssues);
  // GEO health: pass points vs issue counts (critical+minor+warning)
  const geoIssueTotal =
    geoSplit.critical.length + geoSplit.minor.length + geoSplit.warning.length;
  const geoPassPercent =
    geoPassPoints.length + geoIssueTotal > 0
      ? Math.round(
          (geoPassPoints.length / (geoPassPoints.length + geoIssueTotal)) * 100
        )
      : 100;
  const securityPassPercent =
    securityResults.length && securitySplit
      ? (() => {
          const total =
            securitySplit.passed.length +
            securitySplit.critical.length +
            securitySplit.minor.length +
            (securitySplit.warning || []).length;
          if (!total) return computeSecurityPassPercent(p.securityHeaders);
          return Math.round((securitySplit.passed.length / total) * 100);
        })()
      : computeSecurityPassPercent(p.securityHeaders);
  const securityScoreLabel = p.securityHeaders?.label
    ? `${p.securityHeaders.label} headers passed`
    : 'HTTP response headers';

  const seoCard = modules.seo
    ? renderAuditCategoryCard({
        modifier: 'seo',
        title: 'SEO — On-Page Optimization',
        subtitle: 'Titles, links, meta tags, and content issues',
        percent: seoPassPercent,
        critical: seoCrit,
        minor: seoMin,
        bodyHtml: [
          renderUnifiedSeoIssueGroup({
            critical: sortedPageCritical,
            minor: sortedPageMinor
          }),
          renderAuditPieChartGroup({
            title: 'SEO health',
            percent: seoPassPercent,
            critical: seoCrit,
            minor: seoMin,
            passed: 0
          })
        ].join('')
      })
    : '';

  const geoCard = modules.geo
    ? renderAuditCategoryCard({
        modifier: 'geo',
        title: 'GEO — Generative Engine Optimization',
        subtitle: 'Schema, semantics, freshness, and AI-readiness',
        percent: geoPassPercent,
        critical: geoSplit.critical.length,
        minor: geoSplit.minor.length + geoSplit.warning.length,
        bodyHtml: [
          renderUnifiedGeoIssueGroup(geoIssues, p.geoIssueSeverities),
          renderAuditPassGroup({ items: geoPassPoints }),
          renderAuditPieChartGroup({
            title: 'GEO health',
            percent: geoPassPercent,
            critical: geoSplit.critical.length,
            minor: geoSplit.minor.length + geoSplit.warning.length,
            passed: geoPassPoints.length
          })
        ].join('')
      })
    : '';

  const securityCard =
    modules.securityHeaders && p.securityHeaders
      ? renderAuditCategoryCard({
          modifier: 'security',
          title: 'Security Headers — HTTP Response',
          subtitle: securityScoreLabel,
          percent: securityPassPercent,
          critical: securityCriticalCount,
          minor: securityMinorCount + securityWarningCount,
          bodyHtml: renderSecurityHeaderGroups(p.securityHeaders, allSecurityIssues, {
            percent: securityPassPercent,
            passed: securityPassedCount,
            critical: securityCriticalCount,
            minor: securityMinorCount,
            warning: securityWarningCount
          })
        })
      : '';

  const pageSpeedCard = modules.pageSpeed ? renderPageSpeedCategoryCard(p.pageSpeed) : '';
  const richResultsCard = modules.richResults ? renderRichResultsCategoryCard(p.richResults) : '';

  return `
        <div class="page-detail-content">
          <div class="page-detail-meta">
            <div class="pageMeta">Title: <b>${escapeHtml(p.title || '—')}</b></div>
            <div class="pageMeta">Description: <b>${escapeHtml(p.description || '—')}</b></div>
            <div class="pageMeta">Keywords: <b>${escapeHtml(p.keywords || '—')}</b></div>
            <div class="page-detail-score">${renderScoreChip(p.seoScore)}</div>
          </div>
          <div class="audit-cards">
            ${seoCard}
            ${geoCard}
            ${securityCard}
            ${pageSpeedCard}
            ${richResultsCard}
          </div>
        </div>`;
}

function pageDetailScoreVariant(score) {
  const n = Number(score) || 0;
  if (n >= 80) return 'good';
  if (n >= 50) return 'warn';
  return 'bad';
}

function renderPageDetailSummary(p, index, totalPages, { prebuiltBody = null, lazy = false } = {}) {
  const issues = p.issues || {};
  const displayCounts = getDisplayIssueCounts(issues);
  const criticalLen = displayCounts.critical;
  const minorLen = displayCounts.minor;
  const geoLen = (issues.geo || []).length;
  const score = p.seoScore || 0;
  const scoreVariant = pageDetailScoreVariant(score);
  const searchBlob = [p.url, p.title, p.description, p.keywords].filter(Boolean).join(' ');
  const bodyContent = prebuiltBody
    || (lazy
      ? '<div class="page-detail-placeholder">Open this page to load SEO, GEO, and Security cards.</div>'
      : buildPageDetailHtml(p, index, totalPages));

  return `
      <details class="page-detail" data-page-index="${index}" data-search="${escapeHtml(searchBlob)}">
        <summary class="page-detail-summary">
          <span class="page-detail-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>
          </span>
          <span class="page-detail-index">#${index + 1}</span>
          <div class="page-detail-main">
            <a class="page-detail-url" href="${escapeHtml(p.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(p.url)}</a>
            <div class="page-detail-title">${escapeHtml(p.title || 'No title')}</div>
          </div>
          <div class="page-detail-badges">
            <span class="page-badge page-badge--critical" title="Critical issues">${criticalLen} crit</span>
            <span class="page-badge page-badge--minor" title="Minor issues">${minorLen} min</span>
            <span class="page-badge page-badge--geo" title="GEO issues">${geoLen} geo</span>
            <span class="page-badge page-badge--score page-badge--${scoreVariant}" title="SEO score">${score}</span>
          </div>
        </summary>
        <div class="page-detail-body" data-loaded="${prebuiltBody || !lazy ? 'true' : 'false'}">
          ${bodyContent}
        </div>
      </details>`;
}

function renderSecurityHeaderGroups(securityHeaders, fallbackIssues = [], chartOpts = {}) {
  const results = securityHeaders?.results || [];
  let criticalItems = [];
  let minorItems = [];
  let warningItems = [];
  let criticalCount = 0;
  let minorCount = 0;
  let warningCount = 0;
  let passedCount = chartOpts.passed || 0;

  if (!results.length) {
    fallbackIssues.forEach((item) => {
      if (!isSecurityHeaderIssueLine(item)) return;
      const line = formatSecurityHeaderIssueLine(item);
      if (/deprecated|expect-ct|xss-protection|embedder-policy|opener-policy|report-only/i.test(line)) {
        warningItems.push(line);
      } else if (/referrer-policy|permissions-policy|resource-policy|x-powered-by|^server:/i.test(line)) {
        minorItems.push(line);
      } else {
        criticalItems.push(line);
      }
    });
    criticalCount = criticalItems.length;
    minorCount = minorItems.length;
    warningCount = warningItems.length;
  } else {
    const split = splitSecurityResultsBySeverity(results);
    criticalItems = split.critical.map((r) => `${r.header}: ${r.message || 'Failed'}`);
    minorItems = split.minor.map((r) => `${r.header}: ${r.message || 'Failed'}`);
    warningItems = (split.warning || []).map((r) => `${r.header}: ${r.message || 'Warning'}`);
    criticalCount = split.critical.length;
    minorCount = split.minor.length;
    warningCount = (split.warning || []).length;
    passedCount = split.passed.length;
  }

  if (chartOpts.critical != null) criticalCount = chartOpts.critical;
  if (chartOpts.minor != null) minorCount = chartOpts.minor;
  if (chartOpts.warning != null) warningCount = chartOpts.warning;
  if (chartOpts.passed != null) passedCount = chartOpts.passed;

  // Pie: warnings count with minors for slice weight, but list tags stay Warning
  const pieMinor = minorCount + warningCount;
  const percent =
    chartOpts.percent != null
      ? chartOpts.percent
      : (() => {
          const total = passedCount + criticalCount + pieMinor;
          if (total > 0) return Math.round((passedCount / total) * 100);
          return computeSecurityPassPercent(securityHeaders);
        })();
  const passedResults = results.length
    ? splitSecurityResultsBySeverity(results).passed
    : [];

  return [
    renderUnifiedSecurityIssueGroup(criticalItems, minorItems, warningItems),
    renderSecurityPassGroup(passedResults),
    renderAuditPieChartGroup({
      title: 'Header health',
      percent,
      critical: criticalCount,
      minor: pieMinor,
      passed: passedCount
    })
  ].join('');
}

function splitSecurityHeaderIssues(items) {
  const security = [];
  const other = [];
  for (const item of items || []) {
    if (isSecurityHeaderIssueLine(item)) security.push(item);
    else other.push(item);
  }
  return { security, other };
}

function sortCriticalIssuesForDisplay(issues) {
  return splitSecurityHeaderIssues(issues).other;
}

function formatIssueLineForDisplay(text) {
  const t = String(text || '');
  const mHref = t.match(/Bad links:\s*href="#":\s*Found\s*(\d+)\s+href="#"\s+link\(s\)\.?/i);
  if (mHref) return { label: 'Bad links — href="#"', detail: `${mHref[1]} found` };
  const mHref2 = t.match(/Bad links[^:]*href="#":\s*Found\s*(\d+)/i);
  if (mHref2) return { label: 'Bad links — href="#"', detail: `${mHref2[1]} found` };
  const mHref3 = t.match(/Bad links — href="#":\s*Found\s*(\d+)/i);
  if (mHref3) return { label: 'Bad links — href="#"', detail: `${mHref3[1]} found` };
  const mJs = t.match(/Bad links:\s*javascript:void\(0\):\s*Found\s*(\d+)\s+javascript:void\(0\)\s+link\(s\)\.?/i);
  if (mJs) return { label: 'Bad links — javascript:void(0)', detail: `${mJs[1]} found` };
  const mJs2 = t.match(/Bad links[^:]*javascript:void\(0\):\s*Found\s*(\d+)/i);
  if (mJs2) return { label: 'Bad links — javascript:void(0)', detail: `${mJs2[1]} found` };
  const mJs3 = t.match(/Bad links — javascript:void\(0\):\s*Found\s*(\d+)/i);
  if (mJs3) return { label: 'Bad links — javascript:void(0)', detail: `${mJs3[1]} found` };
  const colon = t.indexOf(':');
  if (colon > 0) {
    return { label: t.slice(0, colon).trim(), detail: t.slice(colon + 1).trim() };
  }
  return { label: null, detail: t };
}

function renderIssueLineItem(text) {
  const formatted = formatIssueLineForDisplay(text);
  if (formatted.label) {
    return `<li class="issue-line"><span class="issue-line-label">${escapeHtml(formatted.label)}</span><span class="issue-line-detail"><code>${escapeHtml(formatted.detail)}</code></span></li>`;
  }
  return `<li class="issue-line"><code class="issue-line-code">${escapeHtml(formatted.detail)}</code></li>`;
}

function renderIssueListItems(items, emptyLabel = 'None detected') {
  const list = (items || []).map((x) => renderIssueLineItem(x)).join('');
  return list || `<li>${emptyLabel}</li>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderChip(label, variant = 'neutral', opts = {}) {
  const mono = opts.mono ? ' chip--mono' : '';
  const xs = opts.xs ? ' chip--xs' : '';
  const title = opts.title ? ` title="${escapeHtml(opts.title)}"` : '';
  return `<span class="chip chip--${variant}${mono}${xs}"${title}>${escapeHtml(String(label))}</span>`;
}

function renderStatusBadge(val) {
  const v = String(val || '').trim().toUpperCase();
  if (v === 'YES') return renderChip('Pass', 'success', { title: 'Check passed' });
  if (v === 'NO') return renderChip('Fail', 'danger', { title: 'Check failed' });
  return renderChip('N/A', 'muted');
}

function renderHierarchyBadge(status) {
  const ok = String(status || '').startsWith('YES');
  return ok
    ? renderChip('Valid', 'success', { title: 'Heading hierarchy is valid' })
    : renderChip('Invalid', 'danger', { title: 'Broken heading hierarchy' });
}

function renderMetricChip(value, { zeroIsGood = true } = {}) {
  const n = Number(value) || 0;
  let variant = 'neutral';
  if (zeroIsGood) {
    if (n === 0) variant = 'success';
    else if (n <= 2) variant = 'warning';
    else variant = 'danger';
  } else if (n >= 80) variant = 'success';
  else if (n >= 50) variant = 'warning';
  else variant = 'danger';
  return renderChip(n, variant, { mono: true });
}

function renderSecHeadersChip(sec) {
  if (!sec || sec.skipped || (sec.label === '—' && !sec.results?.length && !(sec.total > 0))) {
    return renderChip('N/A', 'muted', { title: 'Security headers not checked' });
  }
  const label = sec.label || '—';
  if (sec.ok) return renderChip(label, 'success', { title: 'All security headers passed', mono: true });
  if ((sec.passed || 0) > 0) {
    return renderChip(label, 'warning', { title: 'Some security headers failed', mono: true });
  }
  return renderChip(label, 'danger', { title: 'Security headers failed', mono: true });
}

function renderScoreChip(score) {
  const n = Number(score) || 0;
  const variant = n >= 80 ? 'success' : n >= 50 ? 'warning' : 'danger';
  return renderChip(n, variant, { title: 'SEO score', mono: true });
}

function renderH1Chip(count) {
  const n = Number(count) || 0;
  const variant = n === 1 ? 'success' : n === 0 ? 'danger' : 'warning';
  return renderChip(n, variant, { mono: true, title: 'H1 count' });
}

function renderIssuesChipGroup(criticalLen, minorLen, geoLen = 0) {
  const parts = [
    renderChip(`Critical ${criticalLen}`, criticalLen ? 'danger' : 'neutral', { xs: true, title: 'Critical issues' }),
    renderChip(`GEO ${geoLen}`, geoLen ? 'info' : 'neutral', { xs: true, title: 'GEO issues' }),
    renderChip(`Minor ${minorLen}`, minorLen ? 'warning' : 'neutral', { xs: true, title: 'Minor issues' })
  ];
  return `<div class="chip-group">${parts.join('')}</div>`;
}

function embedJsonForHtmlScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/<\/script/gi, '\\u003c/script');
}

function generateHtmlReport({ mainUrl, scanDate, pages, siteChecks = null, reportId = null }) {
  const totalPages = pages.length;
  const totalCritical = pages.reduce((acc, p) => acc + countCriticalIssues(p.issues), 0);
  const totalMinor = pages.reduce((acc, p) => acc + (p.issues.minor?.length || 0), 0);
  const totalHidden = pages.reduce((acc, p) => acc + (p.issues.hidden?.length || 0), 0); // legacy bucket in stored JSON
  const averageScore = averageSeoScore(pages);
  const robotsTxt = siteChecks?.robotsTxt || '—';

  const toIssueBullets = (issueList) => {
    if (!issueList || !issueList.length) return [{ text: '• None' }];
    return issueList.map((x) => {
      const t = (x || '').toString();

      // Normalize "Bad links: javascript:void(0): Found 1 ..."
      // into bullets: "• javascript:void(0): 1" etc.
      const mJsVoid = t.match(/Bad links:\s*javascript:void\(0\):\s*Found\s*(\d+)\s+javascript:void\(0\)\s+link\(s\)/i);
      if (mJsVoid) return { text: `• javascript:void(0): ${mJsVoid[1]}` };

      const mHrefHash = t.match(/Bad links:\s*href="#":\s*Found\s*(\d+)\s+href="#"\s+link\(s\)/i);
      if (mHrefHash) return { text: `• href="#": ${mHrefHash[1]}` };

      // Current UI sometimes stores like: "Bad links: javascript:void(0): 12 🔴"
      const mJsVoid2 = t.match(/Bad links:\s*javascript:void\(0\):\s*(\d+)/i);
      if (mJsVoid2 && !mJsVoid) return { text: `• javascript:void(0): ${mJsVoid2[1]}` };

      const mHrefHash2 = t.match(/Bad links:\s*href="#":\s*(\d+)/i);
      if (mHrefHash2 && !mHrefHash) return { text: `• href="#": ${mHrefHash2[1]}` };

      return { text: `• ${t}` };
    });
  };


  const rows = pages
    .map((p) => {
      const geoCount = p.counts?.missingGeo ?? (p.issues.geo?.length || 0);
      const displayCounts = getDisplayIssueCounts(p.issues);
      const criticalLen = displayCounts.critical;
      const minorLen = displayCounts.minor;
      const sec = p.securityHeaders || {};
      const ogMissing = p.counts?.missingOpenGraph ?? p.counts?.missingPreviewLink ?? 0;

      return `
      <tr class="data-row">
        <td class="cell-url"><a class="url-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.url)}</a></td>
        <td class="cell-title"><span class="cell-wrap" title="${escapeHtml(p.title || '')}">${escapeHtml(p.title || '—')}</span></td>
        <td class="cell-metric">${renderH1Chip(p.h1Count)}</td>
        <td class="cell-badge">${renderHierarchyBadge(p.hierarchyStatus)}</td>
        <td class="cell-issues">${renderIssuesChipGroup(criticalLen, minorLen, geoCount)}</td>
        <td class="cell-metric">${renderMetricChip(p.counts?.hrefHash || 0)}</td>
        <td class="cell-metric">${renderMetricChip(p.counts?.jsVoid || 0)}</td>
        <td class="cell-metric">${renderMetricChip(p.counts?.missingAlt || 0)}</td>
        <td class="cell-metric">${renderMetricChip(ogMissing)}</td>
        <td class="cell-badge">${renderStatusBadge(robotsTxt)}</td>
        <td class="cell-badge">${renderSecHeadersChip(sec)}</td>
        <td class="cell-metric">${renderMetricChip(geoCount)}</td>
        <td class="cell-score">${renderScoreChip(p.seoScore)}</td>
      </tr>`;
    })
    .join('\n');

  const useLazyPageDetails = totalPages > PAGE_DETAIL_LAZY_THRESHOLD;
  const pageBlocks = pages
    .map((p, index) =>
      renderPageDetailSummary(p, index, totalPages, {
        lazy: useLazyPageDetails,
        prebuiltBody: useLazyPageDetails ? null : buildPageDetailHtml(p, index, totalPages)
      })
    )
    .join('\n');

  const totalCriticalAll = pages.reduce((a, p) => a + getDisplayIssueCounts(p.issues).critical, 0);
  const totalGeoAll = pages.reduce((a, p) => a + (p.issues.geo?.length || 0), 0);
  const totalMinorAll = pages.reduce((a, p) => a + getDisplayIssueCounts(p.issues).minor, 0);
  const totalSeoIssuesAll = totalCriticalAll + totalMinorAll;
  const exportPayload = buildSeoReportExportPayload(mainUrl, scanDate, pages);
  const exportJson = embedJsonForHtmlScript(exportPayload);
  const pageUrlsJson = embedJsonForHtmlScript(buildSeoScannedUrlsList(pages));
  const csvExportUrl = reportId
    ? `/api/modules/seo/reports/${encodeURIComponent(reportId)}/csv/issues`
    : '';
  const csvPagesExportUrl = reportId
    ? `/api/modules/seo/reports/${encodeURIComponent(reportId)}/csv/pages`
    : '';
  const urlsCopyUrl = reportId
    ? `/api/modules/seo/reports/${encodeURIComponent(reportId)}/urls`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Seo/Geo Audit Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet" />
<style>
  :root{
    --bg:#0a101c;--card:#111827;--text:#ffffff;--muted:#d1d9e6;
    --border:rgba(203,213,225,.18);--border-strong:rgba(226,232,240,.3);
    --good:#4ade80;--minor:#fbbf24;--critical:#f87171;--info:#7dd3fc;--geo:#c4b5fd;--security:#67e8f9;
    --surface:rgba(255,255,255,.04);--surface-2:rgba(255,255,255,.07);--elevated:rgba(255,255,255,.11);
    --text-secondary:#e5edf7;--text-tertiary:#b8c4d9;
    --success:var(--good);--warning:var(--minor);--danger:var(--critical);
    --success-bg:rgba(74,222,128,.14);--success-border:rgba(74,222,128,.32);
    --warning-bg:rgba(251,191,36,.14);--warning-border:rgba(251,191,36,.32);
    --danger-bg:rgba(248,113,113,.14);--danger-border:rgba(248,113,113,.32);
    --info-bg:rgba(125,211,252,.14);--info-border:rgba(125,211,252,.32);
    --muted-bg:rgba(148,163,184,.12);--muted-border:rgba(148,163,184,.24);
    --radius:14px;--radius-sm:10px;
    --shadow:0 1px 2px rgba(0,0,0,.28),0 10px 30px rgba(0,0,0,.22);
    --font-sans:"Inter",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    --font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
    --code-text:#e0f2fe;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    margin:0;font-family:var(--font-sans);font-size:16px;line-height:1.65;font-weight:500;
    background:radial-gradient(1200px 600px at 10% -10%,rgba(59,130,246,.12),transparent 60%),
      radial-gradient(900px 500px at 90% 0%,rgba(168,85,247,.1),transparent 55%),var(--bg);
    color:var(--text);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility
  }
  .wrap{max-width:1440px;margin:0 auto;padding:clamp(16px,3vw,40px) clamp(14px,2.5vw,32px) clamp(32px,4vw,56px)}
  .report-header{
    display:flex;align-items:flex-start;justify-content:space-between;gap:clamp(16px,3vw,28px);
    margin-bottom:clamp(20px,3vw,32px);padding-bottom:clamp(16px,2.5vw,24px);
    border-bottom:1px solid var(--border)
  }
  .brand{font-size:clamp(1.25rem,2vw,1.5rem);font-weight:650;letter-spacing:-.03em;line-height:1.2}
  .brand-sub{margin-top:6px;font-size:.875rem;color:var(--text-secondary);line-height:1.45}
  .meta-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .meta-target{margin-top:14px;font-size:.875rem;color:var(--text-secondary);word-break:break-word;overflow-wrap:anywhere}
  .meta-target strong{color:var(--text);font-weight:600}
  .controls{display:flex;flex-wrap:wrap;gap:8px;flex-shrink:0;justify-content:flex-end}
  .btn{
    cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:38px;
    padding:0 16px;border-radius:var(--radius-sm);border:1px solid var(--border-strong);
    background:var(--surface-2);color:var(--text);font-size:.8125rem;font-weight:600;
    transition:background .15s ease,border-color .15s ease,transform .15s ease
  }
  .btn:hover{background:var(--elevated);border-color:rgba(255,255,255,.22)}
  .btn-primary{background:rgba(255,255,255,.06)}
  .btn-sm{min-height:34px;padding:0 12px;font-size:.75rem}
  .summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:28px}
  .summary--issues{grid-template-columns:repeat(2,minmax(0,1fr))}
  @media(min-width:720px){.summary--issues{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(min-width:1100px){.summary--issues{grid-template-columns:repeat(5,minmax(0,1fr))}}
  .summary--issues .stat-value{font-weight:800}
  .stat-card{
    background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);
    padding:16px 18px;box-shadow:var(--shadow);min-width:0
  }
  .stat-label{font-size:.75rem;font-weight:600;color:var(--text-tertiary);letter-spacing:.04em;text-transform:uppercase}
  .stat-value{margin-top:10px;font-size:clamp(1.5rem,2.5vw,1.75rem);font-weight:700;letter-spacing:-.03em;line-height:1}
  .stat-value--danger{color:var(--danger)}
  .stat-value--warning{color:var(--warning)}
  .stat-value--info{color:var(--info)}
  .stat-value--geo{color:var(--geo)}
  .table-panel{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
  .table-panel-head{
    display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;
    padding:16px 20px;border-bottom:1px solid var(--border)
  }
  .table-panel-title{font-size:1rem;font-weight:650;letter-spacing:-.02em}
  .table-panel-sub{font-size:.8125rem;color:var(--text-tertiary);margin-top:4px}
  .table-scroll{overflow-x:auto;overflow-y:auto;-webkit-overflow-scrolling:touch;max-height:min(70vh,720px);width:100%}
  .dashboard-table{width:100%;min-width:960px;border-collapse:separate;border-spacing:0}
  @media(min-width:1280px){.dashboard-table{min-width:1280px}}
  .dashboard-table thead th{
    position:sticky;top:0;z-index:2;padding:11px 12px;font-size:.6875rem;font-weight:700;
    color:var(--text-tertiary);text-align:left;text-transform:uppercase;letter-spacing:.07em;
    background:rgba(21,27,36,.96);backdrop-filter:blur(8px);border-bottom:1px solid var(--border-strong)
  }
  .dashboard-table tbody td{
    padding:12px;vertical-align:top;border-bottom:1px solid var(--border);
    font-size:.8125rem;line-height:1.45;word-break:break-word;overflow-wrap:anywhere
  }
  .dashboard-table tbody tr.data-row{transition:background .12s ease}
  .dashboard-table tbody tr.data-row:hover td{background:rgba(255,255,255,.03)}
  .dashboard-table tbody tr:last-child td{border-bottom:none}
  .dashboard-table th.cell-metric,.dashboard-table td.cell-metric,
  .dashboard-table th.cell-badge,.dashboard-table td.cell-badge,
  .dashboard-table th.cell-score,.dashboard-table td.cell-score{text-align:center;white-space:nowrap}
  .dashboard-table thead th.cell-metric{min-width:52px;padding-left:8px;padding-right:8px}
  .th-metric-label{display:inline-block;white-space:nowrap;font-variant-numeric:tabular-nums}
  .dashboard-table th.cell-issues,.dashboard-table td.cell-issues{text-align:left;min-width:140px}
  .dashboard-table .cell-url{min-width:180px;max-width:360px}
  .dashboard-table .cell-title{min-width:140px;max-width:280px}
  .url-link,.page-url-link,.page-detail-url{
    color:#bfdbfe;text-decoration:none;font-family:var(--font-mono);font-size:.8125rem;
    word-break:break-all;overflow-wrap:anywhere;line-height:1.45
  }
  .url-link:hover,.page-url-link:hover,.page-detail-url:hover{color:#eff6ff;text-decoration:underline}
  .cell-wrap{display:block;word-break:break-word;overflow-wrap:anywhere;line-height:1.4}
  .chip{
    display:inline-flex;align-items:center;justify-content:center;min-height:24px;padding:0 10px;
    border-radius:999px;font-size:.6875rem;font-weight:700;line-height:1.2;border:1px solid transparent;
    max-width:100%;white-space:normal;text-align:center
  }
  .chip--xs{min-height:22px;padding:0 8px;font-size:.625rem}
  .chip--mono{font-variant-numeric:tabular-nums;font-family:var(--font-mono)}
  .chip--success{color:var(--good);background:var(--success-bg);border-color:var(--success-border)}
  .chip--warning{color:var(--minor);background:var(--warning-bg);border-color:var(--warning-border)}
  .chip--danger{color:var(--critical);background:var(--danger-bg);border-color:var(--danger-border)}
  .chip--info{color:var(--info);background:var(--info-bg);border-color:var(--info-border)}
  .chip--neutral{color:var(--text-secondary);background:var(--muted-bg);border-color:var(--muted-border)}
  .chip--muted{color:var(--text-tertiary);background:transparent;border-color:var(--border)}
  .chip-group{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:flex-start;gap:6px}
  .mono{font-family:var(--font-mono);font-size:.75rem;word-break:break-all;overflow-wrap:anywhere}
  .pageMeta{color:var(--text-secondary);font-size:.875rem;margin-top:6px;line-height:1.55;word-break:break-word;overflow-wrap:anywhere}
  .pageMeta b{color:#f1f5f9;font-weight:600}
  .minor-meta-line code{color:#f1f5f9;font-weight:500}
  .page-detail-list{display:flex;flex-direction:column;gap:10px}
  .page-detail{
    background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);
    overflow:hidden;box-shadow:var(--shadow);transition:border-color .15s ease,box-shadow .15s ease
  }
  .page-detail[open]{border-color:var(--border-strong);box-shadow:0 0 0 1px rgba(125,211,252,.08),var(--shadow)}
  .page-detail--hidden{display:none !important}
  .page-detail-summary{
    list-style:none;cursor:pointer;display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;
    padding:14px 16px;user-select:none
  }
  .page-detail-summary::-webkit-details-marker{display:none}
  .page-detail-chevron{
    display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;
    background:var(--muted-bg);border:1px solid var(--muted-border);color:var(--text-secondary);flex:0 0 auto;
    transition:transform .18s ease,background .15s ease
  }
  .page-detail-chevron svg{width:16px;height:16px}
  .page-detail[open] .page-detail-chevron{transform:rotate(90deg);background:var(--info-bg);color:var(--info)}
  .page-detail-index{
    font-size:.75rem;font-weight:700;color:var(--text-tertiary);font-variant-numeric:tabular-nums;
    min-width:36px;flex:0 0 auto
  }
  .page-detail-main{min-width:0;flex:1 1 260px}
  .page-detail-title{
    margin-top:4px;font-size:.8125rem;color:var(--text-secondary);line-height:1.45;
    word-break:break-word;overflow-wrap:anywhere
  }
  .page-detail-badges{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;flex:1 1 220px}
  .page-badge{
    display:inline-flex;align-items:center;min-height:26px;padding:0 10px;border-radius:999px;
    font-size:.6875rem;font-weight:700;border:1px solid transparent;font-variant-numeric:tabular-nums
  }
  .page-badge--critical{color:var(--critical);background:var(--danger-bg);border-color:var(--danger-border)}
  .page-badge--minor{color:var(--minor);background:var(--warning-bg);border-color:var(--warning-border)}
  .page-badge--geo{color:var(--geo);background:rgba(196,181,253,.14);border-color:rgba(196,181,253,.28)}
  .page-badge--hidden{color:var(--info);background:var(--info-bg);border-color:var(--info-border)}
  .page-badge--score{color:var(--text);background:var(--muted-bg);border-color:var(--muted-border)}
  .page-badge--score.page-badge--good{color:var(--good);background:var(--success-bg);border-color:var(--success-border)}
  .page-badge--score.page-badge--warn{color:var(--minor);background:var(--warning-bg);border-color:var(--warning-border)}
  .page-badge--score.page-badge--bad{color:var(--critical);background:var(--danger-bg);border-color:var(--danger-border)}
  .page-detail-body{
    border-top:1px solid var(--border);padding:clamp(14px,2vw,20px);background:rgba(0,0,0,.14)
  }
  .page-detail-placeholder,.page-detail-loading{
    color:var(--text-tertiary);font-size:.875rem;padding:12px 2px;display:flex;align-items:center;gap:10px
  }
  .page-detail-spinner{
    width:16px;height:16px;border:2px solid var(--muted-border);border-top-color:var(--info);
    border-radius:50%;animation:page-detail-spin .8s linear infinite
  }
  @keyframes page-detail-spin{to{transform:rotate(360deg)}}
  .page-detail-content{display:flex;flex-direction:column;gap:14px}
  .page-detail-meta{
    display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px 16px;
    padding-bottom:12px;border-bottom:1px solid var(--border)
  }
  .page-detail-score{flex:0 0 auto}
  .audit-cards{display:flex;flex-direction:column;gap:14px;margin-top:16px}
  .audit-card{
    background:rgba(0,0,0,.12);border:1px solid rgba(255,255,255,.08);border-radius:var(--radius-sm);
    padding:clamp(14px,2vw,18px);min-width:0;width:100%
  }
  .audit-card--seo{border-color:rgba(96,165,250,.24)}
  .audit-card--geo{border-color:rgba(168,85,247,.28)}
  .audit-card--security{border-color:rgba(56,189,248,.28)}
  .audit-card--pagespeed{
    border-color:rgba(99,102,241,.32);
    background:linear-gradient(145deg,rgba(15,23,42,.55) 0%,rgba(30,27,75,.28) 48%,rgba(15,23,42,.4) 100%)
  }
  .audit-card--pagespeed-error{border-color:rgba(239,68,68,.28)}
  .audit-card--pagespeed-muted{border-color:rgba(148,163,184,.24)}
  .audit-card-head{
    display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 16px;
    padding-bottom:12px;border-bottom:1px solid var(--border)
  }
  .audit-card-intro{min-width:0;flex:1 1 220px}
  .audit-card-title{
    display:flex;align-items:center;gap:10px;font-size:.9375rem;font-weight:700;color:#f8fafc;line-height:1.35
  }
  .audit-card-icon{width:20px;height:20px;flex:0 0 auto;color:var(--info)}
  .audit-card--geo .audit-card-icon{color:var(--geo)}
  .audit-card--security .audit-card-icon{color:var(--security)}
  .audit-card--pagespeed .audit-card-icon{color:#818cf8}
  .pagespeed-message{margin:0;font-size:.875rem;color:var(--text-secondary);line-height:1.55}
  .pagespeed-message--error{color:var(--critical)}
  .audit-card-body--pagespeed-message{padding:12px 0}
  .audit-card--pagespeed .audit-card-head{padding-bottom:8px}
  .pagespeed-legend{
    display:flex;flex-wrap:wrap;gap:8px 12px;margin:8px 0 0;padding:6px 10px;
    border-radius:var(--radius-sm);background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)
  }
  .pagespeed-legend-item{display:inline-flex;align-items:center;gap:6px;font-size:.625rem;font-weight:600;color:var(--text-secondary)}
  .pagespeed-legend-swatch{width:10px;height:10px;border-radius:999px;flex:0 0 auto}
  .pagespeed-legend-swatch--good{background:#0cce6b}
  .pagespeed-legend-swatch--warn{background:#ffa400}
  .pagespeed-legend-swatch--bad{background:#ff4e42}
  .audit-card-body--pagespeed-pro{
    display:grid;grid-template-columns:1fr;gap:8px;margin-top:2px
  }
  @media(min-width:900px){
    .audit-card--pagespeed .audit-card-body--pagespeed-pro{grid-template-columns:repeat(3,minmax(0,1fr))}
    .audit-card-body--pagespeed-pro .pagespeed-details-row{grid-column:1/-1}
  }
  .audit-card-body--pagespeed-pro > .pagespeed-tile,
  .audit-card-body--pagespeed-pro > .pagespeed-health-card{min-width:0;overflow:hidden;isolation:isolate}
  .pagespeed-tile{
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;
    padding:10px 12px;min-width:0;height:100%;display:flex;flex-direction:column
  }
  .pagespeed-tile--mobile{
    border-color:rgba(167,139,250,.35);
    background:linear-gradient(160deg,rgba(139,92,246,.1) 0%,rgba(255,255,255,.03) 100%);
    box-shadow:inset 0 1px 0 rgba(196,181,253,.18)
  }
  .pagespeed-tile--desktop{
    border-color:rgba(96,165,250,.35);
    background:linear-gradient(160deg,rgba(59,130,246,.1) 0%,rgba(255,255,255,.03) 100%);
    box-shadow:inset 0 1px 0 rgba(147,197,253,.18)
  }
  .pagespeed-tile--error{border-color:rgba(255,78,66,.28)}
  .pagespeed-tile--muted{border-color:rgba(148,163,184,.22)}
  .pagespeed-tile-head--compact{
    display:grid;grid-template-columns:32px minmax(0,1fr) 50px;gap:8px;align-items:center;
    margin-bottom:8px;min-width:0
  }
  .pagespeed-tile-head--no-score{grid-template-columns:32px minmax(0,1fr)}
  .pagespeed-tile-score{display:flex;justify-content:center;align-items:center;flex:0 0 auto}
  .pagespeed-tile-icon-wrap{
    display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;flex:0 0 auto
  }
  .pagespeed-tile--mobile .pagespeed-tile-icon-wrap{color:#ddd6fe;background:rgba(167,139,250,.22);border:1px solid rgba(196,181,253,.28)}
  .pagespeed-tile--desktop .pagespeed-tile-icon-wrap{color:#bfdbfe;background:rgba(96,165,250,.22);border:1px solid rgba(147,197,253,.28)}
  .pagespeed-tile-icon{width:16px;height:16px}
  .pagespeed-tile-intro{min-width:0}
  .pagespeed-tile-title{font-size:.8125rem;font-weight:800;color:#f8fafc;letter-spacing:.01em;line-height:1.2}
  .pagespeed-tile--mobile .pagespeed-tile-title{color:#ede9fe}
  .pagespeed-tile--desktop .pagespeed-tile-title{color:#eff6ff}
  .pagespeed-tile-sub{margin-top:1px;font-size:.625rem;color:#cbd5e1;letter-spacing:.02em;line-height:1.2}
  .pagespeed-tile--mobile .pagespeed-tile-sub{color:#c4b5fd}
  .pagespeed-tile--desktop .pagespeed-tile-sub{color:#93c5fd}
  .pagespeed-ring{position:relative;width:50px;height:50px;flex:0 0 auto}
  .pagespeed-ring-svg{display:block;width:100%;height:100%;overflow:visible}
  .pagespeed-ring-track{stroke:rgba(255,255,255,.14)}
  .pagespeed-ring-value{
    position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    font-size:.8125rem;font-weight:800;color:#f8fafc;font-variant-numeric:tabular-nums;line-height:1
  }
  .pagespeed-tile-bars{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0}
  .pagespeed-bar{display:flex;flex-direction:column;gap:3px}
  .pagespeed-bar-meta{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .pagespeed-bar-label{font-size:.6875rem;font-weight:700;color:#e2e8f0}
  .pagespeed-bar-value{font-size:.6875rem;font-weight:800;font-variant-numeric:tabular-nums;color:#f1f5f9}
  .pagespeed-bar-track{height:5px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden}
  .pagespeed-bar-fill{display:block;height:100%;border-radius:999px;transition:width .3s ease}
  .pagespeed-details-row{display:grid;grid-template-columns:1fr;gap:8px;min-width:0}
  @media(min-width:900px){.pagespeed-details-row{grid-template-columns:minmax(0,1.15fr) minmax(0,0.85fr)}}
  .pagespeed-aside-card{
    background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.1);border-radius:12px;
    padding:10px 12px;min-width:0;height:100%
  }
  .pagespeed-health-card{min-height:0;display:flex;flex-direction:column;padding:10px 12px}
  .pagespeed-health-charts{
    display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;width:100%;margin-top:2px
  }
  .pagespeed-health-charts .pagespeed-mini-chart{
    display:flex;flex-direction:column;align-items:center;width:100%;min-width:0
  }
  .pagespeed-health-charts .audit-pie-chart{width:100%;max-width:108px;margin:0 auto}
  .pagespeed-health-charts .audit-pie-ring{width:100%;max-width:92px;margin:0 auto}
  .pagespeed-health-charts .audit-pie-legend{display:none}
  .pagespeed-health-charts .audit-pie-svg-value{font-size:14px}
  .pagespeed-mini-chart-label{
    font-size:.625rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;text-align:center;margin-bottom:4px
  }
  .pagespeed-mini-chart-label--mobile{color:#c4b5fd}
  .pagespeed-mini-chart-label--desktop{color:#93c5fd}
  .pagespeed-aside-card--vitals{flex:1 1 auto}
  .pagespeed-aside-head{font-size:.6875rem;font-weight:800;color:#f1f5f9;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px}
  .pagespeed-vitals-legend{display:flex;gap:6px;margin-bottom:6px}
  .pagespeed-vitals-legend-item{
    flex:1 1 0;font-size:.5625rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;text-align:center;
    padding:3px 6px;border-radius:999px;border:1px solid transparent
  }
  .pagespeed-vitals-legend-item--mobile{color:#c4b5fd;background:rgba(139,92,246,.12);border-color:rgba(139,92,246,.24)}
  .pagespeed-vitals-legend-item--desktop{color:#93c5fd;background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.24)}
  .pagespeed-vitals-list{display:flex;flex-direction:column;gap:4px}
  .pagespeed-vitals-row{
    display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;
    padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05)
  }
  .pagespeed-vitals-metric{display:flex;align-items:center;gap:6px;min-width:0}
  .pagespeed-vitals-short{font-size:.625rem;font-weight:800;color:#a5b4fc;letter-spacing:.04em;flex:0 0 auto}
  .pagespeed-vitals-name{font-size:.6875rem;font-weight:600;color:#e2e8f0;line-height:1.25;min-width:0}
  .pagespeed-vitals-values{display:grid;grid-template-columns:repeat(2,minmax(56px,1fr));gap:6px}
  .pagespeed-vital-value{
    display:block;text-align:center;padding:4px 6px;border-radius:6px;font-size:.6875rem;font-weight:700;
    color:#e2e8f0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
    font-family:var(--font-mono);white-space:nowrap
  }
  .pagespeed-matrix{display:flex;flex-direction:column;gap:4px}
  .pagespeed-matrix-row{
    display:grid;grid-template-columns:minmax(0,1.1fr) repeat(2,minmax(44px,1fr));gap:6px;align-items:center
  }
  .pagespeed-matrix-row--head{margin-bottom:2px}
  .pagespeed-matrix-label{font-size:.6875rem;font-weight:700;color:#cbd5e1}
  .pagespeed-matrix-row--head .pagespeed-matrix-label,
  .pagespeed-matrix-col{font-size:.5625rem;font-weight:800;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.04em;text-align:center}
  .pagespeed-matrix-cell{
    display:flex;align-items:center;justify-content:center;min-height:26px;border-radius:8px;
    font-size:.75rem;font-weight:800;font-variant-numeric:tabular-nums;border:1px solid transparent
  }
  .pagespeed-health-card.audit-issue-group--chart{min-height:0;padding:10px 12px}
  .pagespeed-matrix-cell--good{color:#bbf7d0;background:rgba(74,222,128,.18);border-color:rgba(134,239,172,.42)}
  .pagespeed-matrix-cell--warn{color:#fde68a;background:rgba(251,191,36,.18);border-color:rgba(252,211,77,.42)}
  .pagespeed-matrix-cell--bad{color:#fecaca;background:rgba(248,113,113,.18);border-color:rgba(252,165,165,.42)}
  .pagespeed-matrix-cell--muted{color:#cbd5e1;background:rgba(148,163,184,.14);border-color:rgba(203,213,225,.24)}
  .pagespeed-mini-chart .audit-pie-legend{font-size:.6875rem}
  .audit-stat-icon{font-size:.5rem;margin-right:4px;opacity:.9}
  .audit-card-subtitle{
    margin-top:4px;font-size:.75rem;color:var(--text-tertiary);line-height:1.4;
    word-break:break-word;overflow-wrap:anywhere
  }
  .audit-card-score{
    display:inline-flex;align-items:center;gap:8px;min-width:92px;padding:8px 14px;border-radius:999px;
    border:1px solid transparent;font-weight:700;flex:0 0 auto
  }
  .audit-card-score-icon{
    display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;
    font-size:.8125rem;font-weight:800;line-height:1
  }
  .audit-card-score-value{font-size:1.125rem;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
  .audit-card-score--good{color:var(--good);background:var(--success-bg);border-color:var(--success-border)}
  .audit-card-score--good .audit-card-score-icon{background:rgba(34,197,94,.18);color:var(--good)}
  .audit-card-score--warn{color:var(--minor);background:var(--warning-bg);border-color:var(--warning-border)}
  .audit-card-score--warn .audit-card-score-icon{background:rgba(245,158,11,.18);color:var(--minor)}
  .audit-card-score--bad{color:var(--critical);background:var(--danger-bg);border-color:var(--danger-border)}
  .audit-card-score--bad .audit-card-score-icon{background:rgba(239,68,68,.18);color:var(--critical)}
  .audit-card-stats{
    display:flex;flex-wrap:wrap;gap:8px;margin-top:12px
  }
  .audit-stat{
    display:inline-flex;align-items:center;min-height:28px;padding:0 12px;border-radius:999px;
    font-size:.6875rem;font-weight:700;border:1px solid transparent
  }
  .audit-stat--critical{color:var(--critical);background:var(--danger-bg);border-color:var(--danger-border)}
  .audit-stat--minor{color:var(--minor);background:var(--warning-bg);border-color:var(--warning-border)}
  .audit-stat--hidden{color:var(--info);background:var(--info-bg);border-color:var(--info-border)}
  .audit-card-body{
    display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px
  }
  @media(min-width:900px){.audit-card-body{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(min-width:900px){.audit-card--seo .audit-card-body{grid-template-columns:2fr 1fr}}
  @media(min-width:900px){.audit-card--geo .audit-card-body,.audit-card--security .audit-card-body{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(min-width:900px){.audit-card-body--richresults{grid-template-columns:1fr 1.2fr}}
  .audit-card--richresults{border-color:rgba(96,165,250,.22)}
  .audit-card-body--richresults{align-items:start}
  .richresults-meta{
    background:rgba(255,255,255,.02);border:1px solid rgba(96,165,250,.18);border-radius:var(--radius-sm);
    padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0
  }
  .richresults-meta-row{display:flex;flex-direction:column;gap:4px;min-width:0}
  .richresults-meta-label{
    font-size:.6875rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-tertiary)
  }
  .richresults-meta-value{font-size:.8125rem;color:var(--text-secondary);word-break:break-word;overflow-wrap:anywhere}
  a.richresults-meta-value{color:#93c5fd;text-decoration:none}
  a.richresults-meta-value:hover{text-decoration:underline;color:#bfdbfe}
  .richresults-cta{
    display:inline-flex;align-items:center;justify-content:center;margin-top:4px;padding:10px 14px;
    border-radius:10px;font-size:.8125rem;font-weight:700;text-decoration:none;
    color:#0f172a;background:linear-gradient(135deg,#60a5fa,#38bdf8);border:1px solid rgba(147,197,253,.5)
  }
  .richresults-cta:hover{filter:brightness(1.05)}
  .richresults-shot-wrap{
    background:rgba(255,255,255,.02);border:1px solid rgba(96,165,250,.18);border-radius:var(--radius-sm);
    padding:12px 14px;min-width:0
  }
  .richresults-shot-head{
    display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;
    margin-bottom:10px;font-size:.75rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#e2e8f0
  }
  .richresults-open-img{
    font-size:.75rem;font-weight:700;letter-spacing:0;text-transform:none;color:#93c5fd;text-decoration:none
  }
  .richresults-open-img:hover{text-decoration:underline}
  .richresults-shot-link{display:block;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}
  .richresults-shot{
    display:block;width:100%;height:auto;max-height:520px;object-fit:contain;object-position:top center;
    background:#0b1220
  }
  .richresults-file{margin-top:8px;font-size:.75rem;color:var(--text-tertiary)}
  .richresults-hint{margin:8px 0 0;font-size:.75rem;color:var(--text-tertiary);line-height:1.45}
  .richresults-message{
    padding:14px 16px;border-radius:var(--radius-sm);font-size:.875rem;line-height:1.5;
    color:var(--text-secondary);background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06)
  }
  .richresults-message--error{color:#fecaca;border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.08)}
  .audit-issue-group{
    background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:var(--radius-sm);
    padding:12px 14px;min-width:0;height:100%
  }
  .audit-issue-group--critical{border-color:rgba(239,68,68,.18)}
  .audit-issue-group--minor{border-color:rgba(245,158,11,.18)}
  .audit-issue-group--unified{border-color:rgba(96,165,250,.2)}
  .audit-issue-group--geo-issues{border-color:rgba(168,85,247,.22)}
  .audit-issue-group--security-issues{border-color:rgba(56,189,248,.22)}
  .audit-issue-group--pass{border-color:rgba(74,222,128,.22)}
  .audit-pass-item{
    display:grid;grid-template-columns:minmax(52px,64px) minmax(0,1fr);align-items:start;column-gap:12px;
    margin:8px 0;font-size:.8125rem;line-height:1.45;min-width:0
  }
  .audit-pass-item code{min-width:0;color:#86efac;word-break:break-word;overflow-wrap:anywhere}
  .audit-pass-status{
    justify-self:start;min-width:52px;padding:3px 8px;border-radius:999px;
    font-size:.625rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;text-align:center;line-height:1.2;
    color:var(--good);background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.28)
  }
  .audit-issue-group--chart{
    border-color:rgba(125,211,252,.2);display:flex;flex-direction:column;align-items:center;justify-content:center;
    text-align:center;min-height:220px
  }
  .audit-pie-chart{
    display:flex;flex-direction:column;align-items:center;width:100%;max-width:180px;margin:8px auto 0
  }
  .audit-pie-ring{position:relative;width:100%;max-width:140px;aspect-ratio:1}
  .audit-pie-svg{display:block;width:100%;height:100%;overflow:visible}
  .audit-pie-svg-value{
    fill:#fff;font-size:18px;font-weight:800;font-family:var(--font-sans);letter-spacing:-.03em
  }
  .audit-pie-legend{
    display:flex;flex-direction:column;align-items:stretch;gap:6px;margin-top:14px;width:100%;
    max-width:160px;font-size:.75rem;font-weight:600;color:var(--text-secondary)
  }
  .audit-pie-legend-item{display:flex;align-items:center;gap:8px;justify-content:center;width:100%}
  .audit-pie-swatch{width:10px;height:10px;border-radius:999px;flex:0 0 auto;box-shadow:0 0 0 1px rgba(255,255,255,.15)}
  .audit-issue-group-head{
    font-size:.75rem;font-weight:700;color:#e2e8f0;margin-bottom:8px;letter-spacing:.04em;text-transform:uppercase
  }
  .audit-issue-count{color:var(--text-tertiary);font-weight:600}
  ul{margin:8px 0 0 18px;padding:0}
  .audit-issue-group ul{margin:0;padding:0;list-style:none}
  li{margin:7px 0;font-size:.9375rem;font-weight:500;color:var(--text-secondary);line-height:1.6;word-break:break-word;overflow-wrap:anywhere}
  .issue-line{
    display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;padding:4px 0
  }
  .issue-line--tagged{align-items:flex-start}
  .issue-line-tags{flex:0 0 auto;display:inline-flex;align-items:center}
  .issue-severity-tag{
    display:inline-flex;align-items:center;min-height:20px;padding:2px 8px;border-radius:999px;
    font-size:.625rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;line-height:1.2;
    border:1px solid transparent
  }
  .issue-severity-tag--critical{color:var(--critical);background:var(--danger-bg);border-color:var(--danger-border)}
  .issue-severity-tag--minor{color:var(--minor);background:var(--warning-bg);border-color:var(--warning-border)}
  .issue-severity-tag--warning{color:#fdba74;background:rgba(251,146,60,.14);border-color:rgba(251,146,60,.35)}
  .issue-line-label{
    flex:0 0 auto;font-weight:700;color:#f1f5f9;white-space:nowrap;line-height:1.5
  }
  .issue-line-detail{flex:1 1 120px;min-width:0}
  .issue-line-detail code,.issue-line-code{
    display:block;width:100%;color:var(--code-text);font-family:var(--font-mono);font-size:.875rem;font-weight:600;
    line-height:1.55;word-break:break-word;overflow-wrap:anywhere;white-space:normal
  }
  code{
    color:var(--code-text);font-family:var(--font-mono);font-size:.875rem;font-weight:600;
    word-break:break-word;overflow-wrap:anywhere;white-space:normal
  }
  .security-header-list{margin:0;padding:0;list-style:none}
  .security-header-item{
    display:grid;grid-template-columns:minmax(52px,64px) minmax(0,1fr);align-items:start;column-gap:12px;row-gap:4px;
    margin:8px 0;font-size:.8125rem;line-height:1.45;min-width:0
  }
  .security-header-item code{min-width:0;word-break:break-word;overflow-wrap:anywhere}
  .security-header-status{
    justify-self:start;min-width:52px;padding:3px 8px;border-radius:999px;
    font-size:.625rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;text-align:center;line-height:1.2
  }
  .security-header-item--pass .security-header-status{color:var(--text-tertiary);background:var(--muted-bg);border:1px solid var(--muted-border)}
  .security-header-item--fail .security-header-status{color:var(--critical);background:var(--danger-bg);border:1px solid var(--danger-border)}
  .security-header-item--warn .security-header-status{color:var(--minor);background:var(--warning-bg);border:1px solid var(--warning-border)}
  .security-header-item--na .security-header-status{color:var(--text-tertiary);background:transparent;border:1px solid var(--border)}
  .security-header-item--pass code{color:#94a3b8}
  .security-header-item--fail code{color:#fecaca}
  .security-header-item--warn code{color:#fde68a}
  .detail-section{margin-top:clamp(24px,4vw,40px)}
  .detail-section-head{
    display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:14px 20px;
    margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)
  }
  .detail-section-title{
    font-size:clamp(1.05rem,2vw,1.2rem);font-weight:700;letter-spacing:-.02em;color:#f8fafc
  }
  .detail-section-sub{margin-top:4px;font-size:.8125rem;color:var(--text-tertiary)}
  .detail-section-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
  .detail-filter{
    display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border-radius:var(--radius-sm);
    border:1px solid var(--border-strong);background:var(--surface-2)
  }
  .detail-filter-icon{width:16px;height:16px;color:var(--text-tertiary);flex:0 0 auto}
  .detail-filter-input{
    border:0;outline:0;background:transparent;color:var(--text);font:inherit;font-size:.8125rem;
    min-width:min(280px,60vw)
  }
  .detail-filter-input::placeholder{color:var(--text-tertiary)}
  @media(max-width:900px){
    .report-header{flex-direction:column}
    .controls{width:100%;justify-content:stretch}
    .btn{flex:1 1 auto}
    .detail-section-head{align-items:stretch}
    .detail-section-toolbar{width:100%}
    .detail-filter{flex:1 1 auto}
    .detail-filter-input{min-width:0;width:100%}
    .page-detail-summary{align-items:flex-start}
    .page-detail-badges{justify-content:flex-start}
    .table-scroll{max-height:none}
  }
  @media print{
    @page{size:A4 landscape;margin:10mm}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{background:#fff !important;color:#111 !important}
    .wrap{max-width:none;padding:0}
    .report-header{border-bottom:1px solid #d4d4d8;padding-bottom:12px;margin-bottom:16px}
    .brand,.brand-sub,.pageUrl,.detail-section-title{color:#111 !important}
    .controls,.btn{display:none !important}
    .summary{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:16px}
    .summary--issues{grid-template-columns:repeat(5,minmax(0,1fr))}
    .stat-card{background:#fafafa !important;border:1px solid #e4e4e7;padding:10px 12px}
    .stat-label{color:#52525b !important}
    .stat-value{color:#111 !important}
    .table-panel,.page-detail{background:#fff !important;border:1px solid #e4e4e7}
    .table-panel-head{border-bottom:1px solid #e4e4e7;padding:10px 14px}
    .table-scroll{max-height:none !important;overflow:visible !important}
    .dashboard-table{min-width:0 !important;width:100% !important;font-size:8px}
    .dashboard-table thead th{
      position:static !important;background:#f4f4f5 !important;color:#3f3f46 !important;
      padding:6px 5px;white-space:normal !important;word-break:break-word
    }
    .dashboard-table tbody td{
      padding:6px 5px;white-space:normal !important;word-break:break-word;
      color:#111 !important;border-bottom:1px solid #e4e4e7
    }
    .dashboard-table .cell-url,.dashboard-table .cell-title{min-width:0 !important;max-width:none !important}
    .cell-wrap{white-space:normal !important;overflow:visible !important;text-overflow:clip !important;max-width:none !important}
    .url-link{color:#111 !important;border-bottom:none}
    .chip{
      color:#111 !important;background:#f4f4f5 !important;border:1px solid #d4d4d8 !important;
      min-height:18px;padding:0 6px;font-size:8px;white-space:normal !important
    }
    .chip-group{gap:4px}
    .page-detail{page-break-inside:avoid;break-inside:avoid-page}
    .page-detail-body{background:#fff !important}
    .pageMeta{color:#3f3f46 !important;font-size:10px}
    .detail-section-toolbar,.detail-filter-input{display:none !important}
    .detail-section{margin-top:20px;page-break-before:auto}
    .audit-cards{gap:10px}
    .audit-card{
      background:#fafafa !important;border:1px solid #e4e4e7;
      page-break-inside:avoid;break-inside:avoid-page
    }
    .audit-card-title,.audit-card-score-value{color:#111 !important}
    .audit-card-subtitle{color:#52525b !important}
    .audit-card-score{background:#fff !important}
    .audit-card-body{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .audit-card--seo .audit-card-body{grid-template-columns:2fr 1fr}
    .audit-card--geo .audit-card-body,.audit-card--security .audit-card-body{grid-template-columns:repeat(3,minmax(0,1fr))}
    .audit-issue-group{background:#fff !important;border:1px solid #e4e4e7}
    .audit-pass-status{color:#166534 !important;background:#dcfce7 !important;border:1px solid #86efac !important}
    .audit-pass-item code{color:#166534 !important}
    .audit-issue-group-head{color:#111 !important}
    .audit-pie-svg-value{fill:#111 !important}
    li,code{color:#27272a !important;font-size:9px;word-break:break-word}
    ul{margin-left:0}
    .security-header-status{color:#111 !important;background:#f4f4f5 !important;border:1px solid #d4d4d8 !important}
    .security-header-item--fail code,.security-header-item--warn code{color:#27272a !important}
    .mono{font-size:8px;word-break:break-all}
    .dashboard-table tbody tr.data-row:hover td{background:transparent !important}
  }
</style>
  <script>${SEO_CSV_CLIENT_SCRIPT}</script>
  <script type="application/json" id="seo-report-page-urls">${pageUrlsJson}</script>
  ${csvExportUrl ? `<script>window.SEO_REPORT_CSV_URL = ${JSON.stringify(csvExportUrl)};</script>` : ''}
  ${csvPagesExportUrl ? `<script>window.SEO_REPORT_PAGES_CSV_URL = ${JSON.stringify(csvPagesExportUrl)};</script>` : ''}
  ${urlsCopyUrl ? `<script>window.SEO_REPORT_URLS_COPY_URL = ${JSON.stringify(urlsCopyUrl)};</script>` : ''}
</head>
<body>
  <div class="wrap">
    <header class="report-header">
      <div>
        <div class="brand">Seo/Geo Audit Report</div>
        <div class="brand-sub">Professional QA Report · Md Imran</div>
        <div class="meta-list">
          ${renderChip('Scan complete', 'success', { xs: true })}
          ${renderChip(`Avg score ${averageScore}`, averageScore >= 80 ? 'success' : averageScore >= 50 ? 'warning' : 'danger', { xs: true, mono: true })}
        </div>
        <div class="meta-target">Target <strong class="mono">${escapeHtml(mainUrl)}</strong></div>
        <div class="meta-target">Scanned <strong class="mono">${escapeHtml(scanDate)}</strong></div>
      </div>
      <div class="controls">
        <button class="btn" type="button" onclick="copySeoScannedUrls(event)">Copy URLs</button>
        <button class="btn" type="button" onclick="exportSeoPagesCsv()">Export CSV · Pages</button>
        <button class="btn btn-primary" type="button" onclick="exportSeoIssuesCsv()">Export CSV · Issues</button>
        <button class="btn" type="button" onclick="window.print()">Print / PDF</button>
      </div>
    </header>

    <div class="summary summary--issues">
      <div class="stat-card">
        <div class="stat-label">Pages scanned</div>
        <div class="stat-value">${totalPages}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Critical issues</div>
        <div class="stat-value stat-value--danger">${totalCriticalAll}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">GEO issues</div>
        <div class="stat-value stat-value--geo">${totalGeoAll}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Minor issues</div>
        <div class="stat-value stat-value--warning">${totalMinorAll}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">SEO issues</div>
        <div class="stat-value stat-value--info">${totalSeoIssuesAll}</div>
      </div>
    </div>

    <div class="table-panel">
      <div class="table-panel-head">
        <div>
          <div class="table-panel-title">Page results</div>
          <div class="table-panel-sub">${totalPages} page${totalPages === 1 ? '' : 's'} audited</div>
        </div>
        ${renderStatusBadge(robotsTxt)}
      </div>
      <div class="table-scroll">
        <table class="dashboard-table">
          <thead>
            <tr>
              <th>URL</th>
              <th>Title</th>
              <th class="cell-metric" title="H1 tag count">H1</th>
              <th class="cell-badge" title="Heading hierarchy">Hierarchy</th>
              <th class="cell-issues">Issues</th>
              <th class="cell-metric" title='Links with href="#"'><span class="th-metric-label">href="#"</span></th>
              <th class="cell-metric" title="javascript:void(0) links"><span class="th-metric-label">JS Void</span></th>
              <th class="cell-metric" title="Missing image alt text">Alt</th>
              <th class="cell-metric" title="Missing Open Graph tags">OG</th>
              <th class="cell-badge" title="robots.txt site check">Robots</th>
              <th class="cell-badge" title="HTTP security headers">Headers</th>
              <th class="cell-metric" title="GEO issues">GEO</th>
              <th class="cell-score">Score</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-head">
        <div>
          <div class="detail-section-title">Issue details by page</div>
          <div class="detail-section-sub">${totalPages} page${totalPages === 1 ? '' : 's'}${useLazyPageDetails ? ' · details load on expand for faster large reports' : ''}</div>
        </div>
        <div class="detail-section-toolbar">
          <label class="detail-filter">
            <svg class="detail-filter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input id="page-detail-filter" class="detail-filter-input" type="search" placeholder="Filter by URL or title…" autocomplete="off" />
          </label>
          <button class="btn btn-sm" type="button" id="expand-all-pages">Expand</button>
          <button class="btn btn-sm" type="button" id="collapse-all-pages">Collapse</button>
        </div>
      </div>
      <div class="page-detail-list" id="issue-details-list">
        ${pageBlocks}
      </div>
    </div>
  </div>
  <script type="application/json" id="seo-report-export-data">${exportJson}</script>
  <script>${SEO_DETAIL_CLIENT_SCRIPT}</script>
</body>
</html>`;
}

async function runSeoAudit({
  mainUrl,
  mode,
  urls: explicitUrls,
  onProgress = null,
  maxCrawlUrls,
  includePageSpeed = false,
  includeRichResults = false,
  includeSeo = true,
  includeGeo = true,
  includeSecurityHeaders = true
}) {
  // Explicit false disables a module; missing/undefined keeps legacy default (on).
  const runSeo = includeSeo !== false;
  const runGeo = includeGeo !== false;
  const runSecurityHeaders = includeSecurityHeaders !== false;

  console.log('🧪 MODE RECEIVED IN ENGINE:', mode);
  log(
    `🧩 Modules: SEO=${runSeo ? 'on' : 'off'}, GEO=${runGeo ? 'on' : 'off'}, Security headers=${runSecurityHeaders ? 'on' : 'off'}`
  );
  if (includePageSpeed) {
    log('📊 Google PageSpeed enabled — mobile + desktop Lighthouse per page');
  }
  if (includeRichResults) {
    log('🔎 Google Rich Results Test enabled — screenshot for main URL (Playwright)');
  }

  if (!runSeo && !runGeo && !runSecurityHeaders && !includePageSpeed && !includeRichResults) {
    throw new Error('At least one audit module must be enabled (SEO, GEO, Security Headers, PageSpeed, or Rich Results).');
  }

  const baseUrl = normalizeBaseUrl(mainUrl);
  const scanDate = new Date().toISOString();

  const robotsStatus = runSeo
    ? await checkRobotsTxt(baseUrl)
    : { ok: true, skipped: true, url: `${baseUrl}/robots.txt`, reason: 'SEO module disabled' };
  const securityHeaderStatus = runSecurityHeaders
    ? await checkHttpSecurityHeaders(baseUrl)
    : {
        ok: true,
        skipped: true,
        passed: 0,
        total: 0,
        label: '—',
        failures: [],
        minors: [],
        warnings: [],
        results: []
      };
  // IndexNow — disabled for now
  // const indexNowKey = process.env.INDEXNOWKEY || '';
  // const indexNowStatus = await checkIndexNow(baseUrl, indexNowKey);
  const siteChecks = {
    critical: [],
    geo: [],
    minor: [],
    robotsTxt: runSeo ? (robotsStatus.ok ? 'YES' : 'NO') : '—',
    // indexNow: indexNowStatus.ok ? 'YES' : indexNowStatus.skipped ? '—' : 'NO',
    httpSecurityHeaders: runSecurityHeaders ? securityHeaderStatus.label : '—',
    securityHeaders: runSecurityHeaders ? securityHeaderStatus : null,
    auditModules: {
      seo: runSeo,
      geo: runGeo,
      securityHeaders: runSecurityHeaders,
      pageSpeed: includePageSpeed === true,
      richResults: includeRichResults === true
    }
    // indexNowStatus
  };
  if (runSeo && !robotsStatus.ok) {
    siteChecks.critical.push(`robots.txt: ${robotsStatus.reason} (${robotsStatus.url})`);
  }
  if (runSecurityHeaders) {
    for (const failure of securityHeaderStatus.failures || []) {
      siteChecks.critical.push(`HTTP Security Header: ${failure}`);
    }
    for (const minor of securityHeaderStatus.minors || []) {
      siteChecks.minor.push(`HTTP Security Header: ${minor}`);
    }
    for (const warning of securityHeaderStatus.warnings || []) {
      siteChecks.minor.push(`HTTP Security Header: ${warning}`);
    }
  }
  // if (!indexNowStatus.ok && !indexNowStatus.skipped) {
  //   siteChecks.geo.push(`${indexNowStatus.reason} (${indexNowStatus.url})`);
  // }

  let urls = [];
  let discoveryMethod = 'single';

  if (mode === 'single') {
    console.log('⚡ Running SINGLE URL SEO mode');
    if (Array.isArray(explicitUrls) && explicitUrls.length) {
      urls = explicitUrls.map((u) => normalizeBaseUrl(u));
      discoveryMethod = 'explicit-list';
      console.log(`📄 Multi-URL single-page mode: ${urls.length} URL(s)`);
    } else {
      urls = [normalizeBaseUrl(mainUrl)];
      discoveryMethod = 'single-url';
    }
  } else {
    console.log('🌐 Running FULL SITE SEO mode (link crawl — same as Keyword Radar)');
    discoveryMethod = 'crawl';
  }

  const tuning = resolveScanTuning(mode, urls.length || 1);
  const concurrency = includePageSpeed || includeRichResults ? 1 : tuning.concurrency;
  const timeoutMs = tuning.timeoutMs;
  const retryCount = tuning.retryCount;
  const BATCH_SIZE = tuning.batchSize;
  const DELAY_BETWEEN_BATCHES = tuning.delayBetweenBatches;
  const RETRY_DELAY_MS = tuning.retryDelayMs;

  const chunkArray = (arr, size) => {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  };

  const browser = await chromium.launch({ headless: true });
  try {
    if (mode === 'full') {
      log('🔗 Crawling site to discover pages (no sitemap)...');
      const crawlLimit = maxCrawlUrls || parseInt(process.argv[4], 10) || CRAWL_MAX_URLS;
      urls = await discoverSiteUrlsByCrawl(baseUrl, {
        browser,
        maxUrls: crawlLimit,
        onProgress: async (info) => {
          log(info.message || 'Crawling...');
          if (typeof onProgress === 'function') {
            await onProgress({
              phase: 'crawl',
              processed: info.processed,
              discovered: info.discovered,
              message: info.message,
              currentUrl: info.currentUrl
            });
          }
        }
      });
      log(`🎯 CRAWL DISCOVERED ${urls.length} URL(s) — faceted filter URLs skipped; collections & ?page= kept`);
    }

    if (!urls || urls.length === 0) {
      log('⚠️ No URLs found, fallback to main URL');
      urls = [baseUrl];
    }

    console.log('✅ FINAL MODE:', mode);
    console.log('📄 Total URLs to scan:', urls.length);

    const batches = chunkArray(urls, BATCH_SIZE);
    console.log('📦 TOTAL BATCHES:', batches.length);
    console.log('📏 BATCH SIZE:', BATCH_SIZE);

    log('🚀 Starting Playwright SEO scan (headless)...');
    log(`📄 Total URLs to scan: ${urls.length}`);
    log(`⚙️ Scan tuning: concurrency=${concurrency}, timeoutMs=${timeoutMs}, retries=${retryCount}, batchSize=${BATCH_SIZE}`);
    log('🌐 Browser launched (headless) using Chromium');

    const pages = [];
    let scanCompleted = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      console.log(`📦 Processing batch ${i + 1}/${batches.length}`);
      console.log(`📄 URLs in batch: ${batch.length}`);

      const batchContext = await browser.newContext({
        userAgent: 'seo-audit-playwright/1.0 (+node)',
        ignoreHTTPSErrors: true
      });

      let completed = 0;
      let batchPages = [];
      try {
        batchPages = await concurrencyMapLimit(batch, concurrency, async (url) => {
        let lastErr;
        const totalAttempts = retryCount + 1;
        for (let attempt = 0; attempt <= retryCount; attempt++) {
          try {
            if (attempt > 0) {
              const delayMs = computeRetryDelayMs(attempt, RETRY_DELAY_MS, lastErr);
              log(`🔁 Retry ${attempt + 1}/${totalAttempts} for ${url} in ${delayMs}ms...`);
              await sleep(delayMs);
            }

            const currentIndex = completed + 1;
            log(`[${currentIndex}/${urls.length}] 🔎 Opening: ${url}${attempt > 0 ? ` (attempt ${attempt + 1}/${totalAttempts})` : ''}`);
            log(`⏳ Waiting for DOM load...`);
            log(`🔍 Running SEO checks...`);

            const useIsolatedContext = attempt > 0 && isTransientScanError(lastErr);
            const result = await scanPage({
              browser,
              context: useIsolatedContext ? null : batchContext,
              url,
              timeoutMs,
              includePageSpeed,
              includeSeo: runSeo,
              includeGeo: runGeo,
              includeSecurityHeaders: runSecurityHeaders,
              isolated: useIsolatedContext
            });
            completed++;
            scanCompleted += 1;
            if (typeof onProgress === 'function') {
              await onProgress({
                phase: 'scan',
                processed: scanCompleted,
                total: urls.length,
                currentUrl: url,
                message: `SEO check ${scanCompleted}/${urls.length}: ${url}`
              });
            }
            log(`✅ Completed: ${url}`);
            return result;
          } catch (e) {
            lastErr = e;
            if (attempt < retryCount) {
              const kind = isTransientScanError(e) ? 'transient' : 'unexpected';
              log(`🔁 Will retry (${kind}): ${url} — ${e?.message || e}`);
            } else {
              log(`❌ Failed after ${totalAttempts} attempts: ${url}`);
            }
            log(`⚠️ Error: ${e?.message || e}`);
          }
        }

        const failureMessage = formatScanFailure(lastErr, { attempts: totalAttempts });
        return {
          url,
          title: '',
          description: '',
          keywords: '',
          h1Count: 0,
          h2Count: 0,
          h3Count: 0,
          hierarchyStatus: 'NO (page scan failed)',
          counts: { hrefHash: 0, jsVoid: 0, missingAlt: 0, missingOpenGraph: 0, missingGeo: 0 },
          issues: {
            critical: isTransientScanError(lastErr) ? [] : [failureMessage],
            geo: [],
            minor: isTransientScanError(lastErr) ? [failureMessage] : [],
            hidden: []
          },
          seoScore: 0,
          securityHeaders: runSecurityHeaders
            ? { ok: false, passed: 0, total: HEADER_CHECK_COUNT, label: '—', results: [], warnings: [] }
            : null,
          pageSpeed: includePageSpeed
            ? {
                mobile: { error: failureMessage, strategy: 'MOBILE' },
                desktop: { error: failureMessage, strategy: 'DESKTOP' }
              }
            : null,
          auditModules: {
            seo: runSeo,
            geo: runGeo,
            securityHeaders: runSecurityHeaders,
            pageSpeed: includePageSpeed === true
          },
          _debug: {
            error: lastErr?.message || String(lastErr),
            attempts: totalAttempts,
            transient: isTransientScanError(lastErr)
          }
        };
      });
      } finally {
        try {
          await batchContext.close();
        } catch {}
      }

      pages.push(...batchPages.filter(Boolean));

      console.log(`✅ Completed batch ${i + 1}/${batches.length}`);
      if (i < batches.length - 1) {
        console.log('⏳ Waiting before next batch...');
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES));
      }
    }

    // Cross-page duplicate validation (SEO module only)
    if (runSeo) {
      const titleToUrls = new Map();
      const descToUrls = new Map();

      for (const p of pages) {
        const t = (p.title || '').trim().toLowerCase();
        if (t) titleToUrls.set(t, [...(titleToUrls.get(t) || []), p.url]);

        const d = (p.description || '').trim().toLowerCase();
        if (d) descToUrls.set(d, [...(descToUrls.get(d) || []), p.url]);
      }

      const dupTitleSet = new Set();
      for (const [, us] of titleToUrls.entries()) if (us.length > 1) us.forEach((u) => dupTitleSet.add(u));

      const dupDescSet = new Set();
      for (const [, us] of descToUrls.entries()) if (us.length > 1) us.forEach((u) => dupDescSet.add(u));

      for (const p of pages) {
        if (dupTitleSet.has(p.url)) p.issues.critical.push('Duplicate title across pages (CRITICAL)');
        if (dupDescSet.has(p.url)) {
          p.issues.minor.push('Duplicate description across pages: same meta description used on multiple pages.');
        }
      }

      applyCrossPageContentDuplicates(pages);
    }

    for (const p of pages) {
      p.counts = p.counts || {};
      p.counts.missingGeo = (p.issues.geo || []).length;
      const geoScoreParts = countGeoForSeoScore(p.issues.geo);
      const criticalCount = countCriticalIssues(p.issues);
      const minorCount = (p.issues.minor?.length || 0) + geoScoreParts.minor;
      // GEO warnings do not reduce SEO score
      p.seoScore = buildSeoScore({ criticalCount, minorCount });
      delete p.contentBodyText;
    }

    applySiteCriticalIssues(pages, siteChecks.critical, baseUrl);
    // applySiteGeoIssues(pages, siteChecks.geo, baseUrl); // IndexNow — disabled

    // Google Rich Results Test — main URL only (soft-fail, does not affect SEO score)
    if (includeRichResults && pages.length) {
      const targetPage =
        pages.find((p) => normalizeBaseUrl(p.url) === baseUrl) ||
        pages.find((p) => {
          try {
            return new URL(p.url).hostname.replace(/^www\./, '') ===
              new URL(baseUrl).hostname.replace(/^www\./, '');
          } catch {
            return false;
          }
        }) ||
        pages[0];

      if (targetPage) {
        log(`🔎 Google Rich Results Test for main URL: ${targetPage.url}`);
        if (typeof onProgress === 'function') {
          try {
            await onProgress({
              phase: 'scan',
              processed: pages.length,
              total: pages.length,
              currentUrl: targetPage.url,
              message: `Google Rich Results Test: ${targetPage.url}`
            });
          } catch {}
        }
        try {
          targetPage.richResults = await captureRichResultsTest(targetPage.url, {
            browser,
            maxWaitMs: 4 * 60 * 1000,
            pollIntervalMs: 5000,
            softFail: true
          });
          if (targetPage.richResults?.ok) {
            log(
              `✅ Rich Results screenshot captured (${targetPage.richResults.status || 'ok'}) for ${targetPage.url}`
            );
          } else {
            log(
              `⚠️ Rich Results capture failed (soft): ${targetPage.richResults?.error || 'unknown'} — link still available`
            );
            if (!targetPage.richResults) {
              targetPage.richResults = {
                ok: false,
                status: 'error',
                targetUrl: targetPage.url,
                toolUrl: buildRichResultsTestUrl(targetPage.url),
                error: 'Capture returned empty result',
                capturedAt: new Date().toISOString()
              };
            }
          }
        } catch (e) {
          log(`⚠️ Rich Results capture error (soft): ${e?.message || e}`);
          targetPage.richResults = {
            ok: false,
            status: 'error',
            targetUrl: targetPage.url,
            toolUrl: buildRichResultsTestUrl(targetPage.url),
            error: e?.message || String(e),
            capturedAt: new Date().toISOString()
          };
        }
      }
    }

    log('🎉 All pages processed. Generating reports...');

    const htmlReport = generateHtmlReport({ mainUrl: baseUrl, scanDate, pages, siteChecks });

    // IndexNow URL submission — disabled for now
    // let indexNowSubmission;
    // if (indexNowStatus.ok) {
    //   log('📡 Submitting scanned URLs to IndexNow...');
    //   indexNowSubmission = await submitScannedUrlsToIndexNow(pages, baseUrl, indexNowKey);
    // } else {
    //   log('ℹ️ IndexNow submission skipped: key file verification did not pass');
    //   indexNowSubmission = { ok: false, skipped: true, reason: 'key verification failed', batches: [] };
    // }
    // siteChecks.indexNowSubmission = indexNowSubmission;

    return {

      meta: {
        tool: 'Playwright SEO Audit (headless)',
        mainUrl: baseUrl,
        startedAt: scanDate,
        discoveryMethod,
        sitemapUsed: null,
        urlsAttempted: urls.length,
        concurrency,
        timeoutMs,
        crawlMaxUrls: mode === 'full' ? (maxCrawlUrls || CRAWL_MAX_URLS) : null,
        auditModules: {
          seo: runSeo,
          geo: runGeo,
          securityHeaders: runSecurityHeaders,
          pageSpeed: includePageSpeed === true,
          richResults: includeRichResults === true
        }
      },
      pages,
      siteChecks,

      summary: {
        totalPages: pages.length,
        totalSiteCritical: siteChecks.critical.length,
        totalCritical: pages.reduce((a, p) => a + countCriticalIssues(p.issues), 0),
        totalGeo: pages.reduce((a, p) => a + (p.issues.geo?.length || 0), 0),
        totalMinor: pages.reduce((a, p) => a + (p.issues.minor?.length || 0), 0),
        totalHidden: pages.reduce((a, p) => a + (p.issues.hidden?.length || 0), 0),
        averageScore: averageSeoScore(pages)
      },
      htmlReport
    };
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}


module.exports = {
  runSeoAudit,
  generateHtmlReport,
  assertHttpSecurityHeaders,
  checkHttpSecurityHeaders,
  // checkIndexNow,
  // submitToIndexNow,
  // submitScannedUrlsToIndexNow,
  fetchResponseHeaders,
  HEADER_CHECK_COUNT,
  analyzeRobotsMetaConflicts
};


