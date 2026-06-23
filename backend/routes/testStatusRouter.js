const express = require('express');
const testStatusService = require('../shared/testStatusService');

const router = express.Router();

router.get('/active/:testType', async (req, res) => {
  try {
    testStatusService.validateTestType(req.params.testType);
    const status = await testStatusService.getActiveForModule(req.params.testType);
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: err.message });
  }
});

router.get('/:modelId/:testType', async (req, res) => {
  try {
    testStatusService.validateTestType(req.params.testType);
    testStatusService.validateModelId(req.params.modelId);
    const status = await testStatusService.getStatus(req.params.testType, req.params.modelId);
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: err.message });
  }
});

module.exports = router;