const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const jobStore = require('../shared/jobStore');
const jobQueue = require('../shared/jobQueue');
const { getModule } = require('../shared/moduleRegistry');
const { logJob } = require('../shared/logger');
const testStatusService = require('../shared/testStatusService');
const executionService = require('../shared/services/executionService');
const executionController = require('../shared/executionController');

const router = express.Router();

function validateModule(req, res, next) {
  const mod = getModule(req.params.moduleId);
  if (!mod) {
    return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
  }
  if (!jobStore.RUNNABLE_MODULES.has(req.params.moduleId)) {
    return res.status(400).json({ error: 'NOT_RUNNABLE', message: 'This module does not support job execution' });
  }
  next();
}

router.post('/:moduleId/jobs', validateModule, async (req, res) => {
  try {
    const { url, options, user } = req.body || {};

    const job = await executionService.startExecution(req.params.moduleId, { url, options, user });
    logJob(req.params.moduleId, job.id, 'info', 'Job created and queued');
    res.status(201).json({ job });
  } catch (err) {
    if (err.code === 'ALREADY_RUNNING' || err.code === 'EXECUTION_ACTIVE') {
      return res.status(409).json({
        error: err.code,
        message: err.message,
        job: err.job
      });
    }
    res.status(400).json({ error: 'JOB_CREATE_FAILED', message: err.message });
  }
});

router.get('/:moduleId/jobs', validateModule, async (req, res) => {
  try {
    const jobs = await jobStore.enrichJobs(
      req.params.moduleId,
      await jobStore.listJobs(req.params.moduleId)
    );
    res.json({ moduleId: req.params.moduleId, jobs });
  } catch (err) {
    res.status(500).json({ error: 'LIST_FAILED', message: err.message });
  }
});

router.get('/:moduleId/jobs/:jobId', validateModule, async (req, res) => {
  try {
    jobStore.validateJobId(req.params.jobId);
    const job = await jobStore.getJob(req.params.moduleId, req.params.jobId);
    if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Job not found' });
    res.json({ job: await jobStore.enrichJob(req.params.moduleId, job) });
  } catch (err) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: err.message });
  }
});

router.get('/:moduleId/jobs/:jobId/events', validateModule, async (req, res) => {
  try {
    jobStore.validateJobId(req.params.jobId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = async () => {
      const raw = await jobStore.getJob(req.params.moduleId, req.params.jobId);
      if (!raw) {
        res.write(`data: ${JSON.stringify({ error: 'NOT_FOUND' })}\n\n`);
        return false;
      }
      const job = await jobStore.enrichJob(req.params.moduleId, raw);
      res.write(`data: ${JSON.stringify({ job })}\n\n`);
      return jobStore.TERMINAL_STATUSES.has(job.status);
    };

    const done = await send();
    if (done) { res.end(); return; }

    const interval = setInterval(async () => {
      try {
        const finished = await send();
        if (finished) { clearInterval(interval); res.end(); }
      } catch { clearInterval(interval); res.end(); }
    }, 1500);

    req.on('close', () => clearInterval(interval));
  } catch (err) {
    res.status(400).json({ error: 'SSE_FAILED', message: err.message });
  }
});

router.post('/:moduleId/jobs/:jobId/cancel', validateModule, async (req, res) => {
  try {
    const job = await executionController.cancelExecution(req.params.moduleId, req.params.jobId);
    res.json({ ok: true, job });
  } catch (err) {
    console.error('Job cancel route error:', err);
    res.status(400).json({ ok: false, error: 'CANCEL_FAILED', message: err.message });
  }
});

router.use('/:moduleId/jobs/:jobId/screenshots', validateModule, (req, res, next) => {
  try {
    jobStore.validateJobId(req.params.jobId);
    const dir = path.join(jobStore.getJobDir(req.params.moduleId, req.params.jobId), 'screenshots');
    if (!fs.existsSync(dir)) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Screenshots not found' });
    }
    express.static(dir)(req, res, next);
  } catch (err) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: err.message });
  }
});

router.get('/:moduleId/jobs/:jobId/report', validateModule, async (req, res) => {
  try {
    jobStore.validateJobId(req.params.jobId);
    const reportPath = jobStore.getReportPath(req.params.moduleId, req.params.jobId);
    if (!await fs.pathExists(reportPath)) {
      return res.status(404).json({ error: 'REPORT_NOT_AVAILABLE', message: 'Report not available' });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(reportPath);
  } catch (err) {
    res.status(400).json({ error: 'REPORT_FAILED', message: err.message });
  }
});

module.exports = router;