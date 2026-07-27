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
    reportTypes: ['json', 'html', 'pdf'],
    reader: () => require('../keyword-check/reportReader')
  },
  {
    id: 'error-check',
    name: 'Error Check',
    description: 'Detect broken pages, 404s, and broken internal links.',
    icon: '⚠️',
    route: '/modules/error-check',
    hasRunner: true,
    reportTypes: ['json', 'html'],
    reader: () => require('../error-check/reportReader')
  },
  {
    id: 'seo',
    name: 'Seo/Geo Audit',
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
  },
  {
    id: 'sitemap-check',
    name: 'Sitemap Audit',
    description: 'Parse sitemap.xml and verify HTTP status and page health for every URL.',
    icon: '🗺️',
    route: '/modules/sitemap-check',
    hasRunner: true,
    reportTypes: ['json', 'html'],
    reader: () => require('../sitemap-check/reportReader')
  },
  {
    id: 'image-audit',
    name: 'Image Audit',
    description: 'Audit images for duplicates, CDN, optimization, accessibility, and SEO.',
    icon: '🖼️',
    route: '/modules/image-audit',
    hasRunner: true,
    reportTypes: ['json', 'html', 'csv'],
    reader: () => require('../image-audit/reportReader')
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'PageSpeed, W3C HTML validation, robots.txt, redirects, and SSL Labs.',
    icon: '🛡️',
    route: '/modules/security-audit',
    hasRunner: true,
    reportTypes: ['json', 'html'],
    reader: () => require('../security-audit/reportReader')
  },
  {
    id: 'visual-twin',
    name: 'Visual Twin',
    description: 'Compare reference site vs candidate clone — headings, text, images, layout.',
    icon: '🪞',
    route: '/modules/visual-twin',
    hasRunner: true,
    reportTypes: ['json', 'html'],
    reader: () => require('../visual-twin/reportReader')
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