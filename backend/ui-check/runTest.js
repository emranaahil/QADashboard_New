const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const config = require('./config');
const generateReport = require('./generateReport');
const generatePdf = require('./generatePdf');
const uiChecks = require('./uiChecks');
const {
  ensureDir,
  loadJson,
  saveJson,
  normalizeIssues
} = require('./utils/reportUtils');

async function run() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node runTest.js <url>');
    process.exit(1);
  }

  const devices = config.devices || [];

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runFolder = path.join(config.reportsRoot || 'reports', runId);
  const reportFile = path.join(runFolder, 'qaReport.json');
  const screenshotFolder = path.join(runFolder, 'screenshots');

  ensureDir(runFolder);
  ensureDir(screenshotFolder);

  // Initialize fresh report per run
  saveJson(reportFile, []);


  const allRuns = [];

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  try {
    for (const device of devices) {
      const page = await browser.newPage({
        viewport: { width: device.width, height: device.height }
      });

      const pageName = device.label;
      const entryUrl = url;

      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeout
        });

        const result = await uiChecks(page, {
  runFolder,
  screenshotDir: screenshotFolder,
  scenario: {
    label: pageName,
    url
  },
 viewport: {
  label: device.label
}
});


        // uiChecks.js writes qaReport.json itself in this repo, but we also aggregate here.
        const issues = normalizeIssues(result?.issues || []);
        const record = {
  page: pageName,
  url: entryUrl,
  device: device.label,
  issues,
  timestamp: new Date().toISOString(),
  status: issues.length ? 'failed' : 'passed'
};

        allRuns.push(record);

      } catch (e) {
        console.error(`Device failed: ${device.label}`, e?.message || e);
        allRuns.push({
          page: 'Page',
          url: entryUrl,
          device: device.label,
          issues: [`Run failed: ${e?.message || String(e)}`],
          timestamp: new Date().toISOString(),
          status: 'failed'
        });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
console.log('__dirname =', __dirname);

 

  // Generate HTML
const reportHtmlPath = config.reportHtmlPath;

console.log('__dirname =', __dirname);
 console.log('reportHtmlPath =', reportHtmlPath);
console.log('runId =', runId);
console.log('screenshotFolder =', screenshotFolder);

generateReport({
  qaReportPath: reportFile,
  outputHtmlPath: reportHtmlPath,
  screenshotFolder,
  runId
});

  // Generate PDF
  await generatePdf({
    htmlPath: reportHtmlPath,
    pdfPath: config.reportPdfPath
  });


  // Optional report artifact cleanup (CI only)
  const shouldCleanup = String(process.env.QA_CLEANUP_REPORTS || '0') === '1';
  if (shouldCleanup) {
    try {
      const { cleanupReports } = require('./cleanupReports');
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

  console.log('✅ Done');
}

run().catch(e => {
  console.error('❌ runTest failed:', e?.message || e);
  process.exit(1);
});



