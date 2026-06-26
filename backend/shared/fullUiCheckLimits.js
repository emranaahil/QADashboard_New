/** Full website UI check page limits — tuned for low-RAM hosts (Render Starter). */

const DEFAULT_MAX_PAGES = 8;
const WARN_ABOVE_PAGES = 10;
const DEV_MAX_PAGES = 50;

function isProductionHost() {
  return process.env.NODE_ENV === 'production' &&
    (process.env.RENDER === 'true' || Boolean(process.env.STORAGE_ROOT));
}

function getHardCap() {
  const envCap = Number(process.env.FULL_UI_MAX_PAGES_CAP);
  if (Number.isFinite(envCap) && envCap > 0) return Math.floor(envCap);
  return isProductionHost() ? 12 : DEV_MAX_PAGES;
}

function normalizeMaxPages(requested) {
  const parsed = parseInt(requested, 10);
  const wanted = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PAGES;
  const cap = getHardCap();
  return Math.min(Math.max(1, wanted), cap);
}

function shouldWarnAbove(requested) {
  const parsed = parseInt(requested, 10);
  return Number.isFinite(parsed) && parsed > WARN_ABOVE_PAGES;
}

function wasCapped(requested) {
  const parsed = parseInt(requested, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return false;
  return parsed > getHardCap();
}

module.exports = {
  DEFAULT_MAX_PAGES,
  WARN_ABOVE_PAGES,
  DEV_MAX_PAGES,
  isProductionHost,
  getHardCap,
  normalizeMaxPages,
  shouldWarnAbove,
  wasCapped
};