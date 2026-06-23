function renderErrorCheckReport(result, viewerEl) {
  const data = result.data;
  if (!data) {
    viewerEl.innerHTML = '<div class="alert alert-empty">Invalid error check report.</div>';
    return;
  }

  const brokenPages = data.brokenPages || [];
  const brokenLinks = data.brokenLinks || [];

  const pageRows = brokenPages.map(p => `<tr style="background:#fef2f2">
    <td style="word-break:break-all;"><a href="${p.url}" target="_blank">${p.url}</a></td>
    <td>${(p.detectedErrors || []).join(', ')}</td>
  </tr>`).join('');

  const linkRows = brokenLinks.map(l => `<tr>
    <td style="word-break:break-all;"><a href="${l.brokenUrl}" target="_blank">${l.brokenUrl}</a></td>
    <td style="word-break:break-all;"><a href="${l.foundIn}" target="_blank">${l.foundIn}</a></td>
  </tr>`).join('');

  viewerEl.innerHTML = `
    <h2 class="card-title">Error Check — ${data.url || 'Report'}</h2>
    <p class="form-hint">Generated: ${data.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—'}</p>
    <div class="stats-grid">
      <div class="stat-item"><span class="stat-value">${data.checked || 0}</span><span class="stat-label">Checked</span></div>
      <div class="stat-item highlight"><span class="stat-value">${brokenPages.length}</span><span class="stat-label">Broken Pages</span></div>
      <div class="stat-item"><span class="stat-value">${brokenLinks.length}</span><span class="stat-label">Broken Links</span></div>
    </div>
    <h3 style="margin:1rem 0 0.5rem;font-size:0.95rem;">Broken Pages</h3>
    <div class="table-container"><table class="results-table">
      <thead><tr><th>URL</th><th>Issues</th></tr></thead>
      <tbody>${pageRows || '<tr><td colspan="2">None</td></tr>'}</tbody>
    </table></div>
    <h3 style="margin:1rem 0 0.5rem;font-size:0.95rem;">Broken Links</h3>
    <div class="table-container"><table class="results-table">
      <thead><tr><th>Broken URL</th><th>Found In</th></tr></thead>
      <tbody>${linkRows || '<tr><td colspan="2">None</td></tr>'}</tbody>
    </table></div>`;
}

window.renderErrorCheckReport = renderErrorCheckReport;