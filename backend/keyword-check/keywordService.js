/**
 * Keyword Service
 * Handles exact keyword matching in page content (case-insensitive and case-sensitive).
 */

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildWordBoundaryRegex(keyword, caseSensitive) {
  const escaped = escapeRegex(keyword);
  return new RegExp(`\\b${escaped}\\b`, caseSensitive ? 'g' : 'gi');
}

/**
 * Search for exact keyword matches in page content.
 * @param {string} content - The page content to search in
 * @param {string[]} keywords - Array of keywords to search for
 * @param {{ caseSensitive?: boolean }} options
 * @returns {Object} - Object with found keywords as keys
 */
function searchKeywords(content, keywords, options = {}) {
  if (!content || !keywords || !Array.isArray(keywords)) {
    return {};
  }

  const caseSensitive = Boolean(options.caseSensitive);
  const found = {};

  for (const keyword of keywords) {
    if (!keyword || typeof keyword !== 'string') continue;

    const haystack = caseSensitive ? content : content.toLowerCase();
    const probe = caseSensitive ? keyword : keyword.toLowerCase();
    const testRegex = buildWordBoundaryRegex(probe, caseSensitive);

    if (testRegex.test(haystack)) {
      found[keyword] = true;
    }
  }

  return found;
}

/**
 * Search keywords from both lists and return combined found map.
 */
function searchAllKeywords(content, keywords = [], caseSensitiveKeywords = []) {
  const insensitive = searchKeywords(content, keywords, { caseSensitive: false });
  const sensitive = searchKeywords(content, caseSensitiveKeywords, { caseSensitive: true });
  return { ...insensitive, ...sensitive };
}

/**
 * Search for keywords and return matches with positions
 */
function searchKeywordsWithPositions(content, keywords, options = {}) {
  if (!content || !keywords || !Array.isArray(keywords)) {
    return [];
  }

  const caseSensitive = Boolean(options.caseSensitive);
  const matches = [];
  const haystack = caseSensitive ? content : content.toLowerCase();

  for (const keyword of keywords) {
    if (!keyword || typeof keyword !== 'string') continue;

    const probe = caseSensitive ? keyword : keyword.toLowerCase();
    const regex = buildWordBoundaryRegex(probe, caseSensitive);

    let match;
    while ((match = regex.exec(haystack)) !== null) {
      matches.push({
        keyword,
        position: match.index,
        context: getContextAround(content, match.index, keyword.length)
      });
    }
  }

  return matches;
}

function getContextAround(content, position, length, contextSize = 50) {
  const start = Math.max(0, position - contextSize);
  const end = Math.min(content.length, position + length + contextSize);

  let context = content.substring(start, end);

  if (start > 0) context = '...' + context;
  if (end < content.length) context = context + '...';

  return context.replace(/\s+/g, ' ').trim();
}

function countKeywordOccurrences(content, keyword, options = {}) {
  if (!content || !keyword) return 0;

  const caseSensitive = Boolean(options.caseSensitive);
  const haystack = caseSensitive ? content : content.toLowerCase();
  const probe = caseSensitive ? keyword : keyword.toLowerCase();
  const regex = buildWordBoundaryRegex(probe, caseSensitive);

  const matches = haystack.match(regex);
  return matches ? matches.length : 0;
}

module.exports = {
  searchKeywords,
  searchAllKeywords,
  searchKeywordsWithPositions,
  countKeywordOccurrences,
  getContextAround
};