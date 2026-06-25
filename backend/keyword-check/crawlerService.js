/**
 * Crawler Service
 * Handles website crawling with Playwright
 */

const { chromium } = require('playwright');
const keywordService = require('./keywordService');
const queueService = require('./queueService');
const stateService = require('./stateService');

const BATCH_SIZE = 50;
const MAX_CONCURRENT = 1;  // IMPORTANT for 450MB RAM devices: Use 1. 2+ can easily exceed available memory.
const MAX_URLS = 3000;     // Hard safety limit for low-memory environments
const PAGE_TIMEOUT = 30000;
const NAVIGATION_TIMEOUT = 60000;

// Single browser instance for memory efficiency
let browser = null;
let browserLaunchPromise = null;
const cancelledScans = new Set();

/**
 * Launch browser (singleton pattern) with crash recovery
 */
async function getBrowser() {
    // Check if existing browser is still connected
    if (browser && browser.isConnected()) {
        return browser;
    }
    
    // If a launch is in progress, wait for it
    if (browserLaunchPromise) {
        try {
            return await browserLaunchPromise;
        } catch (e) {
            // If the previous launch failed, reset and try again
            browserLaunchPromise = null;
        }
    }
    
    // Launch new browser instance
    browserLaunchPromise = launchBrowser();
    return browserLaunchPromise;
}

/**
 * Internal browser launch with proper cleanup
 */
async function launchBrowser() {
    try {
        console.log('Launching new browser instance...');
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-web-security'
            ]
        });
        
        browser.on('disconnected', () => {
            console.log('Browser disconnected');
            browser = null;
            browserLaunchPromise = null;
        });
        
        browser.on('crashed', () => {
            console.error('Browser crashed!');
            browser = null;
            browserLaunchPromise = null;
        });
        
        return browser;
    } catch (error) {
        browserLaunchPromise = null;
        throw error;
    }
}

/**
 * Extract internal links from page content
 */
function extractInternalLinks(html, baseUrl) {
    const links = [];
    
    try {
        const baseUrlObj = new URL(baseUrl);
        const domain = baseUrlObj.hostname;
        
        // Match href attributes
        const hrefRegex = /href=["']([^"']+)["']/gi;
        let match;
        
        while ((match = hrefRegex.exec(html)) !== null) {
            let href = match[1];
            
            // Skip anchors, javascript, mailto, tel
            if (href.startsWith('#') || 
                href.startsWith('javascript:') || 
                href.startsWith('mailto:') ||
                href.startsWith('tel:')) {
                continue;
            }
            
            // Handle relative URLs
            if (href.startsWith('/')) {
                href = baseUrlObj.origin + href;
            } else if (!href.startsWith('http')) {
                // Skip relative paths that aren't absolute
                continue;
            }
            
            try {
                const linkUrl = new URL(href);
                
                // Only include same domain links
                if (linkUrl.hostname === domain) {
                    // Normalize URL (remove trailing slash except for root)
                    let normalizedUrl = linkUrl.href;
                    if (normalizedUrl.endsWith('/') && normalizedUrl.length > linkUrl.origin.length + 1) {
                        normalizedUrl = normalizedUrl.slice(0, -1);
                    }
                    links.push(normalizedUrl);
                }
            } catch (e) {
                // Invalid URL, skip
            }
        }
    } catch (error) {
        console.error('Error extracting links:', error);
    }
    
    return [...new Set(links)]; // Deduplicate
}

/**
 * Extract internal links from an array of hrefs (memory-efficient version)
 */
function extractInternalLinksFromHrefs(rawHrefs, baseUrl) {
    const links = [];
    
    try {
        const baseUrlObj = new URL(baseUrl);
        const domain = baseUrlObj.hostname;
        
        for (let href of rawHrefs) {
            if (!href) continue;
            
            // Skip anchors, javascript, mailto, tel
            if (href.startsWith('#') || 
                href.startsWith('javascript:') || 
                href.startsWith('mailto:') ||
                href.startsWith('tel:')) {
                continue;
            }
            
            // Handle relative URLs
            if (href.startsWith('/')) {
                href = baseUrlObj.origin + href;
            } else if (!href.startsWith('http')) {
                // Skip relative paths that aren't absolute
                continue;
            }
            
            try {
                const linkUrl = new URL(href);
                
                // Only include same domain links
                if (linkUrl.hostname === domain) {
                    // Normalize URL (remove trailing slash except for root)
                    let normalizedUrl = linkUrl.href;
                    if (normalizedUrl.endsWith('/') && normalizedUrl.length > linkUrl.origin.length + 1) {
                        normalizedUrl = normalizedUrl.slice(0, -1);
                    }
                    links.push(normalizedUrl);
                }
            } catch (e) {
                // Invalid URL, skip
            }
        }
    } catch (error) {
        console.error('Error extracting links from hrefs:', error);
    }
    
    return [...new Set(links)]; // Deduplicate
}

/**
 * Process a single page with page state protection
 */
async function processPage(page, url, keywords) {
    const result = {
        url,
        links: [],
        matches: [],
        statusCode: 0,
        isError: false,
        errorType: null,
        error: null
    };
    
    try {
        // Check if page is still valid before navigation
        if (page.isClosed()) {
            result.error = 'Page was closed before navigation';
            result.isError = true;
            result.errorType = 'navigation-failed';
            return result;
        }
        
        // Navigate to page with timeout and capture response
        const response = await page.goto(url, {
            waitUntil: 'networkidle',
            timeout: NAVIGATION_TIMEOUT
        });
        
        const statusCode = response ? response.status() : 0;
        result.statusCode = statusCode;
        
        // Check page state after navigation
        if (page.isClosed()) {
            result.error = 'Page closed during navigation';
            result.isError = true;
            result.errorType = 'navigation-failed';
            return result;
        }
        
        // Wait a bit for any dynamic content
        await page.waitForTimeout(1000);
        
        // Final check before content extraction
        if (page.isClosed()) {
            result.error = 'Page closed before content extraction';
            result.isError = true;
            result.errorType = 'navigation-failed';
            return result;
        }
        
        // Use evaluate() to extract only needed data (much lighter on memory)
        const pageData = await page.evaluate(() => {
            const text = document.body ? (document.body.innerText || '') : '';
            const hrefs = Array.from(document.querySelectorAll('a[href]'))
                .map(a => a.getAttribute('href') || '');
            const title = document.title || '';
            return { text, hrefs, title };
        });
        
        // Determine if this is an error page
        let isErrorPage = false;
        let errorType = null;
        
        // 1. HTTP status code based detection
        if (statusCode >= 400) {
            isErrorPage = true;
            errorType = statusCode.toString();
        } 
        // 2. Navigation failure
        else if (statusCode === 0) {
            isErrorPage = true;
            errorType = 'navigation-failed';
        } 
        // 3. Content-based error detection (user wants to focus on this, not just HTTP status)
        else {
            const lowerText = pageData.text.toLowerCase();
            const lowerTitle = (pageData.title || '').toLowerCase();
            
            const errorIndicators = [
                'page not found',
                '404',
                'not found',
                'error 404',
                'sorry, this page',
                'this page doesn\'t exist',
                'page cannot be found',
                'page you were looking for',
                'oops! something went wrong',
                'internal server error',
                '500 error',
                'page is unavailable',
                'the page you requested',
                'content not available',
                'this content has been removed',
                'page has been deleted',
                'under construction',
                'coming soon',
                'temporarily unavailable',
                'access denied',
                'you do not have permission',
                'login required'
            ];
            
            const hasErrorIndicator = errorIndicators.some(phrase => 
                lowerText.includes(phrase) || lowerTitle.includes(phrase)
            );
            
            if (hasErrorIndicator) {
                isErrorPage = true;
                errorType = 'content-error';
            }
        }
        
        result.isError = isErrorPage;
        result.errorType = errorType;
        
        // Extract internal links from href array
        result.links = extractInternalLinksFromHrefs(pageData.hrefs, url);
        
        // Search for keywords on extracted text
        const foundKeywords = keywordService.searchKeywords(pageData.text, keywords);
        
        // Record matches
        for (const keyword of Object.keys(foundKeywords)) {
            result.matches.push({
                url: url,
                keyword: keyword
            });
        }
        
    } catch (error) {
        result.isError = true;
        result.errorType = 'processing-error';
        
        if (error.message.includes('Target page, context or browser has been closed') ||
            error.message.includes('Protocol error') ||
            page.isClosed()) {
            result.error = 'Browser/page closed unexpectedly';
            console.warn(`Browser issue on ${url}: ${error.message}`);
        } else {
            result.error = error.message;
            console.error(`Error processing ${url}:`, error.message);
        }
    }
    
    return result;
}

/**
 * Process a batch of URLs with concurrency control
 */
async function processBatch(urls, keywords) {
    const browser = await getBrowser();
    const results = [];
    
    // Process in chunks of MAX_CONCURRENT
    for (let i = 0; i < urls.length; i += MAX_CONCURRENT) {
        const chunk = urls.slice(i, i + MAX_CONCURRENT);
        
        const chunkPromises = chunk.map(async (url) => {
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                viewport: { width: 1366, height: 768 },  // smaller viewport = less memory
                javaScriptEnabled: true,
                bypassCSP: true,
                ignoreHTTPSErrors: true
            });
            
            const page = await context.newPage();
            
            try {
                const result = await processPage(page, url, keywords);
                return result;
            } finally {
                await context.close();
            }
        });
        
        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
    }
    
    return results;
}

/**
 * Start crawl process
 */
async function startCrawl(scanId, startUrl, keywords) {
    console.log(`Starting crawl for ${scanId}: ${startUrl}`);
    
    try {
        // Update status to running
        await stateService.updateScanStatus(scanId, 'running');
        
        // Initialize queue
        queueService.initialize(startUrl);
        
        // Get scan data
        let scanData = await stateService.getScanState(scanId);
        
        // Check for checkpoint to resume
        const checkpoint = await stateService.loadCheckpoint(scanId);
        if (checkpoint && checkpoint.queueState) {
            console.log(`Resuming from checkpoint for ${scanId}`);
            queueService.deserialize(checkpoint.queueState);
        }
        
        let batchNumber = 0;
        let allMatches = checkpoint?.matches || [];
        let totalProcessed = checkpoint?.completed || 0;

        // Track all checked URLs with richer data (for error detection + keyword matching)
        // Structure: { matchedKeywords: [], statusCode, isError, errorType }
        const urlResultsMap = new Map();
        if (checkpoint && checkpoint.results) {
            checkpoint.results.forEach(r => {
                urlResultsMap.set(r.url, {
                    matchedKeywords: [...(r.matchedKeywords || [])],
                    statusCode: r.statusCode || 0,
                    isError: r.isError || false,
                    errorType: r.errorType || null
                });
            });
        }
        
        async function isCancelled() {
            if (cancelledScans.has(scanId)) return true;
            const live = await stateService.getScanState(scanId);
            return live?.status === 'cancelled';
        }

        // Process until queue is empty
        while (!queueService.isEmpty()) {
            if (await isCancelled()) {
                console.log(`Scan ${scanId} cancelled by user`);
                break;
            }
            batchNumber++;
            
            // Get next batch
            const batch = queueService.getNextBatch();
            if (batch.length === 0) break;

            // Hard limit to protect low-memory devices
            if (totalProcessed >= MAX_URLS) {
                console.log(`Reached MAX_URLS limit (${MAX_URLS}). Stopping crawl.`);
                break;
            }
            const remaining = MAX_URLS - totalProcessed;
            const limitedBatch = batch.slice(0, remaining);
            
            console.log(`Batch ${batchNumber}: Processing ${limitedBatch.length} URLs`);
            
            // Update stats + announce the URLs in this batch (for live display)
            await stateService.updateScanStatus(scanId, 'running', {
                stats: {
                    urlsDiscovered: queueService.getTotalDiscovered(),
                    urlsProcessed: totalProcessed,
                    matchesFound: allMatches.length,
                    currentBatch: batchNumber
                },
                recentUrls: limitedBatch   // show these URLs below "Current Batch" while processing
            });
            
            // Process batch
            const results = await processBatch(limitedBatch, keywords);
            
            // Process results
            const newLinks = [];
            const batchProcessedUrls = [];
            for (const result of results) {
                batchProcessedUrls.push(result.url);
                
                // Always record every processed URL (success or error)
                if (!urlResultsMap.has(result.url)) {
                    urlResultsMap.set(result.url, {
                        matchedKeywords: [],
                        statusCode: result.statusCode || 0,
                        isError: result.isError || false,
                        errorType: result.errorType || null
                    });
                } else {
                    // Update error info if we have better data now
                    const existing = urlResultsMap.get(result.url);
                    if (result.statusCode) existing.statusCode = result.statusCode;
                    if (result.isError !== undefined) existing.isError = result.isError;
                    if (result.errorType) existing.errorType = result.errorType;
                }
                
                const urlData = urlResultsMap.get(result.url);
                
                if (result.error) {
                    console.log(`Error on ${result.url}: ${result.error}`);
                } else {
                    // Add found matches
                    if (result.matches && result.matches.length > 0) {
                        allMatches.push(...result.matches);
                        
                        result.matches.forEach(m => {
                            if (!urlData.matchedKeywords.includes(m.keyword)) {
                                urlData.matchedKeywords.push(m.keyword);
                            }
                        });
                    }
                    
                    // Add new links to queue
                    const added = queueService.addUrls(result.links);
                    newLinks.push(added);
                }
            }
            
            // Mark as visited
            queueService.markVisited(limitedBatch);
            totalProcessed += limitedBatch.length;
            
            // Save checkpoint
            const currentResults = Array.from(urlResultsMap.entries()).map(([url, data]) => ({
                url,
                matchedKeywords: data.matchedKeywords,
                statusCode: data.statusCode,
                isError: data.isError,
                errorType: data.errorType
            }));
            await stateService.saveCheckpoint(scanId, {
                completed: totalProcessed,
                remaining: queueService.getQueueSize(),
                currentBatch: batchNumber,
                matches: allMatches,
                results: currentResults,
                queueState: queueService.serialize()
            });
            
            // Update final stats for this batch
            await stateService.updateScanStatus(scanId, 'running', {
                stats: {
                    urlsDiscovered: queueService.getTotalDiscovered(),
                    urlsProcessed: totalProcessed,
                    matchesFound: allMatches.length,
                    currentBatch: batchNumber,
                    totalBatches: batchNumber
                },
                recentUrls: batchProcessedUrls
            });
            
            console.log(`Batch ${batchNumber} complete. Total: ${totalProcessed}, Matches: ${allMatches.length}`);
        }
        
        // Update final state
        const finalResults = Array.from(urlResultsMap.entries()).map(([url, data]) => ({
            url,
            matchedKeywords: data.matchedKeywords,
            statusCode: data.statusCode,
            isError: data.isError,
            errorType: data.errorType
        }));
        
        if (await isCancelled()) {
            await stateService.updateScanStatus(scanId, 'cancelled', {
                stats: {
                    urlsDiscovered: queueService.getTotalDiscovered(),
                    urlsProcessed: totalProcessed,
                    matchesFound: allMatches.length,
                    currentBatch: batchNumber,
                    totalBatches: batchNumber
                },
                matches: allMatches,
                results: finalResults,
                error: 'Cancelled by user'
            });
            await stateService.deleteCheckpoint(scanId);
            cancelledScans.delete(scanId);
            console.log(`Crawl cancelled for ${scanId}. Processed ${totalProcessed} URLs before stop.`);
            return;
        }

        await stateService.updateScanStatus(scanId, 'completed', {
            stats: {
                urlsDiscovered: queueService.getTotalDiscovered(),
                urlsProcessed: totalProcessed,
                matchesFound: allMatches.length,
                currentBatch: batchNumber,
                totalBatches: batchNumber
            },
            matches: allMatches,
            results: finalResults
        });
        
        // Clean up checkpoint
        await stateService.deleteCheckpoint(scanId);
        cancelledScans.delete(scanId);
        
        console.log(`Crawl complete for ${scanId}. Processed ${totalProcessed} URLs, found ${allMatches.length} matches.`);
        
    } catch (error) {
        console.error(`Crawl failed for ${scanId}:`, error);
        await stateService.updateScanStatus(scanId, 'failed', {
            error: error.message
        });
        throw error;
    }
}

/**
 * Close browser instance
 */
async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
        browserLaunchPromise = null;
    }
}

async function cancelCrawl(scanId) {
    cancelledScans.add(scanId);
    await stateService.updateScanStatus(scanId, 'cancelled', { error: 'Cancelled by user' });
}

module.exports = {
    startCrawl,
    cancelCrawl,
    closeBrowser,
    getBrowser
};