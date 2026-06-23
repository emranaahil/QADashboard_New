const { BACKEND_ROOT, resolveModuleFolder, backendModuleDir } = require('./storagePaths');

/**
 * Central module registry.
 * Add a new entry here to register a module — no other files need modification.
 */
const MODULES = [
  {
    id: 'keyword-check',
    name: 'Keyword Check',
    description: 'Crawl websites and find exact keyword matches with PDF reports.',
    icon: '🔍',
    route: '/modules/keyword-check',
    hasRunner: true,
    reportTypes: ['json', 'pdf'],
    reader: () => require('../keyword-check/reportReader')
  },
  {
    id: 'error-check',
    name: 'Error Check',
    description: 'Detect broken pages, 404s, and broken internal links.',
    icon: '⚠️',
    route: '/modules/error-check',
    hasRunner: true,
    reportTypes: ['json'],
    reader: () => require('../error-check/reportReader')
  },
  {
    id: 'seo',
    name: 'SEO Check',
    description: 'Audit meta tags, headings, Open Graph, and SEO best practices.',
    icon: '📈',
    route: '/modules/seo',
    hasRunner: true,
    reportTypes: ['json', 'html'],
    reader: () => require(`../${resolveModuleFolder('seo')}/reportReader`)
  },
  {
    id: 'ui-check',
    name: 'UI Check',
    description: 'Single-URL visual QA — layout, contrast, images, and buttons.',
    icon: '🎨',
    route: '/modules/ui-check',
    hasRunner: true,
    reportTypes: ['json', 'html'],
    reader: () => require('../ui-check/reportReader')
  },
  {
    id: 'full-ui-check',
    name: 'Full UI Check',
    description: 'Crawl an entire site and run UI checks on every page.',
    icon: '🌐',
    route: '/modules/full-ui-check',
    hasRunner: true,
    reportTypes: ['json', 'html'],
    reader: () => require('../full-ui-check/reportReader')
  }
];

function getModule(id) {
  return MODULES.find(m => m.id === id) || null;
}

function listModules() {
  return MODULES.map(({ id, name, description, icon, route, hasRunner, reportTypes }) => ({
    id, name, description, icon, route, hasRunner, reportTypes
  }));
}

function getReader(moduleId) {
  const mod = getModule(moduleId);
  if (!mod) return null;
  return mod.reader();
}

module.exports = {
  BACKEND_ROOT,
  MODULES,
  getModule,
  listModules,
  getReader,
  resolveModuleFolder,
  backendModuleDir
};