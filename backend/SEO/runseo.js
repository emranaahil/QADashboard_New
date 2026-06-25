#!/usr/bin/env node

// Production CLI entry for SEO auditing.
// Usage: node runseo.js https://example.com

const { runSeoAudit } = require('./uiseocheck');
const { makeRunId, writeRunArtifacts } = require('./seoReportStorage');

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
  let mode = 'full';
  if (modeArg === 'single') mode = 'single';
  if (modeArg === 'full' || !modeArg) mode = 'full';

  console.log('🧪 CLI MODE:', mode);

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

  const html = report.htmlReport;
  if (!html || typeof html !== 'string') {
    throw new Error('uiseocheck.js did not return htmlReport as a string');
  }

  const runId = makeRunId();
  const saved = await writeRunArtifacts(runId, { seoReport, html });
  log('📁 Reports saved to:', saved.folder);
}

main().catch((e) => {
  console.error('❌ SEO audit failed:', e?.stack || e?.message || e);
  process.exit(1);
});