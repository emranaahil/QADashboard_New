#!/usr/bin/env node
/**
 * Visual Twin job runner — compare reference site vs candidate clone.
 */
const path = require('path');
const fs = require('fs-extra');
const jobStore = require('../shared/jobStore');
const cancelSignal = require('../shared/cancelSignal');

const MODULE_ID = 'visual-twin';

function emitProgress(pct, msg, meta = {}) {
  const hasMeta = meta.currentPage != null || meta.totalPages != null || meta.currentUrl != null;
  const line = hasMeta
    ? `PROGRESS:${pct}|${meta.currentPage || 0}|${meta.totalPages || 0}|${encodeURIComponent(meta.currentUrl || '')}|${msg}\n`
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

  process.env.QA_JOB_DIR = jobDir;
  process.env.QA_JOB_MODULE_ID = MODULE_ID;
  process.env.QA_REPORT_HTML_PATH = path.join(jobDir, 'qa-report.html');
  process.env.QA_SCREENSHOT_BASE_URL = `/api/modules/${MODULE_ID}/jobs/${jobId}/screenshots`;
  process.env.SKIP_PDF = '1';

  const { applyJobRuntimeEnv } = require('../shared/services/executionService');
  await applyJobRuntimeEnv(job);

  if (job.options?.includeContactHyperlinks === true) {
    process.env.QA_CHECK_CONTACT_HYPERLINKS = '1';
    const len = parseInt(job.options.phoneDigitLength, 10);
    process.env.QA_PHONE_DIGIT_LENGTH = String(
      Number.isFinite(len) && len >= 7 && len <= 15 ? len : 10
    );
  } else {
    process.env.QA_CHECK_CONTACT_HYPERLINKS = '0';
  }

  const handleCancel = async () => {
    cancelSignal.setCancelled(jobDir);
    process.exit(130);
  };
  process.on('SIGTERM', handleCancel);
  process.on('SIGINT', handleCancel);

  try {
    const { launchBrowser } = require('../ui-check/browser');
    const {
      comparePagePair,
      mapReferencePathToCandidate,
      discoverReferenceUrls
    } = require('./compareEngine');
    const { generateReport } = require('./generateReport');
    const { loadRuntimeDevices } = require('../shared/deviceRuntimeConfig');

    const mode = job.options?.mode === 'full' ? 'full' : 'single';
    const referenceBase = job.options?.referenceUrl || job.url;
    const candidateBase = job.options?.candidateUrl;
    if (!candidateBase) {
      throw new Error('candidateUrl is required in job options');
    }

    const browserType = job.options?.browser || process.env.QA_BROWSER_TYPE || 'chrome';
    let devices = [];
    if (Array.isArray(job.options?._resolvedDevices) && job.options._resolvedDevices.length) {
      devices = job.options._resolvedDevices.map((d) => ({
        label: d.label || d.name || 'Desktop',
        width: d.width || 1440,
        height: d.height || 900
      }));
    } else {
      devices = loadRuntimeDevices([
        { label: 'Desktop', width: 1440, height: 900 }
      ]);
    }
    if (!devices.length) {
      devices = [{ label: 'Desktop', width: 1440, height: 900 }];
    }

    const screenshotDir = path.join(jobDir, 'screenshots');
    await fs.ensureDir(screenshotDir);
    await fs.ensureDir(jobDir);

    emitProgress(5, 'Launching browser...', {
      currentPage: 0,
      totalPages: 1,
      currentUrl: referenceBase
    });

    const browser = await launchBrowser();
    const pairs = [];
    let pairIndex = 0;

    try {
      let referenceUrls = [];
      if (mode === 'full') {
        const maxPages = Math.min(
          Math.max(parseInt(job.options?.maxPages, 10) || 20, 1),
          100
        );
        emitProgress(10, `Discovering reference pages (max ${maxPages})...`, {
          currentPage: 0,
          totalPages: maxPages,
          currentUrl: referenceBase
        });
        if (Array.isArray(job.options?.urls) && job.options.urls.length) {
          referenceUrls = job.options.urls.slice(0, maxPages);
        } else {
          referenceUrls = await discoverReferenceUrls(
            browser,
            referenceBase,
            maxPages,
            browserType
          );
        }
        if (!referenceUrls.length) referenceUrls = [referenceBase];
      } else {
        // Single: one pair (or list of reference paths mapped to candidate)
        if (Array.isArray(job.options?.urls) && job.options.urls.length > 1) {
          referenceUrls = job.options.urls.slice(0, 50);
        } else {
          referenceUrls = [referenceBase];
        }
      }

      const totalSteps = Math.max(1, referenceUrls.length * devices.length);
      let done = 0;

      for (const device of devices) {
        for (const refUrl of referenceUrls) {
          if (cancelSignal.isCancelled(jobDir)) await handleCancel();

          const candUrl =
            mode === 'full' || referenceUrls.length > 1
              ? mapReferencePathToCandidate(refUrl, candidateBase)
              : candidateBase;

          done += 1;
          pairIndex += 1;
          const pct = 12 + Math.round((done / totalSteps) * 75);
          emitProgress(pct, `Comparing pair ${done}/${totalSteps}…`, {
            currentPage: done,
            totalPages: totalSteps,
            currentUrl: refUrl
          });

          const pair = await comparePagePair({
            browser,
            referenceUrl: refUrl,
            candidateUrl: candUrl,
            viewport: device,
            browserType,
            screenshotDir,
            pairIndex,
            checkContactHyperlinks: job.options?.includeContactHyperlinks === true,
            phoneDigitLength: job.options?.phoneDigitLength
          });
          pairs.push(pair);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }

    emitProgress(90, 'Generating report...', {
      currentPage: pairs.length,
      totalPages: pairs.length,
      currentUrl: candidateBase
    });

    const result = {
      moduleId: MODULE_ID,
      mode,
      referenceBase,
      candidateBase,
      generatedAt: new Date().toISOString(),
      pairs,
      summary: {
        pairCount: pairs.length,
        averageMatch:
          pairs.length > 0
            ? Math.round(pairs.reduce((a, p) => a + (p.matchScore || 0), 0) / pairs.length)
            : 0,
        totalIssues: pairs.reduce((a, p) => a + (p.issues?.length || 0), 0),
        weakPairs: pairs.filter((p) => (p.matchScore || 0) < 80).length
      }
    };

    const reportJsonPath = path.join(jobDir, 'qaReport.json');
    const reportHtmlPath = path.join(jobDir, 'qa-report.html');
    await fs.writeJson(reportJsonPath, result, { spaces: 2 });

    generateReport({
      result,
      outputHtmlPath: reportHtmlPath,
      screenshotBaseUrl: process.env.QA_SCREENSHOT_BASE_URL
        ? `${process.env.QA_SCREENSHOT_BASE_URL}/`
        : ''
    });

    if (!(await fs.pathExists(reportHtmlPath))) {
      throw new Error('Report generation failed — qa-report.html not created');
    }

    emitProgress(100, 'Completed');
    process.exit(0);
  } catch (err) {
    if (cancelSignal.isCancelled(jobDir)) await handleCancel();
    process.stderr.write(err.stack || err.message || String(err));
    process.exit(1);
  }
}

main();
