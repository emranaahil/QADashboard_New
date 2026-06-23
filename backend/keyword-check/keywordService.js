/**
 * Keyword Service
 * Handles exact keyword matching in page content
 */

/**
 * Search for exact keyword matches in page content
 * @param {string} content - The page content to search in
 * @param {string[]} keywords - Array of keywords to search for
 * @returns {Object} - Object with found keywords as keys
 */
function searchKeywords(content, keywords) {
    if (!content || !keywords || !Array.isArray(keywords)) {
        return {};
    }

    const found = {};
    const lowerContent = content.toLowerCase();

    for (const keyword of keywords) {
        if (!keyword || typeof keyword !== 'string') continue;
        
        const lowerKeyword = keyword.toLowerCase();
        
        // Use regex for exact word boundary matching
        // This ensures we match whole words only, not partial matches
        const escapedKeyword = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
        
        if (regex.test(lowerContent)) {
            found[keyword] = true;
        }
    }

    return found;
}

/**
 * Search for keywords and return matches with positions
 * @param {string} content - The page content to search in
 * @param {string[]} keywords - Array of keywords to search for
 * @returns {Array} - Array of match objects with keyword and position
 */
function searchKeywordsWithPositions(content, keywords) {
    if (!content || !keywords || !Array.isArray(keywords)) {
        return [];
    }

    const matches = [];
    const lowerContent = content.toLowerCase();

    for (const keyword of keywords) {
        if (!keyword || typeof keyword !== 'string') continue;
        
        const lowerKeyword = keyword.toLowerCase();
        const escapedKeyword = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
        
        let match;
        while ((match = regex.exec(lowerContent)) !== null) {
            matches.push({
                keyword: keyword,
                position: match.index,
                context: getContextAround(content, match.index, keyword.length)
            });
        }
    }

    return matches;
}

/**
 * Get context around a match position
 * @param {string} content - The full content
 * @param {number} position - Match position
 * @param {number} length - Length of matched keyword
 * @param {number} contextSize - Characters to include before/after
 * @returns {string} - Context string
 */
function getContextAround(content, position, length, contextSize = 50) {
    const start = Math.max(0, position - contextSize);
    const end = Math.min(content.length, position + length + contextSize);
    
    let context = content.substring(start, end);
    
    if (start > 0) context = '...' + context;
    if (end < content.length) context = context + '...';
    
    return context.replace(/\s+/g, ' ').trim();
}

/**
 * Count exact keyword occurrences
 * @param {string} content - The page content
 * @param {string} keyword - Keyword to count
 * @returns {number} - Number of occurrences
 */
function countKeywordOccurrences(content, keyword) {
    if (!content || !keyword) return 0;
    
    const lowerContent = content.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    const escapedKeyword = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
    
    const matches = lowerContent.match(regex);
    return matches ? matches.length : 0;
}

module.exports = {
    searchKeywords,
    searchKeywordsWithPositions,
    countKeywordOccurrences,
    getContextAround
};