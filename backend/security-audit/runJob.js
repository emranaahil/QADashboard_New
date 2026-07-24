#!/usr/bin/env node
/**
 * Security Audit job runner.
 */
const fs = require('fs');
const jobStore = require('../shared/jobStore');
const cancelSignal = require('../shared/cancelSignal');
const { runSecurityAudit } = require('./securityAuditService');
const { writeJobArtifacts } = require('./securityReportStorage');

const MODULE_ID = 'security-audit';

function emitProgress(pct, msg, meta = {}) {
  const hasMeta = meta.currentPage != null || meta.totalPages != null || meta.currentUrl != null;
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

function resolveJobUrls(job) {
  if (Array.isArray(job.urls) && job.urls.length) return job.urls;
  if (Array.isArray(job.options?.urls) && job.options.urls.length) return job.options.urls;
  return [job.url];
}

async function main() {
  const jobId = process.argv[2] || process.env.JOB_ID;
  if (!jobId) process.exit(1);

  const job = await jobStore.getJob(MODULE_ID, jobId);
  if (!job) process.exit(1);

  const jobDir = jobStore.getJobDir(MODULE_ID, jobId);
  cancelSignal.clearCancelled(jobDir);

  try {
    emitProgress(5, 'Starting security audit...');
    await jobStore.updateJob(MODULE_ID, jobId, {
      progress: 5,
      message: 'Starting security audit...'
    });

    const mode = job.options?.mode || 'single';
    const urls = mode === 'single' ? resolveJobUrls(job) : undefined;

    const report = await runSecurityAudit(job.url, {
      mode,
      urls,
      maxUrls: job.options?.maxUrls,
      includePageSpeed: job.options?.includePageSpeed === true,
      includeW3cValidator: job.options?.includeW3cValidator === true,
      includeRobotsTxt: job.options?.includeRobotsTxt === true,
      includeRedirectTrace: job.options?.includeRedirectTrace === true,
      includeSslLabs: job.options?.includeSslLabs === true,
      shouldCancel: () => cancelSignal.isCancelled(jobDir),
      onProgress: async ({
        progressPct,
        message,
        currentPage,
        totalPages,
        currentUrl
      }) => {
        const patch = {
          progress: progressPct,
          message: message || 'Running security audit...',
          currentPage: currentPage || 1,
          totalPages: totalPages || urls?.length || 1,
          currentUrl: currentUrl || job.url
        };
        await jobStore.updateJob(MODULE_ID, jobId, patch);
        emitProgress(progressPct, patch.message, {
          currentPage: patch.currentPage,
          totalPages: patch.totalPages,
          currentUrl: patch.currentUrl
        });
      }
    });

    if (report.cancelled) {
      await jobStore.updateJob(MODULE_ID, jobId, {
        status: 'cancelled',
        message: 'Cancelled by user'
      });
      process.exit(0);
    }

    emitProgress(92, 'Generating report...');
    await jobStore.updateJob(MODULE_ID, jobId, {
      progress: 92,
      message: 'Generating report...',
      errorCount: report.summary?.pagesWithIssues || 0
    });

    const artifacts = await writeJobArtifacts(jobDir, report);
    await jobStore.updateJob(MODULE_ID, jobId, {
      progress: 100,
      message: 'Completed',
      reportPath: artifacts.reportPath,
      reportAvailable: true,
      totalPages: report.pagesAudited || report.summary?.pagesAudited || 1,
      currentPage: report.pagesAudited || report.summary?.pagesAudited || 1
    });

    emitProgress(100, 'Completed');
    process.exit(0);
  } catch (err) {
    await jobStore.updateJob(MODULE_ID, jobId, {
      status: 'failed',
      message: 'Security audit failed',
      error: err.message || String(err)
    });
    console.error(err);
    process.exit(1);
  }
}

main();