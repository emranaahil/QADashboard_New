const express = require('express');
const jobStore = require('../shared/jobStore');

const router = express.Router();

function sparklineFromJobs(jobs, days = 7) {
  const buckets = Array.from({ length: days }, () => ({ total: 0, passed: 0 }));
  const now = Date.now();
  for (const job of jobs) {
    const d = job.completedAt || job.createdAt;
    if (!d) continue;
    const age = Math.floor((now - new Date(d).getTime()) / 86400000);
    if (age < 0 || age >= days) continue;
    const idx = days - 1 - age;
    buckets[idx].total++;
    if (job.status === 'completed') buckets[idx].passed++;
  }
  return buckets.map(b => (b.total ? Math.round((b.passed / b.total) * 100) : 0));
}

function trendLabel(current, previous) {
  if (!previous) return current > 0 ? '+100%' : '0%';
  const delta = Math.round(((current - previous) / previous) * 100);
  return `${delta >= 0 ? '+' : ''}${delta}%`;
}

router.get('/stats', async (req, res) => {
  try {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let running = 0;
    const allJobs = [];

    for (const moduleId of jobStore.RUNNABLE_MODULES) {
      const jobs = await jobStore.listJobs(moduleId, 200);
      for (const job of jobs) {
        allJobs.push(job);
        total++;
        if (job.status === 'completed') passed++;
        else if (job.status === 'failed' || job.status === 'cancelled') failed++;
        else if (job.status === 'pending' || job.status === 'running') running++;
      }
    }

    const finished = passed + failed;
    const successRate = finished > 0 ? Math.round((passed / finished) * 100) : 0;

    const weekAgo = Date.now() - 7 * 86400000;
    const twoWeeksAgo = Date.now() - 14 * 86400000;
    const thisWeek = allJobs.filter(j => new Date(j.completedAt || j.createdAt) >= weekAgo);
    const lastWeek = allJobs.filter(j => {
      const t = new Date(j.completedAt || j.createdAt).getTime();
      return t >= twoWeeksAgo && t < weekAgo;
    });

    const twPassed = thisWeek.filter(j => j.status === 'completed').length;
    const lwPassed = lastWeek.filter(j => j.status === 'completed').length;
    const twFailed = thisWeek.filter(j => j.status === 'failed').length;
    const lwFailed = lastWeek.filter(j => j.status === 'failed').length;
    const twRate = twPassed + twFailed > 0 ? Math.round((twPassed / (twPassed + twFailed)) * 100) : 0;
    const lwRate = lwPassed + lwFailed > 0 ? Math.round((lwPassed / (lwPassed + lwFailed)) * 100) : 0;

    res.json({
      totalTests: total,
      passed,
      failed,
      running,
      successRate,
      sparklines: {
        total: sparklineFromJobs(allJobs),
        passed: sparklineFromJobs(allJobs.filter(j => j.status === 'completed')),
        failed: sparklineFromJobs(allJobs.filter(j => j.status === 'failed')),
        successRate: sparklineFromJobs(allJobs)
      },
      trends: {
        passed: trendLabel(twPassed, lwPassed),
        failed: trendLabel(twFailed, lwFailed),
        successRate: trendLabel(twRate, lwRate)
      },
      recentRuns: allJobs
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 8)
        .map(j => ({
          id: j.id,
          moduleId: j.moduleId,
          url: j.url,
          status: j.status,
          progress: j.progress,
          createdAt: j.createdAt
        }))
    });
  } catch (err) {
    res.status(500).json({ error: 'STATS_FAILED', message: err.message });
  }
});

module.exports = router;