#!/usr/bin/env node
/**
 * SEO job runner — invoked by job queue. Uses existing uiseocheck engine.
 */
require('../shared/loadEnv');
const fs = require('fs-extra');
const jobStore = require('../shared/jobStore');
const { runSeoAudit, generateHtmlReport } = require('./uiseocheck');
const { makeRunId, writeRunArtifacts, getRunArtifacts } = require('./seoReportStorage');
const { writeRichResultsScreenshotFiles } = require('../shared/services/richResultsTest');

const MODULE_ID = 'seo';

function emitProgress(pct, msg) {
  process.stdout.write(`PROGRESS:${pct} ${msg}\n`);
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

  const mode = job.options?.mode || 'single';

  try {
    emitProgress(10, 'Initializing SEO audit...');
    await jobStore.updateJob(MODULE_ID, jobId, { progress: 10, message: 'Initializing SEO audit...' });

    const urls = resolveJobUrls(job);

    const onProgress = async ({ phase, processed, total, discovered, message, currentUrl }) => {
      let progress = 20;
      if (phase === 'crawl') {
        const denom = Math.max(discovered || 1, 1);
        progress = 15 + Math.min(25, Math.floor(((processed || 0) / denom) * 25));
      } else if (phase === 'scan') {
        const denom = Math.max(total || 1, 1);
        progress = 40 + Math.min(45, Math.floor(((processed || 0) / denom) * 45));
      }
      const patch = {
        progress,
        message: message || 'Running SEO checks...',
        totalPages: phase === 'scan' ? total : discovered || 0,
        currentPage: processed || 0,
        currentUrl: currentUrl || ''
      };
      await jobStore.updateJob(MODULE_ID, jobId, patch);
      emitProgress(progress, patch.message);
    };

    emitProgress(15, mode === 'full' ? 'Crawling site to discover pages...' : 'Running SEO checks...');
    await jobStore.updateJob(MODULE_ID, jobId, {
      progress: 15,
      message: mode === 'full' ? 'Crawling site to discover pages...' : 'Running SEO checks...'
    });

    const includePageSpeed = job.options?.includePageSpeed === true;
    const includeRichResults = job.options?.includeRichResults === true;

    const report = await runSeoAudit({
      mainUrl: job.url,
      mode,
      urls: mode === 'single' ? urls : undefined,
      onProgress,
      includePageSpeed,
      includeRichResults
    });

    emitProgress(85, 'Generating QA report...');
    const seoReport = {
      mainUrl: report.meta.mainUrl,
      scanDate: new Date().toISOString(),
      discoveryMethod: report.meta.discoveryMethod,
      sitemapUsed: null,
      urlsAttempted: report.meta.urlsAttempted,
      concurrency: report.meta.concurrency,
      timeoutMs: report.meta.timeoutMs,
      siteChecks: report.siteChecks || { critical: [], minor: [] },
      pages: report.pages,
      summary: report.summary
    };

    if (!report.htmlReport || typeof report.htmlReport !== 'string') {
      throw new Error('SEO audit did not produce HTML report');
    }

    const runId = makeRunId();
    // Write PNGs first so the HTML card can reference the saved file path.
    try {
      const { folder } = getRunArtifacts(runId);
      await fs.ensureDir(folder);
      await writeRichResultsScreenshotFiles(folder, seoReport.pages);
    } catch {
      // non-fatal — HTML still embeds base64 when present
    }
    const html = generateHtmlReport({
      mainUrl: seoReport.mainUrl,
      scanDate: seoReport.scanDate,
      pages: seoReport.pages,
      siteChecks: seoReport.siteChecks,
      reportId: runId
    });
    const saved = await writeRunArtifacts(runId, { seoReport, html });

    await jobStore.updateJob(MODULE_ID, jobId, {
      status: 'completed',
      progress: 100,
      message: 'Completed',
      reportPath: saved.reportPath,
      reportRunId: runId,
      reportAvailable: true,
      error: null
    });

    emitProgress(100, 'Completed');
    process.exit(0);
  } catch (err) {
    await jobStore.updateJob(MODULE_ID, jobId, {
      status: 'failed',
      message: 'SEO audit failed',
      error: err.message || 'Unknown error'
    });
    process.stderr.write(err.stack || err.message);
    process.exit(1);
  }
}

main();