const fs = require('fs-extra');
const path = require('path');
const { validateUuid } = require('./uuidUtils');
const { BACKEND_ROOT, sharedDataPath } = require('./storagePaths');

const TREE_MAPPINGS = [
  { src: ['ui-check', 'jobs'], dest: ['ui-check', 'jobs'] },
  { src: ['full-ui-check', 'jobs'], dest: ['full-ui-check', 'jobs'] },
  { src: ['SEO', 'jobs'], dest: ['seo', 'jobs'] },
  { src: ['SEO', 'reports'], dest: ['seo', 'reports'] },
  { src: ['error-check', 'reports'], dest: ['error-check', 'reports'] },
  { src: ['keyword-check', 'storage'], dest: ['keyword-check', 'storage'] }
];

function manifestPath() {
  return sharedDataPath('bundled-reports-manifest.json');
}

function toPosixRelative(parts) {
  return parts.map(p => String(p).replace(/\\/g, '/')).join('/');
}

function walkFilesSync(rootDir, onFile) {
  if (!fs.existsSync(rootDir)) return;

  for (const name of fs.readdirSync(rootDir)) {
    if (name.startsWith('.')) continue;
    const fullPath = path.join(rootDir, name);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkFilesSync(fullPath, (rel) => onFile(path.join(name, rel)));
    } else {
      onFile(name);
    }
  }
}

function collectBundledSnapshot() {
  const jobs = {};
  const paths = new Set();

  for (const { src, dest } of TREE_MAPPINGS) {
    const srcRoot = path.join(BACKEND_ROOT, ...src);
    if (!fs.existsSync(srcRoot)) continue;

    const destPrefix = dest.slice(0, -1);
    const leaf = dest[dest.length - 1];

    if (leaf === 'jobs') {
      const moduleId = dest[0];
      jobs[moduleId] = jobs[moduleId] || [];

      for (const entry of fs.readdirSync(srcRoot)) {
        if (!validateUuid(entry)) continue;
        jobs[moduleId].push(entry);

        const jobFile = path.join(srcRoot, entry, 'job.json');
        if (!fs.existsSync(jobFile)) continue;
        try {
          const job = fs.readJsonSync(jobFile);
          if (job.reportRunId) {
            paths.add(toPosixRelative(['seo', 'reports', job.reportRunId]));
          }
        } catch {
          /* ignore invalid job.json */
        }
      }
      continue;
    }

    walkFilesSync(srcRoot, (relPath) => {
      paths.add(toPosixRelative([...dest, relPath]));
    });
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    jobs,
    paths: [...paths].sort()
  };
}

function refreshBundledManifestSync() {
  const manifest = collectBundledSnapshot();
  const filePath = manifestPath();
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeJsonSync(filePath, manifest, { spaces: 2 });
  return manifest;
}

function loadManifestSync() {
  const filePath = manifestPath();
  if (!fs.existsSync(filePath)) {
    return { version: 1, updatedAt: null, jobs: {}, paths: [] };
  }
  try {
    return fs.readJsonSync(filePath);
  } catch {
    return { version: 1, updatedAt: null, jobs: {}, paths: [] };
  }
}

function isProtectedJob(moduleId, jobId) {
  const manifest = loadManifestSync();
  const ids = manifest.jobs?.[moduleId] || [];
  return ids.includes(jobId);
}

function isProtectedPath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return false;
  const manifest = loadManifestSync();
  return (manifest.paths || []).includes(normalized);
}

module.exports = {
  TREE_MAPPINGS,
  manifestPath,
  collectBundledSnapshot,
  refreshBundledManifestSync,
  loadManifestSync,
  isProtectedJob,
  isProtectedPath,
  toPosixRelative
};