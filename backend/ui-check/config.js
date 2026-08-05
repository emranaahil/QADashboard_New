const path = require('path');
const { loadRuntimeDevices } = require('../shared/deviceRuntimeConfig');

const projectRoot = path.resolve(__dirname);

function resolveJobDir() {
  return process.env.QA_JOB_DIR ? path.resolve(process.env.QA_JOB_DIR) : null;
}

/**
 * Path/skip flags resolved at access time so job runners can set QA_JOB_DIR /
 * QA_REPORT_HTML_PATH before report generation even if this module was required early.
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
    return path.join(projectRoot, 'reports', 'report.pdf');
  },
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
      '--disable-gpu'
    ]
  },
  get devices() {
    return loadRuntimeDevices([
      { label: 'Desktop', width: 1440, height: 900 },
      { label: 'Tablet_Portrait', width: 768, height: 1024 },
      { label: 'iPhone13_Portrait', width: 390, height: 844 }
    ]);
  }
};
