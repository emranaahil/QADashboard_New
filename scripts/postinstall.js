/**
 * Install Playwright Chromium locally; skip in Docker/production when flagged.
 */
const { execSync } = require('child_process');

const skip =
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === 'true' ||
  process.env.CI === 'true' && process.env.RENDER === 'true';

if (skip) {
  console.log('[postinstall] Skipping Playwright browser download (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true)');
  process.exit(0);
}

try {
  console.log('[postinstall] Installing Playwright Chromium…');
  execSync('npx playwright install chromium', { stdio: 'inherit' });
} catch (err) {
  console.warn('[postinstall] Playwright install failed — run: npm run playwright');
  console.warn(err.message);
}