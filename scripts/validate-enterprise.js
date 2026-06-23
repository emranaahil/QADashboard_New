#!/usr/bin/env node
/**
 * Enterprise upgrade validation — APIs, pages, backward compatibility.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  return { ok: res.ok, status: res.status, data };
}

async function fetchStatus(url) {
  const res = await fetch(url, { redirect: 'manual' });
  return res.status;
}

const results = [];

function pass(name) { results.push({ name, ok: true }); console.log(`  ✓ ${name}`); }
function fail(name, msg) { results.push({ name, ok: false, msg }); console.log(`  ✗ ${name}: ${msg}`); }

async function main() {
  console.log('Enterprise Validation Report');
  console.log('============================\n');

  const health = await fetchJson(`${BASE}/api/health`);
  health.ok && health.data.status === 'healthy' ? pass('Health endpoint') : fail('Health endpoint', health.data.message || String(health.status));

  const stats = await fetchJson(`${BASE}/api/dashboard/stats`);
  stats.ok && typeof stats.data.totalTests === 'number' ? pass('Dashboard stats') : fail('Dashboard stats', stats.data.message);

  const history = await fetchJson(`${BASE}/api/history`);
  history.ok && Array.isArray(history.data.items) ? pass('History API') : fail('History API', history.data.message);

  const reports = await fetchJson(`${BASE}/api/reports-center`);
  reports.ok && Array.isArray(reports.data.reports) ? pass('Reports center API') : fail('Reports center API', reports.data.message);

  const devices = await fetchJson(`${BASE}/api/config/devices`);
  devices.ok && devices.data.devices?.length >= 9 ? pass('Device config (9+ presets)') : fail('Device config', 'missing devices');

  const browsers = await fetchJson(`${BASE}/api/config/browsers`);
  browsers.ok && browsers.data.browsers?.length >= 6 ? pass('Browser config') : fail('Browser config', 'missing browsers');

  const modules = await fetchJson(`${BASE}/api/modules`);
  modules.ok && modules.data.modules?.length >= 5 ? pass('Modules API preserved') : fail('Modules API', 'broken');

  const pages = [
    ['/', 200],
    ['/ui-testing', 200],
    ['/seo-testing', 200],
    ['/history', 200],
    ['/reports', 200],
    ['/keyword-radar', 200],
    ['/linkradar', 200],
    ['/modules/ui-check?legacy=1', 200],
    ['/modules/full-ui-check?legacy=1', 200],
    ['/modules/seo?legacy=1', 200],
    ['/modules/keyword-check?legacy=1', 200],
    ['/modules/error-check?legacy=1', 200]
  ];

  for (const [path, expected] of pages) {
    const status = await fetchStatus(`${BASE}${path}`);
    if (status === expected || (expected === 200 && status < 400)) pass(`Page ${path}`);
    else fail(`Page ${path}`, `HTTP ${status}`);
  }

  const redirectUi = await fetchStatus(`${BASE}/modules/ui-check`);
  redirectUi === 301 || redirectUi === 302 || redirectUi === 200 ? pass('UI check compatibility redirect') : fail('UI check redirect', String(redirectUi));

  const redirectSeo = await fetchStatus(`${BASE}/modules/seo`);
  redirectSeo < 400 ? pass('SEO compatibility route') : fail('SEO route', String(redirectSeo));

  console.log('\n============================');
  const failed = results.filter(r => !r.ok);
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('\nFailures:');
    failed.forEach(f => console.log(`  - ${f.name}: ${f.msg}`));
    process.exit(1);
  }
  console.log('\n✅ Enterprise validation passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});