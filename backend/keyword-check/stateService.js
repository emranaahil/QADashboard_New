const fs = require('fs-extra');
const path = require('path');

const { uuidv4, validateUuid } = require('../shared/uuidUtils');
const { keywordStorageDir } = require('../shared/storagePaths');
const { buildScanFilename } = require('./scanFilename');

const SCANS_DIR = keywordStorageDir('scans');
const CHECKPOINTS_DIR = keywordStorageDir('checkpoints');
const REPORTS_DIR = keywordStorageDir('reports');

fs.ensureDirSync(SCANS_DIR);
fs.ensureDirSync(CHECKPOINTS_DIR);
fs.ensureDirSync(REPORTS_DIR);

async function ensureUniqueFilename(base) {
  let name = base;
  let counter = 0;
  while (await fs.pathExists(path.join(SCANS_DIR, `${name}.json`))) {
    counter++;
    name = `${base}-${counter}`;
    if (counter > 100) {
      name = `${base}-${uuidv4().slice(0, 8)}`;
      break;
    }
  }
  return name;
}

/** Resolve scan JSON on disk by internal UUID (supports legacy UUID filenames). */
async function resolveScanFile(scanId) {
  const legacyPath = path.join(SCANS_DIR, `${scanId}.json`);
  if (await fs.pathExists(legacyPath)) {
    try {
      const data = await fs.readJson(legacyPath);
      if (!data.id || data.id === scanId) {
        return { filePath: legacyPath, data };
      }
    } catch {
      /* fall through */
    }
  }

  let files;
  try {
    files = await fs.readdir(SCANS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(SCANS_DIR, file);
    try {
      const data = await fs.readJson(filePath);
      if (data.id === scanId) return { filePath, data };
    } catch {
      /* skip invalid */
    }
  }

  return null;
}

// Save scan state to JSON (filename derived from URL + timestamp)
async function saveScanState(scanId, data) {
  const payload = { ...data, id: data.id || scanId };
  let filePath;

  if (payload.storageFilename) {
    filePath = path.join(SCANS_DIR, `${payload.storageFilename}.json`);
  } else {
    const existing = await resolveScanFile(scanId);
    if (existing) {
      filePath = existing.filePath;
      payload.storageFilename = path.basename(existing.filePath, '.json');
    } else {
      const base = await ensureUniqueFilename(
        buildScanFilename(payload.url, payload.startedAt)
      );
      payload.storageFilename = base;
      filePath = path.join(SCANS_DIR, `${base}.json`);
    }
  }

  await fs.writeJson(filePath, payload, { spaces: 2 });
}

// Get scan state from JSON
async function getScanState(scanId) {
  const resolved = await resolveScanFile(scanId);
  return resolved ? resolved.data : null;
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
  if (status === 'cancelled') {
    data.completedAt = new Date().toISOString();
    data.error = extra.error || 'Cancelled by user';
  }
  if (extra.stats) {
    data.stats = { ...data.stats, ...extra.stats };
  }
  if (extra.matches) {
    data.matches = extra.matches;
  }
  if (extra.results) {
    data.results = extra.results;
  }
  if (extra.recentUrls) {
    if (!data.recentUrls) data.recentUrls = [];
    data.recentUrls = [...data.recentUrls, ...extra.recentUrls].slice(-20);
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
          stats: data.stats,
          storageFilename: data.storageFilename || file.replace('.json', '')
        });
      }
    }

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
  const resolved = await resolveScanFile(scanId);
  const checkpointFile = path.join(CHECKPOINTS_DIR, `${scanId}.json`);
  const reportFile = path.join(REPORTS_DIR, `keyword-audit-report-${scanId}.pdf`);

  await Promise.all([
    resolved ? fs.remove(resolved.filePath).catch(() => {}) : Promise.resolve(),
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

/** Rename legacy UUID scan files to URL-based filenames (one-time per file). */
async function migrateLegacyScanFilenames() {
  let renamed = 0;
  let files;
  try {
    files = await fs.readdir(SCANS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return { renamed: 0 };
    throw err;
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const basename = file.replace('.json', '');
    if (!validateUuid(basename)) continue;

    const filePath = path.join(SCANS_DIR, file);
    let data;
    try {
      data = await fs.readJson(filePath);
    } catch {
      continue;
    }

    if (data.storageFilename && data.storageFilename !== basename) {
      await fs.remove(filePath).catch(() => {});
      continue;
    }

    const newBase = await ensureUniqueFilename(
      buildScanFilename(data.url, data.startedAt)
    );
    if (newBase === basename) {
      data.storageFilename = basename;
      await fs.writeJson(filePath, data, { spaces: 2 });
      continue;
    }

    data.storageFilename = newBase;
    const newPath = path.join(SCANS_DIR, `${newBase}.json`);
    await fs.writeJson(newPath, data, { spaces: 2 });
    if (newPath !== filePath) await fs.remove(filePath);
    renamed++;
  }

  return { renamed };
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
  cleanupStaleScansOnStartup,
  migrateLegacyScanFilenames,
  resolveScanFile
};