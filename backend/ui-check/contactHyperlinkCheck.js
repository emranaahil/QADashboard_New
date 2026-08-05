/**
 * Contact hyperlink check (UI Testing only).
 *
 * Emails: text-first → require mailto: (or page mailto: for same address).
 *
 * Phones — priority (always use frontend digit length N):
 *  1) tel: hrefs on the page (URL references) — source of truth for "already linked"
 *  2) First page: discover display format from tel:, else multi-format text (length N)
 *  3) If still none: lock "fallback" and use loose multi-format for length N only
 *  4) Later pages: reuse locked format (full website); never re-discover
 *  5) Report only phones of length N that appear in text and have NO matching tel: on page
 */

const PLACEHOLDER_EMAILS = new Set([
  'example@example.com',
  'email@example.com',
  'name@example.com',
  'you@domain.com',
  'user@domain.com',
  'test@test.com',
  'info@example.com',
  'hello@example.com'
]);

function isContactHyperlinkEnabled() {
  return process.env.QA_CHECK_CONTACT_HYPERLINKS === '1' || process.env.QA_CHECK_CONTACT_HYPERLINKS === 'true';
}

function getPhoneDigitLength() {
  const n = parseInt(process.env.QA_PHONE_DIGIT_LENGTH, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(15, Math.max(7, n));
}

function clearPhoneFormatLock() {
  delete process.env.QA_PHONE_FORMAT_MASK;
  delete process.env.QA_PHONE_FORMAT_SAMPLE;
  delete process.env.QA_PHONE_FORMAT_DIGITS;
  delete process.env.QA_PHONE_FORMAT_SOURCE;
  delete process.env.QA_PHONE_FORMAT_LOCKED;
}

function getLockedPhoneFormat() {
  if (process.env.QA_PHONE_FORMAT_LOCKED !== '1') return null;
  return {
    mask: process.env.QA_PHONE_FORMAT_MASK || '',
    sample: process.env.QA_PHONE_FORMAT_SAMPLE || '',
    digitCount: parseInt(process.env.QA_PHONE_FORMAT_DIGITS, 10) || 0,
    source: process.env.QA_PHONE_FORMAT_SOURCE || 'fallback'
  };
}

function lockPhoneFormat(format) {
  process.env.QA_PHONE_FORMAT_LOCKED = '1';
  if (!format || !format.mask) {
    process.env.QA_PHONE_FORMAT_MASK = '';
    process.env.QA_PHONE_FORMAT_SAMPLE = '';
    process.env.QA_PHONE_FORMAT_DIGITS = '';
    process.env.QA_PHONE_FORMAT_SOURCE = 'fallback';
    return;
  }
  process.env.QA_PHONE_FORMAT_MASK = format.mask || '';
  process.env.QA_PHONE_FORMAT_SAMPLE = format.sample || '';
  process.env.QA_PHONE_FORMAT_DIGITS = String(format.digitCount || '');
  process.env.QA_PHONE_FORMAT_SOURCE = format.source || 'text';
}

function applyContactHyperlinkEnvFromJob(job) {
  const opts = job?.options || {};
  const enabled = opts.includeContactHyperlinks === true;
  process.env.QA_CHECK_CONTACT_HYPERLINKS = enabled ? '1' : '0';
  clearPhoneFormatLock();
  if (enabled) {
    const len = parseInt(opts.phoneDigitLength, 10);
    // Always honor frontend value when in range
    if (Number.isFinite(len) && len >= 7 && len <= 15) {
      process.env.QA_PHONE_DIGIT_LENGTH = String(len);
    } else {
      process.env.QA_PHONE_DIGIT_LENGTH = '10';
    }
  } else {
    delete process.env.QA_PHONE_DIGIT_LENGTH;
  }
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * Accept only digit strings whose length equals user N (frontend).
 * Does not drop country digits — if user wants 11, they set 11.
 */
function acceptUserLengthDigits(digitStr, nationalLen) {
  const dig = digitsOnly(digitStr);
  const n = Number(nationalLen) || 0;
  if (!n || !dig) return null;
  if (dig.length !== n) return null;
  if (/^(\d)\1+$/.test(dig)) return null;
  return dig;
}

/**
 * Link matching: same N digits, or one side is N+1 with leading trunk matching the other N.
 * (Does not change what we *search* for — only whether text matches a tel: href.)
 */
function phoneDigitsMatch(a, b, nationalLen) {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  const n = Number(nationalLen) || 0;
  if (!da || !db) return false;
  if (da === db) return true;
  if (n && da.length === n && db.length === n + 1 && db.slice(1) === da) return true;
  if (n && db.length === n && da.length === n + 1 && da.slice(1) === db) return true;
  return false;
}

function toNationalPhoneDigits(digitStr, nationalLen) {
  return acceptUserLengthDigits(digitStr, nationalLen);
}

function inferPhoneMask(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/\s+/g, ' ').replace(/\d/g, 'D');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskToRegExp(mask) {
  const m = String(mask || '');
  if (!m) return null;
  let body = '';
  for (let i = 0; i < m.length; i++) {
    const ch = m[i];
    if (ch === 'D') body += '\\d';
    else if (ch === ' ') body += '\\s+';
    else body += escapeRegExp(ch);
  }
  try {
    return new RegExp(body, 'g');
  } catch {
    return null;
  }
}

/**
 * Browser-side scanner. mode: 'discover' | 'scan'
 * phoneLen = N from frontend (required).
 */
function buildBrowserScanner() {
  return ({ phoneLen: n, placeholders, mode, lockedFormat }) => {
    const PLACEHOLDERS = new Set(placeholders || []);
    const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    // Flexible phone-like chunks (formatting ignored after digit strip)
    const PHONE_CHUNK_RE =
      /(?:\+?\d|\()(?:[\d\s().\-\u2010-\u2015\u2212\u00A0\u202F\u2009/]{4,}\d)/g;

    function isVisible(el) {
      if (!el || el.nodeType !== 1) return false;
      try {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.05) {
          return false;
        }
        const r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) return false;
      } catch (e) {
        return false;
      }
      return true;
    }

    function skipRoot(el) {
      if (!el || !el.closest) return true;
      if (el.closest('script,style,noscript,svg,template,[aria-hidden="true"]')) return true;
      return false;
    }

    function digitsOnlyLocal(s) {
      return String(s || '').replace(/\D/g, '');
    }

    /** Strict: only accept length === N (user frontend count). */
    function acceptLen(dig) {
      const d = digitsOnlyLocal(dig);
      if (!d || d.length !== n) return null;
      if (/^(\d)\1+$/.test(d)) return null;
      return d;
    }

    /** tel: may include extra trunk; still match against page phones of length N. */
    function phonesEqual(a, b) {
      const da = digitsOnlyLocal(a);
      const db = digitsOnlyLocal(b);
      if (!da || !db) return false;
      if (da === db) return true;
      if (da.length === n && db.length === n + 1 && db.slice(1) === da) return true;
      if (db.length === n && da.length === n + 1 && da.slice(1) === db) return true;
      return false;
    }

    function inferMask(raw) {
      return String(raw || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\d/g, 'D');
    }

    function emailIsHyperlinked(fromEl, email) {
      let el = fromEl && fromEl.nodeType === 3 ? fromEl.parentElement : fromEl;
      while (el && el !== document.documentElement) {
        if (el.tagName === 'A') {
          const href = (el.getAttribute('href') || '').trim();
          if (/^mailto:/i.test(href)) {
            const addr = href
              .replace(/^mailto:/i, '')
              .split('?')[0]
              .trim()
              .toLowerCase();
            if (addr === email.toLowerCase()) return true;
          }
        }
        el = el.parentElement;
      }
      // Page-level mailto: for same address
      const mails = document.querySelectorAll('a[href]');
      for (let i = 0; i < mails.length; i++) {
        const href = (mails[i].getAttribute('href') || '').trim();
        if (!/^mailto:/i.test(href)) continue;
        const addr = href
          .replace(/^mailto:/i, '')
          .split('?')[0]
          .trim()
          .toLowerCase();
        if (addr === email.toLowerCase()) return true;
      }
      return false;
    }

    function telHrefDigits(href) {
      const h = String(href || '').trim();
      if (!/^tel:/i.test(h)) return null;
      return digitsOnlyLocal(h.replace(/^tel:/i, '').split('?')[0]);
    }

    /**
     * All tel: URL references on the page (any formatting).
     * Keys: exact digit strings from href + length-N form when matchable.
     */
    function collectPageTelDigitKeys() {
      const set = new Set();
      const anchors = document.querySelectorAll('a[href]');
      for (let i = 0; i < anchors.length; i++) {
        const dig = telHrefDigits(anchors[i].getAttribute('href') || '');
        if (!dig) continue;
        set.add(dig);
        // If tel is N+1 and ends with N user digits, also index the N form
        if (dig.length === n + 1) set.add(dig.slice(1));
        if (dig.length === n) set.add(dig);
        // If tel longer, last N digits when reasonable
        if (dig.length > n && dig.length <= n + 3) set.add(dig.slice(-n));
      }
      return set;
    }

    const pageTelKeys = collectPageTelDigitKeys();

    function isPhoneLinkedByTelUrl(phoneDigits) {
      if (!phoneDigits) return false;
      if (pageTelKeys.has(phoneDigits)) return true;
      for (const t of pageTelKeys) {
        if (phonesEqual(t, phoneDigits)) return true;
      }
      return false;
    }

    function phoneIsHyperlinked(fromEl, phoneDigits) {
      // Priority 1: any matching tel: href on this page (URL reference)
      if (isPhoneLinkedByTelUrl(phoneDigits)) return true;

      let el = fromEl && fromEl.nodeType === 3 ? fromEl.parentElement : fromEl;
      if (!el) return false;

      // Ancestor <a tel:>
      let cur = el;
      while (cur && cur !== document.documentElement) {
        if (cur.tagName === 'A') {
          const dig = telHrefDigits(cur.getAttribute('href') || '');
          if (dig && phonesEqual(dig, phoneDigits)) return true;
        }
        cur = cur.parentElement;
      }

      // Descendant <a tel:>
      try {
        const nested = el.querySelectorAll ? el.querySelectorAll('a[href]') : [];
        for (let i = 0; i < nested.length; i++) {
          const dig = telHrefDigits(nested[i].getAttribute('href') || '');
          if (dig && phonesEqual(dig, phoneDigits)) return true;
        }
      } catch (e) {
        /* ignore */
      }

      return false;
    }

    function collectTextBlobs() {
      const blobs = [];
      const phoneWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let tnode;
      while ((tnode = phoneWalker.nextNode())) {
        const parent = tnode.parentElement;
        if (!parent || skipRoot(parent) || !isVisible(parent)) continue;
        const text = tnode.textContent || '';
        if (text.trim()) blobs.push({ text, el: parent });
      }
      const SEL =
        'a, p, span, li, td, th, label, button, strong, em, b, h1, h2, h3, h4, h5, h6, address, figcaption';
      const els = document.querySelectorAll(SEL);
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (skipRoot(el) || !isVisible(el)) continue;
        let text = '';
        try {
          text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        } catch (e) {
          text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        }
        if (text.length < 7 || text.length > 140) continue;
        if (!/\d{3}/.test(text)) continue;
        blobs.push({ text, el });
      }
      return blobs;
    }

    /** Multi-format extraction; only keep candidates with exactly N digits. */
    function extractUserLengthPhonesFromText(text) {
      const found = [];
      if (!text) return found;
      const s = String(text);
      const seen = new Set();

      function pushRaw(raw) {
        const dig = acceptLen(raw);
        if (!dig || seen.has(dig)) return;
        seen.add(dig);
        found.push({ raw: String(raw), digits: dig });
      }

      PHONE_CHUNK_RE.lastIndex = 0;
      let pm;
      while ((pm = PHONE_CHUNK_RE.exec(s)) !== null) {
        pushRaw(pm[0]);
      }
      // Bare digit runs of exact length N
      const bareRe = new RegExp('\\d{' + n + '}', 'g');
      let bm;
      while ((bm = bareRe.exec(s)) !== null) {
        pushRaw(bm[0]);
      }
      return found;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DISCOVER (first page only): 1) tel:  2) multi-format text  3) none
    // ═══════════════════════════════════════════════════════════════════════
    if (mode === 'discover') {
      const votes = new Map();

      function vote(mask, sample, digitCount, source, weight) {
        if (!mask || mask.indexOf('D') < 0) return;
        // Mask must encode exactly N digits
        const dCount = (mask.match(/D/g) || []).length;
        if (dCount !== n) return;
        const prev = votes.get(mask) || {
          count: 0,
          sample: sample || '',
          digitCount: n,
          source: source || 'text'
        };
        prev.count += weight || 1;
        if (!prev.sample && sample) prev.sample = sample;
        if (source === 'tel') prev.source = 'tel';
        votes.set(mask, prev);
      }

      // —— Step 1: tel: hrefs (user length N) ——
      const anchors = document.querySelectorAll('a[href]');
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        const href = (a.getAttribute('href') || '').trim();
        if (!/^tel:/i.test(href)) continue;
        if (skipRoot(a)) continue;

        const telPart = href.replace(/^tel:/i, '').split('?')[0].trim();
        const dig = digitsOnlyLocal(telPart);
        // Prefer exact N; also allow N+1 trunk only if last N match user length
        let key = acceptLen(dig);
        let sample = telPart;
        if (!key && dig.length === n + 1) {
          key = acceptLen(dig.slice(1));
        }
        if (!key) continue;

        let mask = inferMask(telPart);
        let maskDigits = (mask.match(/D/g) || []).length;
        if (maskDigits !== n) {
          // Build sample from link text / aria-label if href is pure digits or wrong length mask
          let linkText = '';
          try {
            linkText = (a.innerText || a.textContent || a.getAttribute('aria-label') || '')
              .replace(/\s+/g, ' ')
              .trim();
          } catch (e) {
            linkText = a.getAttribute('aria-label') || '';
          }
          if (linkText && acceptLen(linkText)) {
            sample = linkText;
            mask = inferMask(linkText);
            maskDigits = (mask.match(/D/g) || []).length;
          }
          if (maskDigits !== n) {
            // Synthesize plain N-digit mask from accepted key
            mask = 'D'.repeat(n);
            sample = key;
          }
        }
        vote(mask, sample, n, 'tel', 10);
      }

      // —— Step 2: if no tel:, try different visible formats (still length N only) ——
      if (votes.size === 0) {
        const blobs = collectTextBlobs();
        for (let b = 0; b < blobs.length; b++) {
          const phones = extractUserLengthPhonesFromText(blobs[b].text);
          for (let p = 0; p < phones.length; p++) {
            const mask = inferMask(phones[p].raw);
            if ((mask.match(/D/g) || []).length === n) {
              vote(mask, phones[p].raw, n, 'text', 2);
            } else {
              vote('D'.repeat(n), phones[p].digits, n, 'text', 1);
            }
          }
        }
      }

      let best = null;
      for (const [mask, info] of votes.entries()) {
        if (!best || info.count > best.count) {
          best = {
            mask,
            sample: info.sample,
            digitCount: n,
            source: info.source,
            count: info.count
          };
        }
      }

      return {
        discovered: best
          ? {
              mask: best.mask,
              sample: best.sample,
              digitCount: n,
              source: best.source || 'text'
            }
          : null,
        userPhoneLen: n,
        telCountOnPage: pageTelKeys ? pageTelKeys.size : 0
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SCAN: emails + phones of length N; never flag if tel: exists for number
    // Priority find: locked format → multi-format → bare N digits
    // ═══════════════════════════════════════════════════════════════════════
    const unlinkedEmails = new Set();
    const unlinkedPhones = new Set();

    // Emails
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || skipRoot(parent) || !isVisible(parent)) continue;
      const text = node.textContent || '';
      if (!text.trim()) continue;
      EMAIL_RE.lastIndex = 0;
      let em;
      while ((em = EMAIL_RE.exec(text)) !== null) {
        const email = em[0].toLowerCase();
        if (PLACEHOLDERS.has(email)) continue;
        if (!emailIsHyperlinked(node, email)) unlinkedEmails.add(email);
      }
    }

    // Build optional mask regex (step 2 format lock)
    let maskRe = null;
    const mask = lockedFormat && lockedFormat.mask ? lockedFormat.mask : '';
    if (mask) {
      let body = '';
      for (let i = 0; i < mask.length; i++) {
        const ch = mask[i];
        if (ch === 'D') body += '\\d';
        else if (ch === ' ') body += '\\s+';
        else body += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      try {
        maskRe = new RegExp(body, 'g');
      } catch (e) {
        maskRe = null;
      }
    }

    function considerDigits(dig, fromEl) {
      const key = acceptLen(dig);
      if (!key) return;
      // Step 1 always: if tel: URL on page for this number → linked, skip
      if (phoneIsHyperlinked(fromEl, key)) return;
      unlinkedPhones.add(key);
    }

    function extractForScan(text) {
      const out = [];
      if (!text) return out;

      // 2) Locked display format
      if (maskRe) {
        maskRe.lastIndex = 0;
        let m;
        while ((m = maskRe.exec(text)) !== null) {
          out.push(m[0]);
        }
      }

      // 3) Other logic: multi-format + bare N (always as safety net so we don't miss
      //    numbers; tel: filter prevents false "unlinked" for already-linked ones)
      const multi = extractUserLengthPhonesFromText(text);
      for (let i = 0; i < multi.length; i++) {
        out.push(multi[i].raw);
      }
      return out;
    }

    const blobs = collectTextBlobs();
    for (let b = 0; b < blobs.length; b++) {
      const chunks = extractForScan(blobs[b].text);
      for (let c = 0; c < chunks.length; c++) {
        considerDigits(chunks[c], blobs[b].el);
      }
    }

    return {
      unlinkedEmails: Array.from(unlinkedEmails).sort(),
      unlinkedPhones: Array.from(unlinkedPhones).sort(),
      formatUsed: lockedFormat || null,
      userPhoneLen: n,
      pageTelLinkedCount: pageTelKeys.size
    };
  };
}

/**
 * Discover phone display format on first page.
 * Order: tel: → multi-format text → null (caller locks fallback).
 */
async function discoverPhoneFormatOnPage(page, phoneLen) {
  const n = phoneLen || getPhoneDigitLength();
  if (!n || !page) return null;
  try {
    const result = await page.evaluate(buildBrowserScanner(), {
      phoneLen: n,
      placeholders: [...PLACEHOLDER_EMAILS],
      mode: 'discover',
      lockedFormat: null
    });
    return result?.discovered || null;
  } catch (err) {
    console.warn('[contact-hyperlink] format discover failed:', err.message);
    return null;
  }
}

/**
 * Full contact scan. Uses frontend digit length N.
 * Discovers format once per job (first page), then reuses.
 */
async function runContactHyperlinkCheck(page) {
  if (!isContactHyperlinkEnabled()) {
    return { unlinkedEmails: [], unlinkedPhones: [], phoneFormat: null };
  }

  const phoneLen = getPhoneDigitLength();
  if (!phoneLen) {
    return { unlinkedEmails: [], unlinkedPhones: [], phoneFormat: null };
  }

  try {
    let format = getLockedPhoneFormat();

    // First page only: 1) tel:  2) formats  3) fallback
    if (!format) {
      const discovered = await discoverPhoneFormatOnPage(page, phoneLen);
      if (discovered && discovered.mask) {
        lockPhoneFormat(discovered);
        format = getLockedPhoneFormat();
        console.log(
          `[contact-hyperlink] N=${phoneLen} format locked from ${discovered.source}: sample="${discovered.sample}" mask="${discovered.mask}"`
        );
      } else {
        lockPhoneFormat(null);
        format = getLockedPhoneFormat();
        console.log(
          `[contact-hyperlink] N=${phoneLen} no tel:/format on first page — fallback multi-format (length ${phoneLen} only)`
        );
      }
    }

    const lockedForScan =
      format && format.mask
        ? { mask: format.mask, sample: format.sample, source: format.source }
        : null;

    const scan = await page.evaluate(buildBrowserScanner(), {
      phoneLen,
      placeholders: [...PLACEHOLDER_EMAILS],
      mode: 'scan',
      lockedFormat: lockedForScan
    });

    return {
      unlinkedEmails: scan?.unlinkedEmails || [],
      unlinkedPhones: scan?.unlinkedPhones || [],
      phoneFormat: format
    };
  } catch (err) {
    console.warn('[contact-hyperlink] scan failed:', err.message);
    return { unlinkedEmails: [], unlinkedPhones: [], phoneFormat: getLockedPhoneFormat() };
  }
}

function contactFindingsToIssues(result) {
  const issues = [];
  const emails = result?.unlinkedEmails || [];
  const phones = result?.unlinkedPhones || [];

  for (const email of emails) {
    issues.push({
      type: 'Email not hyperlinked',
      severity: 'major',
      details: email,
      contactKind: 'email',
      contactValue: email,
      count: 1
    });
  }
  for (const phone of phones) {
    issues.push({
      type: 'Phone not hyperlinked',
      severity: 'major',
      details: phone,
      contactKind: 'phone',
      contactValue: phone,
      count: 1
    });
  }
  return issues;
}

function isContactHyperlinkIssue(issue) {
  if (!issue || typeof issue !== 'object') return false;
  if (issue.contactKind === 'email' || issue.contactKind === 'phone') return true;
  const t = String(issue.type || '').toLowerCase();
  return t === 'email not hyperlinked' || t === 'phone not hyperlinked';
}

function aggregateContactHyperlinkIssues(entries) {
  const emails = new Map();
  const phones = new Map();

  for (const e of entries || []) {
    const url = e.url || e.page || '';
    if (!url) continue;
    for (const issue of e.issues || []) {
      if (!isContactHyperlinkIssue(issue)) continue;
      const kind =
        issue.contactKind ||
        (String(issue.type || '').toLowerCase().includes('email') ? 'email' : 'phone');
      const value = issue.contactValue || issue.details || '';
      if (!value) continue;
      const map = kind === 'email' ? emails : phones;
      if (!map.has(value)) map.set(value, new Set());
      map.get(value).add(url);
    }
  }

  const toList = (map, kind) =>
    [...map.entries()]
      .map(([value, urls]) => ({
        kind,
        value,
        urls: [...urls].sort()
      }))
      .sort((a, b) => a.value.localeCompare(b.value));

  return {
    emails: toList(emails, 'email'),
    phones: toList(phones, 'phone')
  };
}

function renderContactHyperlinkSectionHtml(aggregate, escapeHtml, phoneFormat) {
  const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '');
  const emails = aggregate?.emails || [];
  const phones = aggregate?.phones || [];
  if (!emails.length && !phones.length) {
    return '';
  }

  const row = (item, label) => {
    const urls = (item.urls || [])
      .map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`)
      .join('');
    return `<tr>
      <td style="font-weight:600;vertical-align:top;white-space:nowrap">${esc(label)}</td>
      <td style="vertical-align:top"><code>${esc(item.value)}</code></td>
      <td style="vertical-align:top"><ul style="margin:0;padding-left:18px">${urls}</ul></td>
    </tr>`;
  };

  const emailRows = emails.map((e) => row(e, 'Email')).join('');
  const phoneRows = phones.map((p) => row(p, 'Phone')).join('');

  let formatNote = '';
  const fmt = phoneFormat || getLockedPhoneFormat();
  const n = getPhoneDigitLength();
  if (fmt && fmt.mask) {
    formatNote = `<p style="color:var(--muted);font-size:12px;margin:0 0 10px">
      Phone digit length from settings: <strong>${esc(String(n))}</strong>.
      Format learned on first page (<code>${esc(fmt.source || 'unknown')}</code>):
      <code>${esc(fmt.sample || fmt.mask)}</code>
      (mask <code>${esc(fmt.mask)}</code>). Reused for the rest of the crawl.
      Numbers already present in any <code>tel:</code> href are not listed.
    </p>`;
  } else if (fmt && fmt.source === 'fallback') {
    formatNote = `<p style="color:var(--muted);font-size:12px;margin:0 0 10px">
      Phone digit length from settings: <strong>${esc(String(n))}</strong>.
      No tel:/format on first page — multi-format scan for length ${esc(String(n))} only.
      Numbers already present in any <code>tel:</code> href are not listed.
    </p>`;
  }

  return `
    <h2>Contact hyperlinks (not linked)</h2>
    <p style="color:var(--muted);font-size:13px;margin:0 0 12px">
      Text contacts found on pages that are <strong>not</strong> wrapped in
      <code>mailto:</code> / <code>tel:</code> links. Each contact is listed once with every page URL where it was unlinked.
    </p>
    ${formatNote}
    <div class="card" style="overflow:auto">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Contact</th>
            <th>Not hyperlinked on these pages</th>
          </tr>
        </thead>
        <tbody>
          ${emailRows}${phoneRows}
        </tbody>
      </table>
    </div>
  `;
}

module.exports = {
  isContactHyperlinkEnabled,
  getPhoneDigitLength,
  applyContactHyperlinkEnvFromJob,
  clearPhoneFormatLock,
  getLockedPhoneFormat,
  lockPhoneFormat,
  digitsOnly,
  toNationalPhoneDigits,
  acceptUserLengthDigits,
  phoneDigitsMatch,
  inferPhoneMask,
  maskToRegExp,
  discoverPhoneFormatOnPage,
  runContactHyperlinkCheck,
  contactFindingsToIssues,
  isContactHyperlinkIssue,
  aggregateContactHyperlinkIssues,
  renderContactHyperlinkSectionHtml,
  PLACEHOLDER_EMAILS
};
