#!/usr/bin/env node
/**
 * UI Check job runner — uses existing runSingleURL pipeline with job-specific paths.
 */
const path = require('path');
const fs = require('fs');
const jobStore = require('../shared/jobStore');

const MODULE_ID = 'ui-check';

function emitProgress(pct, msg) {
  process.stdout.write(`PROGRESS:${pct} ${msg}\n`);
}

async function main() {
  const jobId = process.argv[2] || process.env.JOB_ID;
  if (!jobId) process.exit(1);

  const job = await jobStore.getJob(MODULE_ID, jobId);
  if (!job) process.exit(1);

  const jobDir = jobStore.getJobDir(MODULE_ID, jobId);

  process.env.QA_JOB_DIR = jobDir;
  process.env.QA_JOB_MODULE_ID = MODULE_ID;
  process.env.QA_REPORT_HTML_PATH = path.join(jobDir, 'qa-report.html');
  process.env.QA_SCREENSHOT_BASE_URL = `/api/modules/${MODULE_ID}/jobs/${jobId}/screenshots`;
  process.env.SKIP_PDF = '1';

    const { applyJobRuntimeEnv } = require('../shared/services/executionService');
    await applyJobRuntimeEnv(job);

    try {
      emitProgress(5, 'Launching browser...');
      await jobStore.updateJob(MODULE_ID, jobId, { progress: 5, message: 'Launching browser...' });

      const config = require('./config');
      const { launchBrowser } = require('./browser');
    const { ensureDir, saveJson, normalizeIssues } = require('./utils/reportUtils');
    const generateReport = require('./generateReport');
    const uiChecks = require('./uiChecks');

    const runFolder = jobDir;
    const reportFile = path.join(runFolder, 'qaReport.json');
    const screenshotFolder = path.join(runFolder, 'screenshots');
    const reportHtmlPath = path.join(jobDir, 'qa-report.html');

    ensureDir(runFolder);
    ensureDir(screenshotFolder);
    saveJson(reportFile, []);

    emitProgress(15, 'Loading page...');
    const browser = await launchBrowser();
    const devices = config.devices || [];
    if (!devices.length) {
      throw new Error('No devices configured for UI check');
    }

    try {
      for (let i = 0; i < devices.length; i++) {
        const device = devices[i];
        const pct = 20 + Math.round((i / devices.length) * 55);
        emitProgress(pct, `Testing ${device.label}...`);

        const page = await browser.newPage({
          viewport: { width: device.width, height: device.height }
        });

        try {
          await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: config.timeout });
          await uiChecks(page, {
            runFolder,
            screenshotDir: screenshotFolder,
            scenario: { label: device.label, url: job.url },
            viewport: { label: device.label }
          });
        } finally {
          await page.close().catch(() => {});
        }
      }
    } finally {
      await browser.close();
    }

    emitProgress(85, 'Generating QA report...');
    generateReport({
      qaReportPath: reportFile,
      outputHtmlPath: reportHtmlPath,
      screenshotFolder,
      runId: jobId,
      moduleId: MODULE_ID
    });

    if (!fs.existsSync(reportHtmlPath)) {
      throw new Error('Report generation failed — qa-report.html not created');
    }

    emitProgress(100, 'Completed');
    process.exit(0);
  } catch (err) {
    await jobStore.updateJob(MODULE_ID, jobId, {
      status: 'failed',
      message: 'UI check failed',
      error: err.message || 'Unknown error'
    });
    process.stderr.write(err.stack || err.message);
    process.exit(1);
  }
}

main();