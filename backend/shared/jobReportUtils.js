const path = require('path');
const fs = require('fs-extra');
const jobStore = require('./jobStore');
const { moduleDataRoot } = require('./storagePaths');
const { toReportMeta, safeReadJson } = require('./reportUtils');

const JOB_PREFIX = 'job:';

function parseJobReportId(reportId) {
  if (!reportId || typeof reportId !== 'string' || !reportId.startsWith(JOB_PREFIX)) return null;
  const jobId = reportId.slice(JOB_PREFIX.length);
  try {
    jobStore.validateJobId(jobId);
    return jobId;
  } catch {
    return null;
  }
}

async function listJobReports(moduleId) {
  const jobs = await jobStore.listJobs(moduleId, 50);
  const reports = [];

  for (const job of jobs) {
    const hasHtml = await jobStore.reportExists(moduleId, job.id);
    if (!hasHtml && job.status !== 'completed') continue;

    const date = job.completedAt || job.createdAt;
    reports.push(toReportMeta({
      id: `${JOB_PREFIX}${job.id}`,
      type: 'job',
      title: `${job.url} — ${job.status}`,
      generatedAt: date,
      hasHtml,
      jobId: job.id,
      jobStatus: job.status
    }));
  }

  return reports;
}

async function getJobReport(moduleId, reportId) {
  const jobId = parseJobReportId(reportId);
  if (!jobId) return null;

  const job = await jobStore.getJob(moduleId, jobId);
  if (!job) return { error: 'NOT_FOUND', message: 'Job report not found' };

  const jobDir = jobStore.getJobDir(moduleId, jobId);
  let data = null;

  let seoPath = path.join(jobDir, 'seoReport.json');
  if (job.reportPath) {
    const htmlPath = path.join(moduleDataRoot(moduleId), job.reportPath);
    seoPath = path.join(path.dirname(htmlPath), 'seoReport.json');
  }
  const qaPath = path.join(jobDir, 'qaReport.json');
  if (await fs.pathExists(seoPath)) {
    data = await safeReadJson(seoPath);
  } else if (await fs.pathExists(qaPath)) {
    data = await safeReadJson(qaPath);
  }

  const hasHtml = await jobStore.reportExists(moduleId, jobId);

  return {
    meta: {
      id: reportId,
      type: 'job',
      jobId,
      url: job.url,
      status: job.status,
      generatedAt: job.completedAt || job.createdAt,
      durationMs: job.durationMs,
      hasHtml,
      reportPath: job.reportPath
    },
    data: data || { job }
  };
}

async function getJobHtml(moduleId, reportId) {
  const jobId = parseJobReportId(reportId);
  if (!jobId) return null;

  const reportPath = jobStore.getReportPath(moduleId, jobId);
  if (!await fs.pathExists(reportPath)) {
    return { error: 'NOT_FOUND', message: 'Report not available' };
  }

  const html = await fs.readFile(reportPath, 'utf8');
  return { html };
}

module.exports = {
  JOB_PREFIX,
  parseJobReportId,
  listJobReports,
  getJobReport,
  getJobHtml
};