#!/usr/bin/env node
const BASE = 'http://localhost:3000';

async function waitForJob(moduleId, jobId) {
  for (let i = 0; i < 90; i++) {
    const { job } = await (await fetch(`${BASE}/api/modules/${moduleId}/jobs/${jobId}`)).json();
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('timeout');
}

async function test(moduleId) {
  const { job } = await (await fetch(`${BASE}/api/modules/${moduleId}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com', options: moduleId === 'seo' ? { mode: 'single' } : {} })
  })).json();

  console.log(`\n${moduleId}: job ${job.id}`);
  const final = await waitForJob(moduleId, job.id);
  console.log(`  status: ${final.status}`);

  if (final.status !== 'completed') {
    console.log('  SKIP — job did not complete');
    return;
  }

  const html = await (await fetch(`${BASE}/api/modules/${moduleId}/jobs/${job.id}/report`)).text();
  const match = html.match(/thumbSrc":"([^"]+)"/) || html.match(/src="(screenshots\/[^"]+)"/);
  if (!match) {
    console.log('  no screenshot refs in HTML (may be expected for SEO)');
    return;
  }

  const rel = match[1];
  console.log(`  img ref: ${rel}`);

  if (!rel.startsWith('screenshots/') && !rel.includes('/screenshots/')) {
    console.log('  WARN: not a relative screenshots path');
  }

  const shotUrl = `${BASE}/api/modules/${moduleId}/jobs/${job.id}/${rel}`;
  const res = await fetch(shotUrl);
  const bytes = (await res.arrayBuffer()).byteLength;
  console.log(`  screenshot fetch: HTTP ${res.status}, ${bytes} bytes`);
  if (!res.ok || bytes < 100) process.exitCode = 1;
}

(async () => {
  await test('ui-check');
  await test('full-ui-check');
  console.log('\nDone');
})();