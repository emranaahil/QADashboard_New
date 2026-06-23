const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { launchBrowser } = require('./uichecksfull/browser');

const config = require('./uichecksfull/config');
const uiChecks = require('./uichecksfull/uiChecksfull');
const generateReport = require('./uichecksfull/generateReportfull');

const { ensureDir, saveJson, normalizeIssues } = require('./uichecksfull/utils/reportUtils');
const { updateTracker } = require('./tracker');
const { urlToScreenshotFolderName } = require('./urlNormalizer');
const cancelSignal = require('../shared/cancelSignal');
const executionProgress = require('../shared/executionProgress');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function countUrlsInQueue(urlQueuePath) {
  if (!fs.existsSync(urlQueuePath)) return 0;
  let count = 0;
  const lines = fs.readFileSync(urlQueuePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj?.url) count++;
    } catch {
      // skip invalid lines
    }
  }
  return count;
}

function isRetryableError(e) {
  const msg = String(e?.message || e || '').toLowerCase();
  // Heuristic: network/timeouts/navigation issues.
  return (
    msg.includes('timeout') ||
    msg.includes('net::err') ||
    msg.includes('neterror') ||
    msg.includes('econn') ||
    msg.includes('err_t') ||
    msg.includes('navigation') ||
    msg.includes('protocol error')
  );
}

async function runSingleUrl({ browser, url, runId, runFolder, screenshotFolder }) {
  const reportFile = path.join(runFolder, 'qaReport.json');

  // IMPORTANT: do not keep multiple pages open; also keep one browser per run.
  const devices = config.devices || [];

  const allIssuesForUrl = [];
  for (const device of devices) {
    const viewport = { width: device.width, height: device.height };
    const pageName = device.label;

    const urlFolderName = urlToScreenshotFolderName(url);
    const screenshotDirForUrl = path.join(screenshotFolder, urlFolderName);
    ensureDir(screenshotDirForUrl);

    let page;
    try {
      console.log(`[TEST]   Loading page (${device.label}): ${url}`);
      page = await browser.newPage({ viewport });
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeout });
      console.log(`[TEST]   Running checks (${device.label}): ${url}`);

      const result = await uiChecks(page, {
        runFolder,
        screenshotDir: screenshotDirForUrl,
        scenario: { label: pageName, url },
        viewport: { label: device.label },
        httpStatus: response?.status?.() ?? null
      });

      const issues = normalizeIssues(result?.issues || []);
      allIssuesForUrl.push({
        page: pageName,
        url,
        device: device.label,
        issues,
        timestamp: new Date().toISOString(),
        status: issues.length ? 'failed' : 'passed'
      });

      await page.close().catch(() => {});
      page = null;
    } catch (e) {
      const reason = e?.message || String(e);
      allIssuesForUrl.push({
        page: 'Page',
        url,
        device: device.label,
        issues: [`Run failed: ${reason}`],
        timestamp: new Date().toISOString(),
        status: 'failed'
      });

      if (page) await page.close().catch(() => {});
      page = null;
    }
  }

  // NOTE: Do not persist qaReport.json here.
  // uiChecksfull.js is the single source of truth for qaReport.json persistence.
  // Keeping this function focused on Playwright execution + tracker updates avoids
  // duplicate records in queue mode.
  return { ok: true };
}

async function generateFinalArtifacts({ runId, runFolder, screenshotFolder }) {
  const reportFile = path.join(runFolder, 'qaReport.json');
  const reportHtmlPath = config.reportHtmlPath;
  const reportPdfPath = config.reportPdfPath;

  generateReport({
    qaReportPath: reportFile,
    outputHtmlPath: reportHtmlPath,
    screenshotFolder,
    runId
  });

  if (config.skipPdf) {
    console.log('[PDF] Skipped — HTML report at:', reportHtmlPath);
  } else {
    const generatePdf = require('./uichecksfull/generatePdffull');
    await generatePdf({
      htmlPath: reportHtmlPath,
      pdfPath: reportPdfPath
    });
  }
}

async function processUrlQueue({
  seedUrl,
  runId,
  urlQueuePath,
  runFolder,
  screenshotFolder,
  maxRetries = 3,
  resumeLastProcessedUrl = '',
  moduleId = 'full-ui-check'
}) {
  ensureDir(runFolder);
  ensureDir(screenshotFolder);

  const reportFile = path.join(runFolder, 'qaReport.json');
  if (!fs.existsSync(reportFile)) {
    saveJson(reportFile, []);
  }

  const shouldResume = Boolean(resumeLastProcessedUrl);
  let resumeFound = true;

  // Fix 1: resume correctness (two-pass streaming)
  // - First pass: find resumeLastProcessedUrl exists in JSONL
  // - Second pass: if found, start processing AFTER it; if not found, process from beginning.
  if (shouldResume) {
    resumeFound = false;
    const rl1 = readline.createInterface({
      input: fs.createReadStream(urlQueuePath, { encoding: 'utf8' }),
      crlfDelay: Infinity
    });

    for await (const line of rl1) {
      const trimmed = String(line || '').trim();
      if (!trimmed) continue;
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (obj?.url && obj.url === resumeLastProcessedUrl) {
        resumeFound = true;
        break;
      }
    }
  }

  let skipping = shouldResume && resumeFound;
  let processedCount = 0;
  const totalUrls = countUrlsInQueue(urlQueuePath);

  // totalPages is locked once in runJob.js after discovery — do not re-lock here (avoids cross-process write races)

  console.log('\n[TEST] Starting queue processing');
  console.log('[TEST] Total URLs in queue:', totalUrls);
  if (shouldResume) {
    console.log('[TEST] Resume mode:', resumeFound ? `continue after ${resumeLastProcessedUrl}` : 'resume point not found, starting from beginning');
  }
  if (totalUrls === 0) {
    console.log('[TEST] No URLs to test — skipping');
    return;
  }
  console.log('');

  const openBrowser = launchBrowser;

  let browser = await openBrowser();

  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(urlQueuePath, { encoding: 'utf8' }),
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (cancelSignal.isCancelled(runFolder)) {
        console.log('[TEST] Queue aborted — execution cancelled');
        break;
      }

      const trimmed = String(line || '').trim();
      if (!trimmed) continue;

      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch (e) {
        // Fix 2: corrupted JSONL recovery
        console.warn(`[WARN] Invalid JSONL record skipped in ${urlQueuePath}: ${e?.message || e}`);
        updateTracker({
          runId,
          lastProcessedUrl: '',
          status: 'failed',
          failure: {
            url: '',
            reason: 'Invalid JSONL record',
            attempts: 0,
            timestamp: new Date().toISOString()
          }
        });
        continue;
      }

      const url = obj?.url;
      if (!url) continue;

      // Resume skipping: if skipping, ignore until we meet lastProcessedUrl,
      // then start AFTER it.
      if (skipping) {
        if (url === resumeLastProcessedUrl) {
          skipping = false;
        }
        continue; // always skip until we move past resume pointer
      }

      const urlIndex = processedCount + 1;
      console.log(`\n[TEST] Running ${urlIndex}/${totalUrls}: ${url}`);

      let attempt = 0;
      while (attempt < maxRetries) {
        attempt++;
        try {
          if (attempt > 1) {
            console.log(`[TEST] Retry ${attempt}/${maxRetries} for: ${url}`);
          }

          updateTracker({
            runId,
            lastProcessedUrl: url,
            status: 'running'
          });

          await runSingleUrl({
            browser,
            url,
            runId,
            runFolder,
            screenshotFolder
          });

          updateTracker({
            runId,
            lastProcessedUrl: url,
            status: 'completed'
          });

          processedCount++;
          await executionProgress.updatePageProgress(moduleId, runId, {
            currentPage: processedCount,
            currentUrl: url
          });
          console.log(`[TEST] Completed ${processedCount}/${totalUrls}: ${url}`);
          break; // success
        } catch (e) {
          const retryable = isRetryableError(e);
          if (!retryable || attempt >= maxRetries) {
            updateTracker({
              runId,
              lastProcessedUrl: url,
              status: 'failed',
              failure: {
                url,
                reason: e?.message || String(e),
                attempts: attempt,
                timestamp: new Date().toISOString()
              }
            });
            processedCount++;
            await executionProgress.updatePageProgress(moduleId, runId, {
              currentPage: processedCount,
              currentUrl: url
            });
            console.log(`[TEST] Failed ${processedCount}/${totalUrls}: ${url} — ${e?.message || e}`);
            break;
          }

          const delay = 2000 * Math.pow(2, attempt - 1);
          updateTracker({
            runId,
            lastProcessedUrl: url,
            status: 'running',
            attempts: attempt
          });
          await sleep(delay);
        }
      }

      const restartEvery = config.browserRestartEvery || 50;
      if (processedCount > 0 && processedCount % restartEvery === 0) {
        if (browser) await browser.close().catch(() => {});
        browser = await openBrowser();
        global.gc?.();
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  console.log(`\n[TEST] Queue finished — ${processedCount}/${totalUrls} URL(s) processed`);

  if (cancelSignal.isCancelled(runFolder)) {
    console.log('[TEST] Skipping report generation — cancelled');
    return;
  }

  console.log('[TEST] Generating HTML report...\n');

  await generateFinalArtifacts({ runId, runFolder, screenshotFolder });
}

module.exports = {
  processUrlQueue
};
