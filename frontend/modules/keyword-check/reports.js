function renderKeywordReport(result, viewerEl) {
  const data = result.data;
  if (!data) {
    viewerEl.innerHTML = '<div class="alert alert-empty">Invalid keyword scan report.</div>';
    return;
  }

  const results = data.results || [];
  const matches = data.matches || [];
  const rows = results.length ? results.map(item => {
    const kws = (item.matchedKeywords || []).join(', ') || '—';
    const isErr = item.isError || (item.statusCode >= 400);
    return `<tr style="${isErr ? 'background:#fef2f2' : ''}">
      <td style="word-break:break-all;"><a href="${item.url}" target="_blank">${item.url}</a></td>
      <td>${item.statusCode || '—'}</td>
      <td>${kws}</td>
    </tr>`;
  }).join('') : matches.map(m => `<tr>
    <td style="word-break:break-all;"><a href="${m.url}" target="_blank">${m.url}</a></td>
    <td>—</td>
    <td>${m.keyword}</td>
  </tr>`).join('');

  viewerEl.innerHTML = `
    <h2 class="card-title">${data.url || 'Keyword Scan'}</h2>
    <p class="form-hint">Status: <strong>${data.status}</strong> · Keywords: ${(data.keywords || []).join(', ')}</p>
    <div class="stats-grid">
      <div class="stat-item"><span class="stat-value">${data.stats?.urlsProcessed || 0}</span><span class="stat-label">Processed</span></div>
      <div class="stat-item highlight"><span class="stat-value">${data.stats?.matchesFound || matches.length}</span><span class="stat-label">Matches</span></div>
    </div>
    <div class="table-container"><table class="results-table">
      <thead><tr><th>URL</th><th>Status</th><th>Keywords</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3">No results</td></tr>'}</tbody>
    </table></div>`;
}

window.renderKeywordReport = renderKeywordReport;