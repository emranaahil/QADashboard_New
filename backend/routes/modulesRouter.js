const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { listModules, getModule, getReader } = require('../shared/moduleRegistry');
const { parseJobReportId, getJobHtml } = require('../shared/jobReportUtils');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ modules: listModules() });
});

router.get('/:moduleId', (req, res) => {
  const mod = getModule(req.params.moduleId);
  if (!mod) return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
  const { id, name, description, icon, route, hasRunner, reportTypes } = mod;
  res.json({ id, name, description, icon, route, hasRunner, reportTypes });
});

router.get('/:moduleId/reports', async (req, res) => {
  try {
    const reader = getReader(req.params.moduleId);
    if (!reader) return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
    const reports = await reader.listReports();
    res.json({ moduleId: req.params.moduleId, reports });
  } catch (err) {
    res.status(500).json({ error: 'READ_FAILED', message: err.message });
  }
});

router.get('/:moduleId/reports/latest', async (req, res) => {
  try {
    const reader = getReader(req.params.moduleId);
    if (!reader) return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
    const result = await reader.getLatestReport();
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'READ_FAILED', message: err.message });
  }
});

router.get('/:moduleId/reports/latest/html', async (req, res) => {
  try {
    const reader = getReader(req.params.moduleId);
    if (!reader) return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
    const result = await reader.getHtmlForReport();
    if (result.error) return res.status(404).json(result);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.html);
  } catch (err) {
    res.status(500).json({ error: 'READ_FAILED', message: err.message });
  }
});

router.get('/:moduleId/reports/:reportId/html', async (req, res) => {
  try {
    if (parseJobReportId(req.params.reportId)) {
      const result = await getJobHtml(req.params.moduleId, req.params.reportId);
      if (!result || result.error) return res.status(404).json(result || { error: 'NOT_FOUND', message: 'Report not available' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(result.html);
    }

    const reader = getReader(req.params.moduleId);
    if (!reader) return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
    const result = await reader.getHtmlForReport(req.params.reportId);
    if (result.error) return res.status(404).json(result);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.html);
  } catch (err) {
    res.status(500).json({ error: 'READ_FAILED', message: err.message });
  }
});

router.get('/:moduleId/reports/:reportId/pdf', async (req, res) => {
  try {
    const reader = getReader(req.params.moduleId);
    if (!reader || !reader.getPdfPath) {
      return res.status(404).json({ error: 'NOT_AVAILABLE', message: 'PDF not available for this module' });
    }
    const pdfPath = await reader.getPdfPath(req.params.reportId);
    if (!pdfPath) return res.status(404).json({ error: 'NOT_FOUND', message: 'PDF report not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(pdfPath)}"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'READ_FAILED', message: err.message });
  }
});

router.get('/:moduleId/reports/:reportId', async (req, res) => {
  try {
    const reader = getReader(req.params.moduleId);
    if (!reader) return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
    const result = await reader.getReport(req.params.reportId);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'READ_FAILED', message: err.message });
  }
});

module.exports = router;