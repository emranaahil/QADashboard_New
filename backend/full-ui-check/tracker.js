const fs = require('fs');
const path = require('path');

const trackerPath = process.env.QA_JOB_DIR
  ? require('path').join(process.env.QA_JOB_DIR, 'job-tracker.json')
  : require('path').join(__dirname, 'reports', 'job-tracker.json');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function atomicWriteJson(p, data) {
  ensureDir(path.dirname(p));
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function defaultDoc() {
  return {
    runId: '',
    completed: 0,
    pending: 0,
    failed: [],
    lastProcessedUrl: '',
    runs: {}
  };
}

function readTrackerDoc() {
  try {
    if (!fs.existsSync(trackerPath)) return defaultDoc();
    const raw = fs.readFileSync(trackerPath, 'utf8');
    if (!raw.trim()) return defaultDoc();

    const parsed = JSON.parse(raw);

    // Backward compatibility: old implementation wrote other shapes.
    // We normalize to a doc format, preserving legacy data under _legacy if needed.
    if (Array.isArray(parsed)) {
      // Old array-of-entries format (legacy)
      return { ...defaultDoc(), _legacyArray: parsed };
    }

    if (!parsed || typeof parsed !== 'object') return defaultDoc();

    return {
      runId: parsed.runId || '',
      completed: Number(parsed.completed || 0),
      pending: Number(parsed.pending || 0),
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
      lastProcessedUrl: parsed.lastProcessedUrl || '',
      runs: parsed.runs && typeof parsed.runs === 'object' ? parsed.runs : {},
      _legacy: parsed._legacy
    };
  } catch {
    return defaultDoc();
  }
}

function initRun(doc, runId) {
  if (!runId) return;
  if (!doc.runs) doc.runs = {};
  if (!doc.runs[runId]) {
    doc.runs[runId] = {
      // Minimal per-run structure for resume.
      runId,
      lastProcessedUrl: '',
      status: 'queued',
      url: '',
      retryCount: 0,
      timestamps: {
        created: new Date().toISOString(),
        started: '',
        finished: ''
      },
      completed: 0,
      pending: 0,
      failed: []
    };
  }
}

/**
 * updateTracker supports BOTH call styles currently used in the repo:
 * 1) worker/queueManager style:
 *    updateTracker({ runId, url, status, retryCount })
 * 2) queueManager (stream queue processing) style:
 *    updateTracker({ runId, lastProcessedUrl, status, failure, attempts })
 */
function updateTracker({ runId, url, status, retryCount, lastProcessedUrl, failure, attempts, reason } = {}) {
  const doc = readTrackerDoc();
  initRun(doc, runId);

  // Call style #1: { runId, url, status, retryCount }
  if (runId && url) {
    const run = doc.runs[runId];
    run.url = url;
    run.status = status;
    if (typeof retryCount === 'number') run.retryCount = retryCount;

    run.timestamps = run.timestamps || { created: new Date().toISOString(), started: '', finished: '' };
    if (status === 'running') run.timestamps.started = run.timestamps.started || new Date().toISOString();
    if (status === 'completed' || status === 'failed') run.timestamps.finished = new Date().toISOString();

    if (status === 'completed') {
      run.completed = Number(run.completed || 0) + 1;
      doc.completed = Number(doc.completed || 0) + 1;
    }

    if (status === 'failed') {
      const entry = failure || {
        url: String(url || ''),
        reason: String(reason || failure?.reason || 'Unknown error'),
        attempts: Number(attempts || retryCount || 0),
        timestamp: new Date().toISOString()
      };

      run.failed = Array.isArray(run.failed) ? run.failed : [];
      run.failed.push(entry);

      doc.failed = Array.isArray(doc.failed) ? doc.failed : [];
      doc.failed.push(entry);
    }

    if (typeof lastProcessedUrl === 'string') {
      run.lastProcessedUrl = lastProcessedUrl;
      doc.lastProcessedUrl = lastProcessedUrl;
    }

    doc.runId = doc.runId || runId;
    atomicWriteJson(trackerPath, doc);
    return;
  }

  // Call style #2: { runId, lastProcessedUrl, status, failure }
  if (runId) {
    const run = doc.runs[runId];
    if (typeof lastProcessedUrl === 'string') {
      run.lastProcessedUrl = lastProcessedUrl;
      doc.lastProcessedUrl = lastProcessedUrl;
    }

    if (status) {
      run.status = status;
      run.timestamps = run.timestamps || { created: new Date().toISOString(), started: '', finished: '' };
      if (status === 'running') run.timestamps.started = run.timestamps.started || new Date().toISOString();
      if (status === 'completed' || status === 'failed') run.timestamps.finished = new Date().toISOString();
    }

    if (status === 'completed') {
      run.completed = Number(run.completed || 0) + 1;
      doc.completed = Number(doc.completed || 0) + 1;
    }

    if (status === 'failed') {
      const entry = failure || {
        url: String(lastProcessedUrl || ''),
        reason: String(reason || 'Unknown error'),
        attempts: Number(attempts || 0),
        timestamp: new Date().toISOString()
      };

      run.failed = Array.isArray(run.failed) ? run.failed : [];
      run.failed.push(entry);

      doc.failed = Array.isArray(doc.failed) ? doc.failed : [];
      doc.failed.push(entry);
    }

    doc.runId = doc.runId || runId;
    atomicWriteJson(trackerPath, doc);
    return;
  }

  atomicWriteJson(trackerPath, doc);
}

module.exports = {
  trackerPath,
  updateTracker
};

