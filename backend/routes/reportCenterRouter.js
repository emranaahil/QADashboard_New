const express = require('express');
const reportCenterService = require('../shared/services/reportCenterService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const moduleId = req.query.moduleId || undefined;
    const reports = await reportCenterService.listAllReports({ limit, moduleId });
    res.json({ total: reports.length, reports });
  } catch (err) {
    res.status(500).json({ error: 'REPORTS_FAILED', message: err.message });
  }
});

module.exports = router;