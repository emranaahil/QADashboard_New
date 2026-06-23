const fs = require('fs-extra');
const path = require('path');

const { keywordStorageDir } = require('../shared/storagePaths');
const SCANS_DIR = keywordStorageDir('scans');
const CHECKPOINTS_DIR = keywordStorageDir('checkpoints');
const REPORTS_DIR = keywordStorageDir('reports');

fs.ensureDirSync(SCANS_DIR);
fs.ensureDirSync(CHECKPOINTS_DIR);
fs.ensureDirSync(REPORTS_DIR);

// Save scan state to JSON
async function saveScanState(scanId, data) {
    const filePath = path.join(SCANS_DIR, `${scanId}.json`);
    await fs.writeJson(filePath, data, { spaces: 2 });
}

// Get scan state from JSON
async function getScanState(scanId) {
    const filePath = path.join(SCANS_DIR, `${scanId}.json`);
    try {
        return await fs.readJson(filePath);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

// Update scan status
async function updateScanStatus(scanId, status, extra = {}) {
    const data = await getScanState(scanId);
    if (!data) {
        console.error(`Cannot update status: Scan ${scanId} not found`);
        return;
    }
    
    data.status = status;
    if (status === 'completed') {
        data.completedAt = new Date().toISOString();
    }
    if (status === 'failed' && extra.error) {
        data.error = extra.error;
    }
    if (extra.stats) {
        data.stats = { ...data.stats, ...extra.stats };
    }
    if (extra.matches) {
        data.matches = extra.matches;
    }
    if (extra.recentUrls) {
        if (!data.recentUrls) data.recentUrls = [];
        data.recentUrls = [...data.recentUrls, ...extra.recentUrls].slice(-20); // keep last 20
    }
    
    await saveScanState(scanId, data);
}

// Save checkpoint for resume capability
async function saveCheckpoint(scanId, checkpointData) {
    const filePath = path.join(CHECKPOINTS_DIR, `${scanId}.json`);
    await fs.writeJson(filePath, {
        scanId,
        ...checkpointData,
        timestamp: new Date().toISOString()
    }, { spaces: 2 });
}

// Load checkpoint
async function loadCheckpoint(scanId) {
    const filePath = path.join(CHECKPOINTS_DIR, `${scanId}.json`);
    try {
        return await fs.readJson(filePath);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

// Delete checkpoint
async function deleteCheckpoint(scanId) {
    const filePath = path.join(CHECKPOINTS_DIR, `${scanId}.json`);
    try {
        await fs.remove(filePath);
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
}

// List all scans
async function listScans() {
    try {
        const files = await fs.readdir(SCANS_DIR);
        const scans = [];
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const data = await fs.readJson(path.join(SCANS_DIR, file));
                scans.push({
                    id: data.id,
                    url: data.url,
                    status: data.status,
                    startedAt: data.startedAt,
                    completedAt: data.completedAt,
                    stats: data.stats
                });
            }
        }
        
        // Sort by start time descending
        scans.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
        return scans;
    } catch (err) {
        if (err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}

// Delete scan
async function deleteScan(scanId) {
    const scanFile = path.join(SCANS_DIR, `${scanId}.json`);
    const checkpointFile = path.join(CHECKPOINTS_DIR, `${scanId}.json`);
    const reportFile = path.join(REPORTS_DIR, `${scanId}.pdf`);
    
    await Promise.all([
        fs.remove(scanFile).catch(() => {}),
        fs.remove(checkpointFile).catch(() => {}),
        fs.remove(reportFile).catch(() => {})
    ]);
}

// Check if scan exists and can be resumed
async function canResumeScan(scanId) {
    const checkpoint = await loadCheckpoint(scanId);
    if (!checkpoint) return false;
    
    const scanData = await getScanState(scanId);
    if (!scanData) return false;
    
    return scanData.status === 'running' || scanData.status === 'starting';
}

async function findActiveScan() {
    const scans = await listScans();
    return scans.find(s => s.status === 'running' || s.status === 'starting') || null;
}

/** Mark interrupted keyword scans as failed when the server restarts. */
async function cleanupStaleScansOnStartup() {
    const scans = await listScans();
    let count = 0;
    for (const scan of scans) {
        if (scan.status !== 'running' && scan.status !== 'starting') continue;
        await updateScanStatus(scan.id, 'failed', {
            error: 'Scan interrupted — server restarted'
        });
        count++;
    }
    return count;
}

module.exports = {
    saveScanState,
    getScanState,
    updateScanStatus,
    saveCheckpoint,
    loadCheckpoint,
    deleteCheckpoint,
    listScans,
    deleteScan,
    canResumeScan,
    findActiveScan,
    cleanupStaleScansOnStartup
};