#!/usr/bin/env node
/**
 * Full UI Check job runner — uses existing crawl + queue pipeline with job-specific paths.
 */
const path = require('path');
const fs = require('fs');
const jobStore = require('../shared/jobStore');
const cancelSignal = require('../shared/cancelSignal');
const executionProgress = require('../shared/executionProgress');

const MODULE_ID = 'full-ui-check';

function emitProgress(pct, msg) {
  process.stdout.write(`PROGRESS:${pct} ${msg}\n`);
}

function countUrlsInQueue(urlQueuePath) {
  if (!fs.existsSync(urlQueuePath)) return 0;
  let count = 0;
  for (const line of fs.readFileSync(urlQueuePath, 'utf8').split('\n')) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj?.url) count++;
    } catch { /* skip */ }
  }
  return count;
}

async function main() {
  const jobId = process.argv[2] || process.env.JOB_ID;
  if (!jobId) process.exit(1);

  const job = await jobStore.getJob(MODULE_ID, jobId);
  if (!job) process.exit(1);

  const jobDir = jobStore.getJobDir(MODULE_ID, jobId);
  cancelSignal.clearCancelled(jobDir);

  process.env.QA_JOB_DIR = jobDir;
  process.env.QA_JOB_MODULE_ID = MODULE_ID;
  process.env.QA_REPORT_HTML_PATH = path.join(jobDir, 'qa-report.html');
  process.env.QA_SCREENSHOT_BASE_URL = `/api/modules/${MODULE_ID}/jobs/${jobId}/screenshots`;
  process.env.SKIP_PDF = '1';

  const { applyJobRuntimeEnv } = require('../shared/services/executionService');
  await applyJobRuntimeEnv(job);

  const { normalizeMaxPages } = require('../shared/fullUiCheckLimits');
  const maxPages = normalizeMaxPages(job.options?.maxPages);
  process.env.QA_MAX_PAGES = String(maxPages);

  let progressInterval = null;

  const handleCancel = async () => {
    cancelSignal.setCancelled(jobDir);
    if (progressInterval) clearInterval(progressInterval);
    await jobStore.updateJob(MODULE_ID, jobId, {
      status: 'cancelled',
      message: 'Cancelled by user'
    }).catch(() => {});
    process.exit(130);
  };

  process.on('SIGTERM', handleCancel);
  process.on('SIGINT', handleCancel);

  try {
    emitProgress(5, 'Initializing full site UI check...');

    const { ensureDir } = require('./uichecksfull/utils/reportUtils');
    const { discoverURL } = require('./discoverURL');
    const { processUrlQueue } = require('./queueManager');
    const { updateTracker } = require('./tracker');
    const crawlConfig = require('./crawlConfig');
    const crawlOverrides = {};
    crawlOverrides.maxPagesToScan = maxPages;
    crawlOverrides.maxUrls = maxPages;
    if (job.options?.ignorePaths?.length) {
      crawlOverrides.ignorePaths = job.options.ignorePaths;
    }
    const mergedCrawlConfig = { ...crawlConfig, ...crawlOverrides };

    const runFolder = jobDir;
    const screenshotFolder = path.join(runFolder, 'screenshots');
    const urlQueuePath = path.join(runFolder, 'urlQueue.jsonl');

    ensureDir(runFolder);
    ensureDir(screenshotFolder);

    emitProgress(10, 'Discovering URLs...');
    updateTracker({ runId: jobId, lastProcessedUrl: '', status: 'queued', delta: { pending: 0 } });

    if (cancelSignal.isCancelled(jobDir)) await handleCancel();

    const discovery = await discoverURL({
      seedUrl: job.url,
      runId: jobId,
      urlQueuePath,
      runFolder,
      crawlConfig: mergedCrawlConfig
    });

    const { prioritizeUrlQueue } = require('./prioritizeUrlQueue');
    prioritizeUrlQueue(urlQueuePath, job.url);

    const totalPages = countUrlsInQueue(urlQueuePath) || discovery?.discovered || 0;
    await executionProgress.lockTotalPages(MODULE_ID, jobId, totalPages);
    emitProgress(25, `Found ${totalPages} URLs — scanning (important pages first)...`);

    progressInterval = setInterval(async () => {
      try {
        if (cancelSignal.isCancelled(jobDir)) {
          clearInterval(progressInterval);
          await handleCancel();
          return;
        }
        const current = await jobStore.getJob(MODULE_ID, jobId);
        if (!current || current.status === 'cancelled') return;
        const total = current.totalPages || 0;
        const page = current.currentPage || 0;
        if (total > 0) {
          const pct = Math.min(90, 25 + Math.round((page / total) * 65));
          emitProgress(pct, `Scanning pages... ${page} / ${total}`);
        }
      } catch { /* ignore */ }
    }, 2000);

    await processUrlQueue({
      seedUrl: job.url,
      runId: jobId,
      urlQueuePath,
      runFolder,
      screenshotFolder,
      maxRetries: 3,
      moduleId: MODULE_ID
    });

    clearInterval(progressInterval);

    if (cancelSignal.isCancelled(jobDir)) {
      await handleCancel();
    }

    const reportHtmlPath = path.join(jobDir, 'qa-report.html');
    if (!fs.existsSync(reportHtmlPath)) {
      throw new Error('Report generation failed — qa-report.html not created');
    }

    const finalJob = await jobStore.getJob(MODULE_ID, jobId);
    const total = finalJob?.totalPages || totalPages;
    await executionProgress.updatePageProgress(MODULE_ID, jobId, {
      currentPage: total,
      currentUrl: '',
      progress: 100
    });

    emitProgress(100, 'Completed');
    process.exit(0);
  } catch (err) {
    if (cancelSignal.isCancelled(jobDir)) {
      await handleCancel();
    }
    await jobStore.updateJob(MODULE_ID, jobId, {
      status: 'failed',
      message: 'Full UI check failed',
      error: err.message || 'Unknown error'
    });
    process.stderr.write(err.stack || err.message);
    process.exit(1);
  }
}

main();