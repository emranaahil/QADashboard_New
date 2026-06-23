#!/usr/bin/env node

// Production CLI entry for SEO auditing.
// Usage: node runseo.js https://example.com

const fs = require('fs');
const path = require('path');

const { runSeoAudit } = require('./uiseocheck');


function log(...args) {
  process.stdout.write(args.join(' ') + '\n');
}

function normalizeArgUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') throw new Error('URL argument is required');
  let url = inputUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/$/, '');
  return url;
}

async function main() {
  const inputUrl = process.argv[2];
  if (!inputUrl) {
    log('Usage: node runseo.js <url>');
    process.exit(1);
  }

  const mainUrl = normalizeArgUrl(inputUrl);
  const scanDate = new Date().toISOString();

  log('🔎 SEO audit started for:', mainUrl);

  console.time('SEO Audit');
  const modeArg = process.argv[3];
  let mode = "full";
  if (modeArg === "single") mode = "single";
  if (modeArg === "full" || !modeArg) mode = "full";

  console.log("🧪 CLI MODE:", mode);

  const report = await runSeoAudit({ mainUrl, mode });
  console.timeEnd('SEO Audit');

  log('🎉 SEO audit finished. Writing reports...');

  const seoReport = {
    mainUrl: report.meta.mainUrl,
    scanDate,
    sitemapUsed: report.meta.sitemapUsed,
    urlsAttempted: report.meta.urlsAttempted,
    concurrency: report.meta.concurrency,
    timeoutMs: report.meta.timeoutMs,
    pages: report.pages,
    summary: report.summary
  };

  const reportsDir = path.join(__dirname, 'reports');
  const seoReportPath = path.join(reportsDir, 'seoReport.json');
  const reportHtmlPath = path.join(reportsDir, 'reportseo.html');

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(seoReportPath, JSON.stringify(seoReport, null, 2), 'utf8');
  const html = report.htmlReport;
  if (!html || typeof html !== 'string') {
    throw new Error('uiseocheck.js did not return htmlReport as a string');
  }
  fs.writeFileSync(reportHtmlPath, html, 'utf8');

}

main().catch((e) => {
  console.error('❌ SEO audit failed:', e?.stack || e?.message || e);
  process.exit(1);
});







