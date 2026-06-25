const fs = require('fs-extra');
const path = require('path');
const { BACKEND_ROOT, STORAGE_ROOT } = require('./storagePaths');

/**
 * Bundled report paths in the repo (backend/) → runtime paths when STORAGE_ROOT is set.
 * SEO folder is uppercase on disk but module id is lowercase in STORAGE_ROOT.
 */
const TREE_MAPPINGS = [
  { src: ['ui-check', 'jobs'], dest: ['ui-check', 'jobs'] },
  { src: ['full-ui-check', 'jobs'], dest: ['full-ui-check', 'jobs'] },
  { src: ['SEO', 'jobs'], dest: ['seo', 'jobs'] },
  { src: ['SEO', 'reports'], dest: ['seo', 'reports'] },
  { src: ['error-check', 'reports'], dest: ['error-check', 'reports'] },
  { src: ['keyword-check', 'storage'], dest: ['keyword-check', 'storage'] }
];

function shouldSeed() {
  if (!process.env.STORAGE_ROOT) return false;
  if (process.env.SEED_BUNDLED_REPORTS === 'false') return false;
  return true;
}

function mergeTreeSync(src, dest, stats) {
  if (!fs.existsSync(src)) return;

  fs.ensureDirSync(dest);
  for (const name of fs.readdirSync(src)) {
    if (name.startsWith('.')) continue;

    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    const srcStat = fs.statSync(srcPath);

    if (srcStat.isDirectory()) {
      mergeTreeSync(srcPath, destPath, stats);
      continue;
    }

    if (fs.existsSync(destPath)) {
      stats.skipped += 1;
      continue;
    }

    fs.copyFileSync(srcPath, destPath);
    stats.copied += 1;
  }
}

function mergeTestExecutionsIndexSync(stats) {
  const src = path.join(BACKEND_ROOT, 'shared', 'data', 'test-executions.json');
  const dest = path.join(STORAGE_ROOT, 'shared', 'data', 'test-executions.json');

  if (!fs.existsSync(src)) return;

  let destData = {};
  if (fs.existsSync(dest)) {
    try {
      destData = fs.readJsonSync(dest);
    } catch {
      destData = {};
    }
  }

  const srcData = fs.readJsonSync(src);
  let changed = false;

  for (const [key, value] of Object.entries(srcData)) {
    if (!(key in destData)) {
      destData[key] = value;
      changed = true;
      stats.indexMerged += 1;
    }
  }

  if (!changed) return;

  fs.ensureDirSync(path.dirname(dest));
  fs.writeJsonSync(dest, destData, { spaces: 2 });
}

function seedBundledStorageSync() {
  if (!shouldSeed()) return null;

  const stats = { copied: 0, skipped: 0, indexMerged: 0 };

  for (const { src, dest } of TREE_MAPPINGS) {
    mergeTreeSync(
      path.join(BACKEND_ROOT, ...src),
      path.join(STORAGE_ROOT, ...dest),
      stats
    );
  }

  mergeTestExecutionsIndexSync(stats);

  if (stats.copied > 0 || stats.indexMerged > 0) {
    console.log(
      `[storage] Seeded bundled reports into ${STORAGE_ROOT} ` +
        `(copied ${stats.copied} files, merged ${stats.indexMerged} index entries)`
    );
  }

  return stats;
}

module.exports = {
  seedBundledStorageSync,
  shouldSeed
};