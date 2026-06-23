const path = require('path');

const projectRoot = path.resolve(__dirname);
const jobDir = process.env.QA_JOB_DIR ? path.resolve(process.env.QA_JOB_DIR) : null;

module.exports = {
  projectRoot,
  timeout: 60000,
  reportsRoot: jobDir || path.join(projectRoot, 'reports'),
  reportHtmlPath: process.env.QA_REPORT_HTML_PATH
    ? path.resolve(process.env.QA_REPORT_HTML_PATH)
    : jobDir
      ? path.join(jobDir, 'qa-report.html')
      : path.join(projectRoot, 'reports', 'qa-report.html'),
  reportPdfPath: process.env.QA_REPORT_PDF_PATH
    ? path.resolve(process.env.QA_REPORT_PDF_PATH)
    : path.join(projectRoot, 'reports', 'report.pdf'),
  skipPdf:
    process.env.SKIP_PDF === '0'
      ? false
      : process.env.SKIP_PDF === '1' || process.env.NODE_ENV === 'production',
  browserLaunch: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  },
  devices: (() => {
    if (process.env.QA_DEVICES_JSON) {
      try {
        const parsed = JSON.parse(process.env.QA_DEVICES_JSON);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch { /* fall through to defaults */ }
    }
    return [
      { label: 'Desktop', width: 1440, height: 900 }
      //{ label: 'Tablet', width: 768, height: 1024 },
      //{ label: 'Mobile', width: 390, height: 844 }
    ];
  })()
};


