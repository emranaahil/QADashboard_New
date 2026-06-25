#!/usr/bin/env node
/**
 * Remove keyword scan saved reports for specific URLs only.
 * Usage: node scripts/purge-keyword-reports.js https://asd https://bathmatedirect.com
 */
const fs = require('fs');
const path = require('path');

const SCANS_DIR = path.join(__dirname, '..', 'backend', 'keyword-check', 'storage', 'scans');
const REPORTS_DIR = path.join(__dirname, '..', 'backend', 'keyword-check', 'storage', 'reports');

function normalizeUrl(url) {
  const raw = String(url || '').trim().toLowerCase();
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

const targets = new Set(
  (process.argv.slice(2).length ? process.argv.slice(2) : ['https://asd', 'https://bathmatedirect.com'])
    .map(normalizeUrl)
);

let deleted = 0;
for (const file of fs.readdirSync(SCANS_DIR)) {
  if (!file.endsWith('.json')) continue;
  const filePath = path.join(SCANS_DIR, file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    continue;
  }
  if (!targets.has(normalizeUrl(data.url))) continue;

  fs.unlinkSync(filePath);
  deleted++;
  console.log('Deleted scan:', file, `(${data.url})`);

  if (data.id) {
    const pdfPath = path.join(REPORTS_DIR, `keyword-audit-report-${data.id}.pdf`);
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
      console.log('Deleted pdf:', path.basename(pdfPath));
    }
  }
}

console.log(`Done. Removed ${deleted} keyword scan report(s).`);