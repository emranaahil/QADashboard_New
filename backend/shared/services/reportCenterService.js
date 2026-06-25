/**
 * Reports center adapter — aggregates reports from all registered modules.
 * Wraps module report readers; does not replace per-module report APIs.
 */
const path = require('path');
const { listModules, getReader } = require('../moduleRegistry');
const {
  isJobVisibleToSession,
  isKeywordScanVisible,
  isErrorReportVisible
} = require('../reportVisibility');
const jobStore = require('../jobStore');
const { moduleReportsDir } = require('../storagePaths');

async function listAllReports({ limit = 200, moduleId, sessionId } = {}) {
  const modules = moduleId
    ? listModules().filter(m => m.id === moduleId)
    : listModules();

  const all = [];
  for (const mod of modules) {
    try {
      const reader = getReader(mod.id);
      if (!reader?.listReports) continue;
      const reports = await reader.listReports();
      for (const r of reports) {
        if (jobStore.RUNNABLE_MODULES.has(mod.id)) {
          const job = await jobStore.getJob(mod.id, r.id);
          if (job && !isJobVisibleToSession(job, mod.id, sessionId)) continue;
        } else if (mod.id === 'keyword-check') {
          const stateService = require('../../keyword-check/stateService');
          const scan = await stateService.getScanState(r.id);
          if (scan && !isKeywordScanVisible(scan, sessionId)) continue;
        } else if (mod.id === 'error-check') {
          const rel = path.posix.join('error-check', 'reports', path.basename(String(r.id)));
          const filePath = path.join(moduleReportsDir('error-check'), path.basename(String(r.id)));
          let data = null;
          try {
            data = await require('fs-extra').readJson(filePath);
          } catch {
            data = null;
          }
          if (!isErrorReportVisible(rel, data, sessionId)) continue;
        }

        all.push({
          ...r,
          moduleId: mod.id,
          moduleName: mod.name,
          moduleIcon: mod.icon
        });
      }
    } catch {
      /* skip unreadable module */
    }
  }

  all.sort((a, b) => {
    const ta = new Date(a.generatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.generatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });

  return all.slice(0, limit);
}

module.exports = {
  listAllReports
};