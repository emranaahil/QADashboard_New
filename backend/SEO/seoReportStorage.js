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

function normalizeReportUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathPart = parsed.pathname.replace(/\/+$/, '') || '';
    return `${host}${pathPart}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}

async function buildSeoReportIndex() {
  const reportsRoot = getReportsRoot();
  const index = new Map();
  if (!(await fs.pathExists(reportsRoot))) return index;

  for (const runId of await fs.readdir(reportsRoot)) {
    if (!runId || runId.startsWith('.')) continue;
    const { htmlPath, jsonPath, reportPath } = getRunArtifacts(runId);
    if (!(await fs.pathExists(htmlPath))) continue;

    const data = await fs.readJson(jsonPath).catch(() => null);
    if (!data?.mainUrl) continue;

    const key = normalizeReportUrl(data.mainUrl);
    const scanAt = data.scanDate ? new Date(data.scanDate).getTime() : null;
    const list = index.get(key) || [];
    list.push({ runId, reportPath, scanAt });
    index.set(key, list);
  }

  return index;
}

async function findSeoReportForJob(job, index = null) {
  if (!job?.url) return null;

  const jobUrl = normalizeReportUrl(job.url);
  const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : null;
  let best = null;

  const candidates = index?.get(jobUrl) || null;
  if (candidates) {
    for (const entry of candidates) {
      const distance = completedAt != null && entry.scanAt != null
        ? Math.abs(entry.scanAt - completedAt)
        : Number.MAX_SAFE_INTEGER;
      if (!best || distance < best.distance) {
        best = { runId: entry.runId, reportPath: entry.reportPath, distance };
      }
    }
  } else {
    const reportsRoot = getReportsRoot();
    if (!(await fs.pathExists(reportsRoot))) return null;

    for (const runId of await fs.readdir(reportsRoot)) {
      if (!runId || runId.startsWith('.')) continue;
      const { htmlPath, jsonPath, reportPath } = getRunArtifacts(runId);
      if (!(await fs.pathExists(htmlPath))) continue;

      const data = await fs.readJson(jsonPath).catch(() => null);
      if (!data?.mainUrl) continue;
      if (normalizeReportUrl(data.mainUrl) !== jobUrl) continue;

      const scanAt = data.scanDate ? new Date(data.scanDate).getTime() : null;
      const distance = completedAt != null && scanAt != null
        ? Math.abs(scanAt - completedAt)
        : Number.MAX_SAFE_INTEGER;

      if (!best || distance < best.distance) {
        best = { runId, reportPath, distance };
      }
    }
  }

  if (!best) return null;
  return {
    reportRunId: best.runId,
    reportPath: best.reportPath
  };
}

async function repairSeoJobReportLinks() {
  const { moduleJobsDir } = require('../shared/storagePaths');
  const jobsRoot = moduleJobsDir('seo');
  const stats = { scanned: 0, repaired: 0 };

  if (!(await fs.pathExists(jobsRoot))) return stats;

  const reportIndex = await buildSeoReportIndex();

  for (const entry of await fs.readdir(jobsRoot)) {
    const jobFile = path.join(jobsRoot, entry, 'job.json');
    if (!(await fs.pathExists(jobFile))) continue;

    let job;
    try {
      job = await fs.readJson(jobFile);
    } catch {
      continue;
    }

    if (job.status !== 'completed') continue;
    stats.scanned++;

    const hasPointer = job.reportPath && job.reportRunId;
    if (hasPointer) {
      const htmlPath = path.join(getReportsRoot(), job.reportRunId, REPORT_HTML);
      if (await fs.pathExists(htmlPath)) continue;
    }

    const discovered = await findSeoReportForJob(job, reportIndex);
    if (!discovered) continue;

    await fs.writeJson(jobFile, {
      ...job,
      reportPath: discovered.reportPath,
      reportRunId: discovered.reportRunId,
      reportAvailable: true
    }, { spaces: 2 });
    stats.repaired++;
  }

  return stats;
}

async function cleanupLegacySeoReports() {
  const reportsRoot = getReportsRoot();
  const { moduleJobsDir, moduleDataRoot } = require('../shared/storagePaths');
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

      // Keep valid reports/{runId}/ pointers; only strip broken or legacy job-dir paths.
      if (job.reportPath?.startsWith('reports/')) {
        const htmlPath = path.join(moduleDataRoot('seo'), job.reportPath);
        if (!(await fs.pathExists(htmlPath))) {
          job.reportPath = null;
          job.reportRunId = null;
          changed = true;
        }
      } else {
        if (job.reportPath) {
          job.reportPath = null;
          changed = true;
        }
        if (job.reportRunId) {
          const htmlPath = path.join(getReportsRoot(), job.reportRunId, REPORT_HTML);
          if (!(await fs.pathExists(htmlPath))) {
            job.reportRunId = null;
            changed = true;
          }
        }
      }

      if (job.reportAvailable && !job.reportPath && !job.reportRunId) {
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
  normalizeReportUrl,
  buildSeoReportIndex,
  findSeoReportForJob,
  repairSeoJobReportLinks,
  cleanupLegacySeoReports,
  migrateSeoReportLayoutOnce
};