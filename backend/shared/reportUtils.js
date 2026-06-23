const fs = require('fs-extra');
const path = require('path');

async function safeReadJson(filePath) {
  try {
    if (!await fs.pathExists(filePath)) return null;
    return await fs.readJson(filePath);
  } catch {
    return null;
  }
}

async function safeReadText(filePath) {
  try {
    if (!await fs.pathExists(filePath)) return null;
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function listFilesByMtime(dir, { extension, prefix } = {}) {
  try {
    if (!await fs.pathExists(dir)) return [];
    const entries = await fs.readdir(dir);
    const files = [];
    for (const name of entries) {
      if (extension && !name.endsWith(extension)) continue;
      if (prefix && !name.startsWith(prefix)) continue;
      const full = path.join(dir, name);
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      files.push({ name, path: full, mtime: stat.mtime, size: stat.size });
    }
    files.sort((a, b) => b.mtime - a.mtime);
    return files;
  } catch {
    return [];
  }
}

async function listDirsByMtime(dir) {
  try {
    if (!await fs.pathExists(dir)) return [];
    const entries = await fs.readdir(dir);
    const dirs = [];
    for (const name of entries) {
      const full = path.join(dir, name);
      const stat = await fs.stat(full);
      if (!stat.isDirectory()) continue;
      dirs.push({ name, path: full, mtime: stat.mtime });
    }
    dirs.sort((a, b) => b.mtime - a.mtime);
    return dirs;
  } catch {
    return [];
  }
}

function toReportMeta({ id, type, title, generatedAt, size, hasHtml, hasPdf }) {
  return { id, type, title, generatedAt, size: size || 0, hasHtml: !!hasHtml, hasPdf: !!hasPdf };
}

module.exports = {
  safeReadJson,
  safeReadText,
  listFilesByMtime,
  listDirsByMtime,
  toReportMeta
};