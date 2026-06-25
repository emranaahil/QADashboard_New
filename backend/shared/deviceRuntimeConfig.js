const fs = require('fs');
const path = require('path');

/**
 * Load devices for ui-check / full-ui-check config.js getters.
 * Priority: QA_DEVICES_JSON env → devices.runtime.json in job dir → defaults.
 */
function loadRuntimeDevices(defaults) {
  if (process.env.QA_DEVICES_JSON) {
    try {
      const parsed = JSON.parse(process.env.QA_DEVICES_JSON);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* fall through */ }
  }

  const jobDir = process.env.QA_JOB_DIR ? path.resolve(process.env.QA_JOB_DIR) : null;
  if (jobDir) {
    const runtimePath = path.join(jobDir, 'devices.runtime.json');
    try {
      if (fs.existsSync(runtimePath)) {
        const parsed = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch { /* fall through */ }
  }

  return defaults;
}

module.exports = { loadRuntimeDevices };