/**
 * Plain-language explanations for Link Radar (error-check) findings.
 * Used when saving reports and when rendering HTML so non-technical readers
 * can understand HTTP codes like 404 / 410.
 */

function parseHttpStatus(detectedErrors, statusCode) {
  const n = Number(statusCode);
  if (Number.isFinite(n) && n > 0) return n;
  for (const raw of detectedErrors || []) {
    const m = String(raw).match(/http\s+(\d{3})/i);
    if (m) return Number(m[1]);
  }
  return 0;
}

function looksLikeErrorTitle(title) {
  const t = String(title || '').toLowerCase();
  if (!t) return false;
  return (
    t.includes('page not found') ||
    t.includes('not found') ||
    t.includes('error 404') ||
    t.includes('404') ||
    t.includes('gone') ||
    t.includes('access denied') ||
    t.includes('forbidden') ||
    t.includes('unauthorized') ||
    t.includes('server error')
  );
}

/**
 * HTTP status → human labels (non-technical first, technical detail second).
 */
const HTTP_GUIDE = {
  400: {
    shortLabel: 'Bad request',
    summary: 'Server rejected the request (HTTP 400)',
    whatItMeans:
      'The server said the request was invalid. The page may not load correctly for some visitors or bots.',
    fixHint: 'Check the URL is correct and that the page is published without broken rewrite rules.'
  },
  401: {
    shortLabel: 'Login required',
    summary: 'Login required (HTTP 401)',
    whatItMeans:
      'The page is protected. A normal visitor without a login will not see the full content. This is not always a “broken” marketing page — it may be intentional.',
    fixHint: 'If the page should be public, remove login protection. If it should stay private, ignore this finding or remove internal links to it from public pages.'
  },
  403: {
    shortLabel: 'Access blocked',
    summary: 'Access blocked (HTTP 403)',
    whatItMeans:
      'The server blocked access to this URL (forbidden). Some bots or networks may be blocked while a normal browser works.',
    fixHint: 'Check firewall, bot protection, or IP rules. Confirm the page should be public.'
  },
  404: {
    shortLabel: 'Page not found',
    summary: 'Page not found (HTTP 404)',
    whatItMeans:
      'This page does not exist on the server. Visitors usually see a “Page not found” message. Any menu or internal link to this URL is broken.',
    fixHint: 'Restore the page, correct the link, or redirect (301) to the right live page.'
  },
  410: {
    shortLabel: 'Page marked as gone',
    summary: 'Page marked as removed (HTTP 410)',
    whatItMeans:
      'The server says this page was permanently removed (status 410). The page can still open and look normal in a browser — that is confusing. Search engines still treat it as deleted.',
    fixHint:
      'If it should be live: fix hosting/CMS so the page returns HTTP 200. If it should be gone: keep 410 or redirect, and remove links to it. Do not show a full marketing page with status 410.'
  },
  500: {
    shortLabel: 'Server error',
    summary: 'Server error (HTTP 500)',
    whatItMeans: 'The website crashed or failed while loading this page. Visitors may see an error screen.',
    fixHint: 'Check server logs, plugins, and hosting. Fix the application error and re-test.'
  },
  502: {
    shortLabel: 'Bad gateway',
    summary: 'Bad gateway (HTTP 502)',
    whatItMeans: 'A proxy or CDN could not reach the origin server for this page.',
    fixHint: 'Check hosting, CDN, and origin health; retry later if temporary.'
  },
  503: {
    shortLabel: 'Service unavailable',
    summary: 'Service unavailable (HTTP 503)',
    whatItMeans: 'The server was temporarily unavailable (maintenance or overload). Not always a permanent broken link.',
    fixHint: 'Retry later. If it keeps happening, check hosting capacity or maintenance mode.'
  },
  504: {
    shortLabel: 'Gateway timeout',
    summary: 'Gateway timeout (HTTP 504)',
    whatItMeans: 'The server took too long to respond through a proxy/CDN.',
    fixHint: 'Check origin performance and CDN timeouts.'
  }
};

const HOW_TO_CHECK_STATUS =
  'In Chrome: open the page → F12 → Network → click the first document (Doc) row → check Status. Images/CSS can show 200 even when the page status is 404 or 410.';

function contentIssueGuide(pattern) {
  const key = String(pattern || '').toLowerCase();
  if (key.includes('page not found') || key === '404' || key.includes('error 404') || key === 'not found') {
    return {
      shortLabel: 'Page not found (text)',
      summary: 'Page content says “not found”',
      whatItMeans:
        'The page HTML looks like an error/not-found message (in the title, heading, or body), even if you expected a real page.',
      fixHint: 'Confirm the page is published. Fix links or restore content.'
    };
  }
  if (key.includes('temporarily unavailable') || key.includes('page is unavailable')) {
    return {
      shortLabel: 'Temporarily unavailable',
      summary: 'Page says it is temporarily unavailable',
      whatItMeans: 'The page content indicates downtime or unavailability.',
      fixHint: 'Check if the page is under maintenance or misconfigured.'
    };
  }
  if (key.includes('access denied') || key.includes('login required') || key.includes('permission')) {
    return {
      shortLabel: 'Access restricted',
      summary: 'Page content indicates access is restricted',
      whatItMeans: 'The page may require login or block some visitors.',
      fixHint: 'Confirm whether the page should be public.'
    };
  }
  if (key.includes('page failed to load')) {
    return {
      shortLabel: 'Failed to load',
      summary: 'Page failed to load in the checker',
      whatItMeans: 'Our browser could not finish loading this URL (timeout, network error, or crash).',
      fixHint: 'Open the URL manually. If it works for you, re-run the scan; intermittent failures happen.'
    };
  }
  return {
    shortLabel: 'Content warning',
    summary: `Content warning: ${pattern}`,
    whatItMeans: `The checker found wording that often appears on broken or restricted pages (“${pattern}”).`,
    fixHint: 'Open the page and confirm it is the content you expect.'
  };
}

/**
 * Build a user-friendly explanation for one broken page.
 * Works for new crawls and legacy reports (statusCode + detectedErrors only).
 *
 * @param {object} page
 * @param {string} [page.url]
 * @param {number} [page.statusCode]
 * @param {string[]} [page.detectedErrors]
 * @param {string} [page.pageTitle]
 * @param {string} [page.pageH1]
 * @param {boolean} [page.hasSubstantialContent]
 * @param {string} [page.finalUrl]
 */
function explainBrokenPage(page = {}) {
  const detectedErrors = [...new Set((page.detectedErrors || []).map((e) => String(e).trim()).filter(Boolean))];
  const statusCode = parseHttpStatus(detectedErrors, page.statusCode);
  const title = page.pageTitle || '';
  const hasContent =
    page.hasSubstantialContent === true ||
    (typeof page.contentLength === 'number' && page.contentLength > 800);

  // HTTP 410 is often served with a full-looking page — always treat as the
  // confusing “looks fine but status is wrong” case unless the title is clearly an error page.
  // For older reports without title/content metadata, still default 410 to soft messaging.
  const visuallyLooksOk =
    statusCode === 410
      ? !looksLikeErrorTitle(title)
      : statusCode >= 400 &&
        statusCode !== 404 &&
        !looksLikeErrorTitle(title) &&
        (hasContent || (title && title.length > 8));

  let guide = null;
  if (statusCode >= 400 && HTTP_GUIDE[statusCode]) {
    guide = { ...HTTP_GUIDE[statusCode] };
  } else if (statusCode >= 400) {
    guide = {
      shortLabel: `HTTP ${statusCode}`,
      summary: `Problem response (HTTP ${statusCode})`,
      whatItMeans: `The server returned HTTP status ${statusCode}, which means the page did not load as a healthy public page (healthy pages return 200).`,
      fixHint: 'Ask a developer to check why this status is returned for a URL that should be live.'
    };
  } else {
    const contentPat = detectedErrors.find((e) => !/^http\s+\d{3}$/i.test(e) && e !== 'rate limited (skipped)');
    guide = contentIssueGuide(contentPat || detectedErrors[0] || 'unknown issue');
  }

  // Soft / confusing case: 410 (or similar) with a full-looking page
  if (visuallyLooksOk && statusCode === 410) {
    guide = {
      ...guide,
      shortLabel: 'Looks fine, but status is 410',
      summary: 'Looks OK in browser, but server says “Gone” (HTTP 410)',
      whatItMeans:
        'You can open the page and it may look normal, but the server status is 410 (Gone). Link Radar and Google treat that as removed. Images and CSS can still load as 200 — only the main page status is wrong.',
      fixHint:
        'Usually a hosting/WordPress/CDN setting. Live pages must return HTTP 200. Ask the team to fix the status, or redirect if the page moved.'
    };
  } else if (visuallyLooksOk && statusCode >= 400 && statusCode !== 404) {
    guide = {
      ...guide,
      shortLabel: `Looks fine, but HTTP ${statusCode}`,
      summary: `Looks OK in browser, but server status is ${statusCode}`,
      whatItMeans: `${guide.whatItMeans} Content may still show, so it can look fine while the status is still a problem.`,
      fixHint: guide.fixHint
    };
  }

  const technicalBits = [];
  if (statusCode) technicalBits.push(`HTTP ${statusCode}`);
  for (const e of detectedErrors) {
    if (!/^http\s+\d{3}$/i.test(e)) technicalBits.push(e);
  }

  const category =
    statusCode === 404 || detectedErrors.some((e) => /page not found|error 404/i.test(e))
      ? 'missing'
      : statusCode === 410
        ? 'gone_status'
        : statusCode >= 500
          ? 'server'
          : statusCode === 401 || statusCode === 403
            ? 'access'
            : statusCode >= 400
              ? 'http_error'
              : 'content';

  const severity =
    category === 'missing' || category === 'server' || statusCode === 410
      ? 'high'
      : category === 'access'
        ? 'medium'
        : 'medium';

  return {
    shortLabel: guide.shortLabel,
    summary: guide.summary,
    whatItMeans: guide.whatItMeans,
    howToCheck: HOW_TO_CHECK_STATUS,
    fixHint: guide.fixHint,
    statusCode: statusCode || null,
    technicalDetail: technicalBits.join('; ') || '—',
    visuallyLooksOk: Boolean(visuallyLooksOk),
    category,
    severity,
    pageTitle: title || null,
    finalUrl: page.finalUrl || page.url || null
  };
}

function formatIssuesForDisplay(page) {
  const exp = explainBrokenPage(page);
  return exp.summary;
}

module.exports = {
  parseHttpStatus,
  explainBrokenPage,
  formatIssuesForDisplay,
  HOW_TO_CHECK_STATUS,
  HTTP_GUIDE
};
