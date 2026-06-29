#!/usr/bin/env node
/**
 * SEO job runner — invoked by job queue. Uses existing uiseocheck engine.
 */
const jobStore = require('../shared/jobStore');
const { runSeoAudit } = require('./uiseocheck');
const { makeRunId, writeRunArtifacts } = require('./seoReportStorage');

const MODULE_ID = 'seo';

function emitProgress(pct, msg) {
  process.stdout.write(`PROGRESS:${pct} ${msg}\n`);
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

    emitProgress(20, 'Running SEO checks...');
    const report = await runSeoAudit({ mainUrl: job.url, mode });

    emitProgress(85, 'Generating QA report...');
    const seoReport = {
      mainUrl: report.meta.mainUrl,
      scanDate: new Date().toISOString(),
      sitemapUsed: report.meta.sitemapUsed,
      urlsAttempted: report.meta.urlsAttempted,
      concurrency: report.meta.concurrency,
      timeoutMs: report.meta.timeoutMs,
      pages: report.pages,
      summary: report.summary
    };

    const html = report.htmlReport;
    if (!html || typeof html !== 'string') {
      throw new Error('SEO audit did not produce HTML report');
    }

    const runId = makeRunId();
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