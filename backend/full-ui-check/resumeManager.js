const fs = require('fs');
const path = require('path');

const { moduleReportsDir } = require('../shared/storagePaths');
const trackerPath = path.join(moduleReportsDir('full-ui-check'), 'job-tracker.json');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readTrackerRun(runId) {
  const data = readJsonSafe(trackerPath, null);
  if (!data) return null;

  // 1) Primary (new) format: { runs: { [runId]: { lastProcessedUrl, ... } } }
  if (data && data.runs && data.runs[runId]) return data.runs[runId];

  // 2) Alternate legacy format: { [runId]: { lastProcessedUrl, ... } }
  if (data && typeof data === 'object' && data[runId] && typeof data[runId] === 'object') {
    return data[runId];
  }

  // 3) Flat single-run format:
  //    { lastProcessedUrl: "...", status: "...", runId: "..." }
  if (data && data.runId === runId) return data;

  // 4) Another common flat-like nesting:
  //    { runId: { lastProcessedUrl: "...", status: "..." } }
  //    or { [someKey]: { lastProcessedUrl, status } } already handled above.
  if (data && typeof data === 'object' && data[runId] === data.runId) {
    // no-op (defensive), keep fallthrough to null
  }

  // Legacy array format / unknown shape: can't reliably reconstruct.
  return null;
}


async function getResumeState({ runId }) {
  const data = readJsonSafe(trackerPath, null);

  // If missing runId, fail safe to defaults.
  if (!runId) {
    return { lastProcessedUrl: '', completed: 0 };
  }

  const run = readTrackerRun(runId);

  // If we can't find run in known shapes, still attempt a couple
  // of defensive fallbacks that won't crash older runs.
  const lastProcessedUrlFromFlat = (data && typeof data === 'object')
    ? (data.lastProcessedUrl || '')
    : '';

  const completedFromFlat = (data && typeof data === 'object')
    ? Number(data.completed || 0)
    : 0;

  if (!run) {
    return {
      lastProcessedUrl: lastProcessedUrlFromFlat,
      completed: completedFromFlat
    };
  }

  return {
    lastProcessedUrl: run.lastProcessedUrl || '',
    completed: Number(run.completed || 0)
  };
}

/**
 * Skips already processed URLs by returning an iterator offset:
 * - If lastProcessedUrl exists, queueManager will start processing lines after that URL.
 */
function shouldSkipUrl({ lastProcessedUrl, url }) {
  if (!lastProcessedUrl) return false;
  return url !== lastProcessedUrl;
}

module.exports = {
  getResumeState
};
