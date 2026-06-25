#!/usr/bin/env node
/**
 * Remove all cancelled job folders, keyword scans, and stale execution index entries.
 *
 * Usage: node scripts/purge-cancelled-reports.js
 */
const fs = require('fs-extra');
const path = require('path');
const {
  moduleJobsDir,
  keywordStorageDir,
  BACKEND_ROOT
} = require('../backend/shared/storagePaths');

const JOB_MODULES = ['ui-check', 'full-ui-check', 'seo'];
const stats = {
  jobDirsRemoved: 0,
  keywordScansRemoved: 0,
  keywordCheckpointsRemoved: 0,
  keywordPdfsRemoved: 0,
  testExecutionKeysRemoved: 0
};

async function purgeCancelledJobs() {
  const removedJobIds = new Set();

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

      if (job.status !== 'cancelled') continue;

      await fs.remove(jobDir);
      removedJobIds.add(job.id || entry);
      stats.jobDirsRemoved++;
      console.log(`Removed ${moduleId} cancelled job ${entry} (${job.url})`);
    }
  }

  return removedJobIds;
}

async function purgeCancelledKeywordScans() {
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

      if (data.status !== 'cancelled') continue;

      const scanId = data.id || entry.replace(/\.json$/, '');
      removedScanIds.add(scanId);
      await fs.remove(full);
      stats.keywordScansRemoved++;
      console.log(`Removed keyword cancelled scan ${entry} (${data.url})`);
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

async function cleanTestExecutions(removedJobIds) {
  const filePath = path.join(BACKEND_ROOT, 'shared', 'data', 'test-executions.json');
  if (!await fs.pathExists(filePath)) return;

  const data = await fs.readJson(filePath);
  let changed = false;

  for (const [key, value] of Object.entries(data)) {
    const shouldRemove =
      value?.status === 'cancelled' ||
      (value?.jobId && removedJobIds.has(value.jobId));
    if (shouldRemove) {
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
  console.log(`Purging all cancelled reports under ${BACKEND_ROOT} ...`);
  const removedJobIds = await purgeCancelledJobs();
  await purgeCancelledKeywordScans();
  await cleanTestExecutions(removedJobIds);
  console.log('Done.');
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});