const fs = require('fs-extra');
const path = require('path');
const { moduleJobsDir } = require('./storagePaths');

function logJob(moduleId, jobId, level, message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${message}`;
  console.log(`[${moduleId}:${jobId?.slice(0, 8) || '-'}] ${line}`);

  if (moduleId && jobId) {
    const logPath = path.join(moduleJobsDir(moduleId), jobId, 'job.log');
    fs.appendFile(logPath, line + '\n').catch(() => {});
  }
}

module.exports = { logJob };