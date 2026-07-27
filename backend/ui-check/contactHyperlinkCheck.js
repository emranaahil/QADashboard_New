/**
 * Contact hyperlink check (UI Testing only).
 *
 * Text-first: find visible emails / N-digit phones on the page, then check
 * whether that text sits in a mailto: / tel: hyperlink.
 * Does NOT inventory all anchors first.
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

function applyContactHyperlinkEnvFromJob(job) {
  const opts = job?.options || {};
  const enabled = opts.includeContactHyperlinks === true;
  process.env.QA_CHECK_CONTACT_HYPERLINKS = enabled ? '1' : '0';
  if (enabled) {
    const len = parseInt(opts.phoneDigitLength, 10);
    if (Number.isFinite(len) && len >= 7 && len <= 15) {
      process.env.QA_PHONE_DIGIT_LENGTH = String(len);
    } else {
      process.env.QA_PHONE_DIGIT_LENGTH = '10';
    }
  } else {
    delete process.env.QA_PHONE_DIGIT_LENGTH;
  }
}

/**
 * Run text-first contact scan on the current Playwright page.
 * @returns {Promise<{ unlinkedEmails: string[], unlinkedPhones: string[] }>}
 */
async function runContactHyperlinkCheck(page) {
  if (!isContactHyperlinkEnabled()) {
    return { unlinkedEmails: [], unlinkedPhones: [] };
  }

  const phoneLen = getPhoneDigitLength();
  if (!phoneLen) {
    return { unlinkedEmails: [], unlinkedPhones: [] };
  }

  try {
    return await page.evaluate(
      ({ phoneLen: n, placeholders }) => {
        const PLACEHOLDERS = new Set(placeholders || []);
        const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        // Loose chunks of digit/punctuation; we filter by exact digit length
        const PHONE_CHUNK_RE = /\+?\d[\d\s().\-/]{5,}\d/g;

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

        function digitsOnly(s) {
          return String(s || '').replace(/\D/g, '');
        }

        /** Text-first: is this text node inside a mailto/tel for the same value? */
        function emailIsHyperlinked(textNode, email) {
          let n = textNode.parentElement;
          while (n && n !== document.documentElement) {
            if (n.tagName === 'A') {
              const href = (n.getAttribute('href') || '').trim();
              if (/^mailto:/i.test(href)) {
                const addr = href
                  .replace(/^mailto:/i, '')
                  .split('?')[0]
                  .trim()
                  .toLowerCase();
                if (addr === email.toLowerCase()) return true;
              }
            }
            n = n.parentElement;
          }
          return false;
        }

        function phoneIsHyperlinked(textNode, digitStr) {
          let n = textNode.parentElement;
          while (n && n !== document.documentElement) {
            if (n.tagName === 'A') {
              const href = (n.getAttribute('href') || '').trim();
              if (/^tel:/i.test(href)) {
                const telDigits = digitsOnly(href.replace(/^tel:/i, '').split('?')[0]);
                // Exact digit match only (formats may differ; we normalize both sides)
                if (telDigits === digitStr) return true;
              }
            }
            n = n.parentElement;
          }
          return false;
        }

        const unlinkedEmails = new Set();
        const unlinkedPhones = new Set();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);

        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent || skipRoot(parent) || !isVisible(parent)) continue;

          const text = node.textContent || '';
          if (!text.trim()) continue;

          // Emails
          EMAIL_RE.lastIndex = 0;
          let em;
          while ((em = EMAIL_RE.exec(text)) !== null) {
            const email = em[0].toLowerCase();
            if (PLACEHOLDERS.has(email)) continue;
            if (!emailIsHyperlinked(node, email)) {
              unlinkedEmails.add(email);
            }
          }

          // Phones — text first, length = N digits only
          PHONE_CHUNK_RE.lastIndex = 0;
          let pm;
          while ((pm = PHONE_CHUNK_RE.exec(text)) !== null) {
            const raw = pm[0];
            const dig = digitsOnly(raw);
            if (dig.length !== n) continue;
            // Skip obvious non-phone all-same digits
            if (/^(\d)\1+$/.test(dig)) continue;
            if (!phoneIsHyperlinked(node, dig)) {
              unlinkedPhones.add(dig);
            }
          }
        }

        return {
          unlinkedEmails: Array.from(unlinkedEmails).sort(),
          unlinkedPhones: Array.from(unlinkedPhones).sort()
        };
      },
      { phoneLen, placeholders: [...PLACEHOLDER_EMAILS] }
    );
  } catch (err) {
    console.warn('[contact-hyperlink] scan failed:', err.message);
    return { unlinkedEmails: [], unlinkedPhones: [] };
  }
}

/**
 * Convert scan result into standard UI-check issue objects.
 */
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

/**
 * Aggregate contact issues across all page report entries.
 * One contact → list of page URLs (deduped).
 */
function aggregateContactHyperlinkIssues(entries) {
  const emails = new Map(); // value -> Set(url)
  const phones = new Map();

  for (const e of entries || []) {
    const url = e.url || e.page || '';
    if (!url) continue;
    for (const issue of e.issues || []) {
      if (!isContactHyperlinkIssue(issue)) continue;
      const kind = issue.contactKind || (String(issue.type || '').toLowerCase().includes('email') ? 'email' : 'phone');
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

/**
 * HTML block for QA report (aggregated).
 */
function renderContactHyperlinkSectionHtml(aggregate, escapeHtml) {
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

  return `
    <h2>Contact hyperlinks (not linked)</h2>
    <p style="color:var(--muted);font-size:13px;margin:0 0 12px">
      Text contacts found on pages that are <strong>not</strong> wrapped in
      <code>mailto:</code> / <code>tel:</code> links. Each contact is listed once with every page URL where it was unlinked.
    </p>
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
  runContactHyperlinkCheck,
  contactFindingsToIssues,
  isContactHyperlinkIssue,
  aggregateContactHyperlinkIssues,
  renderContactHyperlinkSectionHtml,
  PLACEHOLDER_EMAILS
};
