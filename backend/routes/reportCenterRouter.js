const express = require('express');
const reportCenterService = require('../shared/services/reportCenterService');
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

module.exports = router;