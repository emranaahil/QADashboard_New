function renderSeoReport(result, viewerEl) {
  const data = result.data;
  if (!data || !data.pages) {
    viewerEl.innerHTML = '<div class="alert alert-empty">Invalid SEO report data.</div>';
    return;
  }

  const summary = data.summary || {};
  let rows = data.pages.map(p => {
    const crit = (p.issues?.critical || []).length;
    const minor = (p.issues?.minor || []).length;
    const score = p.seoScore ?? '—';
    return `<tr>
      <td style="word-break:break-all;"><a href="${p.url}" target="_blank">${p.url}</a></td>
      <td>${p.title || '—'}</td>
      <td>${p.h1Count ?? 0}</td>
      <td><span class="issue-pill ${crit ? 'issue-critical' : 'issue-pass'}">${crit} critical</span>
          <span class="issue-pill ${minor ? 'issue-minor' : 'issue-pass'}">${minor} minor</span></td>
      <td><strong>${score}</strong></td>
    </tr>`;
  }).join('');

  viewerEl.innerHTML = `
    <h2 class="card-title">SEO Audit — ${data.mainUrl || 'Unknown'}</h2>
    <div class="stats-grid">
      <div class="stat-item"><span class="stat-value">${summary.totalPages || data.pages.length}</span><span class="stat-label">Pages</span></div>
      <div class="stat-item highlight"><span class="stat-value">${summary.totalCritical || 0}</span><span class="stat-label">Critical</span></div>
      <div class="stat-item"><span class="stat-value">${summary.totalMinor || 0}</span><span class="stat-label">Minor</span></div>
      <div class="stat-item"><span class="stat-value">${Math.round(summary.averageScore || 0)}</span><span class="stat-label">Avg Score</span></div>
    </div>
    <p class="form-hint">Scanned: ${data.scanDate ? new Date(data.scanDate).toLocaleString() : '—'}</p>
    <div class="table-container"><table class="results-table">
      <thead><tr><th>URL</th><th>Title</th><th>H1</th><th>Issues</th><th>Score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

window.renderSeoReport = renderSeoReport;