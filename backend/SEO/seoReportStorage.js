const fs = require('fs-extra');
const path = require('path');
const { moduleReportsDir } = require('../shared/storagePaths');

const REPORT_JSON = 'seoReport.json';
const REPORT_HTML = 'qa-report.html';
const MIGRATION_MARKER = '.layout-v2-migrated';

function makeRunId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function getReportsRoot() {
  return moduleReportsDir('seo');
}

function getRunFolder(runId) {
  const safeId = path.basename(String(runId || ''));
  return path.join(getReportsRoot(), safeId);
}

function getRunArtifacts(runId) {
  const folder = getRunFolder(runId);
  return {
    folder,
    jsonPath: path.join(folder, REPORT_JSON),
    htmlPath: path.join(folder, REPORT_HTML),
    reportPath: `reports/${runId}/${REPORT_HTML}`
  };
}

async function writeRunArtifacts(runId, { seoReport, html }) {
  const { folder, jsonPath, htmlPath, reportPath } = getRunArtifacts(runId);
  await fs.ensureDir(folder);
  await fs.writeJson(jsonPath, seoReport, { spaces: 2 });
  await fs.writeFile(htmlPath, html, 'utf8');
  return { runId, folder, jsonPath, htmlPath, reportPath };
}

async function cleanupLegacySeoReports() {
  const reportsRoot = getReportsRoot();
  const { moduleJobsDir } = require('../shared/storagePaths');
  const jobsRoot = moduleJobsDir('seo');
  const removed = { flatFiles: 0, jobArtifacts: 0, jobsUpdated: 0 };

  await fs.ensureDir(reportsRoot);

  for (const name of [REPORT_JSON, 'reportseo.html', REPORT_HTML]) {
    const target = path.join(reportsRoot, name);
    if (await fs.pathExists(target)) {
      await fs.remove(target);
      removed.flatFiles++;
    }
  }

  if (await fs.pathExists(jobsRoot)) {
    const entries = await fs.readdir(jobsRoot);
    for (const entry of entries) {
      const jobDir = path.join(jobsRoot, entry);
      const stat = await fs.stat(jobDir).catch(() => null);
      if (!stat?.isDirectory()) continue;

      for (const artifact of [REPORT_HTML, REPORT_JSON]) {
        const artifactPath = path.join(jobDir, artifact);
        if (await fs.pathExists(artifactPath)) {
          await fs.remove(artifactPath);
          removed.jobArtifacts++;
        }
      }

      const jobFile = path.join(jobDir, 'job.json');
      if (!await fs.pathExists(jobFile)) continue;

      const job = await fs.readJson(jobFile);
      let changed = false;
      if (job.reportPath) {
        job.reportPath = null;
        changed = true;
      }
      if (job.reportRunId) {
        job.reportRunId = null;
        changed = true;
      }
      if (job.reportAvailable) {
        job.reportAvailable = false;
        changed = true;
      }
      if (changed) {
        await fs.writeJson(jobFile, job, { spaces: 2 });
        removed.jobsUpdated++;
      }
    }
  }

  return removed;
}

async function migrateSeoReportLayoutOnce() {
  const marker = path.join(getReportsRoot(), MIGRATION_MARKER);
  if (await fs.pathExists(marker)) {
    return { skipped: true };
  }

  const removed = await cleanupLegacySeoReports();
  await fs.writeFile(marker, new Date().toISOString(), 'utf8');
  return { skipped: false, removed };
}

module.exports = {
  REPORT_JSON,
  REPORT_HTML,
  makeRunId,
  getReportsRoot,
  getRunFolder,
  getRunArtifacts,
  writeRunArtifacts,
  cleanupLegacySeoReports,
  migrateSeoReportLayoutOnce
};