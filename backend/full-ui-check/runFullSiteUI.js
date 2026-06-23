process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION:', err);
});

const path = require('path');
const fs = require('fs');
const { launchBrowser } = require('./uichecksfull/browser');
const config = require('./uichecksfull/config');

const {
  ensureDir,
  loadJson,
  saveJson,
  normalizeIssues
} = require('./uichecksfull/utils/reportUtils');

const generateReport = require('./uichecksfull/generateReportfull');

const uiChecks = require('./uichecksfull/uiChecksfull');


const { discoverURL } = require('./discoverURL');
const { processUrlQueue } = require('./queueManager');
const { getResumeState } = require('./resumeManager');
const { updateTracker } = require('./tracker');

function safeRunIdFromDate() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function createRunId() {
  return safeRunIdFromDate();
}

function parseArgs() {
  const args = process.argv.slice(2);
  // Supported:
  // - node runFullSiteUI.js <seedUrl>            (defaults to queue)
  // - node runFullSiteUI.js <seedUrl> queue
  // - node runFullSiteUI.js <seedUrl> local
  // - node runFullSiteUI.js --resume <runId>
  const out = {
    seedUrl: null,
    mode: 'queue',
    resume: false,
    resumeRunId: null
  };

  if (args[0] === '--resume') {
    out.resume = true;
    out.resumeRunId = args[1] ? String(args[1]) : null;
    return out;
  }

  out.seedUrl = args[0] ? String(args[0]) : null;
  const modeArg = String(args[1] || 'queue').toLowerCase();
  out.mode = modeArg === 'local' ? 'local' : 'queue';
  return out;
}

async function run(){
  const args = parseArgs();

  // RESUME mode: continue sequential processing from lastProcessedUrl
  if (args.resume) {
    if (!args.resumeRunId) {
      console.error('Usage: node runFullSiteUI.js --resume <runId>');
      process.exit(1);
    }

    const runId = args.resumeRunId;
    const runFolder = path.join(config.reportsRoot || 'reports', runId);
    const screenshotFolder = path.join(runFolder, 'screenshots');
    const urlQueuePath = path.join(runFolder, 'urlQueue.jsonl');

    if (!fs.existsSync(urlQueuePath)) {
      console.error(`[RESUME] Missing urlQueue.jsonl at: ${urlQueuePath}`);
      process.exit(1);
    }

    const resumeState = await getResumeState({ runId });
    console.log('🚀 runTest(resume) started');
    console.log('runId:', runId);
    console.log('lastProcessedUrl:', resumeState.lastProcessedUrl || '');
    console.log('queue:', urlQueuePath);

    // Mark tracker runId (idempotent-ish)
    updateTracker({ runId, status: 'queued', pending: 0, lastProcessedUrl: resumeState.lastProcessedUrl || '' });

    // We process the queue sequentially; queueManager will handle retries and updates.
    // Resume skipping is implemented by passing lastProcessedUrl and having queueManager skip lines.
    const { processUrlQueue: _processUrlQueue } = require('./queueManager');
    await _processUrlQueue({
      seedUrl: null,
      runId,
      urlQueuePath,
      runFolder,
      screenshotFolder,
      maxRetries: 3,
      resumeLastProcessedUrl: resumeState.lastProcessedUrl || ''
    });

    console.log('✅ Resume done');
    return { success: true, mode: 'resume', runId };
  }

  // QUEUE mode: discover URL -> strict normalization+filtering+dedupe -> urlQueue.jsonl -> sequential processing
  if (args.mode === 'queue') {
    const seedUrl = args.seedUrl;
    if (!seedUrl) {
      console.error('Usage: node runFullSiteUI.js <seedUrl> queue');
      process.exit(1);
    }

    const runId = createRunId();
    const runFolder = path.join(config.reportsRoot || 'reports', runId);
    const screenshotFolder = path.join(runFolder, 'screenshots');
    const urlQueuePath = path.join(runFolder, 'urlQueue.jsonl');

    ensureDir(runFolder);
    ensureDir(screenshotFolder);

    console.log('🚀 runTest(queue) started');
    console.log('runId:', runId);
    console.log('seedUrl:', seedUrl);
    console.log('urlQueuePath:', urlQueuePath);

    // Initialize tracker
    updateTracker({ runId, lastProcessedUrl: '' , status: 'queued', delta: { pending: 0 } });

    // Crawl/discover and write urlQueue.jsonl (memory safe)
    const crawlConfig = require('./crawlConfig');
    const { discoverURL: _discoverURL } = require('./discoverURL');
    const discovery = await _discoverURL({
      seedUrl,
      runId,
      urlQueuePath,
      runFolder,
      crawlConfig
    });

    console.log(`✅ Crawl/discovery done — ${discovery?.discovered ?? 0} URL(s) queued for testing`);

    // Sequentially process urlQueue.jsonl
    await processUrlQueue({
      seedUrl,
      runId,
      urlQueuePath,
      runFolder,
      screenshotFolder,
      maxRetries: 3
    });

    console.log('✅ Queue run done');
    return { success: true, mode: 'queue', runId };
  }

  const rawArg = args.seedUrl;

  if (!rawArg) {
    console.error('Usage: node runFullSiteUI.js <url> OR node runFullSiteUI.js <url1,url2,...>');
    process.exit(1);
  }

  // Support both:
  //  - node runFullSiteUI.js https://example.com
  //  - node runFullSiteUI.js url1,url2,url3
  //  - node runFullSiteUI.js "[\"url1\",\"url2\"]" (array passed as string)
  let urls = [];
  const trimmed = String(rawArg).trim();
  if (!trimmed) {
    console.error('No URL(s) provided');
    process.exit(1);
  }

  // Try JSON array first
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) urls = arr.map(u => String(u)).filter(Boolean);
    } catch {
      // fallback to comma split
    }
  }

  // Comma-separated
  if (urls.length === 0 && trimmed.includes(',')) {
    urls = trimmed.split(',').map(u => u.trim()).filter(Boolean);
  }

  // Single URL
  if (urls.length === 0) {
    urls = [trimmed];
  }

  // Hard limit
  const MAX_URLS = 100;
  if (urls.length > MAX_URLS) {
    console.error(`Too many URLs provided (${urls.length}). Maximum allowed is ${MAX_URLS}.`);
    process.exit(1);
  }

  const devices = config.devices || [];

  console.log('\n[TEST] Local run started');
  console.log('[TEST] Total URLs to test:', urls.length);
  urls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  console.log('');


  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runFolder = path.join(config.reportsRoot || 'reports', runId);
  const reportFile = path.join(runFolder, 'qaReport.json');
  const screenshotFolder = path.join(runFolder, 'screenshots');

  ensureDir(runFolder);
  ensureDir(screenshotFolder);

  // Initialize fresh report per run
  saveJson(reportFile, []);


  // Browser init must be the only fatal failure point
  const browser = await launchBrowser();

  const MAX_CONCURRENT_PAGES = 1;
  const BATCH_SIZE = 10;


  try {
    // Process URL batches
    for (let batchStart = 0; batchStart < urls.length; batchStart += BATCH_SIZE) {
      const batchIndex = Math.floor(batchStart / BATCH_SIZE) + 1;
      const batchEnd = Math.min(urls.length, batchStart + BATCH_SIZE);
      const batchUrls = urls.slice(batchStart, batchEnd);

      console.log(`Batch ${batchIndex}/${Math.ceil(urls.length / BATCH_SIZE)}: URLs ${batchStart + 1}–${batchEnd}`);
      console.log(`  Starting batch ${batchIndex} (${batchEnd - batchStart} URL(s))`);


      // Process URLs within batch with max 2 concurrent pages.
      // We implement a tiny worker pool where each worker consumes next URL sequentially.
      let nextUrlIdx = 0;
      const workers = new Array(Math.min(MAX_CONCURRENT_PAGES, batchUrls.length)).fill(0).map(async () => {
        while (true) {
          const idx = nextUrlIdx++;
          if (idx >= batchUrls.length) return;

          const entryUrl = batchUrls[idx];
          const globalUrlIndex = batchStart + idx + 1;
          console.log(`\n[TEST] Running ${globalUrlIndex}/${urls.length}: ${entryUrl}`);

          // For each URL, run all configured devices sequentially.
          // Within a URL, we create/close pages immediately, so no more than 2 pages exist globally.
          for (const device of devices) {
            const viewport = { width: device.width, height: device.height };
            const pageName = device.label;

            // Per-URL screenshot folder to avoid overwrites.
            const urlFolderName = `url-${String(idx + batchStart + 1)}`;
            const screenshotDirForUrl = path.join(screenshotFolder, urlFolderName);
            ensureDir(screenshotDirForUrl);

            let page;
            try {
              console.log(`  Starting ${device.label}`);
              page = await browser.newPage({ viewport });

              // Use uiChecks for everything else; keep goto here as existing behavior.
              const response = await page.goto(entryUrl, {
                waitUntil: 'domcontentloaded',
                timeout: config.timeout
              });

              const result = await uiChecks(page, {
                runFolder,
                screenshotDir: screenshotDirForUrl,
                scenario: {
                  label: pageName,
                  url: entryUrl
                },
                viewport: {
                  label: device.label
                },
                httpStatus: response?.status?.() ?? null
              });

              console.log(`[TEST] Completed ${globalUrlIndex}/${urls.length}: ${entryUrl} (${device.label})`);

              // Memory optimization
              await page.close().catch(() => {});
              page = null;
              global.gc?.();
            } catch (e) {
              const reason = e?.message || String(e);
              console.error(`URL failed: ${entryUrl}`);
              console.error(`Reason: ${reason}`);

              if (page) await page.close().catch(() => {});
              page = null;
              global.gc?.();

              // Continue to next device/URL
            }
          }
        }
      });

      await Promise.all(workers);

      // After each batch, encourage GC
      global.gc?.();

      // Ensure we don't retain memory unnecessarily
    }
  } finally {
    await browser.close();
  }

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
  // Optional report artifact cleanup (CI only)
  const shouldCleanup = String(process.env.QA_CLEANUP_REPORTS || '0') === '1';
  if (shouldCleanup) {
    try {
      const { cleanupReports } = require('./uichecksfull/cleanupReports');
      const keepLastRuns = Number(process.env.KEEP_LAST_RUNS || '10');
      const keepNewerThanDays = Number(process.env.KEEP_NEWER_THAN_DAYS || '30');

      cleanupReports({
        reportsRoot: config.reportsRoot || 'reports',
        keepLastRuns,
        keepNewerThanDays
      });
    } catch (e) {
      // Never fail QA run due to cleanup
      console.error('⚠️ Report cleanup failed:', e?.message || e);
    }
  }
  return {
    success: true,
    reportFile,
    reportHtmlPath
  };
}

run()
  .then(result => {
    console.log('✅ Done');
    console.log('EXIT CODE: 0');
    console.log('RESULT:', result);
  })
  .catch(e => {
    console.error('❌ runTest failed:', e?.message || e);
    console.log('EXIT CODE: 1');
    process.exit(1);
  });


