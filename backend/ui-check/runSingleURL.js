process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION:', err);
});

const path = require('path');
const fs = require('fs');
const { launchBrowser } = require('./browser');
const config = require('./config');

const {
  ensureDir,
  saveJson,
  normalizeIssues
} = require('./utils/reportUtils');

const generateReport = require('./generateReport');
const uiChecks = require('./uiChecks');

async function run() {
  const url = process.argv[2];

  if (!url) {
    console.error('Usage: node runSingleURL.js <url>');
    process.exit(1);
  }

  console.log('🚀 runSingleURL started');
  console.log('URL:', url);
  console.log('Node version:', process.version);
  console.log('Working directory:', process.cwd());

  const devices = config.devices || [];

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runFolder = path.join(config.reportsRoot || 'reports', runId);
  const reportFile = path.join(runFolder, 'qaReport.json');
  const screenshotFolder = path.join(runFolder, 'screenshots');
  const reportHtmlPath = config.reportHtmlPath;

  ensureDir(runFolder);
  ensureDir(screenshotFolder);
  saveJson(reportFile, []);

  const allRuns = [];
  console.log('Launching browser...');
  const browser = await launchBrowser();
  console.log('Browser launched successfully');

  try {
    for (const device of devices) {
      const page = await browser.newPage({
        viewport: { width: device.width, height: device.height }
      });

      console.log(`Starting device: ${device.label}`);
      const pageName = device.label;
      const entryUrl = url;

      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeout
        });
        console.log(`Page loaded successfully: ${url}`);

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

        console.log(
          `uiChecks completed for ${device.label}`,
          'Issues:',
          result?.issues?.length || 0
        );

        const issues = normalizeIssues(result?.issues || []);
        allRuns.push({
          page: pageName,
          url: entryUrl,
          device: device.label,
          issues,
          timestamp: new Date().toISOString(),
          status: issues.length ? 'failed' : 'passed'
        });
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

  console.log('reportHtmlPath =', reportHtmlPath);
  console.log('Generating HTML report...');

  generateReport({
    qaReportPath: reportFile,
    outputHtmlPath: reportHtmlPath,
    screenshotFolder,
    runId
  });

  console.log('HTML report generated');
  console.log('Report exists:', fs.existsSync(reportHtmlPath));

  if (config.skipPdf) {
    console.log('[PDF] Skipped — HTML report at:', reportHtmlPath);
  } else {
    const generatePdf = require('./generatePdf');
    await generatePdf({
      htmlPath: reportHtmlPath,
      pdfPath: config.reportPdfPath
    });
    console.log('PDF exists:', fs.existsSync(config.reportPdfPath));
  }

  const shouldCleanup = String(process.env.QA_CLEANUP_REPORTS || '0') === '1';
  if (shouldCleanup) {
    try {
      const { cleanupReports } = require('./cleanupReports');
      cleanupReports({
        reportsRoot: config.reportsRoot || 'reports',
        keepLastRuns: Number(process.env.KEEP_LAST_RUNS || '10'),
        keepNewerThanDays: Number(process.env.KEEP_NEWER_THAN_DAYS || '30')
      });
    } catch (e) {
      console.error('⚠️ Report cleanup failed:', e?.message || e);
    }
  }

  return {
    success: true,
    reportFile,
    reportHtmlPath,
    allRunsCount: allRuns.length
  };
}

run()
  .then(result => {
    console.log('✅ Done');
    console.log('EXIT CODE: 0');
    console.log('RESULT:', result);
  })
  .catch(e => {
    console.error('❌ runSingleURL failed:', e?.message || e);
    console.log('EXIT CODE: 1');
    process.exit(1);
  });