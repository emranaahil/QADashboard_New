/**
 * Browser launch abstraction — wraps Playwright without replacing config.js launch args.
 */

const BROWSER_CATALOG = [
  { id: 'chrome', label: 'Chrome', engine: 'chromium', channel: null, warning: false },
  { id: 'edge', label: 'Edge', engine: 'chromium', channel: 'msedge', warning: false },
  { id: 'brave', label: 'Brave', engine: 'chromium', channel: 'brave', warning: false },
  { id: 'opera', label: 'Opera', engine: 'chromium', channel: 'opera', warning: false },
  { id: 'firefox', label: 'Firefox', engine: 'firefox', channel: null, warning: true },
  { id: 'safari', label: 'Safari', engine: 'webkit', channel: null, warning: true }
];

const VALID_IDS = new Set(BROWSER_CATALOG.map(b => b.id));

function getCatalog() {
  return BROWSER_CATALOG.map(({ id, label, warning }) => ({ id, label, warning }));
}

function normalizeBrowserType(type) {
  const t = String(type || 'chrome').toLowerCase();
  return VALID_IDS.has(t) ? t : 'chrome';
}

function getPlaywright() {
  try {
    return require('playwright');
  } catch {
    return require(require('path').join(__dirname, '..', '..', '..', 'node_modules', 'playwright'));
  }
}

/**
 * Launch browser using existing config.browserLaunch options + selected browser type.
 */
async function launchBrowser(baseLaunchOptions = {}, browserType = 'chrome') {
  const type = normalizeBrowserType(process.env.QA_BROWSER_TYPE || browserType);
  const spec = BROWSER_CATALOG.find(b => b.id === type) || BROWSER_CATALOG[0];
  const pw = getPlaywright();

  const launchOpts = { ...(baseLaunchOptions || {}), headless: baseLaunchOptions.headless !== false };
  if (spec.channel) launchOpts.channel = spec.channel;

  if (spec.engine === 'firefox') {
    return pw.firefox.launch(launchOpts);
  }
  if (spec.engine === 'webkit') {
    return pw.webkit.launch(launchOpts);
  }
  return pw.chromium.launch(launchOpts);
}

function applyBrowserToEnv(browserType) {
  if (browserType) {
    process.env.QA_BROWSER_TYPE = normalizeBrowserType(browserType);
  }
}

module.exports = {
  BROWSER_CATALOG,
  getCatalog,
  normalizeBrowserType,
  launchBrowser,
  applyBrowserToEnv
};