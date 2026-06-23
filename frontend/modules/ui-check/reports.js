function renderUiCheckReport(result, viewerEl) {
  const data = result.data;
  if (!Array.isArray(data)) {
    viewerEl.innerHTML = '<div class="alert alert-empty">Invalid UI check report data.</div>';
    return;
  }

  if (!data.length) {
    viewerEl.innerHTML = '<div class="alert alert-info">Scan completed with no issues recorded.</div>';
    return;
  }

  const rows = data.map(entry => {
    const issues = Array.isArray(entry.issues) ? entry.issues : [];
    const issueHtml = issues.length
      ? issues.map(i => `<span class="issue-pill issue-critical">${typeof i === 'string' ? i : (i.message || i.type || 'Issue')}</span>`).join(' ')
      : '<span class="issue-pill issue-pass">Passed</span>';
    return `<tr>
      <td>${entry.device || entry.page || '—'}</td>
      <td style="word-break:break-all;"><a href="${entry.url}" target="_blank">${entry.url}</a></td>
      <td>${entry.status || (issues.length ? 'failed' : 'passed')}</td>
      <td>${issueHtml}</td>
    </tr>`;
  }).join('');

  const failed = data.filter(e => (e.issues || []).length > 0).length;

  viewerEl.innerHTML = `
    <h2 class="card-title">UI Check Results</h2>
    <div class="stats-grid">
      <div class="stat-item"><span class="stat-value">${data.length}</span><span class="stat-label">Checks</span></div>
      <div class="stat-item highlight"><span class="stat-value">${failed}</span><span class="stat-label">With Issues</span></div>
    </div>
    <div class="table-container"><table class="results-table">
      <thead><tr><th>Device</th><th>URL</th><th>Status</th><th>Issues</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

window.renderUiCheckReport = renderUiCheckReport;