const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const { uuidv4 } = require('../shared/uuidUtils');
const crawlerService = require('../keyword-check/crawlerService');
const { MAX_URL_LENGTH } = require('../shared/urlSecurity');
const reportService = require('../keyword-check/reportService');
const stateService = require('../keyword-check/stateService');
const errorCheckService = require('../error-check/errorCheckService');
const { normalizeErrorCheckOptions } = require('../shared/errorCheckLimits');
const scanLogService = require('../shared/scanLogService');
const { normalizeUrl } = require('../shared/urlSecurity');
const { getSessionIdFromRequest } = require('../shared/sessionUtils');

// Start a new scan
router.post('/scan/start', async (req, res) => {
    try {
        const sessionId = getSessionIdFromRequest(req);
        const active = await stateService.findActiveScan(sessionId);
        if (active) {
            return res.status(409).json({
                error: 'SCAN_ALREADY_RUNNING',
                message: 'A keyword scan is already in progress. Please wait for it to finish.',
                scanId: active.id
            });
        }

        const { isParallelExecutionEnabled } = require('../shared/executionEnv');
        if (!isParallelExecutionEnabled()) {
            const globalActive = await stateService.findAnyActiveScan();
            if (globalActive && globalActive.sessionId && globalActive.sessionId !== sessionId) {
                return res.status(409).json({
                    error: 'SERVER_BUSY',
                    message: 'The server is running another user\'s scan. Please try again shortly.'
                });
            }
        }

        const { url, keywords, caseSensitiveKeywords } = req.body;

        // Validate input
        if (!url || !url.trim()) {
            return res.status(400).json({ error: 'MISSING_URL', message: 'Website URL is required' });
        }

        const MAX_KEYWORDS = 50;
        const cleanKeywords = Array.isArray(keywords)
            ? keywords.map((k) => String(k).trim()).filter(Boolean)
            : [];
        const cleanCaseSensitiveKeywords = Array.isArray(caseSensitiveKeywords)
            ? caseSensitiveKeywords.map((k) => String(k).trim()).filter(Boolean)
            : [];

        if (!cleanKeywords.length && !cleanCaseSensitiveKeywords.length) {
            return res.status(400).json({
                error: 'MISSING_KEYWORDS',
                message: 'Enter at least one keyword (standard or case-sensitive)'
            });
        }
        if (cleanKeywords.length + cleanCaseSensitiveKeywords.length > MAX_KEYWORDS) {
            return res.status(400).json({
                error: 'TOO_MANY_KEYWORDS',
                message: `Maximum ${MAX_KEYWORDS} keywords total (standard + case-sensitive)`
            });
        }
        if (String(url).trim().length > MAX_URL_LENGTH) {
            return res.status(400).json({ error: `URL must be ${MAX_URL_LENGTH} characters or less` });
        }

        let cleanUrl;
        try {
            cleanUrl = normalizeUrl(url);
        } catch (e) {
            return res.status(400).json({ error: 'INVALID_URL', message: e.message });
        }

        const allKeywords = [...cleanKeywords, ...cleanCaseSensitiveKeywords];
        for (const kw of allKeywords) {
            if (kw.length > 200) {
                return res.status(400).json({
                    error: 'KEYWORD_TOO_LONG',
                    message: 'Each keyword must be 200 characters or less'
                });
            }
        }

        // Create scan session
        const scanId = uuidv4();
        const scanData = {
            id: scanId,
            sessionId: sessionId || null,
            url: cleanUrl,
            keywords: cleanKeywords,
            caseSensitiveKeywords: cleanCaseSensitiveKeywords,
            status: 'starting',
            currentUrl: cleanUrl,
            logs: [{
                at: new Date().toISOString(),
                level: 'info',
                message: `[QUEUED] Scan created for ${cleanUrl}`
            }],
            startedAt: new Date().toISOString(),
            completedAt: null,
            stats: {
                urlsDiscovered: 0,
                urlsProcessed: 0,
                matchesFound: 0,
                currentBatch: 0,
                totalBatches: 0
            },
            matches: [],
            error: null
        };

        // Save initial scan state
        await stateService.saveScanState(scanId, scanData);

        // Start crawl in background (non-blocking)
        crawlerService.startCrawl(scanId, cleanUrl, cleanKeywords, cleanCaseSensitiveKeywords).catch(err => {
            console.error(`Scan ${scanId} failed:`, err);
            stateService.updateScanStatus(scanId, 'failed', { error: err.message });
        });

        res.json({
            scanId,
            status: 'started',
            message: 'Scan started successfully',
            url: cleanUrl,
            keywords: cleanKeywords,
            caseSensitiveKeywords: cleanCaseSensitiveKeywords
        });

    } catch (error) {
        console.error('Error starting scan:', error);
        res.status(500).json({ error: 'Failed to start scan', message: error.message });
    }
});

// Active keyword scan (for UI resume after navigation)
router.get('/scan/active', async (req, res) => {
    try {
        const sessionId = getSessionIdFromRequest(req);
        const active = await stateService.findActiveScan(sessionId);
        if (!active) {
            return res.json({ active: false });
        }
        res.json({
            active: true,
            scanId: active.id,
            status: active.status,
            url: active.url,
            stats: active.stats
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get active scan', message: error.message });
    }
});

// Cancel keyword scan
router.post('/scan/:scanId/cancel', async (req, res) => {
    try {
        const { scanId } = req.params;
        const scanData = await stateService.getScanState(scanId);
        if (!scanData) {
            return res.status(404).json({ error: 'Scan not found' });
        }
        if (!['running', 'starting'].includes(scanData.status)) {
            return res.status(400).json({ error: 'Scan is not running' });
        }
        await crawlerService.cancelCrawl(scanId);
        res.json({ scanId, status: 'cancelled', message: 'Scan cancelled' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to cancel scan', message: error.message });
    }
});

// Get scan status
router.get('/scan/:scanId/status', async (req, res) => {
    try {
        const { scanId } = req.params;
        const scanData = await stateService.getScanState(scanId);

        if (!scanData) {
            return res.status(404).json({ error: 'Scan not found' });
        }

        res.json({
            scanId,
            status: scanData.status,
            stats: scanData.stats,
            startedAt: scanData.startedAt,
            completedAt: scanData.completedAt,
            error: scanData.error,
            currentUrl: scanData.currentUrl || '',
            recentUrls: scanData.recentUrls || []
        });

    } catch (error) {
        console.error('Error getting scan status:', error);
        res.status(500).json({ error: 'Failed to get scan status', message: error.message });
    }
});

// View scan logs (HTML page in new tab)
router.get('/scan/:scanId/logs', async (req, res) => {
    try {
        const { scanId } = req.params;
        const html = await scanLogService.renderScanLogsHtml(scanId);
        if (!html) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'Scan not found' });
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (error) {
        console.error('Error rendering scan logs:', error);
        res.status(500).json({ error: 'LOGS_FAILED', message: error.message });
    }
});

// Get scan results
router.get('/scan/:scanId/results', async (req, res) => {
    try {
        const { scanId } = req.params;
        const scanData = await stateService.getScanState(scanId);

        if (!scanData) {
            return res.status(404).json({ error: 'Scan not found' });
        }

        res.json({
            scanId,
            url: scanData.url,
            keywords: scanData.keywords,
            status: scanData.status,
            stats: scanData.stats,
            matches: scanData.matches,
            results: scanData.results || [],
            startedAt: scanData.startedAt,
            completedAt: scanData.completedAt
        });

    } catch (error) {
        console.error('Error getting scan results:', error);
        res.status(500).json({ error: 'Failed to get scan results', message: error.message });
    }
});

// Download PDF report
router.get('/scan/:scanId/report', async (req, res) => {
    try {
        const { scanId } = req.params;
        const scanData = await stateService.getScanState(scanId);

        if (!scanData) {
            return res.status(404).json({ error: 'Scan not found' });
        }

        if (scanData.status !== 'completed') {
            return res.status(400).json({ 
                error: 'Scan not completed', 
                status: scanData.status 
            });
        }

        // Generate PDF
        const pdfPath = await reportService.generatePDF(scanData);

        // Send file
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="keyword-audit-report-${scanId}.pdf"`);
        
        const fileStream = fs.createReadStream(pdfPath);
        fileStream.pipe(res);

    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to generate report', message: error.message });
    }
});

// Start broken page / link check (non-blocking — poll /check-broken-pages/status)
router.post('/check-broken-pages', async (req, res) => {
    try {
        const sessionId = getSessionIdFromRequest(req);
        const running = errorCheckService.isCheckRunningGlobally
            ? errorCheckService.isCheckRunningGlobally()
            : (errorCheckService.getProgress ? errorCheckService.getProgress() : { status: 'idle' }).status === 'running';
        if (running) {
            const prog = errorCheckService.getProgress ? errorCheckService.getProgress() : { status: 'running' };
            return res.status(409).json({
                error: 'SCAN_ALREADY_RUNNING',
                message: 'An error check is already running. Please wait for it to finish.',
                currentUrl: prog.currentUrl || ''
            });
        }

        const { url, maxUrls, delay, maxDepth } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        if (String(url).trim().length > MAX_URL_LENGTH) {
            return res.status(400).json({
                error: 'URL_TOO_LONG',
                message: `URL must be ${MAX_URL_LENGTH} characters or less`
            });
        }

        let cleanUrl;
        try {
            cleanUrl = normalizeUrl(url);
        } catch (e) {
            return res.status(400).json({ error: e.message });
        }

        const options = normalizeErrorCheckOptions({ maxUrls, delay, maxDepth });

        const { runId } = errorCheckService.startCheck(cleanUrl, options, sessionId);
        res.json({
            status: 'started',
            runId,
            message: 'Error check started',
            url: cleanUrl
        });
    } catch (error) {
        console.error('Error in broken page check:', error);
        res.status(500).json({ 
            error: 'Execution failed', 
            message: error.message || 'Unknown error',
            log: error.stack || error.message 
        });
    }
});

// Cancel running error check
router.post('/check-broken-pages/cancel', (req, res) => {
    try {
        const cancelled = errorCheckService.requestCancel();
        if (!cancelled) {
            return res.status(400).json({ error: 'No error check is running' });
        }
        res.json({ status: 'cancelling', message: 'Cancellation requested' });
    } catch (error) {
        res.status(500).json({ error: 'CANCEL_FAILED', message: error.message });
    }
});

// View error-check logs (HTML page in new tab)
router.get('/check-broken-pages/logs', (req, res) => {
    try {
        const html = errorCheckService.renderLastRunLogsHtml();
        if (!html) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'No error check logs available' });
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (error) {
        console.error('Error rendering error check logs:', error);
        res.status(500).json({ error: 'LOGS_FAILED', message: error.message });
    }
});

// Status for live progress in error checker (polling)
router.get('/check-broken-pages/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
        const sessionId = getSessionIdFromRequest(req);
        const prog = errorCheckService.getProgress ? errorCheckService.getProgress() : { status: 'idle' };
        const lastRun = errorCheckService.getLastRun ? errorCheckService.getLastRun() : {};

        if (
          sessionId &&
          lastRun.sessionId &&
          lastRun.sessionId !== sessionId &&
          (prog.status === 'running' || lastRun.status === 'running')
        ) {
            return res.json({
                status: 'idle',
                runId: null,
                error: null,
                stats: {},
                recentUrls: [],
                currentUrl: '',
                checked: 0,
                total: 0
            });
        }

        let status = prog.status;
        if (status === 'running' && lastRun.status === 'cancelled') {
            status = 'cancelled';
        } else if (status === 'idle' && lastRun.status === 'running') {
            status = 'running';
        }
        res.json({
            status,
            runId: lastRun.id || null,
            error: lastRun.error || null,
            stats: {
                urlsDiscovered: prog.urlsDiscovered || prog.checked || 0,
                urlsProcessed: prog.checked || 0,
                currentBatch: prog.currentBatch || 0,
                errorCount: prog.errorCount || 0
            },
            recentUrls: prog.recentUrls || [],
            currentUrl: prog.currentUrl || '',
            checked: prog.checked || 0,
            total: prog.total || 0
        });
    } catch (e) {
        res.json({ status: 'idle', stats: {}, recentUrls: [] });
    }
});

// List all scans
router.get('/scans', async (req, res) => {
    try {
        const scans = await stateService.listScans();
        res.json({ scans });
    } catch (error) {
        console.error('Error listing scans:', error);
        res.status(500).json({ error: 'Failed to list scans', message: error.message });
    }
});

// Delete scan
router.delete('/scan/:scanId', async (req, res) => {
    try {
        const { scanId } = req.params;
        const reportDeleteService = require('../shared/services/reportDeleteService');
        const result = await reportDeleteService.deleteReport(
            'keyword-check',
            scanId,
            getSessionIdFromRequest(req)
        );
        res.json({ message: 'Scan deleted successfully', ...result });
    } catch (error) {
        console.error('Error deleting scan:', error);
        const msg = error.message || 'Failed to delete scan';
        const status = msg.includes('permission') || msg.includes('demo report') ? 403
            : msg.toLowerCase().includes('not found') ? 404
            : 500;
        res.status(status).json({ error: 'Failed to delete scan', message: msg });
    }
});

module.exports = router;