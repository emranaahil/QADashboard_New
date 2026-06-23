function renderFullUiReport(result, viewerEl) {
  const data = result.data;
  if (!Array.isArray(data)) {
    viewerEl.innerHTML = '<div class="alert alert-empty">Invalid Full UI check report data.</div>';
    return;
  }

  const rows = data.map(entry => {
    const issues = Array.isArray(entry.issues) ? entry.issues : [];
    const issueHtml = issues.length
      ? `<span class="issue-pill issue-critical">${issues.length} issue(s)</span>`
      : '<span class="issue-pill issue-pass">Passed</span>';
    return `<tr>
      <td style="word-break:break-all;"><a href="${entry.url}" target="_blank">${entry.url}</a></td>
      <td>${entry.device || entry.page || '—'}</td>
      <td>${entry.status || '—'}</td>
      <td>${issueHtml}</td>
    </tr>`;
  }).join('');

  const failed = data.filter(e => (e.issues || []).length > 0).length;

  viewerEl.innerHTML = `
    <h2 class="card-title">Full Site UI Check</h2>
    <div class="stats-grid">
      <div class="stat-item"><span class="stat-value">${data.length}</span><span class="stat-label">Pages Tested</span></div>
      <div class="stat-item highlight"><span class="stat-value">${failed}</span><span class="stat-label">With Issues</span></div>
    </div>
    <div class="table-container"><table class="results-table">
      <thead><tr><th>URL</th><th>Device</th><th>Status</th><th>Issues</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No page data</td></tr>'}</tbody>
    </table></div>`;
}

window.renderFullUiReport = renderFullUiReport;