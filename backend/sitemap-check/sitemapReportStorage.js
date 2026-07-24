const path = require('path');
const fs = require('fs-extra');
const { renderSitemapCheckHtml } = require('../shared/radarReportHtml');

const REPORT_JSON = 'sitemapReport.json';
const REPORT_HTML = 'qa-report.html';

async function writeJobArtifacts(jobDir, report) {
  await fs.ensureDir(jobDir);
  const jsonPath = path.join(jobDir, REPORT_JSON);
  const htmlPath = path.join(jobDir, REPORT_HTML);

  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(htmlPath, renderSitemapCheckHtml(report), 'utf8');

  return {
    jsonPath,
    htmlPath,
    reportPath: `jobs/${path.basename(jobDir)}/${REPORT_HTML}`
  };
}

module.exports = {
  REPORT_JSON,
  REPORT_HTML,
  writeJobArtifacts
};