const fs = require('fs');
const path = require('path');

function ensureScreenshotDir(screenshotDir) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

function createSlug(input) {
  const s = String(input ?? '');
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function getScreenshotPath({ screenshotDir, pageName, deviceLabel, tag, ext = 'png' }) {
  const slug = createSlug(pageName);
  const safeDevice = createSlug(deviceLabel).replace(/-/g, '_');
  const safeTag = createSlug(tag).replace(/-/g, '_');
  const fileName = `${slug}__${safeDevice}__${safeTag}.${ext}`;
  return path.join(screenshotDir, fileName);
}

async function takeScreenshotSafe(page, screenshotPath, { fullPage = true } = {}) {
  ensureScreenshotDir(path.dirname(screenshotPath));

  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage
    });
    return screenshotPath;
  } catch (e) {
    // Do not crash the run for screenshot failures.
    return null;
  }
}

module.exports = {
  ensureScreenshotDir,
  createSlug,
  getScreenshotPath,
  takeScreenshotSafe
};

