#!/usr/bin/env node
/**
 * Sitemap check job runner — parse sitemap, check each URL, write report.
 */
const fs = require('fs');
const jobStore = require('../shared/jobStore');
const cancelSignal = require('../shared/cancelSignal');
const { runSitemapCheck } = require('./sitemapCheckService');
const { writeJobArtifacts } = require('./sitemapReportStorage');

const MODULE_ID = 'sitemap-check';

function emitProgress(pct, msg, meta = {}) {
  const hasMeta =
    meta.currentPage != null ||
    meta.totalPages != null ||
    meta.currentUrl != null;

  const line = hasMeta
    ? (() => {
      const currentPage = meta.currentPage != null ? meta.currentPage : 0;
      const totalPages = meta.totalPages != null ? meta.totalPages : 0;
      const currentUrl = encodeURIComponent(meta.currentUrl || '');
      return `PROGRESS:${pct}|${currentPage}|${totalPages}|${currentUrl}|${msg}\n`;
    })()
    : `PROGRESS:${pct} ${msg}\n`;

  fs.writeSync(1, line);
}

async function main() {
  const jobId = process.argv[2] || process.env.JOB_ID;
  if (!jobId) process.exit(1);

  const job = await jobStore.getJob(MODULE_ID, jobId);
  if (!job) process.exit(1);

  const jobDir = jobStore.getJobDir(MODULE_ID, jobId);
  cancelSignal.clearCancelled(jobDir);

  const maxUrls = job.options?.maxUrls;
  const delayMs = job.options?.delayMs;

  try {
    emitProgress(5, 'Discovering sitemap URLs...');
    await jobStore.updateJob(MODULE_ID, jobId, {
      progress: 5,
      message: 'Discovering sitemap URLs...'
    });

    const report = await runSitemapCheck(job.url, {
      maxUrls,
      delayMs,
      shouldCancel: () => cancelSignal.isCancelled(jobDir),
      onProgress: async ({ processed, total, currentUrl, issueCount, progressPct, message }) => {
        const patch = {
          progress: progressPct,
          currentPage: processed,
          totalPages: total,
          currentUrl,
          message: message || `Checking URL ${processed} / ${total}`,
          errorCount: issueCount
        };
        await jobStore.updateJob(MODULE_ID, jobId, patch);
        emitProgress(progressPct, patch.message, {
          currentPage: processed,
          totalPages: total,
          currentUrl
        });
      }
    });

    if (report.cancelled) {
      await jobStore.updateJob(MODULE_ID, jobId, {
        status: 'cancelled',
        message: 'Cancelled by user',
        progress: report.summary?.totalChecked && report.urls?.length
          ? Math.floor((report.urls.length / Math.max(report.summary.totalDiscovered, 1)) * 100)
          : 0
      });
      process.exit(0);
    }

    emitProgress(92, 'Generating report...');
    await jobStore.updateJob(MODULE_ID, jobId, {
      progress: 92,
      message: 'Generating report...'
    });

    const artifacts = await writeJobArtifacts(jobDir, report);
    await jobStore.updateJob(MODULE_ID, jobId, {
      progress: 100,
      message: 'Completed',
      reportPath: artifacts.reportPath,
      reportAvailable: true,
      totalPages: report.summary?.totalChecked || 0,
      currentPage: report.summary?.totalChecked || 0
    });

    emitProgress(100, 'Completed');
    process.exit(0);
  } catch (err) {
    await jobStore.updateJob(MODULE_ID, jobId, {
      status: 'failed',
      message: 'Sitemap audit failed',
      error: err.message || String(err)
    });
    console.error(err);
    process.exit(1);
  }
}

main();