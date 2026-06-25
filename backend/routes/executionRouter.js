const express = require('express');
const executionController = require('../shared/executionController');
const executionLock = require('../shared/executionLock');
const jobStore = require('../shared/jobStore');
const { getModule } = require('../shared/moduleRegistry');

const router = express.Router();
const RUNNABLE_MODULES = ['full-ui-check', 'ui-check', 'seo'];

function validateModule(moduleId) {
  const mod = getModule(moduleId);
  if (!mod) throw new Error('Module not found');
  if (!jobStore.RUNNABLE_MODULES.has(moduleId)) {
    throw new Error('Module does not support execution');
  }
}

router.get('/active', async (_req, res) => {
  try {
    const locked = executionLock.getActiveExecution();
    if (locked?.moduleId && locked?.jobId) {
      const job = await jobStore.getJob(locked.moduleId, locked.jobId);
      if (job && !jobStore.TERMINAL_STATUSES.has(job.status)) {
        return res.json({ active: true, job: await jobStore.enrichJob(locked.moduleId, job) });
      }
    }

    for (const moduleId of RUNNABLE_MODULES) {
      const jobs = await jobStore.listJobs(moduleId, 20);
      const running = jobs.find((j) => j.status === 'pending' || j.status === 'running');
      if (running) {
        return res.json({ active: true, job: await jobStore.enrichJob(moduleId, running) });
      }
    }

    res.json({ active: false, job: null });
  } catch (err) {
    res.status(500).json({ error: 'ACTIVE_FAILED', message: err.message });
  }
});

router.post('/cancel', async (req, res) => {
  try {
    const { moduleId, jobId } = req.body || {};
    if (!moduleId || !jobId) {
      return res.status(400).json({ error: 'INVALID_REQUEST', message: 'moduleId and jobId are required' });
    }
    validateModule(moduleId);
    const job = await executionController.cancelExecution(moduleId, jobId);
    res.json({
      ok: true,
      job,
      execution: await executionController.getExecutionStatus(moduleId, jobId)
    });
  } catch (err) {
    console.error('Cancel route error:', err);
    res.status(400).json({ ok: false, error: 'CANCEL_FAILED', message: err.message });
  }
});

router.get('/status/:moduleId/:jobId', async (req, res) => {
  try {
    validateModule(req.params.moduleId);
    jobStore.validateJobId(req.params.jobId);
    const execution = await executionController.getExecutionStatus(req.params.moduleId, req.params.jobId);
    res.json({ execution });
  } catch (err) {
    res.status(400).json({ error: 'STATUS_FAILED', message: err.message });
  }
});

router.get('/progress/:moduleId/:jobId', async (req, res) => {
  try {
    validateModule(req.params.moduleId);
    jobStore.validateJobId(req.params.jobId);
    const execution = await executionController.getExecutionProgress(req.params.moduleId, req.params.jobId);
    res.json({ execution });
  } catch (err) {
    res.status(400).json({ error: 'PROGRESS_FAILED', message: err.message });
  }
});

module.exports = router;