const express = require('express');
const jobStore = require('../shared/jobStore');
const stateService = require('../keyword-check/stateService');
const { listFilesByMtime, safeReadJson } = require('../shared/reportUtils');
const { moduleReportsDir } = require('../shared/storagePaths');

const router = express.Router();

const TERMINAL_SUCCESS = new Set(['completed']);
const TERMINAL_FAILURE = new Set(['failed', 'cancelled']);

function sparklineFromRuns(runs, days = 7) {
  const buckets = Array.from({ length: days }, () => ({ total: 0, passed: 0 }));
  const now = Date.now();
  for (const run of runs) {
    const d = run.completedAt || run.createdAt;
    if (!d) continue;
    const age = Math.floor((now - new Date(d).getTime()) / 86400000);
    if (age < 0 || age >= days) continue;
    const idx = days - 1 - age;
    buckets[idx].total++;
    if (TERMINAL_SUCCESS.has(run.status)) buckets[idx].passed++;
  }
  return buckets.map(b => (b.total ? Math.round((b.passed / b.total) * 100) : 0));
}

function trendLabel(current, previous) {
  if (!previous) return current > 0 ? '+100%' : '0%';
  const delta = Math.round(((current - previous) / previous) * 100);
  return `${delta >= 0 ? '+' : ''}${delta}%`;
}

function normalizeStatus(status) {
  if (status === 'done') return 'completed';
  return status || 'unknown';
}

async function collectJobRuns() {
  const runs = [];
  for (const moduleId of jobStore.RUNNABLE_MODULES) {
    const jobs = await jobStore.listJobs(moduleId, 200);
    for (const job of jobs) {
      const enriched = await jobStore.enrichJob(moduleId, { ...job, moduleId: job.moduleId || moduleId });
      runs.push({
        id: enriched.id,
        moduleId: enriched.moduleId,
        url: enriched.url,
        status: normalizeStatus(enriched.status),
        progress: enriched.progress || 0,
        createdAt: enriched.createdAt,
        completedAt: enriched.completedAt,
        reportAvailable: enriched.reportAvailable === true
      });
    }
  }
  return runs;
}

async function collectKeywordRuns() {
  const scans = await stateService.listScans();
  const runs = [];

  for (const scan of scans) {
    const status = normalizeStatus(scan.status);
    const reportAvailable = status === 'completed';

    const total = scan.stats?.urlsDiscovered || 0;
    const current = scan.stats?.urlsProcessed || 0;
    const progress = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : (status === 'completed' ? 100 : 0);

    runs.push({
      id: scan.id,
      moduleId: 'keyword-check',
      url: scan.url,
      status,
      progress,
      createdAt: scan.startedAt,
      completedAt: scan.completedAt,
      reportAvailable
    });
  }

  return runs;
}

async function collectErrorCheckRuns() {
  const reportsDir = moduleReportsDir('error-check');
  const files = await listFilesByMtime(reportsDir, { extension: '.json', prefix: 'error-check-' });
  const runs = [];

  for (const file of files) {
    const data = await safeReadJson(file.path);
    runs.push({
      id: file.name,
      moduleId: 'error-check',
      url: data?.url || '',
      status: 'completed',
      progress: 100,
      createdAt: data?.generatedAt || file.mtime.toISOString(),
      completedAt: data?.generatedAt || file.mtime.toISOString(),
      reportAvailable: true
    });
  }

  return runs;
}

async function collectAllRuns() {
  const [jobs, keywords, errorChecks] = await Promise.all([
    collectJobRuns(),
    collectKeywordRuns(),
    collectErrorCheckRuns()
  ]);
  return [...jobs, ...keywords, ...errorChecks];
}

/** Include recent activity from every module, not only the globally newest runs. */
function pickBalancedRecentRuns(allRuns, limit = 15) {
  const byModule = new Map();
  for (const run of allRuns) {
    const list = byModule.get(run.moduleId) || [];
    list.push(run);
    byModule.set(run.moduleId, list);
  }

  const moduleCount = byModule.size || 1;
  const perModule = Math.max(2, Math.ceil(limit / moduleCount));
  const picked = [];

  for (const runs of byModule.values()) {
    runs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    picked.push(...runs.slice(0, perModule));
  }

  return picked
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

router.get('/stats', async (req, res) => {
  try {
    const allRuns = await collectAllRuns();

    let passed = 0;
    let failed = 0;
    let running = 0;

    for (const run of allRuns) {
      if (TERMINAL_SUCCESS.has(run.status)) passed++;
      else if (TERMINAL_FAILURE.has(run.status)) failed++;
      else if (run.status === 'pending' || run.status === 'running' || run.status === 'starting') running++;
    }

    const total = allRuns.length;
    const finished = passed + failed;
    const successRate = finished > 0 ? Math.round((passed / finished) * 100) : 0;

    const weekAgo = Date.now() - 7 * 86400000;
    const twoWeeksAgo = Date.now() - 14 * 86400000;
    const thisWeek = allRuns.filter(r => new Date(r.completedAt || r.createdAt) >= weekAgo);
    const lastWeek = allRuns.filter(r => {
      const t = new Date(r.completedAt || r.createdAt).getTime();
      return t >= twoWeeksAgo && t < weekAgo;
    });

    const twPassed = thisWeek.filter(r => TERMINAL_SUCCESS.has(r.status)).length;
    const lwPassed = lastWeek.filter(r => TERMINAL_SUCCESS.has(r.status)).length;
    const twFailed = thisWeek.filter(r => TERMINAL_FAILURE.has(r.status)).length;
    const lwFailed = lastWeek.filter(r => TERMINAL_FAILURE.has(r.status)).length;
    const twRate = twPassed + twFailed > 0 ? Math.round((twPassed / (twPassed + twFailed)) * 100) : 0;
    const lwRate = lwPassed + lwFailed > 0 ? Math.round((lwPassed / (lwPassed + lwFailed)) * 100) : 0;

    res.json({
      totalTests: total,
      passed,
      failed,
      running,
      successRate,
      sparklines: {
        total: sparklineFromRuns(allRuns),
        passed: sparklineFromRuns(allRuns.filter(r => TERMINAL_SUCCESS.has(r.status))),
        failed: sparklineFromRuns(allRuns.filter(r => TERMINAL_FAILURE.has(r.status))),
        successRate: sparklineFromRuns(allRuns)
      },
      trends: {
        passed: trendLabel(twPassed, lwPassed),
        failed: trendLabel(twFailed, lwFailed),
        successRate: trendLabel(twRate, lwRate)
      },
      recentRuns: pickBalancedRecentRuns(
        allRuns.filter((r) => r.status !== 'cancelled'),
        15
      ).map(r => ({
          id: r.id,
          moduleId: r.moduleId,
          url: r.url,
          status: r.status,
          progress: r.progress,
          createdAt: r.createdAt,
          reportAvailable: r.reportAvailable === true
        }))
    });
  } catch (err) {
    res.status(500).json({ error: 'STATS_FAILED', message: err.message });
  }
});

module.exports = router;