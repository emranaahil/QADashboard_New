/**
 * Browser launch abstraction — wraps Playwright without replacing config.js launch args.
 */

const BROWSER_CATALOG = [
  {
    id: 'chrome',
    label: 'Chrome',
    engine: 'chromium',
    channel: null,
    warning: false,
    ui: true,
    hint: 'Recommended — fastest and most consistent.'
  },
  { id: 'edge', label: 'Edge', engine: 'chromium', channel: 'msedge', warning: false, ui: false },
  { id: 'brave', label: 'Brave', engine: 'chromium', channel: 'brave', warning: false, ui: false },
  { id: 'opera', label: 'Opera', engine: 'chromium', channel: 'opera', warning: false, ui: false },
  {
    id: 'firefox',
    label: 'Firefox',
    engine: 'firefox',
    channel: null,
    warning: true,
    ui: true,
    hint: 'Layout results may differ from Chrome.'
  },
  {
    id: 'safari',
    label: 'Safari',
    engine: 'webkit',
    channel: null,
    warning: true,
    ui: true,
    hint: 'Server-side WebKit — approximates Safari layout.'
  }
];

const UI_BROWSER_IDS = new Set(BROWSER_CATALOG.filter((b) => b.ui).map((b) => b.id));
const VALID_IDS = new Set(BROWSER_CATALOG.map(b => b.id));

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--disable-gpu'
];

function toPublicBrowser(entry) {
  return {
    id: entry.id,
    label: entry.label,
    warning: entry.warning,
    hint: entry.hint || null
  };
}

function getCatalog({ scope } = {}) {
  const list = scope === 'ui'
    ? BROWSER_CATALOG.filter((b) => b.ui)
    : BROWSER_CATALOG;
  return list.map(toPublicBrowser);
}

function normalizeBrowserType(type) {
  const t = String(type || 'chrome').toLowerCase();
  if (UI_BROWSER_IDS.has(t)) return t;
  return VALID_IDS.has(t) ? t : 'chrome';
}

function getBrowserSpec(browserType) {
  const type = normalizeBrowserType(browserType);
  return BROWSER_CATALOG.find((b) => b.id === type) || BROWSER_CATALOG[0];
}

/**
 * Engine-specific launch options — Chromium flags are not passed to Firefox/WebKit.
 */
function buildLaunchOptions(baseLaunchOptions = {}, browserType = 'chrome') {
  const spec = getBrowserSpec(browserType);
  const headless = baseLaunchOptions.headless !== false;
  const baseArgs = Array.isArray(baseLaunchOptions.args) ? baseLaunchOptions.args : [];

  if (spec.engine === 'firefox') {
    return {
      headless,
      firefoxUserPrefs: {
        'dom.ipc.processCount': 1,
        'media.navigator.enabled': false,
        'devtools.console.stdout.chrome': false
      }
    };
  }

  if (spec.engine === 'webkit') {
    return { headless };
  }

  const chromiumArgs = [...new Set([...CHROMIUM_ARGS, ...baseArgs])];
  const launchOpts = { headless, args: chromiumArgs };
  if (spec.channel) launchOpts.channel = spec.channel;
  return launchOpts;
}

/**
 * Reuse one browser context per device — fewer page creations for Firefox/WebKit.
 */
function buildContextOptions(browserType, viewport) {
  const spec = getBrowserSpec(browserType);
  const context = {
    viewport,
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    serviceWorkers: 'block'
  };

  if (spec.engine === 'firefox') {
    context.javaScriptEnabled = true;
  }

  return context;
}

/** More frequent browser restarts for heavier engines on long full-site crawls. */
function getBrowserRestartEvery(browserType, configuredEvery = 50) {
  const spec = getBrowserSpec(browserType);
  if (spec.engine === 'firefox') return Math.min(configuredEvery, 25);
  if (spec.engine === 'webkit') return Math.min(configuredEvery, 20);
  return configuredEvery;
}

/** Slightly longer navigation timeout for non-Chromium engines. */
function getNavigationTimeout(baseTimeout = 60000, browserType = 'chrome') {
  const spec = getBrowserSpec(browserType);
  if (spec.engine === 'firefox') return Math.max(baseTimeout, 75000);
  if (spec.engine === 'webkit') return Math.max(baseTimeout, 80000);
  return baseTimeout;
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
  const spec = getBrowserSpec(type);
  const pw = getPlaywright();
  const launchOpts = buildLaunchOptions(baseLaunchOptions, type);

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
  UI_BROWSER_IDS,
  getCatalog,
  normalizeBrowserType,
  getBrowserSpec,
  buildLaunchOptions,
  buildContextOptions,
  getBrowserRestartEvery,
  getNavigationTimeout,
  launchBrowser,
  applyBrowserToEnv
};