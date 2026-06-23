const express = require('express');
const seoTestingHistoryService = require('../shared/services/seoTestingHistoryService');
const historyService = require('../shared/services/historyService');

const router = express.Router();

router.get('/history', async (req, res) => {
  try {
    const type = req.query.type;
    if (!type) {
      return res.status(400).json({
        error: 'TYPE_REQUIRED',
        message: 'Query parameter "type" is required (single-page or full-website)'
      });
    }

    const result = await seoTestingHistoryService.listSeoTestingHistory({
      type,
      q: req.query.q,
      limit: req.query.limit
    });

    res.json(result);
  } catch (err) {
    const status = err.code === 'INVALID_TYPE' ? 400 : 500;
    res.status(status).json({
      error: err.code || 'HISTORY_FAILED',
      message: err.message
    });
  }
});

router.delete('/history/:jobId', async (req, res) => {
  try {
    const type = req.query.type;
    if (!type) {
      return res.status(400).json({
        error: 'TYPE_REQUIRED',
        message: 'Query parameter "type" is required'
      });
    }

    seoTestingHistoryService.normalizeTestType(type);
    const result = await historyService.deleteHistoryEntry(
      seoTestingHistoryService.MODULE_ID,
      req.params.jobId
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'DELETE_FAILED', message: err.message });
  }
});

module.exports = router;