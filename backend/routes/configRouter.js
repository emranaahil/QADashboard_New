const express = require('express');
const deviceService = require('../shared/services/deviceService');
const browserService = require('../shared/services/browserService');

const router = express.Router();

router.get('/devices', (req, res) => {
  res.json({ devices: deviceService.getCatalog() });
});

router.get('/browsers', (req, res) => {
  const scope = String(req.query.scope || '').toLowerCase();
  res.json({ browsers: browserService.getCatalog({ scope: scope === 'ui' ? 'ui' : undefined }) });
});

router.post('/devices/resolve', (req, res) => {
  try {
    const devices = deviceService.resolveDevices(req.body?.selected || []);
    res.json({ devices });
  } catch (err) {
    res.status(400).json({ error: 'INVALID_DEVICES', message: err.message });
  }
});

module.exports = router;