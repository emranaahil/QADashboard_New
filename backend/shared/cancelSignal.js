/**
 * Per-job cancellation flag — parent writes, child process reads.
 * Does not modify core Playwright logic; only signals cooperative abort.
 */
const fs = require('fs-extra');
const path = require('path');

const FLAG_NAME = '.cancelled';

function flagPath(jobDir) {
  return path.join(jobDir, FLAG_NAME);
}

function setCancelled(jobDir) {
  if (!jobDir) return;
  fs.ensureDirSync(jobDir);
  fs.writeFileSync(flagPath(jobDir), new Date().toISOString(), 'utf8');
}

function clearCancelled(jobDir) {
  if (!jobDir) return;
  const p = flagPath(jobDir);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function isCancelled(jobDir) {
  if (!jobDir) return false;
  return fs.existsSync(flagPath(jobDir));
}

module.exports = {
  setCancelled,
  clearCancelled,
  isCancelled
};