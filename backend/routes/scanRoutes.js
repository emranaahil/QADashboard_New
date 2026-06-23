const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const crawlerService = require('../keyword-check/crawlerService');
const reportService = require('../keyword-check/reportService');
const stateService = require('../keyword-check/stateService');
const errorCheckService = require('../error-check/errorCheckService');
const { normalizeUrl } = require('../shared/urlSecurity');

// Start a new scan
router.post('/scan/start', async (req, res) => {
    try {
        const active = await stateService.findActiveScan();
        if (active) {
            return res.status(409).json({
                error: 'SCAN_ALREADY_RUNNING',
                message: 'A keyword scan is already in progress. Please wait for it to finish.',
                scanId: active.id
            });
        }

        const { url, keywords } = req.body;

        // Validate input
        if (!url || !url.trim()) {
            return res.status(400).json({ error: 'Website URL is required' });
        }

        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({ error: 'At least one keyword is required' });
        }

        let cleanUrl;
        try {
            cleanUrl = normalizeUrl(url);
        } catch (e) {
            return res.status(400).json({ error: e.message });
        }

        // Clean keywords
        const cleanKeywords = keywords
            .map(k => k.trim())
            .filter(k => k.length > 0);

        if (cleanKeywords.length === 0) {
            return res.status(400).json({ error: 'At least one valid keyword is required' });
        }

        // Create scan session
        const scanId = uuidv4();
        const scanData = {
            id: scanId,
            url: cleanUrl,
            keywords: cleanKeywords,
            status: 'starting',
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
        crawlerService.startCrawl(scanId, cleanUrl, cleanKeywords).catch(err => {
            console.error(`Scan ${scanId} failed:`, err);
            stateService.updateScanStatus(scanId, 'failed', { error: err.message });
        });

        res.json({
            scanId,
            status: 'started',
            message: 'Scan started successfully',
            url: cleanUrl,
            keywords: cleanKeywords
        });

    } catch (error) {
        console.error('Error starting scan:', error);
        res.status(500).json({ error: 'Failed to start scan', message: error.message });
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
            recentUrls: scanData.recentUrls || []   // live processed URLs for UI
        });

    } catch (error) {
        console.error('Error getting scan status:', error);
        res.status(500).json({ error: 'Failed to get scan status', message: error.message });
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

// Dedicated Broken Page / Error Content Checker (separate from keyword search)
router.post('/check-broken-pages', async (req, res) => {
    try {
        const prog = errorCheckService.getProgress ? errorCheckService.getProgress() : { status: 'idle' };
        if (prog.status === 'running') {
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

        let cleanUrl;
        try {
            cleanUrl = normalizeUrl(url);
        } catch (e) {
            return res.status(400).json({ error: e.message });
        }

        const options = {
            maxUrls: parseInt(maxUrls) || 500,
            delay: parseInt(delay) || 400,
            maxDepth: parseInt(maxDepth) || 5
        };

        const result = await errorCheckService.checkForBrokenPages(cleanUrl, options);
        res.json(result);
    } catch (error) {
        console.error('Error in broken page check:', error);
        res.status(500).json({ 
            error: 'Execution failed', 
            message: error.message || 'Unknown error',
            log: error.stack || error.message 
        });
    }
});

// Status for live progress in error checker (polling)
router.get('/check-broken-pages/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
        const prog = errorCheckService.getProgress ? errorCheckService.getProgress() : { status: 'idle' };
        // Return in format similar to main auditor for UI reuse
        res.json({
            status: prog.status,
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
        await stateService.deleteScan(scanId);
        res.json({ message: 'Scan deleted successfully' });
    } catch (error) {
        console.error('Error deleting scan:', error);
        res.status(500).json({ error: 'Failed to delete scan', message: error.message });
    }
});

module.exports = router;