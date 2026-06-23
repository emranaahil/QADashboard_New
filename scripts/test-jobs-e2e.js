#!/usr/bin/env node
/**
 * End-to-end job execution test for SEO, UI Check, and Full UI Check.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

async function waitForJob(moduleId, jobId, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { job } = await fetchJson(`${BASE}/api/modules/${moduleId}/jobs/${jobId}`);
    process.stdout.write(`\r  [${moduleId}] ${job.status} ${job.progress}% — ${job.message || ''}`.padEnd(70));
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      console.log();
      return job;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Timeout waiting for job ${jobId}`);
}

async function testModule(moduleId, url, options = {}, timeoutMs = 180000) {
  console.log(`\n▶ Testing ${moduleId} with ${url}`);
  const { job } = await fetchJson(`${BASE}/api/modules/${moduleId}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, options })
  });
  console.log(`  Created job ${job.id}`);

  const final = await waitForJob(moduleId, job.id, timeoutMs);
  if (final.status !== 'completed') {
    throw new Error(`${moduleId} job ${final.status}: ${final.error || final.message}`);
  }
  if (!final.reportAvailable) {
    throw new Error(`${moduleId} job completed but report not available`);
  }

  const reportRes = await fetch(`${BASE}/api/modules/${moduleId}/jobs/${job.id}/report`);
  if (!reportRes.ok) throw new Error(`Report endpoint failed: ${reportRes.status}`);
  const html = await reportRes.text();
  if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
    throw new Error(`${moduleId} report is not valid HTML`);
  }
  console.log(`  ✓ Report OK (${html.length} bytes)`);

  const { jobs } = await fetchJson(`${BASE}/api/modules/${moduleId}/jobs`);
  const found = jobs.find(j => j.id === job.id);
  if (!found) throw new Error(`${moduleId} job not in history`);
  console.log(`  ✓ History persisted`);

  const { reports } = await fetchJson(`${BASE}/api/modules/${moduleId}/reports`);
  const jobReport = reports.find(r => r.id === `job:${job.id}`);
  if (!jobReport?.hasHtml) throw new Error(`${moduleId} job report not in sidebar list`);
  console.log(`  ✓ Sidebar report list OK`);

  return job;
}

async function main() {
  console.log('QA Job E2E Tests');
  console.log('================');

  const health = await fetchJson(`${BASE}/api/health`);
  console.log(`Server: ${health.status}`);

  await testModule('seo', 'https://example.com', { mode: 'single' }, 120000);
  await testModule('ui-check', 'https://example.com', {}, 180000);
  // Full UI check can be slow — use example.com (single page site)
  await testModule('full-ui-check', 'https://example.com', {}, 300000);

  console.log('\n✅ All job E2E tests passed');
}

main().catch(err => {
  console.error('\n❌ E2E failed:', err.message);
  process.exit(1);
});