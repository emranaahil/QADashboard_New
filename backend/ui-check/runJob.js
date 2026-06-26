#!/usr/bin/env node
/**
 * UI Check job runner — uses existing runSingleURL pipeline with job-specific paths.
 * Supports multiple comma-separated URLs in one job (single combined report).
 */
const path = require('path');
const fs = require('fs');
const jobStore = require('../shared/jobStore');
const cancelSignal = require('../shared/cancelSignal');

const MODULE_ID = 'ui-check';

function emitProgress(pct, msg, meta = {}) {
  const hasMeta =
    meta.currentPage != null ||
    meta.totalPages != null ||
    meta.currentUrl != null;

  if (hasMeta) {
    const currentPage = meta.currentPage != null ? meta.currentPage : 0;
    const totalPages = meta.totalPages != null ? meta.totalPages : 0;
    const currentUrl = encodeURIComponent(meta.currentUrl || '');
    process.stdout.write(`PROGRESS:${pct}|${currentPage}|${totalPages}|${currentUrl}|${msg}\n`);
    return;
  }

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

  const jobDir = jobStore.getJobDir(MODULE_ID, jobId);
  const urls = resolveJobUrls(job);
  const totalUrls = urls.length;

  cancelSignal.clearCancelled(jobDir);

  process.env.QA_JOB_DIR = jobDir;
  process.env.QA_JOB_MODULE_ID = MODULE_ID;
  process.env.QA_REPORT_HTML_PATH = path.join(jobDir, 'qa-report.html');
  process.env.QA_SCREENSHOT_BASE_URL = `/api/modules/${MODULE_ID}/jobs/${jobId}/screenshots`;
  process.env.SKIP_PDF = '1';

  const { applyJobRuntimeEnv } = require('../shared/services/executionService');
  await applyJobRuntimeEnv(job);

  const handleCancel = async () => {
    cancelSignal.setCancelled(jobDir);
    process.exit(130);
  };

  process.on('SIGTERM', handleCancel);
  process.on('SIGINT', handleCancel);

  try {
    emitProgress(5, 'Launching browser...', {
      currentPage: 0,
      totalPages: totalUrls,
      currentUrl: urls[0]
    });

    const config = require('./config');
    const { launchBrowser } = require('./browser');
    const {
      buildContextOptions,
      getNavigationTimeout
    } = require('../shared/services/browserService');
    const { ensureDir, saveJson } = require('./utils/reportUtils');
    const generateReport = require('./generateReport');
    const uiChecks = require('./uiChecks');

    const runFolder = jobDir;
    const reportFile = path.join(runFolder, 'qaReport.json');
    const screenshotFolder = path.join(runFolder, 'screenshots');
    const reportHtmlPath = path.join(jobDir, 'qa-report.html');

    ensureDir(runFolder);
    ensureDir(screenshotFolder);
    saveJson(reportFile, []);

    const browserType = job.options?.browser || process.env.QA_BROWSER_TYPE || 'chrome';
    const navTimeout = getNavigationTimeout(config.timeout, browserType);
    const browser = await launchBrowser();
    const devices = config.devices || [];
    if (!devices.length) {
      throw new Error('No devices configured for UI check');
    }

    const totalSteps = Math.max(1, devices.length * totalUrls);
    let completedSteps = 0;

    try {
      for (let deviceIndex = 0; deviceIndex < devices.length; deviceIndex++) {
        if (cancelSignal.isCancelled(jobDir)) {
          await handleCancel();
        }

        const device = devices[deviceIndex];
        const viewport = { width: device.width, height: device.height };
        const context = await browser.newContext(
          buildContextOptions(browserType, viewport)
        );
        const page = await context.newPage();

        try {
          for (let urlIndex = 0; urlIndex < urls.length; urlIndex++) {
            if (cancelSignal.isCancelled(jobDir)) {
              await handleCancel();
            }

            const targetUrl = urls[urlIndex];
            const urlNum = urlIndex + 1;
            completedSteps += 1;
            const pct = 10 + Math.round((completedSteps / totalSteps) * 70);

            const progressMessage = totalUrls > 1
              ? `URL ${urlNum}/${totalUrls} — ${device.label}...`
              : `${device.label}...`;
            emitProgress(pct, progressMessage, {
              currentPage: urlNum,
              totalPages: totalUrls,
              currentUrl: targetUrl
            });

            await page.goto(targetUrl, {
              waitUntil: 'domcontentloaded',
              timeout: navTimeout
            });
            await uiChecks(page, {
              runFolder,
              screenshotDir: screenshotFolder,
              scenario: { label: device.label, url: targetUrl },
              viewport: { label: device.label }
            });
          }
        } finally {
          await page.close().catch(() => {});
          await context.close().catch(() => {});
        }
      }
    } finally {
      await browser.close();
    }

    emitProgress(88, 'Generating QA report...', {
      currentPage: totalUrls,
      totalPages: totalUrls,
      currentUrl: urls[urls.length - 1]
    });

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
    if (cancelSignal.isCancelled(jobDir)) {
      await handleCancel();
    }
    process.stderr.write(err.stack || err.message || String(err));
    process.exit(1);
  }
}

main();