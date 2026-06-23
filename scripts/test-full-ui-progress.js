#!/usr/bin/env node
/**
 * Validates full-ui-check locked progress fields and cancel endpoint.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

async function main() {
  console.log('Full UI Check Progress + Cancel Test');
  console.log('====================================\n');

  const { job } = await fetchJson(`${BASE}/api/modules/full-ui-check/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.com',
      options: {
        devices: ['desktop', { name: 'QA_Tablet', width: 1280, height: 800 }],
        browser: 'chrome',
        maxPages: 10
      }
    })
  });

  console.log(`Created job ${job.id}`);
  let sawLockedTotal = false;
  let lastTotal = null;
  let lastCurrent = null;

  const start = Date.now();
  while (Date.now() - start < 120000) {
    const { job: j } = await fetchJson(`${BASE}/api/modules/full-ui-check/jobs/${job.id}`);
    const total = j.totalPages || j.executionState?.totalPages || 0;
    const current = j.currentPage || j.executionState?.currentPage || 0;

    if (total > 0) {
      if (lastTotal !== null && lastTotal !== total) {
        throw new Error(`totalPages changed from ${lastTotal} to ${total} — must be locked`);
      }
      lastTotal = total;
      sawLockedTotal = true;
    }
    lastCurrent = current;

    process.stdout.write(`\r  status=${j.status} progress=${current}/${total || '?'} (${j.progress}%)`.padEnd(60));

    if (['completed', 'failed', 'cancelled'].includes(j.status)) {
      console.log();
      if (j.status === 'completed') {
        if (!sawLockedTotal) throw new Error('Never saw locked totalPages');
        if (total > 0 && current !== total) {
          console.warn(`  Warning: final current ${current} !== total ${total}`);
        }
        console.log('  ✓ Progress locking OK');
        console.log('  ✓ Job completed');
        return;
      }
      throw new Error(`Job ended with ${j.status}: ${j.error || j.message}`);
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n  Cancelling long-running job...');
  await fetchJson(`${BASE}/api/execution/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId: 'full-ui-check', jobId: job.id })
  });

  await new Promise(r => setTimeout(r, 3000));
  const { job: cancelled } = await fetchJson(`${BASE}/api/modules/full-ui-check/jobs/${job.id}`);
  if (cancelled.status !== 'cancelled') {
    throw new Error(`Expected cancelled, got ${cancelled.status}`);
  }
  console.log('  ✓ Cancel endpoint works');
}

main().catch(err => {
  console.error('\n✗', err.message);
  process.exit(1);
});