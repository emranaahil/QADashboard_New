const config = require('./config');
const browserService = require('../../shared/services/browserService');

async function launchBrowser() {
  return browserService.launchBrowser(
    config.browserLaunch || { headless: true, args: ['--no-sandbox'] },
    process.env.QA_BROWSER_TYPE || 'chrome'
  );
}

module.exports = { launchBrowser };