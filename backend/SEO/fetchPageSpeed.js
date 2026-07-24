#!/usr/bin/env node

require('../shared/loadEnv');
const { fetchPageSpeedInsightsBoth } = require('../shared/services/pageSpeedInsights');

const TARGET_URL = process.env.PAGESPEED_TARGET_URL || 'https://example.com';

function printDivider(char = '─', width = 52) {
  console.log(char.repeat(width));
}

function scoreBar(score) {
  if (score == null) return '—';
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  const color = score >= 90 ? '\x1b[32m' : score >= 50 ? '\x1b[33m' : '\x1b[31m';
  const reset = '\x1b[0m';
  return `${color}${'█'.repeat(filled)}${'░'.repeat(empty)}${reset} ${score}`;
}

function printScoreRow(label, score) {
  const padded = label.padEnd(16, ' ');
  console.log(`  ${padded} ${scoreBar(score)}`);
}

function printStrategyBlock(label, result) {
  console.log('');
  console.log(`  ${label}`);
  printDivider();
  if (!result || result.skipped) {
    console.log(`  Skipped: ${result?.reason || 'not configured'}`);
    return;
  }
  if (result.error) {
    console.log(`  Error: ${result.error}`);
    return;
  }
  printScoreRow('Performance', result.performance);
  printScoreRow('Accessibility', result.accessibility);
  printScoreRow('SEO', result.seo);
  const metrics = result.metrics || {};
  console.log('');
  console.log(`  FCP  ${metrics.fcp || '—'}`);
  console.log(`  LCP  ${metrics.lcp || '—'}`);
  console.log(`  CLS  ${metrics.cls || '—'}`);
  console.log(`  TBT  ${metrics.tbt || '—'}`);
}

async function main() {
  try {
    console.log('');
    printDivider('═');
    console.log('  Google PageSpeed Insights — Mobile & Desktop');
    printDivider('═');
    console.log(`  URL: ${TARGET_URL}`);

    const data = await fetchPageSpeedInsightsBoth(TARGET_URL);
    if (data.skipped) {
      throw new Error(data.reason || 'PAGESPEED_API_KEY not configured');
    }

    printStrategyBlock('Mobile', data.mobile);
    printStrategyBlock('Desktop', data.desktop);
    console.log('');
    printDivider('═');
    console.log('');
  } catch (err) {
    console.error('');
    console.error('PageSpeed fetch failed');
    console.error(err?.message || String(err));
    console.error('');
    process.exitCode = 1;
  }
}

main();