const fs = require('fs-extra');
const path = require('path');
const jobStore = require('./jobStore');
const { renderLogHtml } = require('./logViewUtils');

async function readJobLogFile(moduleId, jobId) {
  const logPath = path.join(jobStore.getJobDir(moduleId, jobId), 'job.log');
  if (!await fs.pathExists(logPath)) return [];
  const raw = await fs.readFile(logPath, 'utf8');
  return raw.split('\n').map((l) => l.trim()).filter(Boolean);
}

async function getJobLogLines(moduleId, jobId) {
  const job = await jobStore.getJob(moduleId, jobId);
  if (!job) return null;

  const lines = [];
  if (job.error) lines.push(`[ERROR] ${job.error}`);
  if (job.message) lines.push(`[STATUS] ${job.message}`);

  for (const entry of job.logs || []) {
    const stamp = entry.at ? `[${entry.at}] ` : '';
    lines.push(`${stamp}${entry.message}`);
  }

  const fileLines = await readJobLogFile(moduleId, jobId);
  for (const line of fileLines) {
    if (!lines.includes(line)) lines.push(line);
  }

  return { job, lines };
}

async function renderJobLogsHtml(moduleId, jobId) {
  const payload = await getJobLogLines(moduleId, jobId);
  if (!payload) return null;

  const { job, lines } = payload;
  const isRunning = !jobStore.TERMINAL_STATUSES.has(job.status);
  return renderLogHtml({
    title: 'Execution Logs',
    subtitle: job.url,
    meta: {
      Module: moduleId,
      'Job ID': jobId,
      Status: job.status,
      Progress: `${job.progress ?? 0}%`,
      Message: job.message || ''
    },
    lines,
    autoRefreshSec: isRunning ? 5 : 0
  });
}

module.exports = { getJobLogLines, renderJobLogsHtml };