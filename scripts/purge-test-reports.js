#!/usr/bin/env node
/**
 * Remove test artifacts targeting example.com (all statuses) and cancelled example.com scans.
 *
 * Usage: node scripts/purge-test-reports.js
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
const TEST_HOST = 'example.com';
const stats = {
  jobDirsRemoved: 0,
  errorReportsRemoved: 0,
  keywordScansRemoved: 0,
  keywordCheckpointsRemoved: 0,
  keywordPdfsRemoved: 0,
  seoReportDirsRemoved: 0,
  orphanFilesRemoved: 0,
  testExecutionKeysRemoved: 0
};

function hostFromUrl(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return String(url).replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').toLowerCase();
  }
}

function isExampleUrl(url) {
  return hostFromUrl(url) === TEST_HOST;
}

async function purgeExampleComJobs() {
  for (const moduleId of JOB_MODULES) {
    const jobsDir = moduleJobsDir(moduleId);
    if (!await fs.pathExists(jobsDir)) continue;

    for (const entry of await fs.readdir(jobsDir)) {
      if (entry === '.gitkeep') continue;
      const jobDir = path.join(jobsDir, entry);
      const jobPath = path.join(jobDir, 'job.json');
      if (!await fs.pathExists(jobPath)) continue;

      let job;
      try {
        job = await fs.readJson(jobPath);
      } catch {
        continue;
      }

      if (!isExampleUrl(job.url)) continue;
      await fs.remove(jobDir);
      stats.jobDirsRemoved++;
      console.log(`Removed ${moduleId} job ${entry} (${job.status}, ${job.url})`);
    }
  }
}

async function purgeErrorCheckReports() {
  const dir = moduleReportsDir('error-check');
  if (!await fs.pathExists(dir)) return;

  for (const entry of await fs.readdir(dir)) {
    if (entry === '.gitkeep') continue;
    const full = path.join(dir, entry);
    if (!(await fs.stat(full)).isFile() || !entry.endsWith('.json')) continue;

    let data;
    try {
      data = await fs.readJson(full);
    } catch {
      continue;
    }

    if (!isExampleUrl(data.url)) continue;
    await fs.remove(full);
    stats.errorReportsRemoved++;
    console.log(`Removed error-check report ${entry}`);
  }
}

async function purgeKeywordScans() {
  const scansDir = keywordStorageDir('scans');
  const checkpointsDir = keywordStorageDir('checkpoints');
  const pdfDir = keywordStorageDir('reports');
  const removedScanIds = new Set();

  if (await fs.pathExists(scansDir)) {
    for (const entry of await fs.readdir(scansDir)) {
      if (entry === '.gitkeep' || !entry.endsWith('.json')) continue;
      const full = path.join(scansDir, entry);
      let data;
      try {
        data = await fs.readJson(full);
      } catch {
        continue;
      }

      if (!isExampleUrl(data.url)) continue;

      const scanId = data.id || entry.replace(/\.json$/, '');
      removedScanIds.add(scanId);
      await fs.remove(full);
      stats.keywordScansRemoved++;
      console.log(`Removed keyword scan ${entry} (${data.status}, ${data.url})`);
    }
  }

  if (await fs.pathExists(checkpointsDir)) {
    for (const entry of await fs.readdir(checkpointsDir)) {
      if (entry === '.gitkeep' || !entry.endsWith('.json')) continue;
      const scanId = entry.replace(/\.json$/, '');
      if (!removedScanIds.has(scanId)) continue;
      await fs.remove(path.join(checkpointsDir, entry));
      stats.keywordCheckpointsRemoved++;
    }
  }

  if (await fs.pathExists(pdfDir)) {
    for (const scanId of removedScanIds) {
      const pdf = path.join(pdfDir, `keyword-audit-report-${scanId}.pdf`);
      if (await fs.pathExists(pdf)) {
        await fs.remove(pdf);
        stats.keywordPdfsRemoved++;
      }
    }
  }
}

async function purgeSeoReportDirs() {
  const reportsDir = moduleReportsDir('seo');
  if (!await fs.pathExists(reportsDir)) return;

  for (const entry of await fs.readdir(reportsDir)) {
    if (entry === '.gitkeep' || entry.startsWith('.')) continue;
    const dir = path.join(reportsDir, entry);
    if (!(await fs.stat(dir)).isDirectory()) continue;

    const jsonPath = path.join(dir, 'seoReport.json');
    if (!await fs.pathExists(jsonPath)) continue;

    let data;
    try {
      data = await fs.readJson(jsonPath);
    } catch {
      continue;
    }

    const mainUrl = data.meta?.mainUrl || data.mainUrl || data.url;
    if (!isExampleUrl(mainUrl)) continue;

    await fs.remove(dir);
    stats.seoReportDirsRemoved++;
    console.log(`Removed SEO report dir ${entry}`);
  }
}

async function purgeOrphanFullUiReport() {
  const orphan = path.join(BACKEND_ROOT, 'full-ui-check', 'qa-report.html');
  if (!await fs.pathExists(orphan)) return;
  const html = await fs.readFile(orphan, 'utf8');
  if (!html.includes('example.com')) return;
  await fs.remove(orphan);
  stats.orphanFilesRemoved++;
  console.log('Removed orphan full-ui-check/qa-report.html');
}

async function cleanTestExecutions() {
  const filePath = path.join(BACKEND_ROOT, 'shared', 'data', 'test-executions.json');
  if (!await fs.pathExists(filePath)) return;

  const data = await fs.readJson(filePath);
  let changed = false;
  for (const [key, value] of Object.entries(data)) {
    const purge = key.includes(`:${TEST_HOST}`) || isExampleUrl(value?.url);
    if (purge) {
      delete data[key];
      stats.testExecutionKeysRemoved++;
      changed = true;
    }
  }

  if (changed) {
    await fs.writeJson(filePath, data, { spaces: 2 });
    console.log('Updated backend/shared/data/test-executions.json');
  }
}

async function main() {
  console.log(`Purging all ${TEST_HOST} reports under ${BACKEND_ROOT} ...`);
  await purgeExampleComJobs();
  await purgeErrorCheckReports();
  await purgeKeywordScans();
  await purgeSeoReportDirs();
  await purgeOrphanFullUiReport();
  await cleanTestExecutions();
  console.log('Done.');
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});