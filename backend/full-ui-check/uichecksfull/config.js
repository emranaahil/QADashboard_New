const path = require('path');
const { loadRuntimeDevices } = require('../../shared/deviceRuntimeConfig');

const projectRoot = path.resolve(__dirname, '..');

function resolveJobDir() {
  return process.env.QA_JOB_DIR ? path.resolve(process.env.QA_JOB_DIR) : null;
}

/**
 * Paths and skipPdf must be read at access time (getters), not at require-time.
 * runJob.js may require modules that load this config before setting QA_JOB_DIR /
 * QA_REPORT_HTML_PATH / SKIP_PDF — freezing values at load caused HTML/PDF to land
 * in full-ui-check/reports/ while the job runner looked under jobs/<id>/.
 */
module.exports = {
  projectRoot,
  timeout: 60000,
  get reportsRoot() {
    const jobDir = resolveJobDir();
    return jobDir || path.join(projectRoot, 'reports');
  },
  get reportHtmlPath() {
    if (process.env.QA_REPORT_HTML_PATH) {
      return path.resolve(process.env.QA_REPORT_HTML_PATH);
    }
    const jobDir = resolveJobDir();
    return jobDir
      ? path.join(jobDir, 'qa-report.html')
      : path.join(projectRoot, 'reports', 'qa-report.html');
  },
  get reportPdfPath() {
    if (process.env.QA_REPORT_PDF_PATH) {
      return path.resolve(process.env.QA_REPORT_PDF_PATH);
    }
    const jobDir = resolveJobDir();
    return jobDir
      ? path.join(jobDir, 'report.pdf')
      : path.join(projectRoot, 'reports', 'report.pdf');
  },
  // Skip PDF by default in production (saves ~200–300 MB Chromium RAM on Render).
  // Set SKIP_PDF=0 to force PDF generation; SKIP_PDF=1 to force skip in any environment.
  get skipPdf() {
    if (process.env.SKIP_PDF === '0') return false;
    return process.env.SKIP_PDF === '1' || process.env.NODE_ENV === 'production';
  },
  browserLaunch: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--mute-audio',
      '--no-first-run',
      '--disable-sync'
    ]
  },
  get browserRestartEvery() {
    return Number(process.env.QA_BROWSER_RESTART_EVERY || 50);
  },
  get devices() {
    return loadRuntimeDevices([
      { label: 'Desktop', width: 1440, height: 900 }
    ]);
  }
};
