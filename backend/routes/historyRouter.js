const express = require('express');
const historyService = require('../shared/services/historyService');
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
    const result = await historyService.deleteHistoryEntry(req.params.moduleId, req.params.jobId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'DELETE_FAILED', message: err.message });
  }
});

module.exports = router;