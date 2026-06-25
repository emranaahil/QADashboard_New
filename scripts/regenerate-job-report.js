#!/usr/bin/env node
/**
 * Regenerate qa-report.html for an existing job from qaReport.json.
 * Usage: node scripts/regenerate-job-report.js full-ui-check <jobId>
 */
const path = require('path');
const fs = require('fs');

const moduleId = process.argv[2];
const jobId = process.argv[3];

if (!moduleId || !jobId) {
  console.error('Usage: node scripts/regenerate-job-report.js <moduleId> <jobId>');
  process.exit(1);
}

const jobStore = require('../backend/shared/jobStore');
const jobDir = jobStore.getJobDir(moduleId, jobId);

if (!fs.existsSync(path.join(jobDir, 'qaReport.json'))) {
  console.error('qaReport.json not found for job:', jobId);
  process.exit(1);
}

process.env.QA_JOB_DIR = jobDir;
process.env.QA_JOB_MODULE_ID = moduleId;
process.env.QA_REPORT_HTML_PATH = path.join(jobDir, 'qa-report.html');
process.env.QA_SCREENSHOT_BASE_URL = `/api/modules/${moduleId}/jobs/${jobId}/screenshots`;

const generateReport = moduleId === 'full-ui-check'
  ? require('../backend/full-ui-check/uichecksfull/generateReportfull')
  : require('../backend/ui-check/generateReport');

const output = generateReport({
  qaReportPath: path.join(jobDir, 'qaReport.json'),
  outputHtmlPath: path.join(jobDir, 'qa-report.html'),
  screenshotFolder: path.join(jobDir, 'screenshots'),
  runId: jobId,
  moduleId
});

console.log('Regenerated:', output);