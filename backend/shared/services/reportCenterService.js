/**
 * Reports center adapter — aggregates reports from all registered modules.
 * Wraps module report readers; does not replace per-module report APIs.
 */
const { listModules, getReader } = require('../moduleRegistry');

async function listAllReports({ limit = 200, moduleId } = {}) {
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