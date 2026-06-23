#!/usr/bin/env node
/**
 * Stress test: spam cancel endpoint — server must stay stable.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const health = await fetchJson(`${BASE}/api/health`);
  if (!health.ok) throw new Error('API not running on ' + BASE);

  const { data: created } = await fetchJson(`${BASE}/api/modules/full-ui-check/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com', options: { maxPages: 10 } })
  });
  if (!created.job?.id) throw new Error('Failed to start job');
  const jobId = created.job.id;
  console.log('Started job', jobId);

  await new Promise((r) => setTimeout(r, 2000));

  const cancels = Array.from({ length: 8 }, () =>
    fetchJson(`${BASE}/api/execution/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleId: 'full-ui-check', jobId })
    })
  );
  const results = await Promise.all(cancels);
  const allOk = results.every((r) => r.data.ok !== false || r.data.job?.status === 'cancelled');
  if (!allOk) {
    console.error('Some cancel responses failed:', results.map((r) => r.data));
    throw new Error('Multi-cancel returned errors');
  }
  console.log('✓ 8 parallel cancel calls handled without crash');

  await new Promise((r) => setTimeout(r, 2000));

  const { data: final } = await fetchJson(`${BASE}/api/modules/full-ui-check/jobs/${jobId}`);
  if (final.job?.status !== 'cancelled') {
    throw new Error(`Expected cancelled, got ${final.job?.status}`);
  }
  console.log('✓ Job status is cancelled');

  const health2 = await fetchJson(`${BASE}/api/health`);
  if (!health2.ok) throw new Error('Server crashed after multi-cancel');
  console.log('✓ Server still healthy after multi-cancel');
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});