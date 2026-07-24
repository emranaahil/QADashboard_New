const express = require('express');
const historyService = require('../shared/services/historyService');
const reportDeleteService = require('../shared/services/reportDeleteService');
const { getSessionIdFromRequest } = require('../shared/sessionUtils');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const moduleId = req.query.moduleId || undefined;
    const q = req.query.q || undefined;
    const sessionId = getSessionIdFromRequest(req);
    const items = await historyService.listHistory({ limit, moduleId, q, sessionId });
    res.json({
      total: items.length,
      grouped: historyService.groupByDate(items),
      items
    });
  } catch (err) {
    res.status(500).json({ error: 'HISTORY_FAILED', message: err.message });
  }
});

router.delete('/:moduleId/:jobId', async (req, res) => {
  try {
    const sessionId = getSessionIdFromRequest(req);
    const result = await reportDeleteService.deleteReport(
      req.params.moduleId,
      req.params.jobId,
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