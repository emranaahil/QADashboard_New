#!/usr/bin/env node
const BASE = process.env.API_BASE || 'http://localhost:3000';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

async function main() {
  const { job } = await fetchJson(`${BASE}/api/modules/full-ui-check/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com', options: { maxPages: 50 } })
  });
  console.log('Started job', job.id);
  await new Promise(r => setTimeout(r, 5000));
  const result = await fetchJson(`${BASE}/api/execution/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId: 'full-ui-check', jobId: job.id })
  });
  console.log('Cancel response status:', result.job?.status);
  await new Promise(r => setTimeout(r, 3000));
  const { job: final } = await fetchJson(`${BASE}/api/modules/full-ui-check/jobs/${job.id}`);
  if (final.status !== 'cancelled') throw new Error(`Expected cancelled, got ${final.status}`);
  console.log('✓ Cancel test passed');
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });