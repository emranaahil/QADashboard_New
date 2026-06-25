#!/usr/bin/env node
/**
 * Remove all saved reports and job artifacts across every QA module.
 * Preserves directory structure (.gitkeep) and module code.
 *
 * Usage: node scripts/clear-all-reports.js
 */
const fs = require('fs-extra');
const path = require('path');
const {
  moduleJobsDir,
  moduleReportsDir,
  keywordStorageDir,
  BACKEND_ROOT
} = require('../backend/shared/storagePaths');

const JOB_MODULES = ['ui-check', 'full-ui-check', 'seo'];
const REPORT_FILE_NAMES = new Set([
  'qa-report.html',
  'qaReport.json',
  'seoReport.json',
  'report.pdf',
  'job.json',
  'job.log'
]);

const stats = {
  jobDirsRemoved: 0,
  reportFilesRemoved: 0,
  reportDirsRemoved: 0,
  keywordScansRemoved: 0,
  keywordPdfsRemoved: 0,
  errorChecksRemoved: 0
};

async function removeEntry(target) {
  await fs.remove(target);
}

async function clearJobModule(moduleId) {
  const jobsDir = moduleJobsDir(moduleId);
  if (!await fs.pathExists(jobsDir)) return;

  const entries = await fs.readdir(jobsDir);
  for (const entry of entries) {
    if (entry === '.gitkeep') continue;
    const full = path.join(jobsDir, entry);
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      await removeEntry(full);
      stats.jobDirsRemoved++;
    } else {
      await removeEntry(full);
      stats.reportFilesRemoved++;
    }
  }
}

async function clearModuleReports(moduleId) {
  const reportsDir = moduleReportsDir(moduleId);
  if (!await fs.pathExists(reportsDir)) return;

  const entries = await fs.readdir(reportsDir);
  for (const entry of entries) {
    if (entry === '.gitkeep' || entry.startsWith('.')) continue;
    const full = path.join(reportsDir, entry);
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      await removeEntry(full);
      stats.reportDirsRemoved++;
    } else if (REPORT_FILE_NAMES.has(entry) || entry.endsWith('.html') || entry.endsWith('.json') || entry.endsWith('.pdf')) {
      await removeEntry(full);
      stats.reportFilesRemoved++;
    }
  }
}

async function clearKeywordStorage() {
  for (const sub of ['scans', 'reports', 'checkpoints']) {
    const dir = keywordStorageDir(sub);
    if (!await fs.pathExists(dir)) continue;
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (entry === '.gitkeep') continue;
      const full = path.join(dir, entry);
      await removeEntry(full);
      if (sub === 'scans') stats.keywordScansRemoved++;
      if (sub === 'reports') stats.keywordPdfsRemoved++;
    }
  }
}

async function clearErrorCheckReports() {
  const dir = moduleReportsDir('error-check');
  if (!await fs.pathExists(dir)) return;
  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    if (entry === '.gitkeep') continue;
    const full = path.join(dir, entry);
    await removeEntry(full);
    stats.errorChecksRemoved++;
  }
}

async function main() {
  console.log(`Clearing all module reports under ${BACKEND_ROOT} ...`);

  for (const moduleId of JOB_MODULES) {
    await clearJobModule(moduleId);
    await clearModuleReports(moduleId);
  }

  await clearKeywordStorage();
  await clearErrorCheckReports();

  console.log('Done.');
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});