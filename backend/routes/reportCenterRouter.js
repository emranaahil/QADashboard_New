const express = require('express');
const reportCenterService = require('../shared/services/reportCenterService');
const reportDeleteService = require('../shared/services/reportDeleteService');
const { getModule } = require('../shared/moduleRegistry');
const { getSessionIdFromRequest } = require('../shared/sessionUtils');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const moduleId = req.query.moduleId || undefined;
    const sessionId = getSessionIdFromRequest(req);
    const reports = await reportCenterService.listAllReports({ limit, moduleId, sessionId });
    res.json({ total: reports.length, reports });
  } catch (err) {
    res.status(500).json({ error: 'REPORTS_FAILED', message: err.message });
  }
});

router.delete('/:moduleId/:reportId', async (req, res) => {
  try {
    const moduleId = req.params.moduleId;
    if (!getModule(moduleId)) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown module' });
    }
    const sessionId = getSessionIdFromRequest(req);
    const result = await reportDeleteService.deleteReport(
      moduleId,
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