const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { listModules, getModule, getReader } = require('../shared/moduleRegistry');
const { parseJobReportId, getJobHtml, getJobReport } = require('../shared/jobReportUtils');
const {
  buildSeoPagesSummaryCsv,
  buildSeoIssuesDetailCsv,
  buildSeoScannedUrlsCsv
} = require('../shared/seoReportCsv');
const { buildImageAuditCsv, csvFilename } = require('../image-audit/imageAuditCsv');
const {
  buildSitemapPagesCsv,
  buildSitemapFilesCsv
} = require('../sitemap-check/sitemapReportCsv');

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

router.get('/:moduleId/reports/:reportId/csv', async (req, res) => {
  try {
    const moduleId = req.params.moduleId;
    if (moduleId !== 'image-audit' && moduleId !== 'sitemap-check') {
      return res.status(404).json({ error: 'NOT_AVAILABLE', message: 'CSV export is not available for this module' });
    }

    let reportData = null;
    if (parseJobReportId(req.params.reportId)) {
      const result = await getJobReport(moduleId, req.params.reportId);
      if (!result || result.error) return res.status(404).json(result || { error: 'NOT_FOUND', message: 'Report not found' });
      reportData = result.data;
    } else {
      const reader = getReader(moduleId);
      if (!reader) return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
      const result = await reader.getReport(req.params.reportId);
      if (result.error) return res.status(404).json(result);
      reportData = result.data;
    }

    if (moduleId === 'image-audit') {
      if (!reportData?.images?.length) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'No image audit data found' });
      }
      const csv = buildImageAuditCsv(reportData);
      const filename = csvFilename(reportData.domain);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    // sitemap-check
    const kind = String(req.query.kind || 'pages').toLowerCase();
    const date = String(reportData.generatedAt || new Date().toISOString()).slice(0, 10);
    if (kind === 'files') {
      if (!reportData?.sitemaps?.length) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'No sitemap files found in report' });
      }
      const csv = buildSitemapFilesCsv(reportData);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Sitemap-Audit-Files-${date}.csv"`);
      return res.send(csv);
    }

    if (!reportData?.urls?.length) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No sitemap page results found' });
    }
    const csv = buildSitemapPagesCsv(reportData);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Sitemap-Audit-Pages-${date}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'READ_FAILED', message: err.message });
  }
});

router.get('/:moduleId/reports/:reportId/urls', async (req, res) => {
  try {
    if (req.params.moduleId !== 'seo') {
      return res.status(404).json({ error: 'NOT_AVAILABLE', message: 'URL export is only available for Seo/Geo Audit reports' });
    }

    let reportData = null;
    if (parseJobReportId(req.params.reportId)) {
      const result = await getJobReport(req.params.moduleId, req.params.reportId);
      if (!result || result.error) return res.status(404).json(result || { error: 'NOT_FOUND', message: 'Report not found' });
      reportData = result.data;
    } else {
      const reader = getReader(req.params.moduleId);
      if (!reader) return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
      const result = await reader.getReport(req.params.reportId);
      if (result.error) return res.status(404).json(result);
      reportData = result.data;
    }

    if (!reportData?.pages?.length) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No audit report pages found' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(buildSeoScannedUrlsCsv(reportData.pages));
  } catch (err) {
    res.status(500).json({ error: 'READ_FAILED', message: err.message });
  }
});

router.get('/:moduleId/reports/:reportId/csv/:kind(pages|issues)', async (req, res) => {
  try {
    if (req.params.moduleId !== 'seo') {
      return res.status(404).json({ error: 'NOT_AVAILABLE', message: 'CSV export is only available for Seo/Geo Audit reports' });
    }

    let reportData = null;
    if (parseJobReportId(req.params.reportId)) {
      const result = await getJobReport(req.params.moduleId, req.params.reportId);
      if (!result || result.error) return res.status(404).json(result || { error: 'NOT_FOUND', message: 'Report not found' });
      reportData = result.data;
    } else {
      const reader = getReader(req.params.moduleId);
      if (!reader) return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
      const result = await reader.getReport(req.params.reportId);
      if (result.error) return res.status(404).json(result);
      reportData = result.data;
    }

    if (!reportData?.pages?.length) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No audit report pages found' });
    }

    const date = String(reportData.scanDate || new Date().toISOString()).slice(0, 10);
    const csv =
      req.params.kind === 'pages'
        ? buildSeoPagesSummaryCsv(reportData)
        : buildSeoIssuesDetailCsv(reportData);
    const filename =
      req.params.kind === 'pages'
        ? `SeoGeo-Audit-Pages-${date}.csv`
        : `SeoGeo-Audit-Issues-${date}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
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

router.delete('/:moduleId/reports/:reportId', async (req, res) => {
  try {
    const reportDeleteService = require('../shared/services/reportDeleteService');
    const { getSessionIdFromRequest } = require('../shared/sessionUtils');
    const reader = getReader(req.params.moduleId);
    if (!reader) return res.status(404).json({ error: 'MODULE_NOT_FOUND', message: 'Module not found' });
    const sessionId = getSessionIdFromRequest(req);
    const result = await reportDeleteService.deleteReport(
      req.params.moduleId,
      req.params.reportId,
      sessionId
    );
    res.json(result);
  } catch (err) {
    const msg = err.message || 'Delete failed';
    const status = msg.includes('permission') || msg.includes('demo report') ? 403
      : msg.toLowerCase().includes('not found') ? 404
      : 400;
    res.status(status).json({ error: 'DELETE_FAILED', message: msg });
  }
});

module.exports = router;