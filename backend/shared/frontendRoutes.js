/**
 * Serve the static frontend (production / Render single-service deploy).
 */
const path = require('path');
const fs = require('fs');
const express = require('express');

const FRONTEND_ROOT = path.resolve(__dirname, '../../frontend');

const PAGE_MAP = {
  '/': 'index.html',
  '/dashboard': 'index.html',
  '/ui-testing': 'pages/ui-testing/index.html',
  '/seo-testing': 'pages/seo-testing/index.html',
  '/keyword-radar': 'pages/keyword-radar/index.html',
  '/linkradar': 'pages/linkradar/index.html',
  '/link-radar': 'pages/linkradar/index.html',
  '/history': 'pages/history/index.html',
  '/reports': 'pages/reports/index.html'
};

function isInsideRoot(root, filePath) {
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(root);
  return resolved === rootResolved || resolved.startsWith(`${rootResolved}${path.sep}`);
}

function resolvePagePath(reqPath) {
  const clean = (reqPath.split('?')[0] || '/').replace(/\/+$/, '') || '/';

  if (PAGE_MAP[clean]) {
    return path.join(FRONTEND_ROOT, PAGE_MAP[clean]);
  }

  const modMatch = clean.match(/^\/modules\/([a-z0-9-]+)$/);
  if (modMatch) {
    return path.join(FRONTEND_ROOT, 'modules', modMatch[1], 'index.html');
  }

  return null;
}

function mountFrontend(app) {
  app.use(
    express.static(FRONTEND_ROOT, {
      index: false,
      dotfiles: 'deny',
      fallthrough: true
    })
  );

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }

    const pagePath = resolvePagePath(req.path);
    if (!pagePath || !fs.existsSync(pagePath) || !isInsideRoot(FRONTEND_ROOT, pagePath)) {
      return next();
    }

    res.sendFile(pagePath);
  });
}

module.exports = { mountFrontend, FRONTEND_ROOT };